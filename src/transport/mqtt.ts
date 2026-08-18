import { createHash, randomUUID } from 'node:crypto';

import mqtt from 'mqtt';

import { TransportError } from '../errors';
import { ProtocolDispatcher, decodeMessage, encodeMessage } from '../protocol';
import type { MerossMessage, MerossPayload } from '../protocol';

/** Firmware `System.All` / meross_lan. meross-iot's MQTT manager still uses 2001. */
const MQTT_PORT = 443;
const CONNECT_TIMEOUT_MS = 30_000;

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
}

/**
 * Tests inject a fake. Factories must not emit `connect` during construction.
 */
export interface MqttBrokerClient {
    on(event: 'connect', listener: () => void): unknown;
    on(event: 'message', listener: (topic: string, payload: Buffer) => void): unknown;
    on(event: 'error', listener: (error: Error) => void): unknown;
    on(event: 'close', listener: () => void): unknown;
    subscribe(topic: string, callback: (error?: Error | null) => void): void;
    publish(topic: string, payload: string, callback: (error?: Error | null) => void): void;
    end(force: boolean, callback: () => void): void;
}

export type MqttConnectFn = (options: MqttConnectOptions) => MqttBrokerClient;

export interface MqttTransportOptions {
    userId: string;
    key: string;
    mqttDomain: string;
    appId?: string;
    dispatcher?: ProtocolDispatcher;
    connect?: MqttConnectFn;
}

export interface MqttRequestOptions {
    uuid: string;
    namespace: string;
    method: string;
    payload?: MerossPayload;
}

/**
 * Cloud MQTT: signed GET/SET on `/appliance/{uuid}/subscribe`, ACK on the
 * app response topic, PUSH on the user topic. Pending matching lives in
 * {@link ProtocolDispatcher} so LAN can share the same registry later.
 */
export class MqttTransport {
    readonly appId: string;
    readonly clientResponseTopic: string;
    readonly dispatcher: ProtocolDispatcher;

    private readonly userId: string;
    private readonly key: string;
    private readonly mqttDomain: string;
    private readonly connectFn: MqttConnectFn;
    private client: MqttBrokerClient | undefined;
    private connectPromise: Promise<void> | null = null;
    private connected = false;

    constructor(options: MqttTransportOptions) {
        this.userId = options.userId;
        this.key = options.key;
        this.mqttDomain = options.mqttDomain;
        this.connectFn = options.connect ?? defaultConnect;
        this.appId = options.appId
            ?? createHash('md5').update(`API${randomUUID()}`).digest('hex');
        this.clientResponseTopic = `/app/${this.userId}-${this.appId}/subscribe`;
        this.dispatcher = options.dispatcher ?? new ProtocolDispatcher();
    }

    async connect(): Promise<void> {
        if (this.connected) {
            return;
        }
        if (this.connectPromise) {
            return this.connectPromise;
        }
        this.connectPromise = this.open();
        try {
            await this.connectPromise;
        } finally {
            this.connectPromise = null;
        }
    }

    async disconnect(): Promise<void> {
        this.connected = false;
        this.dispatcher.pending.clear();
        const client = this.client;
        this.client = undefined;
        if (!client) {
            return;
        }
        await new Promise<void>((resolve) => client.end(true, resolve));
    }

    /**
     * Encode, register by messageId, publish, then wait for GETACK/SETACK/ERROR.
     */
    async request(options: MqttRequestOptions): Promise<MerossMessage> {
        const client = this.client;
        if (!client || !this.connected) {
            throw new TransportError('MQTT transport is not connected', 'MQTT_NOT_CONNECTED');
        }
        const message = encodeMessage({
            namespace: options.namespace,
            method: options.method,
            key: this.key,
            from: this.clientResponseTopic,
            payload: options.payload,
            uuid: options.uuid
        });
        const reply = this.dispatcher.pending.register(message.header.messageId);
        client.publish(
            `/appliance/${options.uuid}/subscribe`,
            JSON.stringify(message),
            (error) => {
                if (error) {
                    this.dispatcher.pending.reject(
                        message.header.messageId,
                        new TransportError(error.message, 'MQTT_PUBLISH_FAILED')
                    );
                }
            }
        );
        return reply;
    }

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
            reconnectPeriod: 0
        });
        this.client = client;

        try {
            await new Promise<void>((resolve, reject) => {
                let settled = false;
                const done = (error?: Error): void => {
                    if (settled) {
                        return;
                    }
                    settled = true;
                    clearTimeout(timer);
                    if (error) {
                        reject(error);
                    } else {
                        resolve();
                    }
                };
                const timer = setTimeout(() => {
                    done(new TransportError(
                        `MQTT connection timed out after ${CONNECT_TIMEOUT_MS}ms`,
                        'MQTT_CONNECT_TIMEOUT'
                    ));
                }, CONNECT_TIMEOUT_MS);

                client.on('connect', () => done());
                client.on('message', (_topic, payload) => {
                    try {
                        this.dispatcher.handle(decodeMessage(payload, this.key));
                    } catch {
                        // Drop malformed JSON and bad signatures.
                    }
                });
                client.on('error', (error) => {
                    done(new TransportError(error.message, 'MQTT_ERROR'));
                });
                client.on('close', () => {
                    this.connected = false;
                    this.client = undefined;
                    done(new TransportError('MQTT connection closed', 'MQTT_ERROR'));
                });
            });

            await Promise.all([
                `/app/${this.userId}/subscribe`,
                this.clientResponseTopic
            ].map((topic) => new Promise<void>((resolve, reject) => {
                client.subscribe(topic, (error) => {
                    if (error) {
                        reject(new TransportError(error.message, 'MQTT_SUBSCRIBE_FAILED'));
                        return;
                    }
                    resolve();
                });
            })));
            this.connected = true;
        } catch (error) {
            this.connected = false;
            this.client = undefined;
            await new Promise<void>((resolve) => client.end(true, resolve));
            throw error;
        }
    }
}

function defaultConnect(options: MqttConnectOptions): MqttBrokerClient {
    return mqtt.connect(options) as unknown as MqttBrokerClient;
}
