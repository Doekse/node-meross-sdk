import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';

import { CommandError, TransportError } from '../../src/errors';
import {
    ProtocolDispatcher,
    TOGGLEX_NAMESPACE,
    decodeMessage,
    encodeMessage,
    encodeToggleXSet,
    type MerossMessage
} from '../../src/protocol';
import { verifySignature } from '../../src/protocol/sign';
import {
    MQTT_RECONNECT_PERIOD_MS,
    MqttTransport,
    type MqttBrokerClient,
    type MqttConnectOptions,
    type MqttTransportOptions
} from '../../src/transport';

const USER_ID = '42';
const KEY = 'stub-key';
const DOMAIN = 'eu-iotx.meross.com';
const UUID = '00000000-0000-4000-8000-000000000001';
const APP_ID = '53d331b732f6f1ba4031522fa9ee0d7a';
const USER_TOPICS = [
    `/app/${USER_ID}/subscribe`,
    `/app/${USER_ID}-${APP_ID}/subscribe`
];

class FakeMqttClient extends EventEmitter implements MqttBrokerClient {
    readonly subscriptions: string[] = [];
    readonly published: Array<{ topic: string; payload: string }> = [];
    ended = false;
    publishError: Error | null = null;

    subscribe(topic: string, callback: (error?: Error | null) => void): void {
        this.subscriptions.push(topic);
        callback();
    }

    publish(topic: string, payload: string, callback: (error?: Error | null) => void): void {
        this.published.push({ topic, payload });
        callback(this.publishError);
    }

    end(_force: boolean, callback: () => void): void {
        this.ended = true;
        this.emit('close');
        callback();
    }

    deliver(message: MerossMessage | string): void {
        const payload = typeof message === 'string' ? message : JSON.stringify(message);
        this.emit('message', '/app/42/subscribe', Buffer.from(payload));
    }
}

function createTransport(overrides: Partial<MqttTransportOptions> & { client?: FakeMqttClient } = {}) {
    const { client: provided, ...rest } = overrides;
    let client = provided;
    let connectOptions: MqttConnectOptions | undefined;
    const transport = new MqttTransport({
        userId: USER_ID,
        key: KEY,
        mqttDomain: DOMAIN,
        appId: APP_ID,
        connect: (options) => {
            connectOptions = options;
            client ??= new FakeMqttClient();
            queueMicrotask(() => client!.emit('connect'));
            return client;
        },
        ...rest
    });
    return {
        transport,
        getClient: () => client!,
        getConnectOptions: () => connectOptions
    };
}

function ackFor(sent: MerossMessage, method: 'GETACK' | 'SETACK'): MerossMessage {
    return encodeMessage({
        namespace: sent.header.namespace,
        method,
        key: KEY,
        from: `/appliance/${UUID}/publish`,
        messageId: sent.header.messageId,
        timestamp: sent.header.timestamp
    });
}

describe('MqttTransport', () => {
    it('connects with mqtts credentials and subscribes to user and response topics', async () => {
        const { transport, getClient, getConnectOptions } = createTransport();
        await transport.connect();

        const options = getConnectOptions()!;
        assert.equal(options.protocol, 'mqtts');
        assert.equal(options.host, DOMAIN);
        assert.equal(options.port, 443);
        assert.equal(options.clientId, `app:${APP_ID}`);
        assert.equal(options.username, USER_ID);
        assert.equal(options.password, '3421441f1521102d91f627b001f9c9fd');
        assert.equal(options.rejectUnauthorized, true);
        assert.equal(options.reconnectPeriod, MQTT_RECONNECT_PERIOD_MS);
        assert.equal(options.resubscribe, false);
        assert.deepEqual(getClient().subscriptions, USER_TOPICS);
        assert.equal(transport.clientResponseTopic, `/app/${USER_ID}-${APP_ID}/subscribe`);
    });

    it('honors host:port on mqttDomain', async () => {
        const { transport, getConnectOptions } = createTransport({
            mqttDomain: 'eu-iotx.meross.com:2001'
        });
        await transport.connect();
        assert.equal(getConnectOptions()?.host, 'eu-iotx.meross.com');
        assert.equal(getConnectOptions()?.port, 2001);
    });

    it('is a no-op when already connected', async () => {
        let factories = 0;
        const { transport } = createTransport({
            connect: () => {
                factories += 1;
                const client = new FakeMqttClient();
                queueMicrotask(() => client.emit('connect'));
                return client;
            }
        });
        await transport.connect();
        await transport.connect();
        assert.equal(factories, 1);
    });

    it('times out if the broker never emits connect', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const transport = new MqttTransport({
            userId: USER_ID,
            key: KEY,
            mqttDomain: DOMAIN,
            connect: () => new FakeMqttClient()
        });
        const pending = transport.connect();
        t.mock.timers.tick(30_000);
        await assert.rejects(
            pending,
            (err: unknown) => err instanceof TransportError && err.code === 'MQTT_CONNECT_TIMEOUT'
        );
    });

    it('stays pending through a broker error until connect', async () => {
        const client = new FakeMqttClient();
        const transport = new MqttTransport({
            userId: USER_ID,
            key: KEY,
            mqttDomain: DOMAIN,
            appId: APP_ID,
            connect: () => {
                queueMicrotask(() => {
                    client.emit('error', new Error('broker down'));
                    client.emit('connect');
                });
                return client;
            }
        });
        await transport.connect();
        assert.deepEqual(client.subscriptions, USER_TOPICS);
    });

    it('publishes a signed ToggleX SET and resolves with SETACK via pending', async () => {
        const { transport, getClient } = createTransport();
        await transport.connect();
        const pending = transport.request({
            uuid: UUID,
            namespace: TOGGLEX_NAMESPACE,
            method: 'SET',
            payload: encodeToggleXSet({ channel: 0, on: false, entity: 1 })
        });

        const client = getClient();
        assert.equal(client.published[0]!.topic, `/appliance/${UUID}/subscribe`);
        const sent = decodeMessage(client.published[0]!.payload, KEY);
        assert.equal(sent.header.from, transport.clientResponseTopic);
        assert.equal(sent.header.uuid, UUID);
        assert.equal(verifySignature(sent.header, KEY), true);
        assert.deepEqual(sent.payload, { togglex: { onoff: 0, channel: 0, entity: 1 } });

        client.deliver(ackFor(sent, 'SETACK'));
        assert.equal((await pending).header.method, 'SETACK');
    });

    it('rejects a pending request when publish fails', async () => {
        const client = new FakeMqttClient();
        client.publishError = new Error('broker nack');
        const { transport } = createTransport({ client });
        await transport.connect();
        await assert.rejects(
            transport.request({ uuid: UUID, namespace: TOGGLEX_NAMESPACE, method: 'GET' }),
            (err: unknown) => err instanceof TransportError && err.code === 'MQTT_PUBLISH_FAILED'
        );
    });

    it('throws if request is called before connect', async () => {
        const { transport } = createTransport();
        await assert.rejects(
            transport.request({ uuid: UUID, namespace: TOGGLEX_NAMESPACE, method: 'GET' }),
            (err: unknown) => err instanceof TransportError && err.code === 'MQTT_NOT_CONNECTED'
        );
    });

    it('cancels outstanding requests on disconnect', async () => {
        const { transport, getClient } = createTransport();
        await transport.connect();
        const pending = transport.request({
            uuid: UUID,
            namespace: TOGGLEX_NAMESPACE,
            method: 'GET'
        });
        await transport.disconnect();
        assert.equal(getClient().ended, true);
        await assert.rejects(
            pending,
            (err: unknown) => err instanceof CommandError && err.code === 'COMMAND_CANCELLED'
        );
    });

    it('dispatches PUSH and ignores malformed or unsigned payloads', async () => {
        const applied: MerossMessage[] = [];
        const { transport, getClient } = createTransport({
            dispatcher: new ProtocolDispatcher((message) => {
                applied.push(message);
            })
        });
        await transport.connect();
        const pending = transport.request({
            uuid: UUID,
            namespace: TOGGLEX_NAMESPACE,
            method: 'GET'
        });
        const client = getClient();
        const sent = decodeMessage(client.published[0]!.payload, KEY);

        client.deliver('{not json');
        client.deliver(encodeMessage({
            namespace: TOGGLEX_NAMESPACE,
            method: 'PUSH',
            key: 'wrong-key',
            from: `/appliance/${UUID}/publish`,
            payload: { togglex: [{ channel: 0, onoff: 1 }] }
        }));
        client.deliver(encodeMessage({
            namespace: TOGGLEX_NAMESPACE,
            method: 'PUSH',
            key: KEY,
            from: `/appliance/${UUID}/publish`,
            payload: { togglex: [{ channel: 0, onoff: 1 }] }
        }));

        client.deliver(encodeMessage({
            namespace: sent.header.namespace,
            method: 'GETACK',
            key: KEY,
            from: `/appliance/${UUID}/publish`,
            messageId: sent.header.messageId,
            timestamp: sent.header.timestamp,
            payload: { togglex: { channel: 0, onoff: 1 } }
        }));

        assert.equal((await pending).header.method, 'GETACK');
        assert.equal(applied.length, 1);
        assert.equal(applied[0]!.header.method, 'PUSH');
    });

    it('uses the same client after close when it emits connect again', async () => {
        let factories = 0;
        const client = new FakeMqttClient();
        const { transport } = createTransport({
            connect: () => {
                factories += 1;
                queueMicrotask(() => client.emit('connect'));
                return client;
            }
        });
        await transport.connect();
        client.emit('close');
        await assert.rejects(
            transport.request({ uuid: UUID, namespace: TOGGLEX_NAMESPACE, method: 'GET' }),
            (err: unknown) => err instanceof TransportError && err.code === 'MQTT_NOT_CONNECTED'
        );
        await transport.connect();
        assert.equal(factories, 1);

        client.emit('connect');
        assert.deepEqual(client.subscriptions.slice(-2), USER_TOPICS);

        const pending = transport.request({
            uuid: UUID,
            namespace: TOGGLEX_NAMESPACE,
            method: 'GET'
        });
        const sent = decodeMessage(client.published[0]!.payload, KEY);
        client.deliver(ackFor(sent, 'GETACK'));
        assert.equal((await pending).header.method, 'GETACK');
        await transport.disconnect();
    });

    it('rejects in-flight MQTT requests when the socket drops', async () => {
        const { transport, getClient } = createTransport();
        await transport.connect();
        const pending = transport.request({
            uuid: UUID,
            namespace: TOGGLEX_NAMESPACE,
            method: 'GET'
        });
        getClient().emit('close');
        await assert.rejects(
            pending,
            (err: unknown) => err instanceof TransportError && err.code === 'MQTT_DISCONNECTED'
        );
        await transport.disconnect();
    });

    it('does not cancel LAN pending ids when MQTT drops', async () => {
        const dispatcher = new ProtocolDispatcher();
        const { transport, getClient } = createTransport({ dispatcher });
        await transport.connect();
        const lanPending = dispatcher.pending.register('lan-id', 5_000);
        const mqttPending = transport.request({
            uuid: UUID,
            namespace: TOGGLEX_NAMESPACE,
            method: 'GET'
        });
        getClient().emit('close');
        await assert.rejects(
            mqttPending,
            (err: unknown) => err instanceof TransportError && err.code === 'MQTT_DISCONNECTED'
        );
        assert.equal(dispatcher.pending.has('lan-id'), true);
        dispatcher.pending.clear();
        await assert.rejects(
            lanPending,
            (err: unknown) => err instanceof CommandError && err.code === 'COMMAND_CANCELLED'
        );
        await transport.disconnect();
    });

    it('ignores connect after disconnect', async () => {
        const { transport, getClient } = createTransport();
        await transport.connect();
        const client = getClient();
        await transport.disconnect();
        client.emit('connect');
        await assert.rejects(
            transport.request({ uuid: UUID, namespace: TOGGLEX_NAMESPACE, method: 'GET' }),
            (err: unknown) => err instanceof TransportError && err.code === 'MQTT_NOT_CONNECTED'
        );
    });

    it('notifies onConnectionChange on connect, drop, reconnect, and disconnect', async () => {
        const connections: boolean[] = [];
        const { transport, getClient } = createTransport({
            onConnectionChange: (connected) => connections.push(connected)
        });
        await transport.connect();
        assert.deepEqual(connections, [true]);

        getClient().emit('close');
        assert.deepEqual(connections, [true, false]);

        getClient().emit('connect');
        assert.deepEqual(connections, [true, false, true]);

        await transport.disconnect();
        assert.deepEqual(connections, [true, false, true, false]);
    });
});
