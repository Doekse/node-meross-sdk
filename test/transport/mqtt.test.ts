import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CommandError, TransportError } from '../../src/errors';
import type { LogRecord } from '../../src/log';
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
    PublishRateLimiter,
    RATE_LIMIT_BACKGROUND_MAX,
    RATE_LIMIT_MAX_PUBLISHES,
    type MqttConnectOptions,
    type MqttTransportOptions
} from '../../src/transport';
import { FakeMqttClient } from '../helpers/mqtt';

const USER_ID = '42';
const KEY = 'stub-key';
const DOMAIN = 'eu-iotx.meross.com';
const UUID = '00000000-0000-4000-8000-000000000001';
const APP_ID = '53d331b732f6f1ba4031522fa9ee0d7a';
const USER_TOPICS = [
    `/app/${USER_ID}/subscribe`,
    `/app/${USER_ID}-${APP_ID}/subscribe`
];

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

/** Drain nested microtasks so a timeout is armed before fake time advances. */
async function flushMicrotasks(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
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
        assert.equal(options.keepalive, 30);
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

    it('does not hang a failed handshake when mqtt.js never calls end', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const client = new FakeMqttClient();
        client.end = (_force, _callback) => {
            client.ended = true;
            client.emit('close');
        };
        const transport = new MqttTransport({
            userId: USER_ID,
            key: KEY,
            mqttDomain: DOMAIN,
            connect: () => client
        });
        const pending = transport.connect();
        t.mock.timers.tick(30_000);
        await flushMicrotasks();
        assert.equal(client.ended, true);

        t.mock.timers.tick(5_000);
        await assert.rejects(
            pending,
            (err: unknown) => err instanceof TransportError && err.code === 'MQTT_CONNECT_TIMEOUT'
        );
    });

    it('does not hang disconnect when mqtt.js never calls end', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const client = new FakeMqttClient();
        client.end = (_force, _callback) => {
            client.ended = true;
            client.emit('close');
        };
        const { transport } = createTransport({ client });
        await transport.connect();

        let settled = false;
        const pending = transport.disconnect().then(() => {
            settled = true;
        });
        await flushMicrotasks();
        assert.equal(client.ended, true);
        assert.equal(settled, false);

        t.mock.timers.tick(4_999);
        await flushMicrotasks();
        assert.equal(settled, false);

        t.mock.timers.tick(1);
        await pending;
        assert.equal(settled, true);
    });

    it('ignores a late end callback after disconnect has already settled', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const client = new FakeMqttClient();
        let endCallback: (() => void) | undefined;
        client.end = (_force, callback) => {
            client.ended = true;
            client.emit('close');
            endCallback = callback;
        };
        const { transport } = createTransport({ client });
        await transport.connect();

        const pending = transport.disconnect();
        await flushMicrotasks();
        t.mock.timers.tick(5_000);
        await pending;
        endCallback?.();
    });

    it('finishes disconnect as soon as mqtt.js calls end', async () => {
        const client = new FakeMqttClient();
        let endCallback: (() => void) | undefined;
        client.end = (_force, callback) => {
            client.ended = true;
            client.emit('close');
            endCallback = callback;
        };
        const { transport } = createTransport({ client });
        await transport.connect();

        const pending = transport.disconnect();
        await flushMicrotasks();
        endCallback?.();
        await pending;
        assert.equal(client.ended, true);
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

    it('dispatches a signed PUSH to the protocol handler', async () => {
        const applied: MerossMessage[] = [];
        const { transport, getClient } = createTransport({
            dispatcher: new ProtocolDispatcher((message) => {
                applied.push(message);
            })
        });
        await transport.connect();

        getClient().deliver(encodeMessage({
            namespace: TOGGLEX_NAMESPACE,
            method: 'PUSH',
            key: KEY,
            from: `/appliance/${UUID}/publish`,
            payload: { togglex: [{ channel: 0, onoff: 1 }] }
        }));

        assert.equal(applied.length, 1);
        assert.equal(applied[0]!.header.method, 'PUSH');
        await transport.disconnect();
    });

    it('ignores a broker payload that is not JSON', async () => {
        const applied: MerossMessage[] = [];
        const { transport, getClient } = createTransport({
            dispatcher: new ProtocolDispatcher((message) => {
                applied.push(message);
            })
        });
        await transport.connect();

        getClient().deliver('{not json');

        assert.equal(applied.length, 0);
        await transport.disconnect();
    });

    it('ignores a PUSH signed with the wrong key', async () => {
        const applied: MerossMessage[] = [];
        const { transport, getClient } = createTransport({
            dispatcher: new ProtocolDispatcher((message) => {
                applied.push(message);
            })
        });
        await transport.connect();

        getClient().deliver(encodeMessage({
            namespace: TOGGLEX_NAMESPACE,
            method: 'PUSH',
            key: 'wrong-key',
            from: `/appliance/${UUID}/publish`,
            payload: { togglex: [{ channel: 0, onoff: 1 }] }
        }));

        assert.equal(applied.length, 0);
        await transport.disconnect();
    });

    it('does not create a second MQTT client after a drop', async () => {
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

        await transport.connect();

        assert.equal(factories, 1);
        await transport.disconnect();
    });

    it('resubscribes when the same client emits connect after a drop', async () => {
        const { transport, getClient } = createTransport();
        await transport.connect();
        const client = getClient();
        const subscribedBefore = client.subscriptions.length;
        client.emit('close');

        client.emit('connect');

        assert.deepEqual(client.subscriptions.slice(subscribedBefore), USER_TOPICS);
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

    it('notifies onConnectionChange true after connect', async () => {
        const connections: boolean[] = [];
        const { transport } = createTransport({
            onConnectionChange: (connected) => connections.push(connected)
        });

        await transport.connect();

        assert.deepEqual(connections, [true]);
        await transport.disconnect();
    });

    it('notifies onConnectionChange false on broker drop and true on reconnect', async () => {
        const connections: boolean[] = [];
        const { transport, getClient } = createTransport({
            onConnectionChange: (connected) => connections.push(connected)
        });
        await transport.connect();
        connections.length = 0;

        getClient().emit('close');
        assert.deepEqual(connections, [false]);

        getClient().emit('connect');
        assert.deepEqual(connections, [false, true]);

        await transport.disconnect();
    });

    it('notifies onConnectionChange false when disconnect closes MQTT', async () => {
        const connections: boolean[] = [];
        const { transport } = createTransport({
            onConnectionChange: (connected) => connections.push(connected)
        });
        await transport.connect();
        connections.length = 0;

        await transport.disconnect();

        assert.deepEqual(connections, [false]);
    });

    it('forces a reconnect when re-subscribe fails after a drop', async () => {
        const client = new FakeMqttClient();
        const connections: boolean[] = [];
        const { transport } = createTransport({
            client,
            onConnectionChange: (connected) => connections.push(connected)
        });
        await transport.connect();

        client.subscribeError = new Error('not authorized');
        client.emit('close');
        client.emit('connect');

        assert.equal(client.reconnects, 1);
        assert.deepEqual(connections, [true, false]);
        await assert.rejects(
            transport.request({ uuid: UUID, namespace: TOGGLEX_NAMESPACE, method: 'GET' }),
            (err: unknown) => err instanceof TransportError && err.code === 'MQTT_NOT_CONNECTED'
        );
        await transport.disconnect();
    });

    it('accepts requests after subscribe succeeds on a later reconnect', async () => {
        const client = new FakeMqttClient();
        const { transport } = createTransport({ client });
        await transport.connect();

        client.subscribeError = new Error('not authorized');
        client.emit('close');
        client.emit('connect');
        client.subscribeError = null;
        client.emit('connect');

        const pending = transport.request({
            uuid: UUID,
            namespace: TOGGLEX_NAMESPACE,
            method: 'GET'
        });
        client.deliver(ackFor(decodeMessage(client.published[0]!.payload, KEY), 'GETACK'));
        assert.equal((await pending).header.method, 'GETACK');
        await transport.disconnect();
    });

    it('rejects the first handshake on subscribe failure instead of reconnecting', async () => {
        const client = new FakeMqttClient();
        client.subscribeError = new Error('not authorized');
        const { transport } = createTransport({ client });
        await assert.rejects(
            transport.connect(),
            (err: unknown) => err instanceof TransportError && err.code === 'MQTT_SUBSCRIBE_FAILED'
        );
        assert.equal(client.reconnects, 0);
    });

    it('notifies onRateLimit and does not publish when limited', async () => {
        const limiter = new PublishRateLimiter({ now: () => 1_000_000 });
        for (let i = 0; i < RATE_LIMIT_MAX_PUBLISHES; i += 1) {
            limiter.take(UUID, 'user');
        }
        const drops: Array<[string, number]> = [];
        const dispatcher = new ProtocolDispatcher();
        const { transport, getClient } = createTransport({
            dispatcher,
            rateLimiter: limiter,
            onRateLimit: (uuid, dropped) => drops.push([uuid, dropped])
        });
        await transport.connect();
        const publishedBefore = getClient().published.length;

        await assert.rejects(
            transport.request({
                uuid: UUID,
                namespace: TOGGLEX_NAMESPACE,
                method: 'GET'
            }),
            (err: unknown) => err instanceof TransportError && err.code === 'MQTT_RATE_LIMITED'
        );

        assert.deepEqual(drops, [[UUID, 1]]);
        assert.equal(getClient().published.length, publishedBefore);
        await transport.disconnect();
    });

    it('treats an unannotated request as a user command', async () => {
        const limiter = new PublishRateLimiter({ now: () => 1_000_000 });
        for (let i = 0; i < RATE_LIMIT_BACKGROUND_MAX; i += 1) {
            limiter.take(UUID, 'background');
        }
        const { transport, getClient } = createTransport({ rateLimiter: limiter });
        await transport.connect();
        const client = getClient();

        // Background is spent, so this only goes through on the user reserve.
        const pending = transport.request({
            uuid: UUID,
            namespace: TOGGLEX_NAMESPACE,
            method: 'GET'
        });
        client.deliver(ackFor(decodeMessage(client.published[0]!.payload, KEY), 'GETACK'));
        await pending;

        await transport.disconnect();
    });

    it('logs MQTT publish and message traffic on the real topics', async () => {
        const records: LogRecord[] = [];
        const { transport, getClient } = createTransport({
            logLevel: 'trace',
            logger: (record) => {
                records.push(record);
            }
        });
        await transport.connect();
        const pending = transport.request({
            uuid: UUID,
            namespace: TOGGLEX_NAMESPACE,
            method: 'GET'
        });
        const client = getClient();
        const sent = decodeMessage(client.published[0]!.payload, KEY);
        client.deliver(ackFor(sent, 'GETACK'));
        await pending;

        const tx = records.find((record) => record.direction === 'tx');
        const rx = records.find((record) => record.direction === 'rx');
        assert.ok(tx);
        assert.equal(tx.level, 'trace');
        assert.equal(tx.channel, 'mqtt');
        assert.equal(tx.target, `/appliance/${UUID}/subscribe`);
        assert.equal(tx.data, client.published[0]!.payload);
        assert.ok(rx);
        assert.equal(rx.level, 'trace');
        assert.equal(rx.target, USER_TOPICS[0]);
        assert.equal(JSON.stringify(records).includes('Authorization'), false);

        await transport.disconnect();
    });

    it('at debug logs MQTT rx as a summary without a body', async () => {
        const records: LogRecord[] = [];
        const { transport, getClient } = createTransport({
            logger: (record) => {
                records.push(record);
            }
        });
        await transport.connect();
        getClient().deliver(encodeMessage({
            namespace: TOGGLEX_NAMESPACE,
            method: 'PUSH',
            key: KEY,
            from: `/appliance/${UUID}/publish`,
            payload: { togglex: [{ channel: 0, onoff: 1 }] }
        }));

        const rx = records.find((record) => record.direction === 'rx');
        assert.ok(rx);
        assert.equal(rx.level, 'debug');
        assert.equal(rx.data, undefined);

        await transport.disconnect();
    });

    it('logs an error for a malformed payload without dropping the socket', async () => {
        const records: LogRecord[] = [];
        const { transport, getClient } = createTransport({
            logger: (record) => {
                records.push(record);
            }
        });
        await transport.connect();
        getClient().deliver('{not json');

        assert.ok(records.some((record) =>
            record.level === 'error'
            && record.channel === 'mqtt'
            && record.message === 'Malformed MQTT payload'
            && record.data === '{not json'
        ));
        await transport.disconnect();
    });

    it('at logLevel error still logs malformed MQTT data without traffic', async () => {
        const records: LogRecord[] = [];
        const { transport, getClient } = createTransport({
            logLevel: 'error',
            logger: (record) => {
                records.push(record);
            }
        });
        await transport.connect();
        getClient().deliver('{not json');

        assert.equal(records.some((record) => record.direction === 'tx' || record.direction === 'rx'), false);
        assert.ok(records.some((record) =>
            record.level === 'error'
            && record.message === 'Malformed MQTT payload'
            && record.data === '{not json'
        ));
        await transport.disconnect();
    });

    it('logs mqtt.js errors without throwing', async () => {
        const records: LogRecord[] = [];
        const client = new FakeMqttClient();
        const { transport } = createTransport({
            client,
            logger: (record) => {
                records.push(record);
            },
            connect: () => {
                queueMicrotask(() => {
                    client.emit('error', new Error('broker down'));
                    client.emit('connect');
                });
                return client;
            }
        });
        await transport.connect();

        assert.ok(records.some((record) =>
            record.level === 'error'
            && record.channel === 'mqtt'
            && record.message === 'broker down'
        ));
        await transport.disconnect();
    });

    it('does not fail a request when the logger throws', async () => {
        const { transport, getClient } = createTransport({
            logger: () => {
                throw new Error('host logger blew up');
            }
        });
        await transport.connect();
        const pending = transport.request({
            uuid: UUID,
            namespace: TOGGLEX_NAMESPACE,
            method: 'GET'
        });
        const client = getClient();
        client.deliver(ackFor(decodeMessage(client.published[0]!.payload, KEY), 'GETACK'));
        assert.equal((await pending).header.method, 'GETACK');
        await transport.disconnect();
    });
});
