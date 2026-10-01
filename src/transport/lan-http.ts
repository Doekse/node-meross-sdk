import http from 'node:http';

import { ProtocolError, TransportError } from '../errors';
import { logError, logTraffic, type LogLevel, type SessionLogger } from '../log';
import { ProtocolDispatcher } from '../protocol/dispatcher';
import {
    decryptPayload,
    encryptPayload
} from '../protocol/encryption';
import {
    decodeMessage,
    deviceErrorMessage,
    encodeMessage,
    type MerossMessage,
    type MerossPayload
} from '../protocol/message';
import { DEFAULT_COMMAND_TIMEOUT_MS } from '../protocol/pending';

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
    logger?: SessionLogger;
    logLevel?: LogLevel;
}

/**
 * POST signed envelopes to `http://{ip}/config`. The HTTP body is the ACK, so
 * this still registers with {@link ProtocolDispatcher} to share pending ids
 * with MQTT (a cloud PUSH can arrive while a LAN GET is in flight).
 *
 * Default client is `node:http` with `insecureHTTPParser`: some firmware ends
 * response lines with LF, which undici `fetch` rejects. That path owns a
 * keep-alive {@link http.Agent} (`maxSockets: 1`) so sequential POSTs to one
 * host reuse a socket — defense if two uuids share an IP.
 * {@link disconnect} destroys the agent on router teardown so Sessions do not
 * leak free sockets. Injected `fetch` skips the agent (tests stay Agent-free).
 *
 * POSTs to the same uuid are serialized: Meross devices mishandle concurrent
 * HTTP ([meross_lan #206](https://github.com/krahabb/meross_lan/issues/206)).
 */
export class LanHttpTransport {
    readonly dispatcher: ProtocolDispatcher;

    private readonly key: string;
    private readonly from: string;
    private readonly fetchFn?: typeof globalThis.fetch;
    private readonly logger?: SessionLogger;
    private readonly logLevel?: LogLevel;
    /**
     * Present only for {@link postHttp}; {@link disconnect} destroys it so
     * keep-alive sockets do not outlive the Session.
     */
    private readonly agent?: http.Agent;
    /** Tail of each uuid's POST chain, not a backlog: one entry per device. */
    private readonly queues = new Map<string, Promise<void>>();
    /** Last POST host per uuid, so {@link forget} and a later IP can drop unused keep-alives. */
    private readonly lastIp = new Map<string, string>();

    constructor(options: LanHttpTransportOptions) {
        this.key = options.key;
        this.from = options.from;
        this.logger = options.logger;
        this.logLevel = options.logLevel;
        this.dispatcher = options.dispatcher ?? new ProtocolDispatcher();
        this.fetchFn = options.fetch;
        if (!options.fetch) {
            this.agent = new http.Agent({
                keepAlive: true,
                maxSockets: 1,
                maxFreeSockets: 1
            });
        }
    }

    /**
     * Drop keep-alive sockets owned by this transport. Injected-fetch
     * instances are a no-op.
     */
    disconnect(): void {
        this.lastIp.clear();
        this.agent?.destroy();
    }

    /**
     * Device left or is being rebuilt. Idle keep-alives for its last host go
     * with it; in-flight POSTs and the per-uuid queue stay.
     */
    forget(uuid: string): void {
        const ip = this.lastIp.get(uuid);
        this.lastIp.delete(uuid);
        if (!this.agent || !ip) {
            return;
        }
        const { hostname, port } = new URL(`http://${ip}/config`);
        const idle = this.agent.freeSockets[`${hostname}:${port || '80'}:`];
        if (!idle) {
            return;
        }
        for (const socket of idle) {
            socket.destroy();
        }
    }

    async request(options: LanHttpRequestOptions): Promise<MerossMessage> {
        const previous = this.queues.get(options.uuid);
        let release!: () => void;
        const current = new Promise<void>((resolve) => {
            release = resolve;
        });
        this.queues.set(options.uuid, current);

        await previous;
        try {
            return await this.post(options);
        } finally {
            release();
            // A departed uuid must not keep a settled Promise; a POST that
            // queued while this one was in flight must stay the tail.
            if (this.queues.get(options.uuid) === current) {
                this.queues.delete(options.uuid);
            }
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
        const target = `http://${options.ip}/config`;
        const timer = setTimeout(() => {
            const failure = `LAN HTTP timed out after ${DEFAULT_LAN_TIMEOUT_MS}ms`;
            const rejected = this.dispatcher.pending.reject(messageId, new TransportError(
                failure,
                'LAN_TIMEOUT'
            ));
            if (rejected) {
                logError(this.logger, {
                    channel: 'lan',
                    message: failure,
                    direction: 'rx',
                    target
                });
            }
            controller.abort();
        }, DEFAULT_LAN_TIMEOUT_MS);
        const reply = this.dispatcher.pending.register(messageId, DEFAULT_LAN_TIMEOUT_MS);
        const previous = this.lastIp.get(options.uuid);
        if (previous && previous !== options.ip) {
            this.forget(options.uuid);
        }
        this.lastIp.set(options.uuid, options.ip);

        const plaintext = JSON.stringify(message);
        logTraffic(this.logger, this.logLevel, {
            channel: 'lan',
            direction: 'tx',
            target,
            method: options.method,
            namespace: options.namespace,
            uuid: options.uuid,
            messageId,
            body: plaintext
        });
        const body = options.encryptionKey
            ? encryptPayload(plaintext, options.encryptionKey)
            : plaintext;

        try {
            await this.attempt(options, body, controller.signal, target);
        } catch (error) {
            if (!(error instanceof Error && error.name === 'AbortError')) {
                this.rejectFailedPost(messageId, target, error);
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
        signal: AbortSignal,
        target: string
    ): Promise<void> {
        const contentType = options.encryptionKey
            ? 'application/octet-stream'
            : 'application/json';
        const fetchFn = this.fetchFn;
        if (fetchFn) {
            const response = await fetchFn(target, {
                method: 'POST',
                headers: { 'Content-Type': contentType },
                body,
                signal
            });
            if (response.status !== 200) {
                // Undici holds the socket until the body is consumed or cancelled.
                try {
                    if (response.body) {
                        await response.body.cancel();
                    } else {
                        await response.arrayBuffer();
                    }
                } catch {
                    // cancel/arrayBuffer throw when the connection is already closed.
                }
                const failure = `LAN HTTP ${response.status}: ${response.statusText}`;
                logError(this.logger, {
                    channel: 'lan',
                    message: failure,
                    direction: 'rx',
                    target
                });
                throw new TransportError(failure, 'LAN_HTTP_ERROR');
            }
            this.onMessage(options, target, await response.text());
            return;
        }

        const response = await postHttp(target, body, contentType, signal, this.agent);
        if (response.status !== 200) {
            const failure = `LAN HTTP ${response.status}: ${response.statusText}`;
            logError(this.logger, {
                channel: 'lan',
                message: failure,
                direction: 'rx',
                target
            });
            throw new TransportError(failure, 'LAN_HTTP_ERROR');
        }
        this.onMessage(options, target, response.body);
    }

    /**
     * HTTP status errors are already logged where they are thrown. Other
     * failures are logged here before pending is rejected.
     */
    private rejectFailedPost(messageId: string, target: string, error: unknown): void {
        const isHttpStatus = error instanceof TransportError && error.code === 'LAN_HTTP_ERROR';
        const detail = error instanceof Error ? error.message : String(error);
        if (!isHttpStatus) {
            logError(this.logger, {
                channel: 'lan',
                message: `LAN POST failed: ${detail}`,
                direction: 'tx',
                target
            });
        }
        const cause = error instanceof ProtocolError || error instanceof TransportError
            ? error
            : new TransportError(detail, 'LAN_UNREACHABLE');
        this.dispatcher.pending.reject(messageId, cause);
    }

    /**
     * Decode reuses the UTF-8 string when decrypt already produced it. The
     * traffic log reads that same string for its summary.
     */
    private onMessage(
        options: LanHttpRequestOptions,
        target: string,
        wire: string | Buffer
    ): void {
        let text: string | undefined;
        const asText = (): string => {
            text ??= typeof wire === 'string' ? wire : wire.toString('utf8');
            return text;
        };
        const plaintext = options.encryptionKey
            ? decryptPayload(asText(), options.encryptionKey)
            : undefined;

        logTraffic(this.logger, this.logLevel, {
            channel: 'lan',
            direction: 'rx',
            target,
            uuid: options.uuid,
            fallback: 'LAN HTTP 200',
            body: plaintext ?? asText()
        });

        const decoded = decodeMessage(plaintext ?? text ?? wire, this.key);
        if (decoded.header.method === 'ERROR') {
            logError(this.logger, {
                channel: 'lan',
                message: deviceErrorMessage(decoded),
                direction: 'rx',
                target,
                data: () => JSON.stringify(decoded.payload)
            });
        }
        // Envelope often cannot identify the device; this POST's uuid can.
        if (this.dispatcher.handle(decoded, options.uuid) !== 'reply') {
            throw new ProtocolError('LAN HTTP response did not match a pending request');
        }
    }
}

/**
 * Firmware on some boards ends HTTP lines with LF, not CRLF. undici `fetch`
 * has no way to accept that; `insecureHTTPParser` does. Caller-owned
 * {@link http.Agent} keeps the pool per-transport (not process-wide).
 *
 * Returns the socket Buffer so ACK decode does not wrap a Fetch {@link Response}
 * and call `text()` on the same bytes.
 */
function postHttp(
    target: string,
    body: string,
    contentType: string,
    signal: AbortSignal,
    agent: http.Agent | undefined
): Promise<{ status: number; statusText: string; body: Buffer }> {
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (
            error?: Error,
            result?: { status: number; statusText: string; body: Buffer }
        ): void => {
            if (settled) {
                return;
            }
            settled = true;
            if (error) {
                reject(error);
            } else if (result) {
                resolve(result);
            }
        };

        const req = http.request(target, {
            method: 'POST',
            headers: {
                'Content-Type': contentType,
                'Content-Length': Buffer.byteLength(body)
            },
            agent,
            insecureHTTPParser: true,
            signal
        }, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => {
                chunks.push(chunk);
            });
            res.on('error', finish);
            res.on('end', () => {
                finish(undefined, {
                    status: res.statusCode ?? 0,
                    statusText: res.statusMessage ?? '',
                    body: chunks.length === 1 ? chunks[0]! : Buffer.concat(chunks)
                });
            });
            // Abort after headers often destroys the socket without `end`.
            res.on('close', () => {
                if (!res.complete) {
                    const error = new Error('The operation was aborted');
                    error.name = 'AbortError';
                    finish(error);
                }
            });
        });
        req.on('error', finish);
        req.end(body);
    });
}
