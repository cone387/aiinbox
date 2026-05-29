const SALT = new Uint8Array([65, 73, 67, 104, 97, 116, 67, 111, 108, 108, 101, 99, 116, 111, 114, 49])

/**
 * Secure storage for sensitive data (auth tokens) using AES-GCM encryption.
 */
export class SecureStorage {
  private async getEncryptionKey(): Promise<CryptoKey> {
    // Use a device-specific identifier as key material
    const deviceId = await this.getDeviceId()
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(deviceId),
      'PBKDF2',
      false,
      ['deriveKey']
    )
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: SALT, iterations: 100000, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    )
  }

  async encrypt(plaintext: string): Promise<string> {
    const key = await this.getEncryptionKey()
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(plaintext)
    )
    // Combine iv + ciphertext and encode as base64
    const combined = new Uint8Array(iv.length + new Uint8Array(encrypted).length)
    combined.set(iv)
    combined.set(new Uint8Array(encrypted), iv.length)
    return btoa(String.fromCharCode(...combined))
  }

  async decrypt(ciphertext: string): Promise<string> {
    const key = await this.getEncryptionKey()
    const data = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0))
    const iv = data.slice(0, 12)
    const encrypted = data.slice(12)
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      encrypted
    )
    return new TextDecoder().decode(decrypted)
  }

  private async getDeviceId(): Promise<string> {
    // Use extension ID as a stable device identifier
    const id = chrome.runtime.id
    return `aiinbox_${id}_device_key`
  }
}

export const secureStorage = new SecureStorage()
