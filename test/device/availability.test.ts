import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, type TestContext } from 'node:test';

import { Endpoint } from '../../src/endpoint';
import { DeviceAvailability } from '../../src/device/availability';
import { Heartbeat } from '../../src/device/heartbeat';
import { decodeMessage, encodeMessage, type MerossMessage } from '../../src/protocol';

const fixturesDir = join(process.cwd(), 'test/fixtures');
const UUID = '2206138957096651080248e1e99705a4';
const KEY = 'stub-key';
const INTERVAL_MS = 10_000;

function loadFixture(name: string): MerossMessage {
    return decodeMessage(JSON.parse(readFileSync(join(fixturesDir, name), 'utf8')) as unknown);
}

describe('Heartbeat silence detection', () => {
    it('polls System.Online when silence exceeds the interval', async (t: TestContext) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        let clock = 0;
        const pollOnline = t.mock.fn(async () => {});

        const heartbeat = new Heartbeat({
            intervalMs: INTERVAL_MS,
            isOnline: () => true,
            pollOnline,
            onSilenceOffline: () => {},
            now: () => clock
        });

        heartbeat.start();
        heartbeat.recordResponse();
        clock = INTERVAL_MS + 1;
        t.mock.timers.tick(INTERVAL_MS + 1);
        await Promise.resolve();
        await Promise.resolve();

        assert.equal(pollOnline.mock.callCount(), 1);
        heartbeat.stop();
    });

    it('does not mark offline before any response was recorded', async (t: TestContext) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        let offline = false;

        const heartbeat = new Heartbeat({
            intervalMs: INTERVAL_MS,
            isOnline: () => true,
            pollOnline: async () => {},
            onSilenceOffline: () => {
                offline = true;
            }
        });

        heartbeat.start();
        t.mock.timers.tick(INTERVAL_MS * 2);
        await Promise.resolve();
        await Promise.resolve();

        assert.equal(offline, false);
        heartbeat.stop();
    });

    it('marks offline after silence when the liveness probe fails', async (t: TestContext) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        let clock = 0;
        let offline = false;
        const pollOnline = t.mock.fn(async () => {
            throw new Error('unreachable');
        });

        const heartbeat = new Heartbeat({
            intervalMs: INTERVAL_MS,
            isOnline: () => !offline,
            pollOnline,
            onSilenceOffline: () => {
                offline = true;
            },
            now: () => clock
        });

        heartbeat.start();
        heartbeat.recordResponse();
        clock = INTERVAL_MS + 1;
        t.mock.timers.tick(INTERVAL_MS + 1);
        await Promise.resolve();
        await Promise.resolve();

        assert.equal(offline, true);
        assert.equal(pollOnline.mock.callCount(), 1);
        heartbeat.stop();
    });

    it('marks offline after silence even when the liveness probe succeeds', async (t: TestContext) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        let clock = 0;
        let offline = false;
        const pollOnline = t.mock.fn(async () => {});

        const heartbeat = new Heartbeat({
            intervalMs: INTERVAL_MS,
            isOnline: () => !offline,
            pollOnline,
            onSilenceOffline: () => {
                offline = true;
            },
            now: () => clock
        });

        heartbeat.start();
        heartbeat.recordResponse();
        clock = INTERVAL_MS + 1;
        t.mock.timers.tick(INTERVAL_MS + 1);
        await Promise.resolve();
        await Promise.resolve();

        assert.equal(offline, true);
        assert.equal(pollOnline.mock.callCount(), 1);
        heartbeat.stop();
    });

    it('reschedules the next check at the remaining silence window, not a full interval', async (t: TestContext) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        let clock = 0;
        const pollOnline = t.mock.fn(async () => {});

        const heartbeat = new Heartbeat({
            intervalMs: INTERVAL_MS,
            isOnline: () => true,
            pollOnline,
            onSilenceOffline: () => {},
            now: () => clock
        });

        heartbeat.start();
        heartbeat.recordResponse();

        clock = 6_000;
        heartbeat.recordResponse();

        clock = 10_000;
        t.mock.timers.tick(10_000);
        await Promise.resolve();
        await Promise.resolve();

        assert.equal(pollOnline.mock.callCount(), 0);

        clock = 16_000;
        t.mock.timers.tick(6_000);
        await Promise.resolve();
        await Promise.resolve();

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
            isOnline: () => true,
            pollOnline,
            onSilenceOffline: () => {},
            now: () => clock
        });

        heartbeat.start();
        heartbeat.recordResponse();

        clock = INTERVAL_MS;
        t.mock.timers.tick(INTERVAL_MS);
        await Promise.resolve();
        await Promise.resolve();

        assert.equal(pollOnline.mock.callCount(), 1);
        const firstResolve = resolvePoll;

        heartbeat.stop();
        heartbeat.start();

        firstResolve();
        await Promise.resolve();
        await Promise.resolve();

        assert.equal(pollOnline.mock.callCount(), 1);

        clock = INTERVAL_MS * 2;
        t.mock.timers.tick(INTERVAL_MS);
        await Promise.resolve();
        await Promise.resolve();

        assert.equal(pollOnline.mock.callCount(), 2);
        heartbeat.stop();
    });
});

describe('DeviceAvailability', () => {
    it('syncs initial availability on start', () => {
        const endpoint = new Endpoint({ id: `${UUID}:0`, traits: ['switch'], initialOnline: true });
        const seen: boolean[] = [];
        endpoint.on('availability', (online) => seen.push(online));

        const monitor = new DeviceAvailability({
            uuid: UUID,
            initialOnline: true,
            endpoints: [endpoint],
            request: async () => encodeMessage({
                namespace: 'Appliance.System.Online',
                method: 'GETACK',
                key: KEY,
                from: `/appliance/${UUID}/publish`,
                uuid: UUID,
                payload: { online: { status: 1 } }
            })
        });

        monitor.start();
        assert.deepEqual(seen, [true]);
        monitor.stop();
    });

    it('applies System.Online PUSH to all endpoints on the device', () => {
        const endpoint = new Endpoint({ id: `${UUID}:0`, traits: ['switch'], initialOnline: true });
        const seen: boolean[] = [];
        endpoint.on('availability', (online) => seen.push(online));

        const monitor = new DeviceAvailability({
            uuid: UUID,
            initialOnline: true,
            endpoints: [endpoint],
            request: async () => encodeMessage({
                namespace: 'Appliance.System.Online',
                method: 'GETACK',
                key: KEY,
                from: `/appliance/${UUID}/publish`,
                uuid: UUID,
                payload: {}
            })
        });
        monitor.start();
        seen.length = 0;

        monitor.handleMessage(loadFixture('online-push.json'));

        assert.deepEqual(seen, [false]);
        monitor.stop();
    });

    it('applies GETACK that omits uuid and echoes the app from', () => {
        const endpoint = new Endpoint({ id: `${UUID}:0`, traits: ['switch'], initialOnline: true });
        const seen: boolean[] = [];
        endpoint.on('availability', (online) => seen.push(online));

        const monitor = new DeviceAvailability({
            uuid: UUID,
            initialOnline: true,
            endpoints: [endpoint],
            request: async () => encodeMessage({
                namespace: 'Appliance.System.Online',
                method: 'GETACK',
                key: KEY,
                from: `/appliance/${UUID}/publish`,
                uuid: UUID,
                payload: {}
            })
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

        assert.deepEqual(seen, [false]);
        monitor.stop();
    });

    it('applies System.All GETACK online.status to all endpoints', () => {
        const endpoint = new Endpoint({ id: `${UUID}:0`, traits: ['switch'], initialOnline: false });
        const seen: boolean[] = [];
        const ips: Array<string | undefined> = [];
        endpoint.on('availability', (online) => seen.push(online));

        const monitor = new DeviceAvailability({
            uuid: UUID,
            initialOnline: false,
            endpoints: [endpoint],
            request: async () => encodeMessage({
                namespace: 'Appliance.System.All',
                method: 'GETACK',
                key: KEY,
                from: `/appliance/${UUID}/publish`,
                uuid: UUID,
                payload: {}
            }),
            onInnerIp: (innerIp) => ips.push(innerIp)
        });
        monitor.start();
        seen.length = 0;

        monitor.handleMessage(loadFixture('system-all-getack.json'));

        assert.deepEqual(seen, [true]);
        assert.deepEqual(ips, ['192.168.201.190']);
        monitor.stop();
    });

    it('marks offline when Runtime reports abnormal iotStatus', () => {
        const endpoint = new Endpoint({ id: `${UUID}:0`, traits: ['switch'], initialOnline: true });
        const seen: boolean[] = [];
        endpoint.on('availability', (online) => seen.push(online));

        const monitor = new DeviceAvailability({
            uuid: UUID,
            initialOnline: true,
            endpoints: [endpoint],
            request: async () => encodeMessage({
                namespace: 'Appliance.System.Online',
                method: 'GETACK',
                key: KEY,
                from: `/appliance/${UUID}/publish`,
                uuid: UUID,
                payload: {}
            })
        });
        monitor.start();
        seen.length = 0;

        monitor.handleMessage(loadFixture('runtime-getack-abnormal.json'));

        assert.deepEqual(seen, [false]);
        monitor.stop();
    });

    it('marks offline after heartbeat silence', async (t: TestContext) => {
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
            now: () => clock,
            request: async () => encodeMessage({
                namespace: 'Appliance.System.All',
                method: 'GETACK',
                key: KEY,
                from: `/appliance/${UUID}/publish`,
                uuid: UUID,
                payload: {
                    all: {
                        system: {
                            hardware: { type: 'mss110', uuid: UUID },
                            firmware: {},
                            online: { status: 2 }
                        },
                        digest: {}
                    }
                }
            })
        });

        monitor.start();
        monitor.handleMessage(loadFixture('online-getack.json'));
        seen.length = 0;
        clock = INTERVAL_MS + 1;

        t.mock.timers.tick(INTERVAL_MS + 1);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        assert.deepEqual(seen, [false]);
        monitor.stop();
    });

    it('marks offline after heartbeat silence when the liveness probe fails', async (t: TestContext) => {
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
            now: () => clock,
            request: async () => {
                throw new Error('unreachable');
            }
        });

        monitor.start();
        monitor.handleMessage(loadFixture('online-getack.json'));
        seen.length = 0;
        clock = INTERVAL_MS + 1;

        t.mock.timers.tick(INTERVAL_MS + 1);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        assert.deepEqual(seen, [false]);
        monitor.stop();
    });

    it('recovers online when the silence probe System.All reports online', async (t: TestContext) => {
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
            now: () => clock,
            request: async () => loadFixture('system-all-getack.json')
        });

        monitor.start();
        monitor.handleMessage(loadFixture('online-getack.json'));
        seen.length = 0;
        clock = INTERVAL_MS + 1;

        t.mock.timers.tick(INTERVAL_MS + 1);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

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
            now: () => clock,
            request: async () => encodeMessage({
                namespace: 'Appliance.System.Online',
                method: 'GETACK',
                key: KEY,
                from: `/appliance/${UUID}/publish`,
                uuid: UUID,
                payload: { online: { status: 1 } }
            })
        });

        monitor.start();
        seen.length = 0;
        monitor.handleMessage(loadFixture('online-getack.json'));
        clock = INTERVAL_MS / 2;
        monitor.handleMessage(loadFixture('online-getack.json'));
        clock = INTERVAL_MS;

        t.mock.timers.tick(INTERVAL_MS);
        await Promise.resolve();
        await Promise.resolve();

        assert.deepEqual(seen, []);
        monitor.stop();
    });
});

describe('DeviceAvailability hub children', () => {
    const HUB_UUID = '9109182170548290880048b1a9522933';
    const SENSOR_ID = '120027D21C19';
    const VALVE_ID = '01008C11';

    function hubMonitor(hub: Endpoint, ...children: Endpoint[]): DeviceAvailability {
        const monitor = new DeviceAvailability({
            uuid: HUB_UUID,
            initialOnline: hub.isOnline(),
            endpoints: [hub, ...children],
            request: async () => encodeMessage({
                namespace: 'Appliance.System.All',
                method: 'GETACK',
                key: KEY,
                from: `/appliance/${HUB_UUID}/publish`,
                uuid: HUB_UUID,
                payload: {}
            })
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

        hubMonitor(hub, sensor).stop();

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

        const monitor = hubMonitor(hub, sensor, valve);
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

        const monitor = hubMonitor(hub, sensor);
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

    it('forces children offline when the hub board goes offline', () => {
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

        const monitor = hubMonitor(hub, sensor);
        hubSeen.length = 0;
        sensorSeen.length = 0;
        monitor.handleMessage(fromHub('Appliance.System.Online', { online: { status: 2 } }));

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

        const monitor = hubMonitor(hub, sensor);
        sensorSeen.length = 0;
        monitor.handleMessage(fromHub('Appliance.System.Online', { online: { status: 1 } }));

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

        const monitor = hubMonitor(hub, sensor);
        sensorSeen.length = 0;
        monitor.handleMessage(fromHub('Appliance.System.Online', { online: { status: 1 } }));
        monitor.handleMessage(fromHub('Appliance.Hub.Online', {
            online: [{ id: SENSOR_ID, status: 1 }]
        }));

        assert.deepEqual(sensorSeen, [true]);
        monitor.stop();
    });
});
