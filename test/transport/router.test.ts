import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CommandError, ProtocolError, TransportError } from '../../src/errors';
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
    PublishRateLimiter,
    RATE_LIMIT_BACKGROUND_MAX,
    TransportRouter,
    type MqttTransportOptions
} from '../../src/transport';
import { jsonResponse } from '../helpers/http';
import { FakeMqttClient } from '../helpers/mqtt';

const USER_ID = '42';
const KEY = 'stub-key';
const DOMAIN = 'eu-iotx.meross.com';
const UUID = '00000000-0000-4000-8000-000000000001';
const APP_ID = '53d331b732f6f1ba4031522fa9ee0d7a';
const IP = '192.168.1.50';
const ELECTRICITY = 'Appliance.Control.Electricity';
const CONSUMPTIONX = 'Appliance.Control.ConsumptionX';

interface FetchCall {
    url: string;
    init: RequestInit;
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
    rateLimiter?: PublishRateLimiter;
} = {}) {
    const dispatcher = new ProtocolDispatcher();
    const mqtt = createMqtt({ dispatcher, rateLimiter: options.rateLimiter });
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
        lan
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

async function connectAndAckMqtt<T>(
    mqtt: ReturnType<typeof createMqtt>,
    pending: Promise<T>
): Promise<T> {
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

    it('treats a missing IP as cloud path without marking HTTP down', () => {
        const { router } = createRouted();

        assert.equal(router.isCloudPath(UUID, IP), false);
        assert.equal(router.isCloudPath(UUID, null), true);
        assert.equal(router.isHttpDown(UUID), false);
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

    it('fails over to MQTT after a LAN transport error', async () => {
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

    it('retries LAN on the next request after a transport error', async () => {
        const { router, mqtt, lanCalls } = createRouted({
            lan: async () => {
                throw new Error('EHOSTUNREACH');
            }
        });
        await router.connect();

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

        assert.equal(lanCalls.length, 2);
        assert.equal(mqtt.getClient().published.length, 2);
        assert.equal(router.isCloudPath(UUID, IP), false);
        assert.equal(router.isHttpDown(UUID), false);
    });

    it('marks HTTP down after a System.All LAN miss and skips later LAN', async () => {
        const { router, mqtt, lanCalls } = createRouted({
            lan: async () => {
                throw new Error('EHOSTUNREACH');
            }
        });
        await router.connect();

        await connectAndAckMqtt(mqtt, router.request({
            uuid: UUID,
            ip: IP,
            namespace: SYSTEM_ALL_NAMESPACE,
            method: 'GET'
        }));
        await connectAndAckMqtt(mqtt, router.request({
            uuid: UUID,
            ip: IP,
            namespace: TOGGLEX_NAMESPACE,
            method: 'SET'
        }));

        assert.equal(lanCalls.length, 1);
        assert.equal(mqtt.getClient().published.length, 2);
        assert.equal(router.isHttpDown(UUID), true);
        assert.equal(router.isCloudPath(UUID, IP), true);
    });

    it('probes LAN on System.All while HTTP is down and recovers on success', async () => {
        const { router, mqtt, lanCalls } = createRouted({
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
            namespace: SYSTEM_ALL_NAMESPACE,
            method: 'GET'
        }));

        const reply = await router.request({
            uuid: UUID,
            ip: IP,
            namespace: SYSTEM_ALL_NAMESPACE,
            method: 'GET'
        });

        assert.equal(reply.header.method, 'GETACK');
        assert.equal(lanCalls.length, 2);
        assert.equal(router.isHttpDown(UUID), false);
        assert.equal(router.isCloudPath(UUID, IP), false);
        assert.equal(mqtt.getClient().published.length, 1);
    });

    it('does not failover on a device ERROR method', async () => {
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

    it('does not failover on a LAN protocol error', async () => {
        const { router, mqtt, lanCalls } = createRouted({
            lan: async (sent, calls) => {
                if (calls.length === 1) {
                    return jsonResponse('{not json');
                }
                return defaultLanOk(sent);
            }
        });
        await router.connect();

        await assert.rejects(
            router.request({
                uuid: UUID,
                ip: IP,
                namespace: TOGGLEX_NAMESPACE,
                method: 'SET'
            }),
            (err: unknown) => err instanceof ProtocolError
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

    it('uses LAN again as soon as a later request succeeds', async () => {
        const { router, mqtt, lanCalls } = createRouted({
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

        const reply = await router.request({
            uuid: UUID,
            ip: IP,
            namespace: TOGGLEX_NAMESPACE,
            method: 'GET'
        });
        assert.equal(lanCalls.length, 2);
        assert.equal(mqtt.getClient().published.length, 1);
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

    it('packs System.All and Hub.ToggleX with the rest, chunked by maxCmdNum', async () => {
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

        // Four packable GETs at maxCmdNum 3 become one Multiple of 3 plus a
        // leftover sent unwrapped. System.All and Hub.ToggleX pack with the
        // others so they do not each spend their own request.
        assert.equal(lanCalls.length, 2);
        const packed = decodeMessage(String(lanCalls[0]!.init.body), KEY);
        assert.equal(packed.header.namespace, MULTIPLE_NAMESPACE);
        assert.deepEqual(decodeMultipleAck(packed.payload).map((sub) => sub.header.namespace), [
            TOGGLEX_NAMESPACE,
            HUB_TOGGLEX_NAMESPACE,
            SYSTEM_ALL_NAMESPACE
        ]);
        assert.equal(decodeMessage(String(lanCalls[1]!.init.body), KEY).header.namespace, ELECTRICITY);
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

    it('retries a Control.Multiple device ERROR as singles', async () => {
        let packedFallback = 0;
        const { router, lanCalls } = createRouted({
            lan: async (sent) => {
                if (sent.header.namespace === MULTIPLE_NAMESPACE) {
                    return jsonResponse(ackFor(sent, 'ERROR', { error: { code: 5000 } }));
                }
                return defaultLanOk(sent);
            }
        });
        await router.connect();

        const replies = await router.requestGets({
            uuid: UUID,
            ip: IP,
            maxCmdNum: 3,
            onPackedFallback: () => {
                packedFallback += 1;
            },
            gets: [
                { namespace: TOGGLEX_NAMESPACE },
                { namespace: ELECTRICITY }
            ]
        });

        assert.equal(packedFallback, 1);
        assert.equal(lanCalls.length, 3);
        assert.equal(replies.length, 2);
        assert.equal(replies[0]?.header.namespace, TOGGLEX_NAMESPACE);
        assert.equal(replies[1]?.header.namespace, ELECTRICITY);
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

    it('still prefers LAN after disconnect', async () => {
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

    it('forwards priority so background polling cannot spend the user reserve', async () => {
        const rateLimiter = new PublishRateLimiter({ now: () => 1_000_000 });
        const { router, mqtt } = createRouted({ rateLimiter });
        await router.connect();

        for (let i = 0; i < RATE_LIMIT_BACKGROUND_MAX; i += 1) {
            await connectAndAckMqtt(mqtt, router.requestGets({
                uuid: UUID,
                gets: [{ namespace: TOGGLEX_NAMESPACE }],
                priority: 'background'
            }));
        }

        await assert.rejects(
            router.requestGets({
                uuid: UUID,
                gets: [{ namespace: TOGGLEX_NAMESPACE }],
                priority: 'background'
            }),
            (err: unknown) => err instanceof TransportError && err.code === 'MQTT_RATE_LIMITED'
        );

        const reply = await connectAndAckMqtt(mqtt, router.request({
            uuid: UUID,
            namespace: TOGGLEX_NAMESPACE,
            method: 'SET'
        }));
        assert.equal(reply.header.method, 'SETACK');

        await router.disconnect();
    });

    it('keeps later GETs when a Control.Multiple fallback single fails', async () => {
        const { router } = createRouted({
            lan: async (sent) => {
                if (sent.header.namespace === MULTIPLE_NAMESPACE) {
                    throw new TransportError('truncated', 'LAN_UNREACHABLE');
                }
                if (sent.header.namespace === TOGGLEX_NAMESPACE) {
                    throw new TransportError('busy', 'LAN_UNREACHABLE');
                }
                return defaultLanOk(sent);
            }
        });

        const replies = await router.requestGets({
            uuid: UUID,
            ip: IP,
            maxCmdNum: 3,
            gets: [
                { namespace: TOGGLEX_NAMESPACE },
                { namespace: ELECTRICITY }
            ]
        });

        assert.equal(replies.length, 1);
        assert.equal(replies[0]?.header.namespace, ELECTRICITY);
    });
});
