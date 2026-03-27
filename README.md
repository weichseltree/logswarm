# LogSwarm

Distributed computation routing and filtering with anonymous secret-based authentication. Connect devices to a cluster of computation nodes that collaborate on shared goals — all managed through Firebase with zero-knowledge identity.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser (Node)                           │
│                                                                 │
│  ┌──────────┐   ┌──────────┐   ┌────────────┐   ┌───────────┐ │
│  │  app.js   │──▶│  auth.js  │──▶│ crypto-    │   │ device-   │ │
│  │  (entry)  │   │  (core)  │   │ utils.js   │   │ info.js   │ │
│  └────┬─────┘   └────┬─────┘   └────────────┘   └─────┬─────┘ │
│       │              │                                  │       │
│       ▼              │                                  │       │
│  ┌──────────┐        │         ┌────────────────────────┘       │
│  │dashboard │◀───────┘         │                                │
│  │  .js     │◀─────────────────┘                                │
│  └──────────┘                                                   │
└───────┬─────────────────────────────────────────────────────────┘
        │  Firebase SDK
        ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Firebase Backend                            │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐│
│  │ Anonymous     │  │  Firestore   │  │  Cloud Storage         ││
│  │ Auth          │  │              │  │                        ││
│  │ (per-node UID)│  │  /secrets    │  │  /nodes/{uid}/…       ││
│  └──────────────┘  │  /nodes      │  │  /shared/{hash}/…     ││
│                     │  /shared     │  └────────────────────────┘│
│                     │  /routing    │                             │
│                     │  /clusters   │                             │
│                     │  /master     │                             │
│                     └──────────────┘                             │
└─────────────────────────────────────────────────────────────────┘
```

### Source Modules

| Module | Responsibility |
|--------|---------------|
| `src/app.js` | Entry point. Login screen with tabbed auth UI (PIN, passphrase, pattern, master). Manages attempt counter and transitions to dashboard. |
| `src/auth.js` | Core authentication engine. Firebase Anonymous Auth, secret registration/linking, node management, routing/filtering config, cluster operations, shared data CRUD, real-time subscriptions. |
| `src/crypto-utils.js` | SHA-256 hashing via Web Crypto API. Maps raw secrets to Firestore document IDs without storing plaintext. |
| `src/device-info.js` | Collects all available device data: browser, screen, hardware, GPS, battery, GPU/WebGL, permissions, media devices, storage, network. Subscribes to live sensors (orientation, motion, ambient light, connectivity). |
| `src/dashboard.js` | Renders the main dashboard grid: linked secrets, device info, permissions, live sensors, shared Firestore data, routing config, cluster nodes, and master view. |
| `src/firebase-config.js` | Firebase project credentials (must be replaced with real values). |
| `src/styles.css` | Dark-theme responsive CSS. |

### Authentication Model

This project does **not** use traditional email/password authentication. Instead:

1. **Every login is a secret.** Any PIN, passphrase, or pattern the user enters is SHA-256 hashed and looked up in the Firestore `secrets` collection.
2. **New secrets are auto-registered.** If the hash doesn't exist, it becomes a new secret owned by the current anonymous node.
3. **Existing secrets grant access.** If the hash already exists, it links to the current node and grants access to the shared data at that address.
4. **`6 7 OK` is the universal reset.** Entering PIN `67` clears all local state (localStorage, sessionStorage, IndexedDB, cookies), signs out, and reloads as a brand-new empty node. Users can never be locked out.
5. **Multiple secrets stack.** Users can add additional secrets from the dashboard, building up their access graph.
6. **Master password** unlocks read access to all secrets and private data (hash stored in `/master/config`, set via Firebase Console or Admin SDK).
7. **Max attempts (5)** — after exceeding, the UI hints to use `6 7 OK`. This is a soft limit, not a lockout.

### Firestore Schema

```
/secrets/{sha256Hash}
  ├── hash: string
  ├── nodeId: string (Firebase Auth UID of the creating node)
  ├── type: "pin" | "passphrase" | "pattern" | "master"
  └── createdAt: timestamp

/nodes/{uid}
  ├── createdAt: timestamp
  ├── lastSeen: timestamp
  ├── deviceInfo: { ...all device data }
  ├── linkedSecretCount: number
  ├── clusterId?: string
  └── /linkedSecrets/{sha256Hash}
      ├── hash: string
      ├── type: string
      ├── label: string (masked)
      └── linkedAt: timestamp

/shared/{sha256Hash}
  ├── ownerNodeId: string
  ├── createdAt: timestamp
  └── /data/{docId}
      ├── ...user data
      └── updatedAt: timestamp

/routing/{uid}
  ├── nodeId: string
  ├── active: boolean
  ├── filters: array
  └── routes: array

/clusters/{clusterId}
  ├── nodes: string[] (array of UIDs)
  └── createdAt: timestamp

/master/config
  └── hash: string (SHA-256 of master password)
```

### Security Rules Summary

| Collection | Read | Write |
|-----------|------|-------|
| `/secrets` | Any (for login verification) | Owner node only |
| `/nodes/{uid}` | Authenticated | Own node only |
| `/nodes/{uid}/linkedSecrets` | Own node | Own node |
| `/shared/{hash}/data` | Authenticated | Secret owner only |
| `/routing/{uid}` | Authenticated | Own node only |
| `/clusters` | Authenticated | Authenticated (create/join) |
| `/master` | Authenticated | None (admin-only) |

## Setup

### Prerequisites

- Node.js 18+
- A Firebase project with:
  - **Anonymous Authentication** enabled (Firebase Console → Authentication → Sign-in method)
  - **Firestore** database created
  - **Cloud Storage** bucket created (optional, for file sharing)

### Install & Configure

```bash
# Install dependencies
npm install

# Edit src/firebase-config.js with your Firebase project credentials
# Get these from Firebase Console → Project Settings → General → Your apps → Web app
```

### Firebase Configuration

Replace the placeholder values in `src/firebase-config.js`:

```js
const firebaseConfig = {
  apiKey: 'your-api-key',
  authDomain: 'your-project.firebaseapp.com',
  projectId: 'your-project-id',
  storageBucket: 'your-project.appspot.com',
  messagingSenderId: 'your-sender-id',
  appId: 'your-app-id',
};
```

### Set a Master Password (Optional)

In the Firebase Console → Firestore → create document at `/master/config`:

```json
{
  "hash": "<SHA-256 hex digest of your master password>"
}
```

Generate the hash: `echo -n "your-password" | sha256sum`

### Deploy Firebase Rules

```bash
# Install Firebase CLI if needed
npm install -g firebase-tools

# Log in and select your project
firebase login
firebase use your-project-id

# Deploy Firestore rules, indexes, and storage rules
firebase deploy --only firestore,storage
```

### Development

```bash
npm run dev       # Start Vite dev server on http://localhost:3000
npm run build     # Production build to dist/
npm run preview   # Preview production build locally
npm run deploy    # Build + deploy to Firebase Hosting
```

### Deploy to Firebase Hosting

```bash
npm run deploy
```

## Dashboard Sections

| Section | Content |
|---------|---------|
| **Linked Secrets** | All secrets linked to the current node (type, masked label, hash preview) |
| **Device Information** | Browser UA, platform, screen, hardware concurrency, memory, timezone |
| **Permissions & Input Sources** | API permission states (camera, mic, GPS, etc.), enumerated media devices, geolocation |
| **Live Sensors** | Real-time device orientation, motion/accelerometer, ambient light, online/offline |
| **Shared Data** | Firestore documents stored under each linked secret — live-updating via `onSnapshot` |
| **Routing & Filtering** | Per-node routing config with JSON filter/route arrays and active toggle |
| **Cluster Nodes** | Join a cluster by ID, view all member node IDs |
| **Master View** | (Master only) All registered secrets across all nodes |
