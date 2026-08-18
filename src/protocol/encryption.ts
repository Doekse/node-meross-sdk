import { createCipheriv, createDecipheriv, createECDH, createHash } from 'node:crypto';

import { ProtocolError } from '../errors';
import type { MerossPayload } from './message';

export const ENCRYPT_SUITE_NAMESPACE = 'Appliance.Encrypt.Suite';
export const ENCRYPT_ECDHE_NAMESPACE = 'Appliance.Encrypt.ECDHE';

/**
 * AES-CBC IV is 16 ASCII `0` characters, not 16 NUL bytes.
 */
const IV = Buffer.from('0000000000000000', 'utf8');

export interface EncryptSuite {
    ka: string;
    se: string;
    ds: string;
}

export interface EncryptEcdhe {
    step: number;
    pubkey: string;
}

/**
 * Suite `se: mrskey` after configuration: UUID slice + cloud key slices + MAC,
 * then MD5 hex as a 32-byte UTF-8 AES-256 key. `ka: ecdhe256` names the
 * handshake; this mix is still the LAN cipher key once the device has an
 * account key.
 */
export function deriveEncryptionKey(uuid: string, mrskey: string, mac: string): Buffer {
    const mix = uuid.substring(3, 22) + mrskey.substring(1, 9) + mac + mrskey.substring(10, 28);
    return Buffer.from(createHash('md5').update(mix).digest('hex'), 'utf8');
}

/**
 * Ability maps advertise ECDHE when LAN HTTP bodies must be AES-wrapped.
 */
export function supportsLanEncryption(abilities: Record<string, unknown>): boolean {
    return ENCRYPT_ECDHE_NAMESPACE in abilities;
}

/**
 * AES-256-CBC of the already-encoded envelope, zero-padded to the next block.
 */
export function encryptPayload(plain: string, key: Buffer): string {
    const data = Buffer.from(plain, 'utf8');
    const padded = Buffer.concat([data, Buffer.alloc(16 - (data.length % 16))]);
    const cipher = createCipheriv('aes-256-cbc', key, IV);
    cipher.setAutoPadding(false);
    return Buffer.concat([cipher.update(padded), cipher.final()]).toString('base64');
}

/**
 * Inverse of {@link encryptPayload}. Trailing NULs are padding, not payload.
 */
export function decryptPayload(cipherText: string, key: Buffer): string {
    const encrypted = Buffer.from(cipherText, 'base64');
    const decipher = createDecipheriv('aes-256-cbc', key, IV);
    decipher.setAutoPadding(false);
    return Buffer.concat([decipher.update(encrypted), decipher.final()])
        .toString('utf8')
        .replace(/\0+$/, '');
}

/**
 * Firmware tables label these `the` / `with`; captured GETACK uses `ka` / `se`.
 */
export function decodeEncryptSuiteGetAck(payload: MerossPayload): EncryptSuite {
    const suite = payload.suite;
    if (typeof suite !== 'object' || suite === null) {
        throw new ProtocolError('Encrypt.Suite GETACK suite must be an object');
    }
    const { ka, se, ds } = suite as Record<string, unknown>;
    if (typeof ka !== 'string' || ka.length === 0 || typeof se !== 'string' || se.length === 0 || typeof ds !== 'string') {
        throw new ProtocolError('Encrypt.Suite suite requires ka, se, and ds');
    }
    return { ka, se, ds };
}

export function encodeEncryptEcdheSet(pubkey: string): MerossPayload {
    return { ecdhe: { step: 1, pubkey } };
}

export function decodeEncryptEcdheSetAck(payload: MerossPayload): EncryptEcdhe {
    const ecdhe = payload.ecdhe;
    if (typeof ecdhe !== 'object' || ecdhe === null) {
        throw new ProtocolError('Encrypt.ECDHE ecdhe must be an object');
    }
    const { step, pubkey } = ecdhe as Record<string, unknown>;
    if (step !== 2 || typeof pubkey !== 'string' || pubkey.length === 0) {
        throw new ProtocolError('Encrypt.ECDHE SETACK requires step 2 and pubkey');
    }
    return { step, pubkey };
}

/**
 * Holds the client's P-256 secret so SET / SETACK can finish without a
 * transport knowing ECDH.
 */
export class EcdheHandshake {
    private readonly ecdh = createECDH('prime256v1');

    constructor() {
        this.ecdh.generateKeys();
    }

    publicKey(): string {
        return this.ecdh.getPublicKey('base64');
    }

    computeSharedSecret(peerPublicKey: string): Buffer {
        return this.ecdh.computeSecret(peerPublicKey, 'base64');
    }
}
