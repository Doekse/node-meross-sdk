import { createHash, randomUUID } from 'node:crypto';

import mqtt from 'mqtt';

import { TransportError } from '../errors';
import { ProtocolDispatcher, decodeMessage, encodeMessage } from '../protocol';
import type { MerossMessage, MerossPayload } from '../protocol';
import { PublishRateLimiter, type PublishPriority } from './rate-limit';

/** Cloud brokers listen on 443; older firmware used 2001. */
const MQTT_PORT = 443;

/**
 * Bound for the first {@link MqttTransport.connect} so Session cannot hang
 * while mqtt.js retries in the background.
 */
const CONNECT_TIMEOUT_MS = 30_000;

/**
 * Passed to mqtt.js so a dropped socket is retried on the same client.
 */
export const MQTT_RECONNECT_PERIOD_MS = 1_000;

export interface MqttConnectOptions {
    protocol: 'mqtts';
    host: string;
    port: number;
    clientId: string;
    username: string;
    password: string;
    rejectUnauthorized: boolean;
    keepalive: number;
    reconnectPeriod: number;
    /**
     * mqtt.js would replay stored topics on reconnect. Subscribe already
     * runs on every `connect` event.
     */
    resubscribe: boolean;
}

/**
 * mqtt.js client surface. Injected fakes must emit `connect` after return
 * so listeners are already attached.
 */
export interface MqttBrokerClient {
    on(event: 'connect', listener: () => void): unknown;
    on(event: 'message', listener: (topic: string, payload: Buffer) => void): unknown;
    on(event: 'error', listener: (error: Error) => void): unknown;
    on(event: 'close', listener: () => void): unknown;
    subscribe(topic: string, callback: (error?: Error | null) => void): void;
    publish(topic: string, payload: string, callback: (error?: Error | null) => void): void;
    end(force: boolean, callback: () => void): void;
    /** Drops the current connection and opens a new one with the same options. */
    reconnect(): void;
}

export type MqttConnectFn = (options: MqttConnectOptions) => MqttBrokerClient;

export interface MqttTransportOptions {
    userId: string;
    key: string;
    mqttDomain: string;
    appId?: string;
    dispatcher?: ProtocolDispatcher;
    connect?: MqttConnectFn;
    rateLimiter?: PublishRateLimiter;
    /**
     * Session re-emits this as `connection` so hosts can react to broker
     * drop without a public transport.
     */
    onConnectionChange?: (connected: boolean) => void;
    /**
     * Session re-emits this as `ratelimit` so hosts see drops that
     * DevicePoller's bare catch would otherwise swallow.
     */
    onRateLimit?: (uuid: string, dropped: number) => void;
}

export interface MqttRequestOptions {
    uuid: string;
    namespace: string;
    method: string;
    payload?: MerossPayload;
    /** Defaults to `user` so an unannotated caller keeps the full publish window. */
    priority?: PublishPriority;
}

/** First {@link MqttTransport.connect} must not settle on a later mqtt.js reconnect. */
interface Handshake {
    resolve: () => void;
    reject: (error: Error) => void;
}

/**
 * Cloud MQTT: signed GET/SET on `/appliance/{uuid}/subscribe`, ACK on the
 * app response topic, PUSH on the user topic. Pending matching lives in
 * {@link ProtocolDispatcher} so LAN HTTP can share the same registry.
 *
 * mqtt.js owns reconnect; {@link disconnect} is the only `end()` so a
 * dropped socket does not tear down the client.
 */
export class MqttTransport {
    readonly appId: string;
    readonly clientResponseTopic: string;
    readonly dispatcher: ProtocolDispatcher;

    private readonly userId: string;
    private readonly key: string;
    private readonly mqttDomain: string;
    private readonly connectFn: MqttConnectFn;
    private readonly rateLimiter: PublishRateLimiter;
    private readonly onConnectionChange?: (connected: boolean) => void;
    private readonly onRateLimit?: (uuid: string, dropped: number) => void;
    private client: MqttBrokerClient | undefined;
    private connectPromise: Promise<void> | null = null;
    private connected = false;
    private handshake: Handshake | null = null;
    /** Shared dispatcher also holds LAN ids; only these are cancelled on drop. */
    private readonly inflight = new Set<string>();

    constructor(options: MqttTransportOptions) {
        this.userId = options.userId;
        this.key = options.key;
        this.mqttDomain = options.mqttDomain;
        this.connectFn = options.connect ?? defaultConnect;
        this.rateLimiter = options.rateLimiter ?? new PublishRateLimiter();
        this.onConnectionChange = options.onConnectionChange;
        this.onRateLimit = options.onRateLimit;
        this.appId = options.appId
            ?? createHash('md5').update(`API${randomUUID()}`).digest('hex');
        this.clientResponseTopic = `/app/${this.userId}-${this.appId}/subscribe`;
        this.dispatcher = options.dispatcher ?? new ProtocolDispatcher();
    }

    /**
     * First handshake only. Later `connect` events come from mqtt.js; calling
     * this again must not create a second client.
     */
    async connect(): Promise<void> {
        if (this.connected) {
            return;
        }
        if (this.connectPromise) {
            return this.connectPromise;
        }
        if (this.client) {
            return;
        }
        this.connectPromise = this.open();
        try {
            await this.connectPromise;
        } finally {
            this.connectPromise = null;
        }
    }

    /**
     * Stops mqtt.js reconnect. Rejects an in-flight first handshake so
     * {@link connect} does not wait out the timeout.
     */
    async disconnect(): Promise<void> {
        this.applyConnected(false);
        this.handshake?.reject(new TransportError('MQTT connection closed', 'MQTT_ERROR'));
        this.dispatcher.pending.clear();
        this.inflight.clear();
        const client = this.client;
        this.client = undefined;
        if (!client) {
            return;
        }
        await new Promise<void>((resolve) => client.end(true, resolve));
    }

    async request(options: MqttRequestOptions): Promise<MerossMessage> {
        const client = this.client;
        if (!client || !this.connected) {
            throw new TransportError('MQTT transport is not connected', 'MQTT_NOT_CONNECTED');
        }
        // Refuse before pending.register so a dropped publish leaves no orphan id.
        if (!this.rateLimiter.take(options.uuid, options.priority ?? 'user')) {
            this.onRateLimit?.(options.uuid, this.rateLimiter.droppedCount(options.uuid));
            throw new TransportError(
                `MQTT publish rate limited for device ${options.uuid}`,
                'MQTT_RATE_LIMITED'
            );
        }
        const message = encodeMessage({
            namespace: options.namespace,
            method: options.method,
            key: this.key,
            from: this.clientResponseTopic,
            payload: options.payload,
            uuid: options.uuid
        });
        const messageId = message.header.messageId;
        const reply = this.dispatcher.pending.register(messageId);
        this.inflight.add(messageId);
        client.publish(
            `/appliance/${options.uuid}/subscribe`,
            JSON.stringify(message),
            (error) => {
                if (error) {
                    this.dispatcher.pending.reject(
                        messageId,
                        new TransportError(error.message, 'MQTT_PUBLISH_FAILED')
                    );
                }
            }
        );
        try {
            return await reply;
        } finally {
            this.inflight.delete(messageId);
        }
    }

    /**
     * Creates the client and waits for the first successful subscribe. Failure
     * calls `end()` because mqtt.js would otherwise keep retrying after
     * {@link connect} has already rejected.
     */
    private async open(): Promise<void> {
        const [host, portStr] = this.mqttDomain.split(':');
        const client = this.connectFn({
            protocol: 'mqtts',
            host,
            port: portStr ? Number(portStr) : MQTT_PORT,
            clientId: `app:${this.appId}`,
            username: this.userId,
            password: createHash('md5').update(`${this.userId}${this.key}`).digest('hex'),
            rejectUnauthorized: true,
            keepalive: 30,
            reconnectPeriod: MQTT_RECONNECT_PERIOD_MS,
            resubscribe: false
        });
        this.client = client;

        client.on('connect', () => this.onConnect(client));
        client.on('message', (_topic, payload) => {
            try {
                this.dispatcher.handle(decodeMessage(payload, this.key));
            } catch {
                // Unsigned or malformed payloads must not kill the socket.
            }
        });
        client.on('error', () => {
            // mqtt.js treats an unhandled `error` event as a thrown exception.
        });
        client.on('close', () => {
            const wasConnected = this.connected;
            this.applyConnected(false);
            if (wasConnected) {
                this.failInflight(new TransportError(
                    'MQTT connection closed',
                    'MQTT_DISCONNECTED'
                ));
            }
        });

        try {
            await new Promise<void>((resolve, reject) => {
                let settled = false;
                const timer = setTimeout(() => {
                    finish(new TransportError(
                        `MQTT connection timed out after ${CONNECT_TIMEOUT_MS}ms`,
                        'MQTT_CONNECT_TIMEOUT'
                    ));
                }, CONNECT_TIMEOUT_MS);
                const finish = (error?: Error): void => {
                    if (settled) {
                        return;
                    }
                    settled = true;
                    this.handshake = null;
                    clearTimeout(timer);
                    if (error) {
                        reject(error);
                    } else {
                        resolve();
                    }
                };
                this.handshake = {
                    resolve: () => finish(),
                    reject: (error) => finish(error)
                };
            });
        } catch (error) {
            this.applyConnected(false);
            if (this.client === client) {
                this.client = undefined;
                await new Promise<void>((resolve) => client.end(true, resolve));
            }
            throw error;
        }
    }

    /**
     * Reconnects start a new MQTT session; topics from the previous
     * connection are gone.
     */
    private onConnect(client: MqttBrokerClient): void {
        if (this.client !== client) {
            return;
        }
        const topics = [
            `/app/${this.userId}/subscribe`,
            this.clientResponseTopic
        ];
        let remaining = topics.length;
        let failed = false;
        for (const topic of topics) {
            client.subscribe(topic, (error) => {
                if (this.client !== client || failed) {
                    return;
                }
                if (error) {
                    failed = true;
                    this.applyConnected(false);
                    const transportError = new TransportError(error.message, 'MQTT_SUBSCRIBE_FAILED');
                    if (this.handshake) {
                        this.handshake.reject(transportError);
                        return;
                    }
                    // A subscribe that fails on reconnect leaves mqtt.js believing
                    // the socket is healthy, so it never retries on its own and
                    // every later request would fail with MQTT_NOT_CONNECTED.
                    client.reconnect();
                    return;
                }
                remaining -= 1;
                if (remaining !== 0) {
                    return;
                }
                this.applyConnected(true);
                this.handshake?.resolve();
            });
        }
    }

    /**
     * Skip-duplicate so `close` and {@link disconnect} do not emit twice
     * for the same drop.
     */
    private applyConnected(connected: boolean): void {
        if (this.connected === connected) {
            return;
        }
        this.connected = connected;
        this.onConnectionChange?.(connected);
    }

    /**
     * Only MQTT-originated ids. Clearing the shared registry would cancel a
     * LAN GET that is still on the wire.
     */
    private failInflight(error: Error): void {
        for (const messageId of this.inflight) {
            this.dispatcher.pending.reject(messageId, error);
        }
        this.inflight.clear();
    }
}

function defaultConnect(options: MqttConnectOptions): MqttBrokerClient {
    return mqtt.connect(options) as unknown as MqttBrokerClient;
}
