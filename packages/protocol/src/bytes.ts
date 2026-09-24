/**
 * Bytes as text: base64 (RFC 4648 §4) for bot images in JSON, base64url without padding (§5) for
 * links, and SHA-256 in lowercase hex. Web Crypto and `atob`/`btoa` only, so the browser, the
 * Worker, and Bun all run it.
 */

/** Standard base64 of `bytes`, padded. */
export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  // In slices: String.fromCharCode takes its bytes as arguments, and those have a limit.
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  }
  return btoa(binary)
}

/** The bytes of base64 text, padded or not. Throws on a character outside the alphabet. */
export function fromBase64(text: string): Uint8Array {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** Base64url without padding (RFC 4648 §5). */
export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** The bytes of base64url text, padded or not. Throws on a character outside the alphabet. */
export function fromBase64Url(text: string): Uint8Array {
  return fromBase64(text.replace(/-/g, '+').replace(/_/g, '/'))
}

/** SHA-256 of `bytes`, lowercase hex. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')
}
