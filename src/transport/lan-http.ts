import { ProtocolError, TransportError } from '../errors';
import {
    DEFAULT_COMMAND_TIMEOUT_MS,
    ProtocolDispatcher,
    decodeMessage,
    decryptPayload,
    encodeMessage,
    encryptPayload
} from '../protocol';
import type { MerossMessage, MerossPayload } from '../protocol';

/** LAN is on-link; keep this well under the MQTT pending timeout. */
export const DEFAULT_LAN_TIMEOUT_MS = 1_000;

export interface LanHttpRequestOptions {
    uuid: string;
    ip: string;
    namespace: string;
    method: string;
    payload?: MerossPayload;
    encryptionKey?: Buffer;
}

export interface LanHttpTransportOptions {
    key: string;
    from: string;
    dispatcher?: ProtocolDispatcher;
    fetch?: typeof globalThis.fetch;
    timeoutMs?: number;
}

/**
 * POST signed envelopes to `http://{ip}/config`. The HTTP body is the ACK, so
 * this still registers with {@link ProtocolDispatcher} to share pending ids
 * with MQTT (a cloud PUSH can arrive while a LAN GET is in flight).
 */
export class LanHttpTransport {
    readonly dispatcher: ProtocolDispatcher;

    private readonly key: string;
    private readonly from: string;
    private readonly fetchFn: typeof globalThis.fetch;
    private readonly timeoutMs: number;

    constructor(options: LanHttpTransportOptions) {
        this.key = options.key;
        this.from = options.from;
        this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
        this.timeoutMs = options.timeoutMs ?? DEFAULT_LAN_TIMEOUT_MS;
        this.dispatcher = options.dispatcher ?? new ProtocolDispatcher();
    }

    async request(options: LanHttpRequestOptions): Promise<MerossMessage> {
        const message = encodeMessage({
            namespace: options.namespace,
            method: options.method,
            key: this.key,
            from: this.from,
            payload: options.payload,
            uuid: options.uuid
        });
        const reply = this.dispatcher.pending.register(
            message.header.messageId,
            DEFAULT_COMMAND_TIMEOUT_MS
        );

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            let body = JSON.stringify(message);
            if (options.encryptionKey) {
                body = encryptPayload(body, options.encryptionKey);
            }

            const response = await this.fetchFn(`http://${options.ip}/config`, {
                method: 'POST',
                headers: {
                    'Content-Type': options.encryptionKey ? 'application/octet-stream' : 'application/json'
                },
                body,
                signal: controller.signal
            });

            if (response.status !== 200) {
                throw new TransportError(
                    `LAN HTTP ${response.status}: ${response.statusText}`,
                    'LAN_HTTP_ERROR'
                );
            }

            let text = await response.text();
            if (options.encryptionKey) {
                text = decryptPayload(text, options.encryptionKey);
            }

            const decoded = decodeMessage(text, this.key);
            if (this.dispatcher.handle(decoded) !== 'reply') {
                throw new ProtocolError('LAN HTTP response did not match a pending request');
            }
        } catch (error) {
            let normalized: Error;
            if (error instanceof ProtocolError || error instanceof TransportError) {
                normalized = error;
            } else if (error instanceof Error && error.name === 'AbortError') {
                normalized = new TransportError(
                    `LAN HTTP timed out after ${this.timeoutMs}ms`,
                    'LAN_TIMEOUT'
                );
            } else {
                normalized = new TransportError(
                    error instanceof Error ? error.message : String(error),
                    'LAN_UNREACHABLE'
                );
            }
            this.dispatcher.pending.reject(message.header.messageId, normalized);
        } finally {
            clearTimeout(timer);
        }

        return reply;
    }
}
