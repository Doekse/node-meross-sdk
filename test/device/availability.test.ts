import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, type TestContext } from 'node:test';

import { DeviceAvailability } from '../../src/device/availability';
import { Heartbeat } from '../../src/device/heartbeat';
import { Endpoint } from '../../src/endpoint';
import { decodeMessage, encodeMessage, type MerossMessage, type MerossPayload } from '../../src/protocol';

const fixturesDir = join(process.cwd(), 'test/fixtures');
const UUID = '2206138957096651080248e1e99705a4';
const KEY = 'stub-key';
const INTERVAL_MS = 10_000;

function loadFixture(name: string): MerossMessage {
    return decodeMessage(JSON.parse(readFileSync(join(fixturesDir, name), 'utf8')) as unknown);
}

function systemAllGetAck(options: {
    uuid?: string;
    status?: number;
    payload?: MerossPayload;
} = {}): MerossMessage {
    const uuid = options.uuid ?? UUID;
    const payload = options.payload ?? {
        all: {
            system: {
                hardware: { type: 'mss110', uuid },
                firmware: {},
                online: { status: options.status ?? 1 }
            },
            digest: {}
        }
    };
    return encodeMessage({
        namespace: 'Appliance.System.All',
        method: 'GETACK',
        key: KEY,
        from: `/appliance/${uuid}/publish`,
        uuid,
        payload
    });
}

function stubRequest(uuid = UUID): () => Promise<MerossMessage> {
    return async (): Promise<MerossMessage> => systemAllGetAck({ uuid });
}

async function unreachable(): Promise<never> {
    throw new Error('unreachable');
}

async function resolveProbe(): Promise<void> {}

function noop(): void {}

function alwaysOnline(): boolean {
    return true;
}

/** Drain queued `perform` microtasks after a fake-timer tick. */
async function settle(hops: number): Promise<void> {
    for (let i = 0; i < hops; i++) {
        await Promise.resolve();
    }
}

async function runSilenceProbe(
    t: TestContext,
    pollOnlineImpl: () => Promise<void>
): Promise<{ offline: boolean; pollCount: number }> {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let clock = 0;
    let offline = false;
    const pollOnline = t.mock.fn(pollOnlineImpl);
    const heartbeat = new Heartbeat({
        intervalMs: INTERVAL_MS,
        isOnline(): boolean {
            return !offline;
        },
        pollOnline,
        onSilenceOffline(): void {
            offline = true;
        },
        now(): number {
            return clock;
        }
    });
    heartbeat.start();
    heartbeat.recordResponse();
    clock = INTERVAL_MS + 1;
    t.mock.timers.tick(INTERVAL_MS + 1);
    await settle(2);
    heartbeat.stop();
    return { offline, pollCount: pollOnline.mock.callCount() };
}

describe('Heartbeat silence detection', () => {
    it('polls System.All when silence exceeds the interval', async (t: TestContext) => {
        const { pollCount } = await runSilenceProbe(t, resolveProbe);
        assert.equal(pollCount, 1);
    });

    it('does not mark offline before any response was recorded', async (t: TestContext) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        let offline = false;

        const heartbeat = new Heartbeat({
            intervalMs: INTERVAL_MS,
            isOnline: alwaysOnline,
            pollOnline: unreachable,
            onSilenceOffline(): void {
                offline = true;
            }
        });

        heartbeat.start();
        t.mock.timers.tick(INTERVAL_MS * 2);
        await settle(2);

        assert.equal(offline, false);
        heartbeat.stop();
    });

    it('marks offline after silence when the liveness probe fails', async (t: TestContext) => {
        const { offline, pollCount } = await runSilenceProbe(t, unreachable);
        assert.equal(offline, true);
        assert.equal(pollCount, 1);
    });

    it('does not mark offline after silence when the liveness probe succeeds', async (t: TestContext) => {
        const { offline, pollCount } = await runSilenceProbe(t, resolveProbe);
        assert.equal(offline, false);
        assert.equal(pollCount, 1);
    });

    it('does not mark offline from recordResponse after the silence window', () => {
        let clock = 0;
        let offline = false;

        const heartbeat = new Heartbeat({
            intervalMs: INTERVAL_MS,
            isOnline(): boolean {
                return !offline;
            },
            pollOnline: resolveProbe,
            onSilenceOffline(): void {
                offline = true;
            },
            now(): number {
                return clock;
            }
        });

        heartbeat.start();
        heartbeat.recordResponse();
        clock = INTERVAL_MS + 1;
        heartbeat.recordResponse();

        assert.equal(offline, false);
        heartbeat.stop();
    });

    it('reschedules the next check at the remaining silence window, not a full interval', async (t: TestContext) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        let clock = 0;
        const pollOnline = t.mock.fn(resolveProbe);

        const heartbeat = new Heartbeat({
            intervalMs: INTERVAL_MS,
            isOnline: alwaysOnline,
            pollOnline,
            onSilenceOffline: noop,
            now(): number {
                return clock;
            }
        });

        heartbeat.start();
        heartbeat.recordResponse();

        clock = 6_000;
        heartbeat.recordResponse();

        clock = 10_000;
        t.mock.timers.tick(10_000);
        await settle(2);

        assert.equal(pollOnline.mock.callCount(), 0);

        clock = 16_000;
        t.mock.timers.tick(6_000);
        await settle(2);

        assert.equal(pollOnline.mock.callCount(), 1);
        heartbeat.stop();
    });

    it('does not leave a duplicate timer behind when stop() runs mid-check', async (t: TestContext) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        let clock = 0;
        let resolvePoll!: () => void;
        const pollOnline = t.mock.fn(() => new Promise<void>((resolve) => {
            resolvePoll = resolve;
        }));

        const heartbeat = new Heartbeat({
            intervalMs: INTERVAL_MS,
            isOnline: alwaysOnline,
            pollOnline,
            onSilenceOffline: noop,
            now(): number {
                return clock;
            }
        });

        heartbeat.start();
        heartbeat.recordResponse();

        clock = INTERVAL_MS;
        t.mock.timers.tick(INTERVAL_MS);
        await settle(2);

        assert.equal(pollOnline.mock.callCount(), 1);
        const firstResolve = resolvePoll;

        heartbeat.stop();
        heartbeat.start();

        firstResolve();
        await settle(2);

        assert.equal(pollOnline.mock.callCount(), 1);

        clock = INTERVAL_MS * 2;
        t.mock.timers.tick(INTERVAL_MS);
        await settle(2);

        assert.equal(pollOnline.mock.callCount(), 2);
        heartbeat.stop();
    });

    it('rejects a zero intervalMs', () => {
        assert.throws(
            () => new Heartbeat({
                intervalMs: 0,
                isOnline: alwaysOnline,
                pollOnline: resolveProbe,
                onSilenceOffline: noop
            }),
            RangeError
        );
    });

    it('rejects a negative intervalMs', () => {
        assert.throws(
            () => new Heartbeat({
                intervalMs: -1,
                isOnline: alwaysOnline,
                pollOnline: resolveProbe,
                onSilenceOffline: noop
            }),
            RangeError
        );
    });
});

/**
 * DeviceAvailability silence uses the same timer dance as Heartbeat; this
 * keeps malformed vs unreachable vs success probes from copying it.
 */
async function runBoardSilence(
    t: TestContext,
    request: () => Promise<MerossMessage>
): Promise<{
    endpoint: Endpoint;
    seen: boolean[];
    monitor: DeviceAvailability;
    clearMqttCalls: number;
}> {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let clock = 0;
    let clearMqttCalls = 0;
    const endpoint = new Endpoint({ id: `${UUID}:0`, traits: ['switch'], initialOnline: true });
    const seen: boolean[] = [];
    endpoint.on('availability', (online) => seen.push(online));
    const monitor = new DeviceAvailability({
        uuid: UUID,
        initialOnline: true,
        endpoints: [endpoint],
        heartbeatIntervalMs: INTERVAL_MS,
        now(): number {
            return clock;
        },
        clearMqtt(): void {
            clearMqttCalls += 1;
        },
        request
    });
    monitor.start();
    monitor.handleMessage(loadFixture('online-getack.json'));
    seen.length = 0;
    clock = INTERVAL_MS + 1;
    t.mock.timers.tick(INTERVAL_MS + 1);
    await settle(3);
    return { endpoint, seen, monitor, clearMqttCalls };
}

describe('DeviceAvailability', () => {
    it('syncs initial availability on start', () => {
        const endpoint = new Endpoint({ id: `${UUID}:0`, traits: ['switch'], initialOnline: true });
        const seen: boolean[] = [];
        endpoint.on('availability', (online) => seen.push(online));

        const monitor = new DeviceAvailability({
            uuid: UUID,
            initialOnline: true,
            endpoints: [endpoint],
            request: stubRequest()
        });

        monitor.start();
        assert.deepEqual(seen, [true]);
        monitor.stop();
    });

    it('does not offline from System.Online status 2', () => {
        const endpoint = new Endpoint({ id: `${UUID}:0`, traits: ['switch'], initialOnline: true });
        const seen: boolean[] = [];
        endpoint.on('availability', (online) => seen.push(online));

        const monitor = new DeviceAvailability({
            uuid: UUID,
            initialOnline: true,
            endpoints: [endpoint],
            request: stubRequest()
        });
        monitor.start();
        seen.length = 0;

        monitor.handleMessage(loadFixture('online-push.json'));

        assert.deepEqual(seen, []);
        assert.equal(endpoint.isOnline(), true);
        monitor.stop();
    });

    it('does not offline from Online GETACK status 2', () => {
        const endpoint = new Endpoint({ id: `${UUID}:0`, traits: ['switch'], initialOnline: true });
        const seen: boolean[] = [];
        endpoint.on('availability', (online) => seen.push(online));

        const monitor = new DeviceAvailability({
            uuid: UUID,
            initialOnline: true,
            endpoints: [endpoint],
            request: stubRequest()
        });
        monitor.start();
        seen.length = 0;

        const ack = encodeMessage({
            namespace: 'Appliance.System.Online',
            method: 'GETACK',
            key: KEY,
            from: '/app/42-lan/subscribe',
            payload: { online: { status: 2 } }
        });

        monitor.handleMessage(ack);

        assert.deepEqual(seen, []);
        assert.equal(endpoint.isOnline(), true);
        monitor.stop();
    });

    it('onlines a dead board on any inbound message', () => {
        const endpoint = new Endpoint({ id: `${UUID}:0`, traits: ['switch'], initialOnline: false });
        const seen: boolean[] = [];
        endpoint.on('availability', (online) => seen.push(online));

        const monitor = new DeviceAvailability({
            uuid: UUID,
            initialOnline: false,
            endpoints: [endpoint],
            request: stubRequest()
        });
        monitor.start();
        seen.length = 0;

        monitor.handleMessage(encodeMessage({
            namespace: 'Appliance.Control.ToggleX',
            method: 'PUSH',
            key: KEY,
            from: `/appliance/${UUID}/publish`,
            uuid: UUID,
            payload: { togglex: [{ channel: 0, onoff: 1 }] }
        }));

        assert.deepEqual(seen, [true]);
        monitor.stop();
    });

    it('onlines a dead board from System.All and reports innerIp without clearMqtt when status is 1', () => {
        const endpoint = new Endpoint({ id: `${UUID}:0`, traits: ['switch'], initialOnline: false });
        const seen: boolean[] = [];
        const ips: Array<string | undefined> = [];
        let clearMqttCalls = 0;
        endpoint.on('availability', (online) => seen.push(online));

        const monitor = new DeviceAvailability({
            uuid: UUID,
            initialOnline: false,
            endpoints: [endpoint],
            request: stubRequest(),
            clearMqtt(): void {
                clearMqttCalls += 1;
            },
            onInnerIp(innerIp: string | undefined): void {
                ips.push(innerIp);
            }
        });
        monitor.start();
        seen.length = 0;

        monitor.handleMessage(loadFixture('system-all-getack.json'));

        assert.deepEqual(seen, [true]);
        assert.deepEqual(ips, ['192.168.201.190']);
        assert.equal(clearMqttCalls, 0);
        monitor.stop();
    });

    it('calls clearMqtt on All status !== 1 without offlining the board', () => {
        const endpoint = new Endpoint({ id: `${UUID}:0`, traits: ['switch'], initialOnline: true });
        const seen: boolean[] = [];
        let clearMqttCalls = 0;
        endpoint.on('availability', (online) => seen.push(online));

        const monitor = new DeviceAvailability({
            uuid: UUID,
            initialOnline: true,
            endpoints: [endpoint],
            request: stubRequest(),
            clearMqtt(): void {
                clearMqttCalls += 1;
            }
        });
        monitor.start();
        seen.length = 0;

        monitor.handleMessage(systemAllGetAck({ status: 2 }));

        assert.deepEqual(seen, []);
        assert.equal(clearMqttCalls, 1);
        assert.equal(endpoint.isOnline(), true);
        monitor.stop();
    });

    it('does not call clearMqtt on All status 1', () => {
        const endpoint = new Endpoint({ id: `${UUID}:0`, traits: ['switch'], initialOnline: true });
        let clearMqttCalls = 0;

        const monitor = new DeviceAvailability({
            uuid: UUID,
            initialOnline: true,
            endpoints: [endpoint],
            request: stubRequest(),
            clearMqtt(): void {
                clearMqttCalls += 1;
            }
        });
        monitor.start();

        monitor.handleMessage(loadFixture('system-all-getack.json'));

        assert.equal(clearMqttCalls, 0);
        monitor.stop();
    });

    it('does not offline from Runtime abnormal iotStatus', () => {
        const endpoint = new Endpoint({ id: `${UUID}:0`, traits: ['switch'], initialOnline: true });
        const seen: boolean[] = [];
        endpoint.on('availability', (online) => seen.push(online));

        const monitor = new DeviceAvailability({
            uuid: UUID,
            initialOnline: true,
            endpoints: [endpoint],
            request: stubRequest()
        });
        monitor.start();
        seen.length = 0;

        monitor.handleMessage(loadFixture('runtime-getack-abnormal.json'));

        assert.deepEqual(seen, []);
        assert.equal(endpoint.isOnline(), true);
        monitor.stop();
    });

    it('does not offline after silence when the liveness probe All succeeds', async (t: TestContext) => {
        const { endpoint, seen, monitor, clearMqttCalls } = await runBoardSilence(
            t,
            async () => systemAllGetAck({ status: 2 })
        );

        assert.deepEqual(seen, []);
        assert.equal(endpoint.isOnline(), true);
        assert.equal(clearMqttCalls, 1);
        monitor.stop();
    });

    it('does not offline from a malformed inbound All', () => {
        const endpoint = new Endpoint({ id: `${UUID}:0`, traits: ['switch'], initialOnline: true });
        const seen: boolean[] = [];
        endpoint.on('availability', (online) => seen.push(online));

        const monitor = new DeviceAvailability({
            uuid: UUID,
            initialOnline: true,
            endpoints: [endpoint],
            request: stubRequest()
        });
        monitor.start();
        seen.length = 0;

        monitor.handleMessage(systemAllGetAck({ payload: {} }));

        assert.deepEqual(seen, []);
        assert.equal(endpoint.isOnline(), true);
        monitor.stop();
    });

    it('marks offline after heartbeat silence when the liveness probe All is malformed', async (t: TestContext) => {
        const { seen, monitor } = await runBoardSilence(t, async () => systemAllGetAck({ payload: {} }));

        assert.deepEqual(seen, [false]);
        monitor.stop();
    });

    it('marks offline after heartbeat silence when the liveness probe fails', async (t: TestContext) => {
        const { seen, monitor } = await runBoardSilence(t, unreachable);

        assert.deepEqual(seen, [false]);
        monitor.stop();
    });

    it('recovers online on any inbound after silence offline', async (t: TestContext) => {
        const { endpoint, seen, monitor } = await runBoardSilence(t, unreachable);

        assert.deepEqual(seen, [false]);

        monitor.handleMessage(encodeMessage({
            namespace: 'Appliance.Control.ToggleX',
            method: 'PUSH',
            key: KEY,
            from: `/appliance/${UUID}/publish`,
            uuid: UUID,
            payload: { togglex: [{ channel: 0, onoff: 1 }] }
        }));

        assert.deepEqual(seen, [false, true]);
        assert.equal(endpoint.isOnline(), true);
        monitor.stop();
    });

    it('records inbound GETACK replies for heartbeat liveness', async (t: TestContext) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        let clock = 0;
        const endpoint = new Endpoint({ id: `${UUID}:0`, traits: ['switch'], initialOnline: true });
        const seen: boolean[] = [];
        endpoint.on('availability', (online) => seen.push(online));

        const monitor = new DeviceAvailability({
            uuid: UUID,
            initialOnline: true,
            endpoints: [endpoint],
            heartbeatIntervalMs: INTERVAL_MS,
            now(): number {
                return clock;
            },
            request: stubRequest()
        });

        monitor.start();
        seen.length = 0;
        monitor.handleMessage(loadFixture('online-getack.json'));
        clock = INTERVAL_MS / 2;
        monitor.handleMessage(loadFixture('online-getack.json'));
        clock = INTERVAL_MS;

        t.mock.timers.tick(INTERVAL_MS);
        await settle(2);

        assert.deepEqual(seen, []);
        monitor.stop();
    });
});

describe('DeviceAvailability hub children', () => {
    const HUB_UUID = '9109182170548290880048b1a9522933';
    const SENSOR_ID = '120027D21C19';
    const VALVE_ID = '01008C11';

    function hubMonitor(
        hub: Endpoint,
        children: Endpoint[],
        options: {
            request?: () => Promise<MerossMessage>;
            heartbeatIntervalMs?: number;
            now?: () => number;
        } = {}
    ): DeviceAvailability {
        const monitor = new DeviceAvailability({
            uuid: HUB_UUID,
            initialOnline: hub.isOnline(),
            endpoints: [hub, ...children],
            request: options.request ?? stubRequest(HUB_UUID),
            heartbeatIntervalMs: options.heartbeatIntervalMs,
            now: options.now
        });
        monitor.start();
        return monitor;
    }

    function fromHub(namespace: string, payload: Record<string, unknown>, method = 'PUSH'): MerossMessage {
        return encodeMessage({
            namespace,
            method,
            key: KEY,
            from: `/appliance/${HUB_UUID}/publish`,
            uuid: HUB_UUID,
            payload
        });
    }

    it('keeps digest child offline when the hub board is online', () => {
        const hub = new Endpoint({ id: HUB_UUID, traits: ['dnd'], initialOnline: true });
        const sensor = new Endpoint({
            id: `${HUB_UUID}#${SENSOR_ID}`,
            traits: ['sensor'],
            initialOnline: false
        });
        const hubSeen: boolean[] = [];
        const sensorSeen: boolean[] = [];
        hub.on('availability', (online) => hubSeen.push(online));
        sensor.on('availability', (online) => sensorSeen.push(online));

        hubMonitor(hub, [sensor]).stop();

        assert.deepEqual(hubSeen, [true]);
        assert.deepEqual(sensorSeen, [false]);
    });

    it('applies Hub.Online to the matching child only', () => {
        const hub = new Endpoint({ id: HUB_UUID, traits: ['dnd'], initialOnline: true });
        const sensor = new Endpoint({
            id: `${HUB_UUID}#${SENSOR_ID}`,
            traits: ['sensor'],
            initialOnline: true
        });
        const valve = new Endpoint({
            id: `${HUB_UUID}#${VALVE_ID}`,
            traits: ['climate'],
            initialOnline: true
        });
        const sensorSeen: boolean[] = [];
        const valveSeen: boolean[] = [];
        sensor.on('availability', (online) => sensorSeen.push(online));
        valve.on('availability', (online) => valveSeen.push(online));

        const monitor = hubMonitor(hub, [sensor, valve]);
        sensorSeen.length = 0;
        valveSeen.length = 0;
        monitor.handleMessage(fromHub('Appliance.Hub.Online', {
            online: [{ id: SENSOR_ID, status: 2 }]
        }));

        assert.deepEqual(sensorSeen, [false]);
        assert.deepEqual(valveSeen, []);
        monitor.stop();
    });

    it('applies System.All digest.hub.subdevice status to children', () => {
        const hub = new Endpoint({ id: HUB_UUID, traits: ['dnd'], initialOnline: true });
        const sensor = new Endpoint({
            id: `${HUB_UUID}#${SENSOR_ID}`,
            traits: ['sensor'],
            initialOnline: true
        });
        const sensorSeen: boolean[] = [];
        sensor.on('availability', (online) => sensorSeen.push(online));

        const monitor = hubMonitor(hub, [sensor]);
        sensorSeen.length = 0;
        monitor.handleMessage(fromHub('Appliance.System.All', {
            all: {
                system: {
                    hardware: { type: 'msh300', uuid: HUB_UUID },
                    firmware: { innerIp: '10.0.0.1' },
                    online: { status: 1 }
                },
                digest: {
                    hub: { subdevice: [{ id: SENSOR_ID, status: 2 }] }
                }
            }
        }, 'GETACK'));

        assert.deepEqual(sensorSeen, [false]);
        monitor.stop();
    });

    it('forces children offline when the hub board goes offline from a failed heartbeat', async (t: TestContext) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        let clock = 0;
        const hub = new Endpoint({ id: HUB_UUID, traits: ['dnd'], initialOnline: true });
        const sensor = new Endpoint({
            id: `${HUB_UUID}#${SENSOR_ID}`,
            traits: ['sensor'],
            initialOnline: true
        });
        const hubSeen: boolean[] = [];
        const sensorSeen: boolean[] = [];
        hub.on('availability', (online) => hubSeen.push(online));
        sensor.on('availability', (online) => sensorSeen.push(online));

        const monitor = hubMonitor(hub, [sensor], {
            heartbeatIntervalMs: INTERVAL_MS,
            now(): number {
                return clock;
            },
            request: unreachable
        });
        monitor.handleMessage(fromHub('Appliance.Control.ToggleX', {
            togglex: [{ channel: 0, onoff: 1 }]
        }));
        hubSeen.length = 0;
        sensorSeen.length = 0;
        clock = INTERVAL_MS + 1;

        t.mock.timers.tick(INTERVAL_MS + 1);
        await settle(3);

        assert.deepEqual(hubSeen, [false]);
        assert.deepEqual(sensorSeen, [false]);
        monitor.stop();
    });

    it('does not mark children online just because the hub board returned', () => {
        const hub = new Endpoint({ id: HUB_UUID, traits: ['dnd'], initialOnline: false });
        const sensor = new Endpoint({
            id: `${HUB_UUID}#${SENSOR_ID}`,
            traits: ['sensor'],
            initialOnline: false
        });
        const sensorSeen: boolean[] = [];
        sensor.on('availability', (online) => sensorSeen.push(online));

        const monitor = hubMonitor(hub, [sensor]);
        sensorSeen.length = 0;
        monitor.handleMessage(fromHub('Appliance.Control.ToggleX', {
            togglex: [{ channel: 0, onoff: 1 }]
        }));

        assert.equal(hub.isOnline(), true);
        assert.deepEqual(sensorSeen, []);
        monitor.stop();
    });

    it('marks a child online from Hub.Online after the hub board is up', () => {
        const hub = new Endpoint({ id: HUB_UUID, traits: ['dnd'], initialOnline: false });
        const sensor = new Endpoint({
            id: `${HUB_UUID}#${SENSOR_ID}`,
            traits: ['sensor'],
            initialOnline: false
        });
        const sensorSeen: boolean[] = [];
        sensor.on('availability', (online) => sensorSeen.push(online));

        const monitor = hubMonitor(hub, [sensor]);
        sensorSeen.length = 0;
        monitor.handleMessage(fromHub('Appliance.Control.ToggleX', {
            togglex: [{ channel: 0, onoff: 1 }]
        }));
        monitor.handleMessage(fromHub('Appliance.Hub.Online', {
            online: [{ id: SENSOR_ID, status: 1 }]
        }));

        assert.deepEqual(sensorSeen, [true]);
        monitor.stop();
    });
});
