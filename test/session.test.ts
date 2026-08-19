import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { ABILITY_NAMESPACE, SYSTEM_ALL_NAMESPACE } from '../src/graph';
import { MerossError } from '../src/errors';
import { encodeMessage, type MerossMessage } from '../src/protocol';
import { Session } from '../src/session';
import type { MqttBrokerClient } from '../src/transport';

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

function enrollmentAck(sent: MerossMessage): MerossMessage {
    if (sent.header.namespace === ABILITY_NAMESPACE) {
        return ackFor(sent, 'GETACK', {
            payloadVersion: 1,
            ability: {
                'Appliance.Control.ToggleX': {},
                'Appliance.Control.Multiple': { maxCmdNum: 5 },
                'Appliance.Control.Electricity': {},
                'Appliance.Control.ConsumptionX': {}
            }
        });
    }
    if (sent.header.namespace === SYSTEM_ALL_NAMESPACE) {
        const payload = structuredClone(loadFixture('system-all-getack.json')) as {
            all: { system: { firmware: { innerIp?: string } } };
        };
        // Session tests have no LAN HTTP server; drop innerIp so energy polls stay on MQTT.
        delete payload.all.system.firmware.innerIp;
        return ackFor(sent, 'GETACK', payload);
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
    return ackFor(sent, 'GETACK');
}

function createCloudFetch() {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
        calls.push({ url: String(url), init: init ?? {} });
        if (String(url).endsWith('/v1/Auth/signIn')) {
            return ok(LOGIN_DATA);
        }
        if (String(url).endsWith('/v1/Device/devList')) {
            return ok([DEVICE_ROW]);
        }
        return jsonResponse({ apiStatus: 999, info: 'unexpected' }, 500);
    };
    return { fetchImpl, calls };
}

function createMqttConnect(clientRef: { current?: FakeMqttClient }) {
    return () => {
        const client = new FakeMqttClient();
        clientRef.current = client;
        queueMicrotask(() => client.emit('connect'));
        return client;
    };
}

async function ackNextGet(client: FakeMqttClient, alreadyAcked: Set<string>): Promise<void> {
    for (let attempt = 0; attempt < 50; attempt++) {
        await Promise.resolve();
        for (const entry of client.published) {
            const sent = JSON.parse(entry.payload) as MerossMessage;
            if (sent.header.method !== 'GET' || alreadyAcked.has(sent.header.messageId)) {
                continue;
            }
            alreadyAcked.add(sent.header.messageId);
            client.deliver(enrollmentAck(sent));
            return;
        }
    }
    assert.fail('MQTT GET was not published');
}

async function connectSession(session: Session, clientRef: { current?: FakeMqttClient }): Promise<void> {
    const connectPromise = session.connect();
    await Promise.resolve();
    const client = clientRef.current!;
    assert.ok(client, 'MQTT client was not created');

    const acked = new Set<string>();
    await ackNextGet(client, acked);
    await ackNextGet(client, acked);
    await connectPromise;
    await ackNextGet(client, acked);
    await ackNextGet(client, acked);
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
        assert.equal(rows[0]?.online, true);
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
});
