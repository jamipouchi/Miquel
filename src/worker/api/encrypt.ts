export async function encrypt(text: string, hexKey: string): Promise<string> {
    const encoder = new TextEncoder()

    // Convert hex key to bytes
    const keyBytes = new Uint8Array(hexKey.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)))

    // Import key
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt'])

    // Generate random IV
    const iv = crypto.getRandomValues(new Uint8Array(12))

    // Encrypt the text
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(text))

    // Combine IV and encrypted data
    const combined = new Uint8Array(iv.length + encrypted.byteLength)
    combined.set(iv)
    combined.set(new Uint8Array(encrypted), iv.length)

    // Convert to base64
    return btoa(String.fromCharCode(...combined))
}

export async function decrypt(encryptedText: string, hexKey: string): Promise<string> {
    const decoder = new TextDecoder()

    // Convert hex key to bytes
    const keyBytes = new Uint8Array(hexKey.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)))

    // Import key
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt'])

    // Decode from base64
    const combined = new Uint8Array(
        atob(encryptedText)
            .split('')
            .map((c) => c.charCodeAt(0))
    )

    // Extract IV and encrypted data
    const iv = combined.slice(0, 12)
    const encrypted = combined.slice(12)

    // Decrypt
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encrypted)

    return decoder.decode(decrypted)
}
