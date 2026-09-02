import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { ABILITY_NAMESPACE, SYSTEM_ALL_NAMESPACE } from '../src/device';
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
import { RATE_LIMIT_MAX_PUBLISHES } from '../src/transport';
import { jsonResponse, ok } from './helpers/http';
import { FakeMqttClient } from './helpers/mqtt';

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

const LAMP_UUID = '3306138957096651080248e1e99705b7';
const LAMP_ROW = {
    uuid: LAMP_UUID,
    devName: 'Lamp',
    deviceType: 'mss110',
    onlineStatus: 1,
    channels: [{ channel: 0, devName: 'Lamp' }]
};

interface EnrollmentAckOptions {
    innerIp?: boolean;
    encrypt?: boolean;
}

function loadFixture(name: string): MerossMessage['payload'] {
    const raw = JSON.parse(readFileSync(join(fixturesDir, name), 'utf8')) as {
        payload: MerossMessage['payload'];
    };
    return raw.payload;
}

/**
 * Answers Ability, System.All, and poller GETs as they are published so
 * Session.connect/sync can settle. Host commands (ToggleX SET) stay unanswered.
 */
class EnrollingMqttClient extends FakeMqttClient {
    ackOptions: EnrollmentAckOptions = {};
    failUuid: string | undefined;

    constructor() {
        super({ userId: USER_ID });
        this.autoAck = (payload) => this.enrollmentReply(payload);
    }

    private enrollmentReply(payload: string): MerossMessage | undefined {
        let sent: MerossMessage;
        try {
            sent = JSON.parse(payload) as MerossMessage;
        } catch {
            return undefined;
        }
        if (!shouldAutoAck(sent)) {
            return undefined;
        }
        return sent.header.uuid === this.failUuid
            ? ackFor(sent, 'ERROR', { error: { code: 5000, detail: 'boom' } })
            : enrollmentAck(sent, this.ackOptions);
    }
}

function shouldAutoAck(sent: MerossMessage): boolean {
    return sent.header.method === 'GET'
        || (
            sent.header.method === 'SET'
            && sent.header.namespace === 'Appliance.Control.Multiple'
        );
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

function enrollmentAck(sent: MerossMessage, options: EnrollmentAckOptions = {}): MerossMessage {
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

function createCloudFetch(
    devices: unknown[] = [DEVICE_ROW],
    login: () => unknown = () => LOGIN_DATA
) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
        calls.push({ url: String(url), init: init ?? {} });
        if (String(url).endsWith('/v1/Auth/signIn')) {
            return ok(login());
        }
        if (String(url).endsWith('/v1/Device/devList')) {
            return ok(devices);
        }
        return jsonResponse({ apiStatus: 999, info: 'unexpected' }, 500);
    };
    return { fetchImpl, calls, devices };
}

function createMqttConnect(
    clientRef: { current?: EnrollingMqttClient },
    ackOptions: EnrollmentAckOptions = {}
) {
    return () => {
        const client = new EnrollingMqttClient();
        client.ackOptions = ackOptions;
        clientRef.current = client;
        queueMicrotask(() => client.emit('connect'));
        return client;
    };
}

/**
 * Poller schedule(0) is a macrotask; one tick lets the cold-start Multiple
 * publish and auto-ack after connect returns.
 */
async function waitMacrotask(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

/**
 * Logs in, connects MQTT, enrolls the cloud list (Ability + System.All),
 * and waits out the first poller tick. Tests that care about later sync
 * mutate `devices` or `client.ackOptions` / `client.failUuid`.
 */
async function loginConnected(options: {
    devices?: unknown[];
    login?: () => unknown;
    lanFetch?: typeof fetch;
    ack?: EnrollmentAckOptions;
    /** Attach listeners before MQTT comes up so connect emits are not missed. */
    beforeConnect?: (session: Session) => void;
} = {}): Promise<{
    session: Session;
    client: EnrollingMqttClient;
    clientRef: { current?: EnrollingMqttClient };
    calls: Array<{ url: string; init: RequestInit }>;
    devices: unknown[];
}> {
    const devices = options.devices ?? [DEVICE_ROW];
    const { fetchImpl, calls } = createCloudFetch(devices, options.login);
    const clientRef: { current?: EnrollingMqttClient } = {};
    const session = await Session.login(
        { email: EMAIL, password: PASSWORD },
        {
            cloud: { now: () => NOW, nonce: () => NONCE, fetch: fetchImpl },
            mqttConnect: createMqttConnect(clientRef, options.ack ?? {}),
            lanFetch: options.lanFetch
        }
    );
    options.beforeConnect?.(session);
    await session.connect();
    await waitMacrotask();
    const client = clientRef.current;
    assert.ok(client, 'MQTT client was not created');
    return { session, client, clientRef, calls, devices };
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
        const { session } = await loginConnected();

        const rows = session.inventory.endpoints();
        assert.equal(rows.length, 1);
        assert.equal(rows[0]?.id, `${UUID}:0`);
        assert.equal(rows[0]?.name, 'Kitchen plug');
        assert.equal(rows[0]?.classHint, 'socket');
        assert.deepEqual(rows[0]?.traits, ['switch', 'system', 'energy']);
        assert.equal('online' in (rows[0] ?? {}), false);
        await session.disconnect();
    });

    it('endpoint returns a trait-bearing Endpoint after connect', async () => {
        const { session } = await loginConnected();

        const endpoint = session.endpoint(`${UUID}:0`);
        assert.equal(endpoint.id, `${UUID}:0`);
        assert.ok(endpoint.switch);
        assert.ok(endpoint.energy);
        assert.ok(endpoint.system);
        assert.equal(endpoint.switch.isOn(), true);
        assert.equal(endpoint.system.getFirmware()?.version, '7.3.13');
        await session.disconnect();
    });

    it('throws ENDPOINT_NOT_FOUND for an unknown id', async () => {
        const { session } = await loginConnected();

        assert.throws(
            () => session.endpoint('missing'),
            (err: unknown) => err instanceof MerossError && err.code === 'ENDPOINT_NOT_FOUND'
        );
        await session.disconnect();
    });

    it('updates endpoint availability from System.Online PUSH', async () => {
        const { session, client } = await loginConnected();

        const endpoint = session.endpoint(`${UUID}:0`);
        const availability: boolean[] = [];
        endpoint.on('availability', (online) => availability.push(online));

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

    it('connect is a no-op while already connected', async () => {
        const { session, client } = await loginConnected();

        const publishedBefore = client.published.length;
        await session.connect();
        assert.equal(client.published.length, publishedBefore);

        await session.disconnect();
    });

    it('disconnect closes MQTT and is idempotent', async () => {
        const { session, client } = await loginConnected();

        await session.disconnect();
        assert.equal(client.ended, true);

        await session.disconnect();
        assert.equal(client.ended, true);
    });

    it('skips offline cloud devices until they answer Ability and System.All', async () => {
        const shed = {
            uuid: 'offline00000000000000000000000001',
            devName: 'Shed plug',
            deviceType: 'mss110',
            onlineStatus: 2,
            channels: [{ channel: 0, devName: 'Shed plug' }]
        };
        const { session } = await loginConnected({ devices: [DEVICE_ROW, shed] });

        const rows = session.inventory.endpoints();
        assert.equal(rows.length, 1);
        assert.equal(rows[0]?.id, `${UUID}:0`);
        assert.throws(
            () => session.endpoint(`${shed.uuid}:0`),
            (error: unknown) => error instanceof MerossError && error.code === 'ENDPOINT_NOT_FOUND'
        );
        await session.disconnect();
    });

    it('sync enrolls devices added to the account after connect', async () => {
        const { session, devices } = await loginConnected();

        devices.push({
            uuid: 'added0000000000000000000000000001',
            devName: 'Porch plug',
            deviceType: 'mss110',
            onlineStatus: 1,
            channels: [{ channel: 0, devName: 'Porch plug' }]
        });
        await session.sync();

        assert.equal(session.inventory.endpoints().length, 2);
        assert.equal(
            session.endpoint('added0000000000000000000000000001:0').id,
            'added0000000000000000000000000001:0'
        );
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

        const { session } = await loginConnected({
            lanFetch,
            ack: { encrypt: true, innerIp: true }
        });

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

        const { session, client } = await loginConnected({
            lanFetch,
            ack: { innerIp: true }
        });

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

    it('emits connection true after connect', async () => {
        const connections: boolean[] = [];
        const { session } = await loginConnected({
            beforeConnect: (next) => {
                next.on('connection', (connected) => connections.push(connected));
            }
        });

        assert.deepEqual(connections, [true]);
        await session.disconnect();
    });

    it('emits connection false on broker drop and true on reconnect', async () => {
        const { session, client } = await loginConnected();
        const connections: boolean[] = [];
        session.on('connection', (connected) => connections.push(connected));

        client.emit('close');
        assert.deepEqual(connections, [false]);

        client.emit('connect');
        assert.deepEqual(connections, [false, true]);

        await session.disconnect();
    });

    it('emits connection false when disconnect closes MQTT', async () => {
        const { session } = await loginConnected();
        const connections: boolean[] = [];
        session.on('connection', (connected) => connections.push(connected));

        await session.disconnect();

        assert.deepEqual(connections, [false]);
    });

    it('emits ratelimit when the MQTT publish window is exhausted', async () => {
        const { session, client } = await loginConnected();
        const drops: Array<[string, number]> = [];
        session.on('ratelimit', (uuid, dropped) => drops.push([uuid, dropped]));
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
        const clientRef: { current?: EnrollingMqttClient } = {};
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
        assert.equal(clientRef.current?.ended, true);
        await session.disconnect();
    });
});

describe('Session.sync', () => {
    it('drops devices that left the cloud account', async () => {
        const { session, devices } = await loginConnected({
            devices: [DEVICE_ROW, LAMP_ROW]
        });
        assert.deepEqual(
            session.inventory.endpoints().map((row) => row.id).sort(),
            [`${LAMP_UUID}:0`, `${UUID}:0`].sort()
        );

        devices.splice(1, 1);
        await session.sync();

        assert.deepEqual(
            session.inventory.endpoints().map((row) => row.id),
            [`${UUID}:0`]
        );
        assert.throws(
            () => session.endpoint(`${LAMP_UUID}:0`),
            (err: unknown) => err instanceof MerossError && err.code === 'ENDPOINT_NOT_FOUND'
        );
        await session.disconnect();
    });

    it('keeps the same Endpoint when a re-read finds the same shape', async () => {
        const { session } = await loginConnected();
        const before = session.endpoint(`${UUID}:0`);

        await session.sync();

        assert.equal(session.endpoint(`${UUID}:0`), before);
        await session.disconnect();
    });

    it('joins overlapping callers to the run already in flight', async () => {
        const { session, calls } = await loginConnected();
        const listedAfterConnect = calls.filter((call) => call.url.endsWith('/v1/Device/devList')).length;

        await Promise.all([session.sync(), session.sync()]);

        // A second pass would re-list and could drop a device the first just enrolled.
        assert.equal(
            calls.filter((call) => call.url.endsWith('/v1/Device/devList')).length,
            listedAfterConnect + 1
        );
        assert.deepEqual(
            session.inventory.endpoints().map((row) => row.id),
            [`${UUID}:0`]
        );
        await session.disconnect();
    });

    it('runs a later sync normally once the first has settled', async () => {
        const { session, calls } = await loginConnected();
        const listedAfterConnect = calls.filter((call) => call.url.endsWith('/v1/Device/devList')).length;

        await session.sync();
        await session.sync();

        assert.equal(
            calls.filter((call) => call.url.endsWith('/v1/Device/devList')).length,
            listedAfterConnect + 2
        );
        await session.disconnect();
    });

    it('rebuilds an Endpoint when the device reports new abilities', async () => {
        const { session, client } = await loginConnected();
        const before = session.endpoint(`${UUID}:0`);

        client.ackOptions = { encrypt: true };
        await session.sync();

        const after = session.endpoint(`${UUID}:0`);
        assert.notEqual(after, before);
        assert.deepEqual(
            session.inventory.endpoints().map((row) => row.id),
            [`${UUID}:0`]
        );
        await session.disconnect();
    });

    it('emits error and keeps the rest when one device fails to enroll', async () => {
        const { session, client, devices } = await loginConnected();
        const errors: Error[] = [];
        session.on('warning', (error) => errors.push(error));

        devices.push(LAMP_ROW);
        client.failUuid = LAMP_UUID;
        await session.sync();

        assert.equal(errors.length, 1);
        assert.deepEqual(
            session.inventory.endpoints().map((row) => row.id),
            [`${UUID}:0`]
        );
        await session.disconnect();
    });
});

describe('Session.reauthenticate', () => {
    it('swaps the token in place and leaves transports alone', async () => {
        let loginData: unknown = LOGIN_DATA;
        const { session, client, clientRef } = await loginConnected({
            login: () => loginData
        });
        const before = session.endpoint(`${UUID}:0`);

        loginData = { ...LOGIN_DATA, token: 'fresh-token' };
        const token = await session.reauthenticate({ email: EMAIL, password: PASSWORD });

        assert.equal(token.token, 'fresh-token');
        assert.equal(session.getToken().token, 'fresh-token');
        assert.equal(clientRef.current, client);
        assert.equal(session.endpoint(`${UUID}:0`), before);
        await session.disconnect();
    });

    it('rebuilds transports when the device key rotated but keeps endpoints', async () => {
        let loginData: unknown = LOGIN_DATA;
        const { session, client, clientRef } = await loginConnected({
            login: () => loginData
        });
        const before = session.endpoint(`${UUID}:0`);

        loginData = { ...LOGIN_DATA, key: 'rotated-key' };
        await session.reauthenticate({ email: EMAIL, password: PASSWORD });

        assert.equal(session.getToken().key, 'rotated-key');
        assert.notEqual(clientRef.current, client);
        assert.equal(session.endpoint(`${UUID}:0`), before);
        await session.disconnect();
    });
});
