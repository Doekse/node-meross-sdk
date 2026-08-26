import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { ABILITY_NAMESPACE, SYSTEM_ALL_NAMESPACE } from '../src/graph';
import { AuthError, MerossError, TransportError } from '../src/errors';
import {
    decodeMessage,
    decryptPayload,
    deriveEncryptionKey,
    encodeMessage,
    encryptPayload,
    type MerossMessage
} from '../src/protocol';
import { Session } from '../src/session';
import { RATE_LIMIT_MAX_PUBLISHES, type MqttBrokerClient } from '../src/transport';

const fixturesDir = join(process.cwd(), 'test/fixtures');
const EMAIL = 'you@example.com';
const PASSWORD = 'plain-secret';
const NOW = 1_700_000_000_000;
const NONCE = 'ABCDEFGH01234567';
const KEY = 'stub-key';
const USER_ID = '42';
const MQTT_DOMAIN = 'eu-iotx.meross.com';
const UUID = '2206138957096651080248e1e99705a4';

const LOGIN_DATA = {
    token: 'stub-token',
    key: KEY,
    userid: USER_ID,
    email: EMAIL,
    domain: 'https://iotx-eu.meross.com',
    mqttDomain: MQTT_DOMAIN
};

const DEVICE_ROW = {
    uuid: UUID,
    devName: 'Kitchen plug',
    deviceType: 'mss110',
    onlineStatus: 1,
    channels: [{ channel: 0, devName: 'Kitchen plug' }]
};

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

function ok(data: unknown): Response {
    return jsonResponse({ apiStatus: 0, data });
}

function loadFixture(name: string): MerossMessage['payload'] {
    const raw = JSON.parse(readFileSync(join(fixturesDir, name), 'utf8')) as {
        payload: MerossMessage['payload'];
    };
    return raw.payload;
}

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
        this.emit('message', `/app/${USER_ID}/subscribe`, Buffer.from(JSON.stringify(message)));
    }
}

function ackFor(
    request: MerossMessage,
    method: 'GETACK' | 'SETACK' | 'ERROR',
    payload: MerossMessage['payload'] = {}
): MerossMessage {
    const uuid = request.header.uuid ?? UUID;
    return encodeMessage({
        namespace: request.header.namespace,
        method,
        key: KEY,
        from: `/appliance/${uuid}/publish`,
        messageId: request.header.messageId,
        timestamp: request.header.timestamp,
        uuid,
        payload
    });
}

function enrollmentAck(sent: MerossMessage, options: { innerIp?: boolean; encrypt?: boolean } = {}): MerossMessage {
    const uuid = sent.header.uuid ?? UUID;
    if (sent.header.namespace === ABILITY_NAMESPACE) {
        return ackFor(sent, 'GETACK', {
            payloadVersion: 1,
            ability: {
                'Appliance.Control.ToggleX': {},
                'Appliance.Control.Multiple': { maxCmdNum: 5 },
                'Appliance.Control.Electricity': {},
                'Appliance.Control.ConsumptionX': {},
                ...(options.encrypt ? { 'Appliance.Encrypt.ECDHE': {} } : {})
            }
        });
    }
    if (sent.header.namespace === SYSTEM_ALL_NAMESPACE) {
        const payload = structuredClone(loadFixture('system-all-getack.json')) as {
            all: {
                system: {
                    hardware: { uuid: string };
                    firmware: { innerIp?: string };
                };
            };
        };
        payload.all.system.hardware.uuid = uuid;
        if (!options.innerIp) {
            delete payload.all.system.firmware.innerIp;
        }
        return ackFor(sent, 'GETACK', payload);
    }
    if (sent.header.namespace === 'Appliance.Control.Multiple' && sent.header.method === 'SET') {
        const commands = Array.isArray(sent.payload.multiple) ? sent.payload.multiple : [];
        return ackFor(sent, 'SETACK', {
            multiple: commands.map((command) => {
                const sub = command as {
                    header: { namespace: string; method: string };
                    payload: MerossMessage['payload'];
                };
                const ack = enrollmentAck({
                    header: {
                        ...sent.header,
                        namespace: sub.header.namespace,
                        method: 'GET',
                        messageId: sent.header.messageId
                    },
                    payload: sub.payload
                }, options);
                return {
                    header: { namespace: sub.header.namespace, method: 'GETACK' },
                    payload: ack.payload
                };
            })
        });
    }
    if (sent.header.namespace === 'Appliance.Control.Electricity') {
        return ackFor(sent, 'GETACK', {
            electricity: {
                channel: 0,
                power: 0,
                current: 0,
                voltage: 2300
            }
        });
    }
    if (sent.header.namespace === 'Appliance.Control.ConsumptionX') {
        return ackFor(sent, 'GETACK', { consumptionx: [] });
    }
    if (sent.header.namespace === 'Appliance.Control.ToggleX') {
        return ackFor(sent, 'GETACK', {
            togglex: { channel: 0, onoff: 1, entity: 1, lmTime: 1 }
        });
    }
    if (sent.header.namespace === 'Appliance.System.Online') {
        return ackFor(sent, 'GETACK', { online: { status: 1 } });
    }
    return ackFor(sent, 'GETACK');
}

function createCloudFetch(devices: unknown[] = [DEVICE_ROW]) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
        calls.push({ url: String(url), init: init ?? {} });
        if (String(url).endsWith('/v1/Auth/signIn')) {
            return ok(LOGIN_DATA);
        }
        if (String(url).endsWith('/v1/Device/devList')) {
            return ok(devices);
        }
        return jsonResponse({ apiStatus: 999, info: 'unexpected' }, 500);
    };
    return { fetchImpl, calls, devices };
}

function createMqttConnect(clientRef: { current?: FakeMqttClient }) {
    return () => {
        const client = new FakeMqttClient();
        clientRef.current = client;
        queueMicrotask(() => client.emit('connect'));
        return client;
    };
}

async function waitMacrotask(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function isPendingGet(sent: MerossMessage, alreadyAcked: Set<string>): boolean {
    if (alreadyAcked.has(sent.header.messageId)) {
        return false;
    }
    return sent.header.method === 'GET'
        || (
            sent.header.method === 'SET'
            && sent.header.namespace === 'Appliance.Control.Multiple'
        );
}

/**
 * Acks every outstanding GET / Multiple until a short quiet window — covers
 * Ability + System.All enrollment and the poller's cold-start batch.
 */
async function drainPendingGets(
    client: FakeMqttClient,
    alreadyAcked: Set<string>,
    options?: { innerIp?: boolean; encrypt?: boolean }
): Promise<void> {
    for (let quiet = 0; quiet < 5; ) {
        let ackedOne = false;
        for (const entry of client.published) {
            const sent = JSON.parse(entry.payload) as MerossMessage;
            if (!isPendingGet(sent, alreadyAcked)) {
                continue;
            }
            alreadyAcked.add(sent.header.messageId);
            client.deliver(enrollmentAck(sent, options));
            ackedOne = true;
            break;
        }
        if (ackedOne) {
            quiet = 0;
            await Promise.resolve();
            continue;
        }
        await waitMacrotask();
        quiet++;
    }
}

/**
 * Ability + System.All enrollment, then DevicePoller schedule(0) cold-start GETs.
 */
async function connectSession(session: Session, clientRef: { current?: FakeMqttClient }): Promise<void> {
    const connectPromise = session.connect();
    await Promise.resolve();
    const client = clientRef.current!;
    assert.ok(client, 'MQTT client was not created');

    const acked = new Set<string>();
    await drainPendingGets(client, acked);
    await connectPromise;
    await drainPendingGets(client, acked);
}

describe('Session.login and restore', () => {
    it('login returns a session with persistable TokenData', async () => {
        const { fetchImpl, calls } = createCloudFetch();
        const session = await Session.login(
            { email: EMAIL, password: PASSWORD },
            {
                cloud: { now: () => NOW, nonce: () => NONCE, fetch: fetchImpl }
            }
        );

        assert.equal(calls.length, 1);
        assert.equal(session.getToken().token, LOGIN_DATA.token);
        assert.equal(session.getToken().key, KEY);
        assert.equal(session.getToken().userId, USER_ID);
        assert.equal(session.getToken().domain, 'iotx-eu.meross.com');
        assert.equal(session.getToken().mqttDomain, MQTT_DOMAIN);
        assert.deepEqual(session.inventory.endpoints(), []);
    });

    it('restore rebuilds a session from stored TokenData', () => {
        const session = Session.restore({
            token: 'saved',
            key: KEY,
            userId: USER_ID,
            domain: 'iotx-eu.meross.com',
            mqttDomain: MQTT_DOMAIN
        });

        assert.equal(session.getToken().token, 'saved');
        assert.deepEqual(session.inventory.endpoints(), []);
    });
});

describe('Session.connect', () => {
    it('enrolls devices over MQTT and projects inventory rows', async () => {
        const { fetchImpl } = createCloudFetch();
        const clientRef: { current?: FakeMqttClient } = {};
        const session = await Session.login(
            { email: EMAIL, password: PASSWORD },
            {
                cloud: { now: () => NOW, nonce: () => NONCE, fetch: fetchImpl },
                mqttConnect: createMqttConnect(clientRef)
            }
        );

        await connectSession(session, clientRef);

        const rows = session.inventory.endpoints();
        assert.equal(rows.length, 1);
        assert.equal(rows[0]?.id, `${UUID}:0`);
        assert.equal(rows[0]?.name, 'Kitchen plug');
        assert.equal(rows[0]?.classHint, 'socket');
        assert.deepEqual(rows[0]?.traits, ['switch', 'energy']);
        assert.equal('online' in (rows[0] ?? {}), false);
        await session.disconnect();
    });

    it('endpoint returns a trait-bearing Endpoint after connect', async () => {
        const { fetchImpl } = createCloudFetch();
        const clientRef: { current?: FakeMqttClient } = {};
        const session = await Session.login(
            { email: EMAIL, password: PASSWORD },
            {
                cloud: { now: () => NOW, nonce: () => NONCE, fetch: fetchImpl },
                mqttConnect: createMqttConnect(clientRef)
            }
        );

        await connectSession(session, clientRef);

        const endpoint = session.endpoint(`${UUID}:0`);
        assert.equal(endpoint.id, `${UUID}:0`);
        assert.ok(endpoint.switch);
        assert.ok(endpoint.energy);
        assert.equal(endpoint.switch.isOn(), true);
        assert.throws(
            () => session.endpoint('missing'),
            (err: unknown) => err instanceof MerossError && err.code === 'ENDPOINT_NOT_FOUND'
        );
        await session.disconnect();
    });

    it('updates endpoint availability from System.Online PUSH', async () => {
        const { fetchImpl } = createCloudFetch();
        const clientRef: { current?: FakeMqttClient } = {};
        const session = await Session.login(
            { email: EMAIL, password: PASSWORD },
            {
                cloud: { now: () => NOW, nonce: () => NONCE, fetch: fetchImpl },
                mqttConnect: createMqttConnect(clientRef)
            }
        );

        await connectSession(session, clientRef);

        const endpoint = session.endpoint(`${UUID}:0`);
        const availability: boolean[] = [];
        endpoint.on('availability', (online) => availability.push(online));

        const client = clientRef.current!;
        client.deliver(encodeMessage({
            namespace: 'Appliance.System.Online',
            method: 'PUSH',
            key: KEY,
            from: `/appliance/${UUID}/publish`,
            uuid: UUID,
            payload: { online: { status: 2 } }
        }));

        assert.deepEqual(availability, [false]);
        assert.equal(endpoint.isOnline(), false);
        assert.equal('online' in (session.inventory.endpoints()[0] ?? {}), false);
        await session.disconnect();
    });

    it('disconnect closes MQTT and connect is idempotent', async () => {
        const { fetchImpl } = createCloudFetch();
        const clientRef: { current?: FakeMqttClient } = {};
        const session = await Session.login(
            { email: EMAIL, password: PASSWORD },
            {
                cloud: { now: () => NOW, nonce: () => NONCE, fetch: fetchImpl },
                mqttConnect: createMqttConnect(clientRef)
            }
        );

        await connectSession(session, clientRef);

        const client = clientRef.current!;
        const publishedBefore = client.published.length;
        await session.connect();
        assert.equal(client.published.length, publishedBefore);

        await session.disconnect();
        await session.disconnect();
    });

    it('skips offline cloud boards until they answer Ability and System.All', async () => {
        const shed = {
            uuid: 'offline00000000000000000000000001',
            devName: 'Shed plug',
            deviceType: 'mss110',
            onlineStatus: 2,
            channels: [{ channel: 0, devName: 'Shed plug' }]
        };
        const { fetchImpl } = createCloudFetch([DEVICE_ROW, shed]);
        const clientRef: { current?: FakeMqttClient } = {};
        const session = await Session.login(
            { email: EMAIL, password: PASSWORD },
            {
                cloud: { now: () => NOW, nonce: () => NONCE, fetch: fetchImpl },
                mqttConnect: createMqttConnect(clientRef)
            }
        );

        await connectSession(session, clientRef);

        const rows = session.inventory.endpoints();
        assert.equal(rows.length, 1);
        assert.equal(rows[0]?.id, `${UUID}:0`);
        assert.throws(
            () => session.endpoint(`${shed.uuid}:0`),
            (error: unknown) => error instanceof MerossError && error.code === 'ENDPOINT_NOT_FOUND'
        );
        await session.disconnect();
    });

    it('sync enrolls boards added to the account after connect', async () => {
        const devices: unknown[] = [DEVICE_ROW];
        const { fetchImpl } = createCloudFetch(devices);
        const clientRef: { current?: FakeMqttClient } = {};
        const session = await Session.login(
            { email: EMAIL, password: PASSWORD },
            {
                cloud: { now: () => NOW, nonce: () => NONCE, fetch: fetchImpl },
                mqttConnect: createMqttConnect(clientRef)
            }
        );

        await connectSession(session, clientRef);

        const added = {
            uuid: 'added0000000000000000000000000001',
            devName: 'Porch plug',
            deviceType: 'mss110',
            onlineStatus: 1,
            channels: [{ channel: 0, devName: 'Porch plug' }]
        };
        devices.push(added);

        const client = clientRef.current!;
        const acked = new Set(client.published.map((entry) => (
            JSON.parse(entry.payload) as MerossMessage
        ).header.messageId));
        const syncPromise = session.sync();
        await drainPendingGets(client, acked);
        await syncPromise;
        await drainPendingGets(client, acked);

        assert.equal(session.inventory.endpoints().length, 2);
        assert.equal(session.endpoint(`${added.uuid}:0`).id, `${added.uuid}:0`);
        await session.disconnect();
    });

    it('encrypts LAN bodies when Ability advertises Encrypt.ECDHE', async () => {
        const mac = '48:e1:e9:97:05:a4';
        const encryptionKey = deriveEncryptionKey(UUID, KEY, mac);
        const lanCalls: RequestInit[] = [];
        const lanFetch: typeof fetch = async (_url, init) => {
            lanCalls.push(init ?? {});
            const plain = decryptPayload(String(init?.body), encryptionKey);
            const sent = decodeMessage(plain, KEY);
            const ack = enrollmentAck(sent, { innerIp: true, encrypt: true });
            return {
                status: 200,
                statusText: 'OK',
                ok: true,
                async text() {
                    return encryptPayload(JSON.stringify(ack), encryptionKey);
                }
            } as Response;
        };

        const { fetchImpl } = createCloudFetch();
        const clientRef: { current?: FakeMqttClient } = {};
        const session = await Session.login(
            { email: EMAIL, password: PASSWORD },
            {
                cloud: { now: () => NOW, nonce: () => NONCE, fetch: fetchImpl },
                mqttConnect: createMqttConnect(clientRef),
                lanFetch
            }
        );

        const connectPromise = session.connect();
        await Promise.resolve();
        const client = clientRef.current!;
        const acked = new Set<string>();
        await drainPendingGets(client, acked, { encrypt: true, innerIp: true });
        await connectPromise;
        await drainPendingGets(client, acked, { encrypt: true, innerIp: true });

        assert.ok(lanCalls.length >= 1);
        const headers = lanCalls[0]!.headers as Record<string, string>;
        assert.equal(headers['Content-Type'], 'application/octet-stream');
        assert.equal(String(lanCalls[0]!.body).startsWith('{'), false);
        await session.disconnect();
    });

    it('retargets LAN after System.All reports a new innerIp', async () => {
        const lanUrls: string[] = [];
        const lanFetch: typeof fetch = async (url, init) => {
            lanUrls.push(String(url));
            const sent = decodeMessage(String(init?.body), KEY);
            const ack = enrollmentAck(sent, { innerIp: true });
            return {
                status: 200,
                statusText: 'OK',
                ok: true,
                async text() {
                    return JSON.stringify(ack);
                }
            } as Response;
        };

        const { fetchImpl } = createCloudFetch();
        const clientRef: { current?: FakeMqttClient } = {};
        const session = await Session.login(
            { email: EMAIL, password: PASSWORD },
            {
                cloud: { now: () => NOW, nonce: () => NONCE, fetch: fetchImpl },
                mqttConnect: createMqttConnect(clientRef),
                lanFetch
            }
        );

        const connectPromise = session.connect();
        await Promise.resolve();
        const client = clientRef.current!;
        const acked = new Set<string>();
        await drainPendingGets(client, acked, { innerIp: true });
        await connectPromise;
        await drainPendingGets(client, acked, { innerIp: true });

        assert.ok(lanUrls.length >= 1);

        const allPayload = structuredClone(loadFixture('system-all-getack.json')) as {
            all: { system: { firmware: { innerIp?: string } } };
        };
        allPayload.all.system.firmware.innerIp = '10.0.0.42';
        client.deliver(encodeMessage({
            namespace: SYSTEM_ALL_NAMESPACE,
            method: 'PUSH',
            key: KEY,
            from: `/appliance/${UUID}/publish`,
            uuid: UUID,
            payload: allPayload
        }));
        await Promise.resolve();

        await session.endpoint(`${UUID}:0`).switch!.setOn(true);
        assert.equal(lanUrls.at(-1), 'http://10.0.0.42/config');
        await session.disconnect();
    });

    it('emits connection on connect, drop, reconnect, and disconnect', async () => {
        const { fetchImpl } = createCloudFetch();
        const clientRef: { current?: FakeMqttClient } = {};
        const session = await Session.login(
            { email: EMAIL, password: PASSWORD },
            {
                cloud: { now: () => NOW, nonce: () => NONCE, fetch: fetchImpl },
                mqttConnect: createMqttConnect(clientRef)
            }
        );

        const connections: boolean[] = [];
        session.on('connection', (connected) => connections.push(connected));

        await connectSession(session, clientRef);
        assert.deepEqual(connections, [true]);

        clientRef.current!.emit('close');
        assert.deepEqual(connections, [true, false]);

        clientRef.current!.emit('connect');
        assert.deepEqual(connections, [true, false, true]);

        await session.disconnect();
        assert.deepEqual(connections, [true, false, true, false]);
    });

    it('emits ratelimit when MQTT publish budget is exhausted', async () => {
        const { fetchImpl } = createCloudFetch();
        const clientRef: { current?: FakeMqttClient } = {};
        const session = await Session.login(
            { email: EMAIL, password: PASSWORD },
            {
                cloud: { now: () => NOW, nonce: () => NONCE, fetch: fetchImpl },
                mqttConnect: createMqttConnect(clientRef)
            }
        );

        const drops: Array<[string, number]> = [];
        session.on('ratelimit', (uuid, dropped) => drops.push([uuid, dropped]));

        await connectSession(session, clientRef);
        const client = clientRef.current!;
        const endpoint = session.endpoint(`${UUID}:0`);

        for (let i = 0; i < RATE_LIMIT_MAX_PUBLISHES + 2; i += 1) {
            const publishedBefore = client.published.length;
            const pending = endpoint.switch!.setOn(i % 2 === 0);
            await Promise.resolve();
            if (client.published.length === publishedBefore) {
                await assert.rejects(
                    pending,
                    (err: unknown) =>
                        err instanceof TransportError && err.code === 'MQTT_RATE_LIMITED'
                );
                break;
            }
            const sent = JSON.parse(client.published.at(-1)!.payload) as MerossMessage;
            client.deliver(ackFor(sent, 'SETACK', {
                togglex: { channel: 0, onoff: i % 2 === 0 ? 1 : 0 }
            }));
            await pending;
        }

        assert.ok(drops.length >= 1);
        assert.equal(drops[0]![0], UUID);
        assert.ok(drops[0]![1] >= 1);
        await session.disconnect();
    });

    it('tears MQTT down when connect fails on an expired token', async () => {
        const fetchImpl: typeof fetch = async (url) => {
            if (String(url).endsWith('/v1/Auth/signIn')) {
                return ok(LOGIN_DATA);
            }
            if (String(url).endsWith('/v1/Device/devList')) {
                return jsonResponse({ apiStatus: 1019, info: 'Token invalid' });
            }
            return jsonResponse({ apiStatus: 999, info: 'unexpected' }, 500);
        };
        const clientRef: { current?: FakeMqttClient } = {};
        const session = await Session.login(
            { email: EMAIL, password: PASSWORD },
            {
                cloud: { now: () => NOW, nonce: () => NONCE, fetch: fetchImpl },
                mqttConnect: createMqttConnect(clientRef)
            }
        );

        const connections: boolean[] = [];
        session.on('connection', (connected) => connections.push(connected));

        await assert.rejects(
            session.connect(),
            (error: unknown) => error instanceof AuthError && error.code === 'TOKEN_EXPIRED'
        );
        assert.deepEqual(connections, [true, false]);
        await session.disconnect();
    });
});
