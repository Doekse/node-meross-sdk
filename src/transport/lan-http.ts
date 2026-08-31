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
 * First-attempt LAN HTTP timeout. Device HTTP times out with no apparent cause,
 * so attempts escalate from here (1s → 2s → 4s) the way meross_lan escalates
 * its connect timeout, rather than spending the router's error budget on one abort.
 * Raising this shortens the escalation, since the total must still fit inside
 * {@link DEFAULT_COMMAND_TIMEOUT_MS}.
 */
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
    /** First-attempt abort timeout; each retry doubles it while the total still fits. */
    timeoutMs?: number;
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
    private readonly timeoutMs: number;
    /** Tail of each uuid's POST chain, not a backlog: one entry per device. */
    private readonly queues = new Map<string, Promise<void>>();

    constructor(options: LanHttpTransportOptions) {
        this.key = options.key;
        this.from = options.from;
        this.fetchFn = options.fetch ?? defaultFetch;
        this.timeoutMs = options.timeoutMs ?? DEFAULT_LAN_TIMEOUT_MS;
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
     * Escalates the abort timeout across attempts, stopping while the total
     * still fits inside {@link DEFAULT_COMMAND_TIMEOUT_MS}: letting the pending
     * timer fire first would raise CommandError, which TransportRouter treats
     * as a delivered command and does not fail over to MQTT. Every exit settles
     * the pending id, so the returned promise never outlives the POST.
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
        const reply = this.dispatcher.pending.register(messageId, DEFAULT_COMMAND_TIMEOUT_MS);

        // Encode once so retries reuse the same messageId (pending rejects duplicates).
        let body = JSON.stringify(message);
        if (options.encryptionKey) {
            body = encryptPayload(body, options.encryptionKey);
        }

        let attemptTimeoutMs = this.timeoutMs;
        let elapsedMs = 0;
        for (;;) {
            try {
                await this.attempt(options, body, attemptTimeoutMs);
                break;
            } catch (error) {
                if (error instanceof Error && error.name === 'AbortError') {
                    elapsedMs += attemptTimeoutMs;
                    const nextTimeoutMs = attemptTimeoutMs * 2;
                    if (elapsedMs + nextTimeoutMs < DEFAULT_COMMAND_TIMEOUT_MS) {
                        attemptTimeoutMs = nextTimeoutMs;
                        continue;
                    }
                    this.dispatcher.pending.reject(messageId, new TransportError(
                        `LAN HTTP timed out after ${elapsedMs}ms`,
                        'LAN_TIMEOUT'
                    ));
                    break;
                }

                this.dispatcher.pending.reject(
                    messageId,
                    error instanceof ProtocolError || error instanceof TransportError
                        ? error
                        : new TransportError(
                            error instanceof Error ? error.message : String(error),
                            'LAN_UNREACHABLE'
                        )
                );
                break;
            }
        }

        return reply;
    }

    /**
     * Lets the abort surface as AbortError rather than normalising it here, so
     * {@link post} can tell a transient blip from a hard failure.
     */
    private async attempt(
        options: LanHttpRequestOptions,
        body: string,
        timeoutMs: number
    ): Promise<void> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await this.fetchFn(`http://${options.ip}/config`, {
                method: 'POST',
                headers: {
                    'Content-Type': options.encryptionKey
                        ? 'application/octet-stream'
                        : 'application/json'
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

            if (this.dispatcher.handle(decodeMessage(text, this.key)) !== 'reply') {
                throw new ProtocolError('LAN HTTP response did not match a pending request');
            }
        } finally {
            clearTimeout(timer);
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
