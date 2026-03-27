# 07 — Authentication

> **Goal:** Define the authentication flow using local device meta-information for primary auth and nearby trusted devices for 2FA.

---

## Overview

Logswarm authentication is designed for **local-first, zero-password** operation:

1. **Primary auth** — The device itself is the identity. A cryptographic keypair stored in the browser's `SubtleCrypto` or the OS keychain proves device ownership.
2. **2FA** — A second trusted device nearby (discovered via Firebase presence) confirms the login attempt.

No usernames or passwords are involved. The "user" is the set of trusted devices.

---

## Authentication Flow

```
Device A (new session)              logswarm daemon               Device B (trusted)
        │                                  │                              │
        │  1. GET /auth/challenge          │                              │
        │─────────────────────────────────▶│                              │
        │  { challenge: nonce }            │                              │
        │◀─────────────────────────────────│                              │
        │                                  │                              │
        │  2. Sign challenge with          │                              │
        │     device private key           │                              │
        │                                  │                              │
        │  3. POST /auth/verify            │                              │
        │  { device_id, signature,         │                              │
        │    device_meta }                 │                              │
        │─────────────────────────────────▶│                              │
        │                                  │  4. Verify signature          │
        │                                  │     against stored pubkey     │
        │                                  │                              │
        │                                  │  5. If 2FA required:         │
        │                                  │     Push challenge to         │
        │                                  │     Device B via Firebase     │
        │                                  │─────────────────────────────▶│
        │                                  │                              │
        │  6. "Waiting for 2FA…"           │                    7. User   │
        │◀─────────────────────────────────│                    approves  │
        │                                  │                    on B      │
        │                                  │◀─────────────────────────────│
        │                                  │  8. 2FA confirmed            │
        │  9. { token: JWT }               │                              │
        │◀─────────────────────────────────│                              │
        │                                  │                              │
        │  10. Connect WebSocket           │                              │
        │      with JWT in header          │                              │
        │─────────────────────────────────▶│                              │
```

---

## Device Identity

### Key Generation (first visit)

On the very first visit to the dashboard, the frontend generates a device keypair:

```typescript
const keyPair = await crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  false,                    // non-extractable
  ["sign", "verify"]
);

// Store in IndexedDB
await idb.put("logswarm-keys", {
  id: "device-keypair",
  privateKey: keyPair.privateKey,
  publicKey: keyPair.publicKey,
});
```

The **public key** is sent to the daemon during the first `/auth/verify` call. The daemon stores it as a known device.

### Device Meta-Information

Along with the signature, the device sends meta-information used for trust scoring:

```typescript
interface DeviceMeta {
  userAgent: string;
  platform: string;
  screenResolution: [number, number];
  timezone: string;
  language: string;
  hardwareConcurrency: number;
  deviceMemory?: number;
  gpu?: string;              // via WebGL renderer string
  touchPoints: number;
}
```

This meta-information is **not** used as the sole authentication factor — the cryptographic signature is. However, significant changes in meta-information (e.g., suddenly a different GPU or platform) trigger **mandatory 2FA** even if the keypair is valid.

---

## 2FA via Trusted Device

### Device Trust Model

```
┌──────────────────────────────────────────┐
│  Trust Ring                               │
│                                          │
│  ┌──────────┐    ┌──────────┐            │
│  │ Device A  │◀──▶│ Device B  │  mutual   │
│  │ (laptop)  │    │ (phone)   │  trust    │
│  └──────────┘    └──────────┘            │
│        ▲                                  │
│        │ one-way trust                    │
│        ▼                                  │
│  ┌──────────┐                             │
│  │ Device C  │                             │
│  │ (tablet)  │                             │
│  └──────────┘                             │
└──────────────────────────────────────────┘
```

- **Mutual trust:** Both devices can approve 2FA for each other.
- **One-way trust:** Device A trusts Device C, but C cannot approve 2FA for A.

### Trust Establishment

A new device joins the trust ring by being **physically present** with an already-trusted device:

1. Trusted device generates a one-time pairing code (6-digit TOTP).
2. New device enters the code on its dashboard.
3. Daemon verifies the code and adds the new device's public key to the trust ring.
4. Trust direction defaults to **one-way** (trusted → new). The existing trusted device can upgrade it to mutual.

### 2FA Challenge via Firebase

When 2FA is required, the daemon writes a challenge to Firebase Realtime DB:

```json
{
  "requester_device": "device-A-id",
  "responder_device": "device-B-id",
  "challenge_hash": "BLAKE3(nonce || device-A-pubkey)",
  "status": "pending",
  "created_at": 1679000000000,
  "expires_at": 1679000030000
}
```

Device B receives this via Firebase's real-time listener and displays an approval prompt. On approval:

```json
{
  "status": "approved",
  "signature": "ECDSA-sign(challenge_hash, device-B-privkey)"
}
```

The daemon verifies Device B's signature and issues the JWT to Device A.

### 2FA Timeout

If no trusted device responds within 30 seconds, the challenge expires. The user can retry or add a new trusted device via the pairing flow.

---

## JWT Token

After successful authentication (+ 2FA if required), the daemon issues a JWT:

```json
{
  "sub": "device-A-id",
  "iat": 1679000000,
  "exp": 1679086400,
  "trust_level": "mutual",
  "streams": ["*"],
  "capabilities": {
    "camera": true,
    "microphone": true,
    "gamepad": false
  }
}
```

- **`trust_level`** — Determines which routes the device can access.
- **`streams`** — Which streams the device is authorized to read (`*` = all).
- **`capabilities`** — The device's granted input permissions (from the permission gate).

The JWT is sent as a `Bearer` token in the WebSocket upgrade request.

---

## Coding Agent Tasks

### Task 1: Implement device key management (frontend)

- [ ] Generate ECDSA P-256 keypair on first visit using `SubtleCrypto`.
- [ ] Store keypair in IndexedDB (non-extractable private key).
- [ ] Implement `signChallenge(challenge: ArrayBuffer): Promise<ArrayBuffer>`.

### Task 2: Implement auth endpoints (daemon)

- [ ] `GET /auth/challenge` — Generate and return a random nonce.
- [ ] `POST /auth/verify` — Verify ECDSA signature against stored public key.
- [ ] Store device public keys and meta-information in the event store.
- [ ] Use `jsonwebtoken` crate for JWT issuance.

### Task 3: Implement 2FA challenge flow

- [ ] On the daemon: write 2FA challenges to Firebase Realtime DB.
- [ ] On the frontend (trusted device): listen for incoming challenges via Firebase real-time listener.
- [ ] Display approval prompt with requester device meta-info.
- [ ] On approval: sign the challenge hash and write the signature back to Firebase.
- [ ] On the daemon: poll/subscribe Firebase for status changes, verify responder signature.

### Task 4: Implement trust ring management

- [ ] `POST /auth/pair/initiate` — Generate a TOTP code, store it with a 60-second TTL.
- [ ] `POST /auth/pair/complete` — Verify the TOTP code, add the new device to the trust ring.
- [ ] `POST /auth/trust/upgrade` — Upgrade one-way trust to mutual (requires the existing trusted device).
- [ ] Store trust relationships in the event store.

### Task 5: Implement meta-information anomaly detection

- [ ] On each auth attempt, compare current `DeviceMeta` with stored meta.
- [ ] Compute a similarity score (weighted Jaccard over categorical fields, relative diff for numeric fields).
- [ ] If similarity < 0.7, force 2FA regardless of existing trust level.
- [ ] Log anomalies for audit.
