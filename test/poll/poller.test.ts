import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';

import {
    buildPollJobs,
    CLOUDMQTT_PERIOD_MS,
    ENERGY_CLOUD_PERIOD_MS,
    ENERGY_PERIOD_MS,
    SENSOR_FAST_CLOUD_PERIOD_MS,
    SENSOR_FAST_PERIOD_MS,
    SYSTEM_ALL_PERIOD_MS
} from '../../src/poll/jobs';
import {
    DevicePoller,
    DEFAULT_POLL_INTERVAL_MS,
    type PollJob
} from '../../src/poll/poller';
import { SYSTEM_ALL_NAMESPACE } from '../../src/protocol/codecs/system-all';
import { Endpoint } from '../../src/endpoint';
import { CTL_RANGE_NAMESPACE } from '../../src/protocol/codecs/climate';
import { CONSUMPTIONX_NAMESPACE } from '../../src/protocol/codecs/consumptionx';
import { DND_MODE_NAMESPACE } from '../../src/protocol/codecs/dnd';
import { ELECTRICITY_NAMESPACE } from '../../src/protocol/codecs/electricity';
import { CONFIG_STANDBY_KILLER_NAMESPACE } from '../../src/protocol/codecs/standbykiller';
import { TOGGLEX_NAMESPACE } from '../../src/protocol/codecs/togglex';
import { encodeMessage, type MerossMessage } from '../../src/protocol';
import { MP3_NAMESPACE } from '../../src/protocol/codecs/mp3';
import { EnergyTrait } from '../../src/traits/energy';
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

function flushMicrotasks(): Promise<void> {
    return Promise.resolve().then(() => Promise.resolve());
}

interface Harness {
    poller: DevicePoller;
    requestGets: ReturnType<TestContext['mock']['fn']>;
    acks: MerossMessage[];
    getsHistory: GetCommand[][];
    setOnline: (online: boolean) => void;
    advance: (ms: number) => Promise<void>;
}

function createHarness(
    t: TestContext,
    options: {
        online?: boolean;
        cloudPath?: boolean;
        httpDown?: boolean;
        maxCmdNum?: number;
        jobs?: readonly PollJob[];
        intervalMs?: number;
        startDelayMs?: number;
        /** Non-zero proves scheduling does not depend on the clock origin. */
        startClock?: number;
        /** Tests that omit this still see applied GETACKs on {@link Harness.acks}. */
        onAck?: (message: MerossMessage) => void;
    } = {}
): Harness {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let clock = options.startClock ?? 0;
    let online = options.online ?? true;
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

    const onAck = options.onAck ?? ((message: MerossMessage) => {
        acks.push(message);
    });

    const poller = new DevicePoller({
        isOnline: () => online,
        isCloudPath: () => cloudPath,
        httpDown: () => options.httpDown ?? false,
        maxCmdNum: () => options.maxCmdNum ?? 3,
        requestGets,
        onAck,
        jobs: options.jobs,
        intervalMs,
        startDelayMs: options.startDelayMs,
        now: () => clock
    });

    return {
        poller,
        requestGets,
        acks,
        getsHistory,
        setOnline: (value: boolean) => {
            online = value;
        },
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

        harness.poller.recordPush();
        await harness.advance(INTERVAL_MS);
        assert.equal(harness.requestGets.mock.callCount(), 1);

        harness.poller.stop();
    });

    it('keeps skipping default jobs after the heartbeat window while MQTT stays active', async (t) => {
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
        assert.deepEqual(
            harness.getsHistory[0].map((get) => get.namespace),
            ['Appliance.Control.ToggleX']
        );

        harness.poller.recordPush();
        await harness.advance(INTERVAL_MS);
        assert.equal(harness.requestGets.mock.callCount(), 1);

        await harness.advance(SYSTEM_ALL_PERIOD_MS);
        assert.equal(harness.requestGets.mock.callCount(), 1);

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
        harness.poller.recordPush();
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

        harness.requestGets.mock.mockImplementation(async (gets: GetCommand[]) => {
            harness.getsHistory.push(gets.map((get) => ({
                namespace: get.namespace,
                payload: get.payload ?? {}
            })));
            return gets.map((get) => ack(get.namespace, get.payload ?? {}));
        });

        await harness.advance(INTERVAL_MS);
        assert.deepEqual(
            harness.getsHistory[1]?.map((get) => get.namespace),
            [SYSTEM_ALL_NAMESPACE]
        );

        await harness.advance(ENERGY_PERIOD_MS);
        assert.deepEqual(
            harness.getsHistory[2]?.map((get) => get.namespace),
            [CONSUMPTIONX_NAMESPACE]
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
        assert.equal(harness.requestGets.mock.callCount(), 3);
        assert.deepEqual(
            harness.acks.map((message) => message.header.namespace),
            [SYSTEM_ALL_NAMESPACE, CTL_RANGE_NAMESPACE]
        );

        await harness.advance(INTERVAL_MS);
        assert.equal(harness.requestGets.mock.callCount(), 3);

        harness.poller.stop();
    });

    it('spends one cloud publish per cycle and fills the Multiple batch', async (t) => {
        // Both namespaces fit one Control.Multiple under maxCmdNum 5 (4000-byte
        // budget): header 300 + Electricity 430 + ConsumptionX 1910.
        const harness = createHarness(t, {
            cloudPath: true,
            maxCmdNum: 5,
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
            harness.getsHistory[0].map((get) => get.namespace).sort(),
            ['Appliance.Control.ConsumptionX', 'Appliance.Control.Electricity']
        );

        await harness.advance(INTERVAL_MS);
        assert.equal(harness.requestGets.mock.callCount(), 2);

        harness.poller.stop();
    });

    it('restores the advertised response budget after a complete packed reply', async (t) => {
        const harness = createHarness(t, {
            maxCmdNum: 5,
            jobs: ['One', 'Two', 'Three'].map((suffix) => ({
                namespace: `Appliance.Test.${suffix}`,
                strategy: 'default' as const,
                periodMs: 0,
                periodCloudMs: 0,
                responseSize: 800
            }))
        });

        harness.poller.shrinkResponseBudget();
        harness.poller.start();
        await harness.advance(0);
        assert.deepEqual(harness.getsHistory.map((gets) => gets.length), [2, 1]);
        await flushMicrotasks();

        await harness.advance(INTERVAL_MS);
        assert.equal(harness.getsHistory[2]?.length, 3);

        harness.poller.stop();
    });

    it('does not undo a response-budget shrink reported by the current request', async (t) => {
        const harness = createHarness(t, {
            maxCmdNum: 5,
            jobs: ['One', 'Two', 'Three'].map((suffix) => ({
                namespace: `Appliance.Test.${suffix}`,
                strategy: 'default' as const,
                periodMs: 0,
                periodCloudMs: 0,
                responseSize: 800
            }))
        });
        let reportTruncation = true;
        harness.requestGets.mock.mockImplementation(async (gets: GetCommand[]) => {
            harness.getsHistory.push(gets.map((get) => ({
                namespace: get.namespace,
                payload: get.payload ?? {}
            })));
            if (reportTruncation) {
                reportTruncation = false;
                harness.poller.shrinkResponseBudget();
            }
            return gets.map((get) => ack(get.namespace, get.payload ?? {}));
        });

        harness.poller.start();
        await harness.advance(0);
        assert.equal(harness.getsHistory[0]?.length, 3);

        await harness.advance(INTERVAL_MS);
        assert.deepEqual(harness.getsHistory.slice(1).map((gets) => gets.length), [2, 1]);

        harness.poller.stop();
    });

    it('polls every never-run smart job on a cloud cold start', async (t) => {
        const harness = createHarness(t, {
            cloudPath: true,
            maxCmdNum: 1,
            startClock: 1_700_000_000_000,
            jobs: [
                {
                    namespace: ELECTRICITY_NAMESPACE,
                    strategy: 'smart',
                    periodMs: SENSOR_FAST_PERIOD_MS,
                    periodCloudMs: SENSOR_FAST_CLOUD_PERIOD_MS
                },
                {
                    namespace: CONSUMPTIONX_NAMESPACE,
                    strategy: 'smart',
                    periodMs: ENERGY_PERIOD_MS,
                    periodCloudMs: ENERGY_CLOUD_PERIOD_MS
                }
            ]
        });

        harness.poller.start();
        await harness.advance(0);

        assert.equal(harness.requestGets.mock.callCount(), 2);
        assert.deepEqual(
            harness.getsHistory.map((gets) => gets.map((get) => get.namespace)),
            [[ELECTRICITY_NAMESPACE], [CONSUMPTIONX_NAMESPACE]]
        );

        harness.poller.stop();
    });

    it('polls electricity each cloud cycle while ConsumptionX waits for its cloud period', async (t) => {
        const harness = createHarness(t, {
            cloudPath: true,
            maxCmdNum: 1,
            startClock: 1_700_000_000_000,
            jobs: [
                {
                    namespace: ELECTRICITY_NAMESPACE,
                    strategy: 'smart',
                    periodMs: SENSOR_FAST_PERIOD_MS,
                    periodCloudMs: SENSOR_FAST_CLOUD_PERIOD_MS
                },
                {
                    namespace: CONSUMPTIONX_NAMESPACE,
                    strategy: 'smart',
                    periodMs: ENERGY_PERIOD_MS,
                    periodCloudMs: ENERGY_CLOUD_PERIOD_MS
                }
            ]
        });

        harness.poller.start();
        await harness.advance(0);
        assert.deepEqual(
            harness.getsHistory.map((gets) => gets.map((get) => get.namespace)),
            [[ELECTRICITY_NAMESPACE], [CONSUMPTIONX_NAMESPACE]]
        );

        await harness.advance(INTERVAL_MS);
        assert.deepEqual(
            harness.getsHistory[2]?.map((get) => get.namespace),
            [ELECTRICITY_NAMESPACE]
        );

        await harness.advance(ENERGY_PERIOD_MS - INTERVAL_MS);
        assert.deepEqual(
            harness.getsHistory.at(-1)?.map((get) => get.namespace),
            [ELECTRICITY_NAMESPACE]
        );

        harness.poller.stop();
    });

    it('waits out startDelayMs before the first tick', async (t) => {
        const harness = createHarness(t, {
            startDelayMs: 500,
            jobs: [{
                namespace: TOGGLEX_NAMESPACE,
                strategy: 'default',
                periodMs: 0,
                periodCloudMs: 0
            }]
        });

        harness.poller.start();
        await harness.advance(0);
        assert.equal(harness.requestGets.mock.callCount(), 0);

        await harness.advance(500);
        assert.equal(harness.requestGets.mock.callCount(), 1);

        harness.poller.stop();
    });

    it('polls System.All before never-run smart jobs on a cloud cold start', async (t) => {
        const harness = createHarness(t, {
            cloudPath: true,
            maxCmdNum: 1,
            jobs: [
                {
                    namespace: SYSTEM_ALL_NAMESPACE,
                    strategy: 'all',
                    periodMs: SYSTEM_ALL_PERIOD_MS,
                    periodCloudMs: CLOUDMQTT_PERIOD_MS
                },
                {
                    namespace: TOGGLEX_NAMESPACE,
                    strategy: 'digest',
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
        assert.deepEqual(
            harness.getsHistory.map((gets) => gets.map((get) => get.namespace)),
            [[SYSTEM_ALL_NAMESPACE], [ELECTRICITY_NAMESPACE]]
        );

        await harness.advance(INTERVAL_MS);
        assert.deepEqual(
            harness.getsHistory[2]?.map((get) => get.namespace),
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
            [{
                id: `${UUID}:0`,
                uuid: UUID,
                channel: 0,
                name: 'plug',
                model: 'mss310',
                classHint: 'socket',
                traits: ['switch', 'energy', 'dnd'],
                online: true
            }],
            new Set([TOGGLEX_NAMESPACE])
        );
        // Firmware without Control.Multiple sends one publish per GET, so this
        // is the path that overran the publish window; a packing device is strictly cheaper.
        const harness = createHarness(t, {
            cloudPath: true,
            intervalMs: DEFAULT_POLL_INTERVAL_MS,
            maxCmdNum: 1,
            jobs
        });

        harness.poller.recordPush();
        harness.poller.start();
        await harness.advance(0);
        await harness.advance(3_600_000);
        harness.poller.stop();

        const publishes = harness.getsHistory.reduce((total, gets) => total + gets.length, 0);
        assert.ok(publishes < 200, `expected under 200 publishes/hour, got ${publishes}`);
    });

    it('lazy-fills leftover Multiple batch room with oldest smart jobs first', async (t) => {
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
        // Default must poll; smart jobs are not due yet and fill the leftover batch room.
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

    it('does not pack Electricity with ConsumptionX when the pair would overflow HTTP', async (t) => {
        const harness = createHarness(t, {
            maxCmdNum: 3,
            jobs: [
                {
                    namespace: ELECTRICITY_NAMESPACE,
                    strategy: 'smart',
                    periodMs: SENSOR_FAST_PERIOD_MS,
                    periodCloudMs: SENSOR_FAST_CLOUD_PERIOD_MS
                },
                {
                    namespace: CONSUMPTIONX_NAMESPACE,
                    strategy: 'smart',
                    periodMs: ENERGY_PERIOD_MS,
                    periodCloudMs: ENERGY_CLOUD_PERIOD_MS
                }
            ]
        });

        harness.poller.start();
        await harness.advance(0);
        // header 300 + Electricity 430 + ConsumptionX 1910 = 2640 > maxCmdNum 3 * 800.
        assert.deepEqual(harness.getsHistory, [
            [{ namespace: ELECTRICITY_NAMESPACE, payload: {} }],
            [{ namespace: CONSUMPTIONX_NAMESPACE, payload: {} }]
        ]);

        await harness.advance(INTERVAL_MS);
        assert.deepEqual(harness.getsHistory[2], [
            { namespace: ELECTRICITY_NAMESPACE, payload: {} }
        ]);

        harness.poller.stop();
    });

    it('does not lazy-fill ConsumptionX into an Electricity Multiple that would overflow', async (t) => {
        const harness = createHarness(t, {
            maxCmdNum: 3,
            jobs: [
                {
                    namespace: ELECTRICITY_NAMESPACE,
                    strategy: 'smart',
                    periodMs: SENSOR_FAST_PERIOD_MS,
                    periodCloudMs: SENSOR_FAST_CLOUD_PERIOD_MS
                },
                {
                    namespace: CONSUMPTIONX_NAMESPACE,
                    strategy: 'smart',
                    periodMs: ENERGY_PERIOD_MS,
                    periodCloudMs: ENERGY_CLOUD_PERIOD_MS,
                    responseSize: 2_000
                }
            ]
        });

        harness.poller.start();
        await harness.advance(0);
        assert.deepEqual(harness.getsHistory, [
            [{ namespace: ELECTRICITY_NAMESPACE, payload: {} }],
            [{ namespace: CONSUMPTIONX_NAMESPACE, payload: {} }]
        ]);

        await harness.advance(INTERVAL_MS);
        assert.deepEqual(harness.getsHistory[2], [
            { namespace: ELECTRICITY_NAMESPACE, payload: {} }
        ]);

        harness.poller.stop();
    });

    it('applies job.calibrate from GETACK so a later cycle can pack what previously overflowed', async (t) => {
        const harness = createHarness(t, {
            maxCmdNum: 3,
            jobs: [
                {
                    namespace: ELECTRICITY_NAMESPACE,
                    strategy: 'smart',
                    periodMs: SENSOR_FAST_PERIOD_MS,
                    periodCloudMs: SENSOR_FAST_CLOUD_PERIOD_MS
                },
                {
                    namespace: CONSUMPTIONX_NAMESPACE,
                    strategy: 'smart',
                    periodMs: ENERGY_PERIOD_MS,
                    periodCloudMs: ENERGY_CLOUD_PERIOD_MS,
                    responseSize: 2_000,
                    calibrate: (payload) => (
                        Array.isArray(payload.consumptionx) ? 100 : undefined
                    )
                }
            ]
        });
        harness.requestGets.mock.mockImplementation(async (gets: GetCommand[]) => {
            harness.getsHistory.push(gets.map((get) => ({
                namespace: get.namespace,
                payload: get.payload ?? {}
            })));
            return gets.map((get) => {
                if (get.namespace === CONSUMPTIONX_NAMESPACE) {
                    return ack(CONSUMPTIONX_NAMESPACE, { consumptionx: [{ date: '20240101' }] });
                }
                return ack(get.namespace, get.payload ?? {});
            });
        });

        harness.poller.start();
        await harness.advance(0);
        assert.deepEqual(harness.getsHistory, [
            [{ namespace: ELECTRICITY_NAMESPACE, payload: {} }],
            [{ namespace: CONSUMPTIONX_NAMESPACE, payload: {} }]
        ]);

        await harness.advance(INTERVAL_MS);
        assert.deepEqual(harness.getsHistory[2], [
            { namespace: ELECTRICITY_NAMESPACE, payload: {} },
            { namespace: CONSUMPTIONX_NAMESPACE, payload: {} }
        ]);

        harness.poller.stop();
    });

    it('doubles the offline System.All delay after a failed probe', async (t) => {
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

    it('interleaves System.All with digest jobs on HTTP', async (t) => {
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
                    strategy: 'digest',
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

        await harness.advance(SYSTEM_ALL_PERIOD_MS - INTERVAL_MS);
        assert.deepEqual(
            harness.getsHistory.at(-1)?.map((get) => get.namespace),
            [SYSTEM_ALL_NAMESPACE]
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

        harness.poller.recordPush();
        harness.poller.start();
        await harness.advance(0);
        // System.All has no nesting restriction, so onlining packs it with
        // ToggleX into a single Control.Multiple instead of two requests.
        assert.deepEqual(
            harness.getsHistory.map((gets) => gets.map((get) => get.namespace)),
            [[SYSTEM_ALL_NAMESPACE, 'Appliance.Control.ToggleX']]
        );

        await harness.advance(INTERVAL_MS);
        assert.equal(harness.requestGets.mock.callCount(), 1);

        harness.poller.stop();
    });

    it('polls System.All on the heartbeat while MQTT is active and HTTP is down', async (t) => {
        const harness = createHarness(t, {
            cloudPath: true,
            httpDown: true,
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
                }
            ]
        });

        harness.poller.recordPush();
        harness.poller.start();
        await harness.advance(0);
        // Cold start still GETs default jobs; MQTT skip only applies after nextMs is set.
        assert.deepEqual(
            harness.getsHistory.map((gets) => gets.map((get) => get.namespace)),
            [[SYSTEM_ALL_NAMESPACE, TOGGLEX_NAMESPACE]]
        );

        await harness.advance(INTERVAL_MS);
        assert.equal(harness.requestGets.mock.callCount(), 1);

        harness.poller.recordPush();
        await harness.advance(SYSTEM_ALL_PERIOD_MS - INTERVAL_MS);
        // ToggleX is not due this tick (MQTT active, already polled), so the
        // heartbeat System.All goes out alone.
        assert.deepEqual(harness.getsHistory[1], [{
            namespace: SYSTEM_ALL_NAMESPACE,
            payload: {}
        }]);

        harness.poller.stop();
    });

    it('does not poll System.All on the heartbeat for a cloud-only device', async (t) => {
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
                }
            ]
        });

        harness.poller.recordPush();
        harness.poller.start();
        await harness.advance(0);
        // Cold start still GETs default jobs; MQTT skip only applies after nextMs is set.
        assert.deepEqual(
            harness.getsHistory.map((gets) => gets.map((get) => get.namespace)),
            [[SYSTEM_ALL_NAMESPACE, TOGGLEX_NAMESPACE]]
        );

        await harness.advance(INTERVAL_MS);
        assert.equal(harness.requestGets.mock.callCount(), 1);

        harness.poller.recordPush();
        await harness.advance(SYSTEM_ALL_PERIOD_MS - INTERVAL_MS);
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

    it('applies later GETACKs when a trait throws on an earlier namespace', async (t) => {
        const applied: string[] = [];
        const warnings: Array<{ error: Error; trait: string }> = [];
        const endpoint = new Endpoint({
            id: UUID,
            traits: ['energy'],
            energy: new EnergyTrait({
                uuid: UUID,
                channel: 0,
                hasElectricity: true,
                hasElectricityX: false,
                hasConsumptionX: false,
                hasConsumptionH: false,
                namespaces: new Set([CONFIG_STANDBY_KILLER_NAMESPACE]),
                request: async () => ack(ELECTRICITY_NAMESPACE),
                emitChange: () => {
                    applied.push(ELECTRICITY_NAMESPACE);
                }
            })
        });
        endpoint.on('warning', (error, trait) => {
            warnings.push({ error, trait });
        });
        const electricityAck = {
            electricity: { channel: 0, power: 11_000, current: 53, voltage: 2274 }
        };
        const harness = createHarness(t, {
            maxCmdNum: 5,
            onAck: (message) => endpoint.handlePush(message),
            jobs: [
                {
                    namespace: CONFIG_STANDBY_KILLER_NAMESPACE,
                    strategy: 'smart',
                    periodMs: 300_000,
                    periodCloudMs: 600_000,
                    payload: { config: 1 }
                },
                {
                    namespace: ELECTRICITY_NAMESPACE,
                    strategy: 'smart',
                    periodMs: SENSOR_FAST_PERIOD_MS,
                    periodCloudMs: SENSOR_FAST_CLOUD_PERIOD_MS,
                    payload: electricityAck
                }
            ]
        });

        harness.poller.start();
        await harness.advance(0);
        assert.deepEqual(
            harness.getsHistory[0]?.map((get) => get.namespace),
            [CONFIG_STANDBY_KILLER_NAMESPACE, ELECTRICITY_NAMESPACE]
        );
        assert.deepEqual(applied, [ELECTRICITY_NAMESPACE]);
        assert.equal(warnings.length, 1);
        assert.equal(warnings[0]?.trait, 'energy');

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

    it('still polls default jobs on a System.All tick', async (t) => {
        const harness = createHarness(t, {
            jobs: [
                {
                    namespace: SYSTEM_ALL_NAMESPACE,
                    strategy: 'all',
                    periodMs: SYSTEM_ALL_PERIOD_MS,
                    periodCloudMs: 0
                },
                {
                    namespace: MP3_NAMESPACE,
                    strategy: 'default',
                    periodMs: 0,
                    periodCloudMs: 0
                }
            ]
        });

        harness.poller.start();
        await harness.advance(0);
        // System.All packs with default jobs on the same tick, so MP3 does not
        // spend a second request.
        assert.deepEqual(
            harness.getsHistory.map((gets) => gets.map((get) => get.namespace)),
            [[SYSTEM_ALL_NAMESPACE, MP3_NAMESPACE]]
        );

        harness.poller.stop();
    });

    it('polls immediately when MQTT traffic brings an offline device online', async (t) => {
        const harness = createHarness(t, {
            online: false,
            jobs: [{
                namespace: TOGGLEX_NAMESPACE,
                strategy: 'default',
                periodMs: 0,
                periodCloudMs: 0
            }]
        });

        harness.poller.start();
        await harness.advance(0);
        assert.deepEqual(
            harness.getsHistory[0]?.map((get) => get.namespace),
            [SYSTEM_ALL_NAMESPACE]
        );

        harness.setOnline(true);
        harness.poller.setOnline(true);
        await harness.advance(0);
        assert.deepEqual(
            harness.getsHistory[1]?.map((get) => get.namespace),
            [TOGGLEX_NAMESPACE]
        );

        harness.poller.stop();
    });

    it('walks remaining jobs in the same tick when a probe onlines the device', async (t) => {
        const harness = createHarness(t, {
            online: false,
            jobs: [{
                namespace: TOGGLEX_NAMESPACE,
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
            harness.setOnline(true);
            harness.poller.setOnline(true);
            return gets.map((get) => ack(get.namespace, get.payload ?? {}));
        });

        harness.poller.start();
        await harness.advance(0);
        assert.deepEqual(
            harness.getsHistory.map((gets) => gets.map((get) => get.namespace)),
            [[SYSTEM_ALL_NAMESPACE], [TOGGLEX_NAMESPACE]]
        );

        harness.poller.stop();
    });

    it('resumes default jobs after MQTT drops', async (t) => {
        const harness = createHarness(t, {
            jobs: [{
                namespace: TOGGLEX_NAMESPACE,
                strategy: 'default',
                periodMs: 0,
                periodCloudMs: 0
            }]
        });

        harness.poller.start();
        await harness.advance(0);
        assert.deepEqual(
            harness.getsHistory[0]?.map((get) => get.namespace),
            [TOGGLEX_NAMESPACE]
        );

        harness.poller.recordPush();
        await harness.advance(INTERVAL_MS);
        assert.equal(harness.requestGets.mock.callCount(), 1);

        harness.poller.clearMqtt();
        await harness.advance(INTERVAL_MS);
        assert.deepEqual(
            harness.getsHistory[1]?.map((get) => get.namespace),
            [TOGGLEX_NAMESPACE]
        );

        harness.poller.stop();
    });
});
