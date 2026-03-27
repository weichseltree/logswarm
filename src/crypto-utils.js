/**
 * Hashes a secret string using SHA-256 and returns the hex digest.
 * Used to map user-entered secrets to Firestore document IDs without
 * storing the plaintext secret.
 */
export async function hashSecret(secret) {
  const encoder = new TextEncoder();
  const data = encoder.encode(secret);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generates a cryptographically random node ID (hex string).
 */
export function generateNodeId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
