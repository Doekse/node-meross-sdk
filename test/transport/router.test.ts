import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';

import { CommandError, TransportError } from '../../src/errors';
import {
    HUB_TOGGLEX_NAMESPACE,
    MULTIPLE_NAMESPACE,
    ProtocolDispatcher,
    SYSTEM_ALL_NAMESPACE,
    TOGGLEX_NAMESPACE,
    decodeMessage,
    decodeMultipleAck,
    encodeMessage,
    encodeToggleXGet,
    type MerossMessage
} from '../../src/protocol';
import {
    LanHttpTransport,
    MqttTransport,
    TransportRouter,
    type MqttBrokerClient,
    type MqttTransportOptions
} from '../../src/transport';

const USER_ID = '42';
const KEY = 'stub-key';
const DOMAIN = 'eu-iotx.meross.com';
const UUID = '00000000-0000-4000-8000-000000000001';
const APP_ID = '53d331b732f6f1ba4031522fa9ee0d7a';
const IP = '192.168.1.50';
const ELECTRICITY = 'Appliance.Control.Electricity';
const CONSUMPTIONX = 'Appliance.Control.ConsumptionX';

class FakeMqttClient extends EventEmitter implements MqttBrokerClient {
    readonly published: Array<{ topic: string; payload: string }> = [];

    subscribe(_topic: string, callback: (error?: Error | null) => void): void {
        callback();
    }

    publish(topic: string, payload: string, callback: (error?: Error | null) => void): void {
        this.published.push({ topic, payload });
        callback();
    }

    end(_force: boolean, callback: () => void): void {
        this.emit('close');
        callback();
    }

    deliver(message: MerossMessage): void {
        this.emit('message', '/app/42/subscribe', Buffer.from(JSON.stringify(message)));
    }
}

interface FetchCall {
    url: string;
    init: RequestInit;
}

function jsonResponse(body: unknown, status = 200, statusText = 'OK'): Response {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return {
        status,
        statusText,
        ok: status === 200,
        async text() {
            return text;
        }
    } as Response;
}

function ackFor(
    request: MerossMessage,
    method: 'GETACK' | 'SETACK' | 'ERROR',
    payload: MerossMessage['payload'] = {}
): MerossMessage {
    return encodeMessage({
        namespace: request.header.namespace,
        method,
        key: KEY,
        from: `/appliance/${UUID}/publish`,
        messageId: request.header.messageId,
        timestamp: request.header.timestamp,
        uuid: UUID,
        payload
    });
}

function createMqtt(overrides: Partial<MqttTransportOptions> = {}) {
    let client: FakeMqttClient | undefined;
    const transport = new MqttTransport({
        userId: USER_ID,
        key: KEY,
        mqttDomain: DOMAIN,
        appId: APP_ID,
        connect: () => {
            client = new FakeMqttClient();
            queueMicrotask(() => client!.emit('connect'));
            return client;
        },
        ...overrides
    });
    return {
        transport,
        getClient: () => client!
    };
}

function createRouted(options: {
    lan?: (sent: MerossMessage, calls: FetchCall[]) => Promise<Response> | Response;
    now?: () => number;
    errorBudgetTimeWindowMs?: number;
} = {}) {
    const dispatcher = new ProtocolDispatcher();
    const mqtt = createMqtt({ dispatcher });
    const lanCalls: FetchCall[] = [];
    const lan = new LanHttpTransport({
        key: KEY,
        from: mqtt.transport.clientResponseTopic,
        dispatcher,
        fetch: async (url, init) => {
            const requestInit = init ?? {};
            lanCalls.push({ url: String(url), init: requestInit });
            const sent = decodeMessage(String(requestInit.body), KEY);
            const response = await (options.lan ?? defaultLanOk)(sent, lanCalls);
            return response;
        }
    });
    const router = new TransportRouter({
        mqtt: mqtt.transport,
        lan,
        now: options.now,
        errorBudgetTimeWindowMs: options.errorBudgetTimeWindowMs
    });
    return { router, mqtt, lanCalls };
}

function defaultLanOk(sent: MerossMessage): Response {
    if (sent.header.namespace === MULTIPLE_NAMESPACE) {
        const subs = (sent.payload.multiple as Array<{ header: { namespace: string } }>).map((sub) => ({
            header: { namespace: sub.header.namespace, method: 'GETACK' },
            payload: {}
        }));
        return jsonResponse(ackFor(sent, 'SETACK', { multiple: subs }));
    }
    return jsonResponse(ackFor(sent, sent.header.method === 'SET' ? 'SETACK' : 'GETACK'));
}

async function connectAndAckMqtt(
    mqtt: ReturnType<typeof createMqtt>,
    pending: Promise<MerossMessage>
): Promise<MerossMessage> {
    const client = mqtt.getClient();
    const before = client.published.length;
    for (let i = 0; i < 20 && client.published.length === before; i++) {
        await Promise.resolve();
    }
    const published = client.published.at(-1);
    assert.ok(published, 'MQTT publish did not happen');
    const sent = decodeMessage(published.payload, KEY);
    client.deliver(ackFor(sent, sent.header.method === 'SET' ? 'SETACK' : 'GETACK'));
    return pending;
}

describe('TransportRouter', () => {
    it('prefers LAN when an IP is present and does not publish MQTT', async () => {
        const { router, mqtt, lanCalls } = createRouted();
        await router.connect();

        const reply = await router.request({
            uuid: UUID,
            ip: IP,
            namespace: TOGGLEX_NAMESPACE,
            method: 'GET',
            payload: encodeToggleXGet({ channel: 0 })
        });

        assert.equal(lanCalls.length, 1);
        assert.equal(mqtt.getClient().published.length, 0);
        assert.equal(reply.header.method, 'GETACK');
    });

    it('uses MQTT when no IP is known', async () => {
        const { router, mqtt, lanCalls } = createRouted();
        await router.connect();

        const pending = router.request({
            uuid: UUID,
            namespace: TOGGLEX_NAMESPACE,
            method: 'GET'
        });
        const reply = await connectAndAckMqtt(mqtt, pending);

        assert.equal(lanCalls.length, 0);
        assert.equal(mqtt.getClient().published.length, 1);
        assert.equal(reply.header.method, 'GETACK');
    });

    it('fails over to MQTT after a LAN transport error and spends the error budget', async () => {
        const { router, mqtt, lanCalls } = createRouted({
            lan: async () => jsonResponse('down', 500, 'Error')
        });
        await router.connect();

        const pending = router.request({
            uuid: UUID,
            ip: IP,
            namespace: TOGGLEX_NAMESPACE,
            method: 'SET'
        });
        const reply = await connectAndAckMqtt(mqtt, pending);

        assert.equal(lanCalls.length, 1);
        assert.equal(mqtt.getClient().published.length, 1);
        assert.equal(reply.header.method, 'SETACK');
    });

    it('skips LAN once the error budget is exhausted', async () => {
        const { router, mqtt, lanCalls } = createRouted({
            lan: async () => {
                throw new Error('EHOSTUNREACH');
            }
        });
        await router.connect();

        assert.equal(router.isCloudPath(UUID, IP), false);
        assert.equal(router.isCloudPath(UUID, null), true);

        await connectAndAckMqtt(mqtt, router.request({
            uuid: UUID,
            ip: IP,
            namespace: TOGGLEX_NAMESPACE,
            method: 'GET'
        }));
        await connectAndAckMqtt(mqtt, router.request({
            uuid: UUID,
            ip: IP,
            namespace: TOGGLEX_NAMESPACE,
            method: 'GET'
        }));

        assert.equal(lanCalls.length, 1);
        assert.equal(mqtt.getClient().published.length, 2);
        assert.equal(router.isCloudPath(UUID, IP), true);
    });

    it('does not spend budget or failover on a device ERROR method', async () => {
        const { router, mqtt, lanCalls } = createRouted({
            lan: async (sent, calls) => {
                if (calls.length === 1) {
                    return jsonResponse(ackFor(sent, 'ERROR', { error: { code: 5000 } }));
                }
                return defaultLanOk(sent);
            }
        });
        await router.connect();

        await assert.rejects(
            router.request({ uuid: UUID, ip: IP, namespace: TOGGLEX_NAMESPACE, method: 'GET' }),
            (err: unknown) => err instanceof CommandError && err.code === 'COMMAND_FAILED'
        );
        const retry = await router.request({
            uuid: UUID,
            ip: IP,
            namespace: TOGGLEX_NAMESPACE,
            method: 'GET'
        });
        assert.equal(lanCalls.length, 2);
        assert.equal(mqtt.getClient().published.length, 0);
        assert.equal(retry.header.method, 'GETACK');
    });

    it('failovers on a LAN protocol error without spending budget', async () => {
        const { router, mqtt, lanCalls } = createRouted({
            lan: async (sent, calls) => {
                if (calls.length === 1) {
                    return jsonResponse('{not json');
                }
                return defaultLanOk(sent);
            }
        });
        await router.connect();

        await connectAndAckMqtt(mqtt, router.request({
            uuid: UUID,
            ip: IP,
            namespace: TOGGLEX_NAMESPACE,
            method: 'GET'
        }));
        const retry = await router.request({
            uuid: UUID,
            ip: IP,
            namespace: TOGGLEX_NAMESPACE,
            method: 'GET'
        });

        assert.equal(lanCalls.length, 2);
        assert.equal(mqtt.getClient().published.length, 1);
        assert.equal(retry.header.method, 'GETACK');
    });

    it('restores LAN after the error-budget window elapses', async () => {
        let now = 1_000;
        const { router, mqtt, lanCalls } = createRouted({
            now: () => now,
            errorBudgetTimeWindowMs: 60_000,
            lan: async (sent, calls) => {
                if (calls.length === 1) {
                    throw new Error('ECONNRESET');
                }
                return defaultLanOk(sent);
            }
        });
        await router.connect();

        await connectAndAckMqtt(mqtt, router.request({
            uuid: UUID,
            ip: IP,
            namespace: TOGGLEX_NAMESPACE,
            method: 'GET'
        }));

        now += 60_001;
        const reply = await router.request({
            uuid: UUID,
            ip: IP,
            namespace: TOGGLEX_NAMESPACE,
            method: 'GET'
        });
        assert.equal(lanCalls.length, 2);
        assert.equal(reply.header.method, 'GETACK');
    });

    it('packs GETs into Control.Multiple batches of maxCmdNum', async () => {
        const { router, mqtt, lanCalls } = createRouted();
        await router.connect();

        const replies = await router.requestGets({
            uuid: UUID,
            ip: IP,
            maxCmdNum: 3,
            gets: [
                { namespace: TOGGLEX_NAMESPACE, payload: encodeToggleXGet() },
                { namespace: ELECTRICITY, payload: {} },
                { namespace: CONSUMPTIONX, payload: {} },
                { namespace: 'Appliance.System.Runtime', payload: {} }
            ]
        });

        assert.equal(lanCalls.length, 2);
        assert.equal(mqtt.getClient().published.length, 0);

        const first = decodeMessage(String(lanCalls[0]!.init.body), KEY);
        assert.equal(first.header.namespace, MULTIPLE_NAMESPACE);
        assert.equal(first.header.method, 'SET');
        const firstSubs = decodeMultipleAck(first.payload);
        assert.deepEqual(firstSubs.map((sub) => sub.header), [
            { method: 'GET', namespace: TOGGLEX_NAMESPACE },
            { method: 'GET', namespace: ELECTRICITY },
            { method: 'GET', namespace: CONSUMPTIONX }
        ]);

        const second = decodeMessage(String(lanCalls[1]!.init.body), KEY);
        assert.equal(second.header.namespace, 'Appliance.System.Runtime');
        assert.equal(second.header.method, 'GET');

        assert.equal(replies.length, 4);
        assert.equal(replies[0]!.header.namespace, TOGGLEX_NAMESPACE);
        assert.equal(replies[0]!.header.method, 'GETACK');
        assert.equal(replies[3]!.header.namespace, 'Appliance.System.Runtime');
    });

    it('sends Hub.ToggleX and System.All individually first, then packs the rest', async () => {
        const { router, lanCalls } = createRouted();
        await router.connect();

        await router.requestGets({
            uuid: UUID,
            ip: IP,
            maxCmdNum: 3,
            gets: [
                { namespace: TOGGLEX_NAMESPACE },
                { namespace: HUB_TOGGLEX_NAMESPACE },
                { namespace: SYSTEM_ALL_NAMESPACE },
                { namespace: ELECTRICITY }
            ]
        });

        assert.equal(lanCalls.length, 3);
        assert.equal(decodeMessage(String(lanCalls[0]!.init.body), KEY).header.namespace, HUB_TOGGLEX_NAMESPACE);
        assert.equal(decodeMessage(String(lanCalls[1]!.init.body), KEY).header.namespace, SYSTEM_ALL_NAMESPACE);
        const packed = decodeMessage(String(lanCalls[2]!.init.body), KEY);
        assert.equal(packed.header.namespace, MULTIPLE_NAMESPACE);
        assert.deepEqual(decodeMultipleAck(packed.payload).map((sub) => sub.header.namespace), [
            TOGGLEX_NAMESPACE,
            ELECTRICITY
        ]);
    });

    it('does not wrap a single leftover GET in Control.Multiple', async () => {
        const { router, lanCalls } = createRouted();
        await router.connect();

        await router.requestGets({
            uuid: UUID,
            ip: IP,
            maxCmdNum: 3,
            gets: [{ namespace: TOGGLEX_NAMESPACE }]
        });

        assert.equal(lanCalls.length, 1);
        assert.equal(decodeMessage(String(lanCalls[0]!.init.body), KEY).header.namespace, TOGGLEX_NAMESPACE);
    });

    it('sends GETs one at a time when maxCmdNum is missing or below 2', async () => {
        const { router, lanCalls } = createRouted();
        await router.connect();

        await router.requestGets({
            uuid: UUID,
            ip: IP,
            gets: [
                { namespace: TOGGLEX_NAMESPACE },
                { namespace: ELECTRICITY }
            ]
        });

        assert.equal(lanCalls.length, 2);
        assert.equal(decodeMessage(String(lanCalls[0]!.init.body), KEY).header.namespace, TOGGLEX_NAMESPACE);
        assert.equal(decodeMessage(String(lanCalls[1]!.init.body), KEY).header.namespace, ELECTRICITY);
    });

    it('retries a truncated Control.Multiple as singles', async () => {
        const { router, lanCalls } = createRouted({
            lan: async (sent) => {
                if (sent.header.namespace === MULTIPLE_NAMESPACE) {
                    return jsonResponse(ackFor(sent, 'SETACK', {
                        multiple: [{
                            header: { namespace: TOGGLEX_NAMESPACE, method: 'GETACK' },
                            payload: {}
                        }]
                    }));
                }
                return defaultLanOk(sent);
            }
        });
        await router.connect();

        const replies = await router.requestGets({
            uuid: UUID,
            ip: IP,
            maxCmdNum: 3,
            gets: [
                { namespace: TOGGLEX_NAMESPACE },
                { namespace: ELECTRICITY }
            ]
        });

        assert.equal(lanCalls.length, 3);
        assert.equal(
            decodeMessage(String(lanCalls[0]!.init.body), KEY).header.namespace,
            MULTIPLE_NAMESPACE
        );
        assert.equal(
            decodeMessage(String(lanCalls[1]!.init.body), KEY).header.namespace,
            TOGGLEX_NAMESPACE
        );
        assert.equal(
            decodeMessage(String(lanCalls[2]!.init.body), KEY).header.namespace,
            ELECTRICITY
        );
        assert.equal(replies.length, 2);
        assert.equal(replies[0]?.header.method, 'GETACK');
    });

    it('sends PUSH-query jobs individually and does not pack them', async () => {
        const { router, lanCalls } = createRouted();
        await router.connect();

        await router.requestGets({
            uuid: UUID,
            ip: IP,
            maxCmdNum: 3,
            gets: [
                { namespace: 'Appliance.Control.FilterMaintenance', method: 'PUSH' },
                { namespace: TOGGLEX_NAMESPACE },
                { namespace: ELECTRICITY }
            ]
        });

        assert.equal(lanCalls.length, 2);
        const first = decodeMessage(String(lanCalls[0]!.init.body), KEY);
        assert.equal(first.header.namespace, 'Appliance.Control.FilterMaintenance');
        assert.equal(first.header.method, 'PUSH');
        const packed = decodeMessage(String(lanCalls[1]!.init.body), KEY);
        assert.equal(packed.header.namespace, MULTIPLE_NAMESPACE);
    });

    it('clears the error budget on disconnect so LAN is retried', async () => {
        const { router, mqtt, lanCalls } = createRouted({
            lan: async (sent, calls) => {
                if (calls.length === 1) {
                    throw new TransportError('down', 'LAN_UNREACHABLE');
                }
                return defaultLanOk(sent);
            }
        });
        await router.connect();
        await connectAndAckMqtt(mqtt, router.request({
            uuid: UUID,
            ip: IP,
            namespace: TOGGLEX_NAMESPACE,
            method: 'GET'
        }));
        assert.equal(lanCalls.length, 1);

        await router.disconnect();
        await router.connect();
        const reply = await router.request({
            uuid: UUID,
            ip: IP,
            namespace: TOGGLEX_NAMESPACE,
            method: 'GET'
        });
        assert.equal(lanCalls.length, 2);
        assert.equal(reply.header.method, 'GETACK');
    });
});
