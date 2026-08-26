import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';

import { buildPollJobs } from '../../src/graph/poll-jobs';
import {
    CLOUDMQTT_PERIOD_MS,
    DevicePoller,
    DEFAULT_POLL_INTERVAL_MS,
    ENERGY_CLOUD_PERIOD_MS,
    ENERGY_PERIOD_MS,
    SENSOR_FAST_CLOUD_PERIOD_MS,
    SENSOR_FAST_PERIOD_MS,
    SYSTEM_ALL_PERIOD_MS,
    type PollJob
} from '../../src/graph/poller';
import { SYSTEM_ALL_NAMESPACE } from '../../src/graph/system-all';
import { CTL_RANGE_NAMESPACE } from '../../src/protocol/codecs/climate';
import { CONSUMPTIONX_NAMESPACE } from '../../src/protocol/codecs/consumptionx';
import { DND_MODE_NAMESPACE } from '../../src/protocol/codecs/dnd';
import { ELECTRICITY_NAMESPACE } from '../../src/protocol/codecs/electricity';
import { TOGGLEX_NAMESPACE } from '../../src/protocol/codecs/togglex';
import { encodeMessage, type MerossMessage } from '../../src/protocol';
import type { GetCommand } from '../../src/transport/router';

const UUID = '2206138957096651080248e1e99705a4';
const KEY = 'stub-key';
const INTERVAL_MS = 1_000;

function ack(namespace: string, payload: Record<string, unknown> = {}): MerossMessage {
    return encodeMessage({
        namespace,
        method: 'GETACK',
        key: KEY,
        from: `/appliance/${UUID}/publish`,
        uuid: UUID,
        payload
    });
}

function push(namespace: string): MerossMessage {
    return encodeMessage({
        namespace,
        method: 'PUSH',
        key: KEY,
        from: `/appliance/${UUID}/publish`,
        uuid: UUID,
        payload: {}
    });
}

function flushMicrotasks(): Promise<void> {
    return Promise.resolve().then(() => Promise.resolve());
}

interface Harness {
    poller: DevicePoller;
    requestGets: ReturnType<TestContext['mock']['fn']>;
    acks: MerossMessage[];
    getsHistory: GetCommand[][];
    advance: (ms: number) => Promise<void>;
}

function createHarness(
    t: TestContext,
    options: {
        online?: boolean;
        cloudPath?: boolean;
        maxCmdNum?: number;
        jobs?: readonly PollJob[];
        intervalMs?: number;
    } = {}
): Harness {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let clock = 0;
    const online = options.online ?? true;
    const cloudPath = options.cloudPath ?? false;
    const intervalMs = options.intervalMs ?? INTERVAL_MS;
    const acks: MerossMessage[] = [];
    const getsHistory: GetCommand[][] = [];

    const requestGets = t.mock.fn(async (gets: GetCommand[]) => {
        getsHistory.push(gets.map((get) => ({
            namespace: get.namespace,
            payload: get.payload ?? {}
        })));
        return gets.map((get) => ack(get.namespace, get.payload ?? {}));
    });

    const poller = new DevicePoller({
        uuid: UUID,
        isOnline: () => online,
        isCloudPath: () => cloudPath,
        maxCmdNum: () => options.maxCmdNum ?? 3,
        requestGets,
        onAck: (message) => {
            acks.push(message);
        },
        jobs: options.jobs,
        intervalMs,
        now: () => clock
    });

    return {
        poller,
        requestGets,
        acks,
        getsHistory,
        advance: async (ms: number) => {
            if (ms === 0) {
                t.mock.timers.tick(0);
                await flushMicrotasks();
                await flushMicrotasks();
                return;
            }
            let remaining = ms;
            while (remaining > 0) {
                const delta = Math.min(intervalMs, remaining);
                clock += delta;
                t.mock.timers.tick(delta);
                await flushMicrotasks();
                await flushMicrotasks();
                remaining -= delta;
            }
        }
    };
}

describe('DevicePoller constants', () => {
    it('exposes the shared poll periods', () => {
        assert.equal(DEFAULT_POLL_INTERVAL_MS, 30_000);
        assert.equal(SYSTEM_ALL_PERIOD_MS, 295_000);
        assert.equal(ENERGY_PERIOD_MS, 55_000);
        assert.equal(ENERGY_CLOUD_PERIOD_MS, 600_000);
        assert.equal(SENSOR_FAST_PERIOD_MS, 0);
        assert.equal(SENSOR_FAST_CLOUD_PERIOD_MS, 180_000);
        assert.equal(CLOUDMQTT_PERIOD_MS, 1_195_000);
    });
});

describe('DevicePoller', () => {
    it('skips default jobs when MQTT PUSH is active after the cold start', async (t) => {
        const harness = createHarness(t, {
            jobs: [{
                namespace: 'Appliance.Control.ToggleX',
                strategy: 'default',
                periodMs: 0,
                periodCloudMs: 0
            }]
        });

        harness.poller.start();
        await harness.advance(0);
        assert.equal(harness.requestGets.mock.callCount(), 1);
        assert.deepEqual(
            harness.getsHistory[0].map((get) => get.namespace),
            ['Appliance.Control.ToggleX']
        );

        harness.poller.recordPush(push('Appliance.Control.ToggleX'));
        await harness.advance(INTERVAL_MS);
        assert.equal(harness.requestGets.mock.callCount(), 1);

        harness.poller.stop();
    });

    it('resumes default jobs after the heartbeat window without another PUSH', async (t) => {
        const harness = createHarness(t, {
            jobs: [{
                namespace: 'Appliance.Control.ToggleX',
                strategy: 'default',
                periodMs: 0,
                periodCloudMs: 0
            }]
        });

        harness.poller.start();
        await harness.advance(0);
        harness.poller.recordPush(push('Appliance.Control.ToggleX'));
        await harness.advance(INTERVAL_MS);
        assert.equal(harness.requestGets.mock.callCount(), 1);

        await harness.advance(SYSTEM_ALL_PERIOD_MS);
        assert.ok(harness.requestGets.mock.callCount() > 1);
        assert.equal(
            harness.getsHistory.at(-1)?.[0]?.namespace,
            'Appliance.Control.ToggleX'
        );

        harness.poller.stop();
    });

    it('polls electricity every cycle even when MQTT is active', async (t) => {
        const harness = createHarness(t, {
            jobs: [{
                namespace: 'Appliance.Control.Electricity',
                strategy: 'smart',
                periodMs: SENSOR_FAST_PERIOD_MS,
                periodCloudMs: SENSOR_FAST_CLOUD_PERIOD_MS
            }]
        });

        harness.poller.start();
        harness.poller.recordPush(push('Appliance.Control.ToggleX'));
        await harness.advance(0);
        await harness.advance(INTERVAL_MS);
        await harness.advance(INTERVAL_MS);

        assert.equal(harness.requestGets.mock.callCount(), 3);
        for (const gets of harness.getsHistory) {
            assert.deepEqual(gets.map((get) => get.namespace), ['Appliance.Control.Electricity']);
        }

        harness.poller.stop();
    });

    it('polls consumption on the 55s LAN period', async (t) => {
        const harness = createHarness(t, {
            jobs: [{
                namespace: 'Appliance.Control.ConsumptionX',
                strategy: 'smart',
                periodMs: ENERGY_PERIOD_MS,
                periodCloudMs: ENERGY_CLOUD_PERIOD_MS
            }]
        });

        harness.poller.start();
        await harness.advance(0);
        assert.equal(harness.requestGets.mock.callCount(), 1);

        await harness.advance(INTERVAL_MS);
        assert.equal(harness.requestGets.mock.callCount(), 1);

        await harness.advance(ENERGY_PERIOD_MS);
        assert.equal(harness.requestGets.mock.callCount(), 2);
        assert.equal(
            harness.getsHistory[1][0]?.namespace,
            'Appliance.Control.ConsumptionX'
        );

        harness.poller.stop();
    });

    it('advances nextMs even when a batch fails so the job is not retried next tick', async (t) => {
        const harness = createHarness(t, {
            jobs: [{
                namespace: 'Appliance.Control.ConsumptionX',
                strategy: 'smart',
                periodMs: ENERGY_PERIOD_MS,
                periodCloudMs: ENERGY_CLOUD_PERIOD_MS
            }]
        });

        harness.requestGets.mock.mockImplementation(async (gets: GetCommand[]) => {
            harness.getsHistory.push(gets.map((get) => ({
                namespace: get.namespace,
                payload: get.payload ?? {}
            })));
            throw new Error('transport dropped');
        });

        harness.poller.start();
        await harness.advance(0);
        assert.equal(harness.requestGets.mock.callCount(), 1);
        assert.equal(harness.acks.length, 0);

        await harness.advance(INTERVAL_MS);
        assert.equal(harness.requestGets.mock.callCount(), 1);

        harness.requestGets.mock.mockImplementation(async (gets: GetCommand[]) => {
            harness.getsHistory.push(gets.map((get) => ({
                namespace: get.namespace,
                payload: get.payload ?? {}
            })));
            return gets.map((get) => ack(get.namespace, get.payload ?? {}));
        });

        await harness.advance(ENERGY_PERIOD_MS);
        assert.equal(harness.requestGets.mock.callCount(), 2);
        assert.equal(
            harness.getsHistory[1][0]?.namespace,
            'Appliance.Control.ConsumptionX'
        );

        harness.poller.stop();
    });

    it('retries a once job after a failed batch instead of retiring it', async (t) => {
        const harness = createHarness(t, {
            jobs: [{
                namespace: CTL_RANGE_NAMESPACE,
                strategy: 'once',
                periodMs: 0,
                periodCloudMs: 0
            }]
        });

        harness.requestGets.mock.mockImplementation(async () => {
            throw new Error('transport dropped');
        });

        harness.poller.start();
        await harness.advance(0);
        assert.equal(harness.requestGets.mock.callCount(), 1);

        harness.requestGets.mock.mockImplementation(
            async (gets: GetCommand[]) => gets.map((get) => ack(get.namespace, get.payload ?? {}))
        );

        await harness.advance(INTERVAL_MS);
        assert.equal(harness.requestGets.mock.callCount(), 2);
        assert.equal(harness.acks.length, 1);

        await harness.advance(INTERVAL_MS);
        assert.equal(harness.requestGets.mock.callCount(), 2);

        harness.poller.stop();
    });

    it('caps smart/once to one cloud MQTT job per cycle within the cloud period', async (t) => {
        const harness = createHarness(t, {
            cloudPath: true,
            jobs: [
                {
                    namespace: 'Appliance.Control.Electricity',
                    strategy: 'smart',
                    periodMs: SENSOR_FAST_PERIOD_MS,
                    periodCloudMs: SENSOR_FAST_CLOUD_PERIOD_MS
                },
                {
                    namespace: 'Appliance.Control.ConsumptionX',
                    strategy: 'smart',
                    periodMs: ENERGY_PERIOD_MS,
                    periodCloudMs: ENERGY_CLOUD_PERIOD_MS
                }
            ]
        });

        harness.poller.start();
        await harness.advance(0);
        assert.equal(harness.requestGets.mock.callCount(), 1);
        assert.deepEqual(
            harness.getsHistory[0].map((get) => get.namespace),
            ['Appliance.Control.Electricity']
        );

        await harness.advance(INTERVAL_MS);
        assert.equal(harness.requestGets.mock.callCount(), 2);
        assert.deepEqual(
            harness.getsHistory[1].map((get) => get.namespace),
            ['Appliance.Control.Electricity']
        );

        harness.poller.stop();
    });

    it('honors the cloud floor for default and all the same way as smart', async (t) => {
        const harness = createHarness(t, {
            cloudPath: true,
            jobs: [
                {
                    namespace: SYSTEM_ALL_NAMESPACE,
                    strategy: 'all',
                    periodMs: SYSTEM_ALL_PERIOD_MS,
                    periodCloudMs: CLOUDMQTT_PERIOD_MS
                },
                {
                    namespace: TOGGLEX_NAMESPACE,
                    strategy: 'default',
                    periodMs: 0,
                    periodCloudMs: CLOUDMQTT_PERIOD_MS
                },
                {
                    namespace: ELECTRICITY_NAMESPACE,
                    strategy: 'smart',
                    periodMs: SENSOR_FAST_PERIOD_MS,
                    periodCloudMs: SENSOR_FAST_CLOUD_PERIOD_MS
                }
            ]
        });

        harness.poller.start();
        await harness.advance(0);
        assert.equal(harness.requestGets.mock.callCount(), 1);
        assert.deepEqual(
            harness.getsHistory[0].map((get) => get.namespace),
            [SYSTEM_ALL_NAMESPACE]
        );

        await harness.advance(INTERVAL_MS);
        assert.equal(harness.requestGets.mock.callCount(), 2);
        assert.deepEqual(
            harness.getsHistory[1].map((get) => get.namespace),
            [TOGGLEX_NAMESPACE]
        );

        await harness.advance(INTERVAL_MS);
        assert.equal(harness.requestGets.mock.callCount(), 3);
        assert.deepEqual(
            harness.getsHistory[2].map((get) => get.namespace),
            [TOGGLEX_NAMESPACE]
        );

        harness.poller.stop();
    });

    it('keeps a cloud-only energy plug under 200 publishes per hour', async (t) => {
        const jobs = buildPollJobs(
            {
                [SYSTEM_ALL_NAMESPACE]: {},
                [TOGGLEX_NAMESPACE]: {},
                [ELECTRICITY_NAMESPACE]: {},
                [CONSUMPTIONX_NAMESPACE]: {},
                [DND_MODE_NAMESPACE]: {}
            },
            [{ channel: 0, traits: ['switch', 'energy', 'dnd'] }]
        );
        // Firmware without Control.Multiple sends one publish per GET, so this
        // is the path that overran the budget; a packing device is strictly cheaper.
        const harness = createHarness(t, {
            cloudPath: true,
            intervalMs: DEFAULT_POLL_INTERVAL_MS,
            maxCmdNum: 1,
            jobs
        });

        harness.poller.start();
        await harness.advance(0);
        await harness.advance(3_600_000);
        harness.poller.stop();

        const publishes = harness.getsHistory.reduce((total, gets) => total + gets.length, 0);
        assert.ok(publishes < 200, `expected under 200 publishes/hour, got ${publishes}`);
    });

    it('lazy-fills leftover Multiple slots with oldest smart jobs first', async (t) => {
        const harness = createHarness(t, {
            maxCmdNum: 3,
            jobs: [
                {
                    namespace: 'Appliance.Control.ToggleX',
                    strategy: 'default',
                    periodMs: 0,
                    periodCloudMs: 0
                },
                {
                    namespace: 'Appliance.System.DNDMode',
                    strategy: 'smart',
                    periodMs: 300_000,
                    periodCloudMs: 600_000
                },
                {
                    namespace: 'Appliance.Config.OverTemp',
                    strategy: 'smart',
                    periodMs: 300_000,
                    periodCloudMs: 600_000
                }
            ]
        });

        harness.poller.start();
        await harness.advance(0);
        // Cold start: default + both smart due, so the Multiple pack is already full.
        assert.equal(harness.getsHistory[0]?.length, 3);

        await harness.advance(INTERVAL_MS);
        // Default must poll; smart jobs are not due yet and fill the leftover slots.
        assert.deepEqual(
            harness.getsHistory[1].map((get) => get.namespace),
            [
                'Appliance.Control.ToggleX',
                'Appliance.System.DNDMode',
                'Appliance.Config.OverTemp'
            ]
        );

        harness.poller.stop();
    });

    it('probes System.All only while offline and backs off toward 295s', async (t) => {
        const harness = createHarness(t, {
            online: false,
            jobs: [{
                namespace: 'Appliance.Control.ToggleX',
                strategy: 'default',
                periodMs: 0,
                periodCloudMs: 0
            }]
        });

        harness.requestGets.mock.mockImplementation(async (gets: GetCommand[]) => {
            harness.getsHistory.push(gets.map((get) => ({
                namespace: get.namespace,
                payload: get.payload ?? {}
            })));
            throw new Error('unreachable');
        });

        harness.poller.start();
        await harness.advance(0);
        assert.equal(harness.requestGets.mock.callCount(), 1);
        assert.deepEqual(
            harness.getsHistory[0].map((get) => get.namespace),
            [SYSTEM_ALL_NAMESPACE]
        );

        // First failure doubles the offline delay to 2 * interval.
        await harness.advance(INTERVAL_MS);
        assert.equal(harness.requestGets.mock.callCount(), 1);
        await harness.advance(INTERVAL_MS);
        assert.equal(harness.requestGets.mock.callCount(), 2);
        assert.deepEqual(
            harness.getsHistory[1].map((get) => get.namespace),
            [SYSTEM_ALL_NAMESPACE]
        );

        harness.poller.stop();
    });

    it('interleaves System.All with digest default jobs on HTTP', async (t) => {
        const harness = createHarness(t, {
            jobs: [
                {
                    namespace: SYSTEM_ALL_NAMESPACE,
                    strategy: 'all',
                    periodMs: SYSTEM_ALL_PERIOD_MS,
                    periodCloudMs: 0
                },
                {
                    namespace: 'Appliance.Control.ToggleX',
                    strategy: 'default',
                    periodMs: 0,
                    periodCloudMs: 0
                }
            ]
        });

        harness.poller.start();
        await harness.advance(0);
        assert.deepEqual(
            harness.getsHistory[0].map((get) => get.namespace),
            [SYSTEM_ALL_NAMESPACE]
        );

        await harness.advance(INTERVAL_MS);
        assert.deepEqual(
            harness.getsHistory[1].map((get) => get.namespace),
            ['Appliance.Control.ToggleX']
        );

        await harness.advance(SYSTEM_ALL_PERIOD_MS);
        assert.ok(
            harness.getsHistory.some((gets, index) =>
                index > 1 && gets.length === 1 && gets[0]?.namespace === SYSTEM_ALL_NAMESPACE
            )
        );

        harness.poller.stop();
    });

    it('skips System.All after onlining when MQTT is active', async (t) => {
        const harness = createHarness(t, {
            jobs: [
                {
                    namespace: SYSTEM_ALL_NAMESPACE,
                    strategy: 'all',
                    periodMs: SYSTEM_ALL_PERIOD_MS,
                    periodCloudMs: 0
                },
                {
                    namespace: 'Appliance.Control.ToggleX',
                    strategy: 'default',
                    periodMs: 0,
                    periodCloudMs: 0
                }
            ]
        });

        harness.poller.recordPush(push('Appliance.Control.ToggleX'));
        harness.poller.start();
        await harness.advance(0);
        assert.deepEqual(
            harness.getsHistory[0].map((get) => get.namespace).sort(),
            [SYSTEM_ALL_NAMESPACE, 'Appliance.Control.ToggleX'].sort()
        );

        await harness.advance(INTERVAL_MS);
        assert.equal(harness.requestGets.mock.callCount(), 1);

        harness.poller.stop();
    });

    it('deduplicates jobs by namespace', async (t) => {
        const harness = createHarness(t, {
            jobs: [
                {
                    namespace: 'Appliance.Control.Electricity',
                    strategy: 'smart',
                    periodMs: 0,
                    periodCloudMs: 180_000
                },
                {
                    namespace: 'Appliance.Control.Electricity',
                    strategy: 'smart',
                    periodMs: 0,
                    periodCloudMs: 180_000,
                    payload: { electricity: [{ channel: 1 }] }
                }
            ]
        });

        harness.poller.start();
        await harness.advance(0);
        assert.deepEqual(harness.getsHistory[0], [
            { namespace: 'Appliance.Control.Electricity', payload: {} }
        ]);
        harness.poller.stop();
    });

    it('dispatches GETACKs through onAck', async (t) => {
        const harness = createHarness(t, {
            jobs: [{
                namespace: 'Appliance.Control.ToggleX',
                strategy: 'default',
                periodMs: 0,
                periodCloudMs: 0
            }]
        });

        harness.poller.start();
        await harness.advance(0);
        assert.equal(harness.acks.length, 1);
        assert.equal(harness.acks[0]?.header.namespace, 'Appliance.Control.ToggleX');
        assert.equal(harness.acks[0]?.header.method, 'GETACK');

        harness.poller.stop();
    });
});
