import http from 'node:http';

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

/**
 * meross_lan `ClientTimeout.total`. Sleepy boards take 0.6s–3.2s to accept TCP
 * after a Wi-Fi wake; aborting the whole POST at the 1s connect budget dropped
 * those.
 */
export const DEFAULT_LAN_TIMEOUT_MS = DEFAULT_COMMAND_TIMEOUT_MS;

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
}

/**
 * POST signed envelopes to `http://{ip}/config`. The HTTP body is the ACK, so
 * this still registers with {@link ProtocolDispatcher} to share pending ids
 * with MQTT (a cloud PUSH can arrive while a LAN GET is in flight).
 *
 * Default client is `node:http` with `insecureHTTPParser`: some firmware ends
 * response lines with LF, which undici `fetch` rejects.
 *
 * POSTs to the same uuid are serialized: Meross devices mishandle concurrent
 * HTTP ([meross_lan #206](https://github.com/krahabb/meross_lan/issues/206)).
 */
export class LanHttpTransport {
    readonly dispatcher: ProtocolDispatcher;

    private readonly key: string;
    private readonly from: string;
    private readonly fetchFn: typeof globalThis.fetch;
    /** Tail of each uuid's POST chain, not a backlog: one entry per device. */
    private readonly queues = new Map<string, Promise<void>>();

    constructor(options: LanHttpTransportOptions) {
        this.key = options.key;
        this.from = options.from;
        this.fetchFn = options.fetch ?? defaultFetch;
        this.dispatcher = options.dispatcher ?? new ProtocolDispatcher();
    }

    async request(options: LanHttpRequestOptions): Promise<MerossMessage> {
        const previous = this.queues.get(options.uuid);
        let release!: () => void;
        this.queues.set(options.uuid, new Promise<void>((resolve) => {
            release = resolve;
        }));

        await previous;
        try {
            return await this.post(options);
        } finally {
            release();
        }
    }

    /**
     * Abort must reject pending as a transport miss: a pending CommandError
     * looks delivered, so TransportRouter would not fail over to MQTT.
     */
    private async post(options: LanHttpRequestOptions): Promise<MerossMessage> {
        const message = encodeMessage({
            namespace: options.namespace,
            method: options.method,
            key: this.key,
            from: this.from,
            payload: options.payload,
            uuid: options.uuid
        });
        const messageId = message.header.messageId;
        const controller = new AbortController();
        const timer = setTimeout(() => {
            this.dispatcher.pending.reject(messageId, new TransportError(
                `LAN HTTP timed out after ${DEFAULT_LAN_TIMEOUT_MS}ms`,
                'LAN_TIMEOUT'
            ));
            controller.abort();
        }, DEFAULT_LAN_TIMEOUT_MS);
        const reply = this.dispatcher.pending.register(messageId, DEFAULT_LAN_TIMEOUT_MS);

        let body = JSON.stringify(message);
        if (options.encryptionKey) {
            body = encryptPayload(body, options.encryptionKey);
        }

        try {
            await this.attempt(options, body, controller.signal);
        } catch (error) {
            if (!(error instanceof Error && error.name === 'AbortError')) {
                this.dispatcher.pending.reject(
                    messageId,
                    error instanceof ProtocolError || error instanceof TransportError
                        ? error
                        : new TransportError(
                            error instanceof Error ? error.message : String(error),
                            'LAN_UNREACHABLE'
                        )
                );
            }
        } finally {
            clearTimeout(timer);
        }

        return reply;
    }

    /**
     * Lets AbortError through so {@link post} does not map a timeout to
     * LAN_UNREACHABLE; abort already settled pending.
     */
    private async attempt(
        options: LanHttpRequestOptions,
        body: string,
        signal: AbortSignal
    ): Promise<void> {
        const response = await this.fetchFn(`http://${options.ip}/config`, {
            method: 'POST',
            headers: {
                'Content-Type': options.encryptionKey
                    ? 'application/octet-stream'
                    : 'application/json'
            },
            body,
            signal
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
        // Envelope often cannot identify the device; this POST's uuid can.
        if (this.dispatcher.handle(decoded, options.uuid) !== 'reply') {
            throw new ProtocolError('LAN HTTP response did not match a pending request');
        }
    }
}

/**
 * Firmware on some boards ends HTTP lines with LF, not CRLF. undici `fetch`
 * has no way to accept that; `insecureHTTPParser` does.
 */
function defaultFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
    const body = typeof init.body === 'string' ? init.body : '';
    return new Promise((resolve, reject) => {
        const req = http.request(String(input), {
            method: init.method ?? 'POST',
            headers: {
                ...(init.headers as http.OutgoingHttpHeaders),
                'Content-Length': Buffer.byteLength(body)
            },
            agent: false,
            insecureHTTPParser: true,
            signal: init.signal ?? undefined
        }, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => {
                chunks.push(chunk);
            });
            res.on('end', () => {
                resolve(new Response(Buffer.concat(chunks), {
                    status: res.statusCode ?? 0,
                    statusText: res.statusMessage ?? ''
                }));
            });
        });
        req.on('error', reject);
        req.end(body);
    });
}
