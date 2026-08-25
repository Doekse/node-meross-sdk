import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, type TestContext } from 'node:test';

import { Endpoint } from '../../src/endpoint';
import { DeviceAvailability } from '../../src/graph/availability';
import { Heartbeat, DEFAULT_HEARTBEAT_INTERVAL_MS } from '../../src/graph/heartbeat';
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

    it('uses the default Meross heartbeat interval', () => {
        assert.equal(DEFAULT_HEARTBEAT_INTERVAL_MS, 295_000);
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

    it('applies System.Online PUSH to all endpoints on the board', () => {
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

    it('applies System.All GETACK online.status to all endpoints', () => {
        const endpoint = new Endpoint({ id: `${UUID}:0`, traits: ['switch'], initialOnline: false });
        const seen: boolean[] = [];
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
            })
        });
        monitor.start();
        seen.length = 0;

        monitor.handleMessage(loadFixture('system-all-getack.json'));

        assert.deepEqual(seen, [true]);
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
        clock = INTERVAL_MS + 1;

        t.mock.timers.tick(INTERVAL_MS + 1);
        await Promise.resolve();
        await Promise.resolve();

        assert.deepEqual(seen, []);
        monitor.stop();
    });
});
