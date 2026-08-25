import { randomBytes } from 'node:crypto';

import { ProtocolError } from '../errors';
import { signMessage, verifySignature } from './sign';

/** Firmware `payloadVersion` is currently always 1. */
export const PAYLOAD_VERSION = 1;

/**
 * Signature does not cover this field. Matches official Android app traffic.
 */
export const DEFAULT_TRIGGER_SRC = 'Android';

export interface MerossHeader {
    messageId: string;
    namespace: string;
    method: string;
    payloadVersion: number;
    from: string;
    timestamp: number;
    sign: string;
    triggerSrc?: string;
    timestampMs?: number;
    uuid?: string;
}

export type MerossPayload = Record<string, unknown>;

export interface MerossMessage {
    header: MerossHeader;
    payload: MerossPayload;
}

export interface EncodeMessageOptions {
    namespace: string;
    method: string;
    key: string;
    from: string;
    payload?: MerossPayload;
    triggerSrc?: string;
    uuid?: string;
    messageId?: string;
    timestamp?: number;
    timestampMs?: number;
}

/**
 * Sign covers messageId + key + timestamp only; the payload is not hashed.
 */
export function encodeMessage(options: EncodeMessageOptions): MerossMessage {
    const messageId = options.messageId ?? randomBytes(16).toString('hex');
    const timestamp = options.timestamp ?? Math.trunc(Date.now() / 1000);
    return {
        header: {
            messageId,
            namespace: options.namespace,
            method: options.method,
            payloadVersion: PAYLOAD_VERSION,
            triggerSrc: options.triggerSrc ?? DEFAULT_TRIGGER_SRC,
            from: options.from,
            timestamp,
            timestampMs: options.timestampMs ?? 0,
            sign: signMessage(messageId, options.key, timestamp),
            ...(options.uuid ? { uuid: options.uuid } : {})
        },
        payload: options.payload ?? {}
    };
}

/**
 * Accepts MQTT/HTTP bytes, a JSON string, or an already-parsed object.
 * Pass `key` to reject a mismatched `sign`.
 */
export function decodeMessage(input: string | Buffer | unknown, key?: string): MerossMessage {
    let raw: unknown = input;
    if (typeof input === 'string' || Buffer.isBuffer(input)) {
        try {
            raw = JSON.parse(String(input));
        } catch {
            throw new ProtocolError('message is not valid JSON');
        }
    }
    if (typeof raw !== 'object' || raw === null) {
        throw new ProtocolError('message must be a JSON object');
    }

    const { header, payload } = raw as { header?: unknown; payload?: unknown };
    if (typeof header !== 'object' || header === null || typeof payload !== 'object' || payload === null) {
        throw new ProtocolError('message must have header and payload objects');
    }

    const message = { header: header as MerossHeader, payload: payload as MerossPayload };
    if (key !== undefined && !verifySignature(message.header, key)) {
        // ERROR 5001 is signed with the device key; a wrong caller key always
        // fails verify. Accept it so PendingRequests can surface INVALID_KEY.
        if (deviceErrorCode(message) !== 5001) {
            throw new ProtocolError('message signature is invalid', 'SIGNATURE_ERROR');
        }
    }
    return message;
}

/**
 * Firmware `payload.error.code` on method ERROR, if present and numeric.
 */
export function deviceErrorCode(message: MerossMessage): number | undefined {
    if (message.header.method !== 'ERROR') {
        return undefined;
    }
    const rawCode = (message.payload as { error?: { code?: unknown } }).error?.code;
    return typeof rawCode === 'number' ? rawCode : undefined;
}
