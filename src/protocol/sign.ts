import { createHash } from 'node:crypto';

/**
 * Devices check MD5(messageId + key + timestamp) against `header.sign`;
 * the payload is not hashed.
 */
export function signMessage(messageId: string, key: string, timestamp: number): string {
    return createHash('md5')
        .update(`${messageId}${key}${timestamp}`)
        .digest('hex');
}

/**
 * Case-insensitive because some firmware emits uppercase hex.
 */
export function verifySignature(
    header: { messageId: string; timestamp: number; sign: string },
    key: string
): boolean {
    return signMessage(header.messageId, key, header.timestamp) === header.sign.toLowerCase();
}
