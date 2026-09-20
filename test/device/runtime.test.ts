import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';

import { DeviceRuntime, type DeviceRuntimeOptions } from '../../src/device/runtime';
import { Endpoint, type Protocol } from '../../src/endpoint';
import {
    SYSTEM_RUNTIME_NAMESPACE,
    encodeMessage,
    type MerossMessage,
    type MerossPayload
} from '../../src/protocol';
import { SystemTrait } from '../../src/traits/system';
import type { GetCommand } from '../../src/transport/router';

const UUID = '2206138957096651080248e1e99705a4';
const KEY = 'stub-key';
const INTERVAL_MS = 1_000;

async function flushMicrotasks(times = 1): Promise<void> {
    for (let i = 0; i < times; i++) {
        await Promise.resolve().then(() => Promise.resolve());
    }
}

async function unreachable(): Promise<never> {
    throw new Error('unreachable');
}

function systemAllGetAck(payload?: MerossPayload, uuid = UUID): MerossMessage {
    return encodeMessage({
        namespace: 'Appliance.System.All',
        method: 'GETACK',
        key: KEY,
        from: `/appliance/${uuid}/publish`,
        uuid,
        payload: payload ?? {
            all: {
                system: {
                    hardware: { type: 'mss110', uuid },
                    firmware: {},
                    online: { status: 1 }
                },
                digest: {}
            }
        }
    });
}

function runtimeGetAck(runtime: Record<string, unknown>): MerossMessage {
    return encodeMessage({
        namespace: SYSTEM_RUNTIME_NAMESPACE,
        method: 'GETACK',
        key: KEY,
        from: `/appliance/${UUID}/publish`,
        uuid: UUID,
        payload: { runtime }
    });
}

function togglePush(): MerossMessage {
    return encodeMessage({
        namespace: 'Appliance.Control.ToggleX',
        method: 'PUSH',
        key: KEY,
        from: `/appliance/${UUID}/publish`,
        uuid: UUID,
        payload: { togglex: [{ channel: 0, onoff: 1 }] }
    });
}

interface Harness {
    runtime: DeviceRuntime;
    endpoint: Endpoint;
    requestGets: ReturnType<TestContext['mock']['fn']>;
    request: ReturnType<TestContext['mock']['fn']>;
    advance: (ms: number) => Promise<void>;
}

function createHarness(t: TestContext, overrides: Partial<DeviceRuntimeOptions> = {}): Harness {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let clock = 0;
    const endpoint = new Endpoint({ id: `${UUID}:0`, traits: ['switch'], initialOnline: true });

    const requestGets = t.mock.fn(async (
        gets: GetCommand[],
        _maxCmdNum: number,
        _onPackedFallback: () => void
    ) => gets.map((get) => encodeMessage({
        namespace: get.namespace,
        method: 'GETACK',
        key: KEY,
        from: `/appliance/${UUID}/publish`,
        uuid: UUID,
        payload: get.payload ?? {}
    })));

    const request = t.mock.fn(async () => systemAllGetAck());

    const runtime = new DeviceRuntime({
        uuid: UUID,
        initialOnline: true,
        endpoints: [endpoint],
        request,
        isCloudPath: () => false,
        maxCmdNum: () => 3,
        requestGets,
        onAck: () => {},
        jobs: [{
            namespace: 'Appliance.Control.ToggleX',
            strategy: 'default',
            periodMs: 0,
            periodCloudMs: 0
        }],
        pollIntervalMs: INTERVAL_MS,
        now: () => clock,
        ...overrides
    });

    return {
        runtime,
        endpoint,
        requestGets,
        request,
        advance: async (ms: number) => {
            if (ms === 0) {
                t.mock.timers.tick(0);
                await flushMicrotasks(2);
                return;
            }
            let remaining = ms;
            while (remaining > 0) {
                const delta = Math.min(INTERVAL_MS, remaining);
                clock += delta;
                t.mock.timers.tick(delta);
                await flushMicrotasks(2);
                remaining -= delta;
            }
        }
    };
}

interface SystemRuntimeHarness {
    runtime: DeviceRuntime;
    endpoint: Endpoint;
    warnings: { error: Error; trait: string }[];
}

function createSystemRuntime(overrides: Partial<DeviceRuntimeOptions> = {}): SystemRuntimeHarness {
    const endpoint = new Endpoint({
        id: `${UUID}:0`,
        traits: ['system'],
        system: new SystemTrait({
            request: unreachable,
            emitChange: () => {}
        }),
        initialOnline: true
    });
    const warnings: { error: Error; trait: string }[] = [];
    endpoint.on('warning', (error, traitName) => {
        warnings.push({ error, trait: traitName });
    });
    const runtime = new DeviceRuntime({
        uuid: UUID,
        initialOnline: true,
        endpoints: [endpoint],
        request: unreachable,
        isCloudPath: () => false,
        maxCmdNum: () => 1,
        requestGets: async () => [],
        onAck: () => {},
        ...overrides
    });
    return { runtime, endpoint, warnings };
}

function assertSystemAllWarning(warnings: { error: Error; trait: string }[]): void {
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0]?.trait, 'system');
    assert.match(warnings[0]?.error.message ?? '', /System\.All/);
}

describe('DeviceRuntime', () => {
    it('start() starts polling and the heartbeat; stop() halts both', async (t: TestContext) => {
        const harness = createHarness(t, { heartbeatIntervalMs: 2_000 });

        harness.runtime.start();
        await harness.advance(0);
        assert.equal(harness.requestGets.mock.callCount(), 1);

        await harness.advance(2_000);
        assert.equal(harness.request.mock.callCount(), 1);

        harness.runtime.stop();
        const requestGetsAtStop = harness.requestGets.mock.callCount();
        const requestAtStop = harness.request.mock.callCount();

        await harness.advance(10_000);
        assert.equal(harness.requestGets.mock.callCount(), requestGetsAtStop);
        assert.equal(harness.request.mock.callCount(), requestAtStop);
    });

    it('propagates an availability online transition into an immediate poll', async (t: TestContext) => {
        const harness = createHarness(t, { initialOnline: false });

        harness.runtime.start();
        await harness.advance(0);
        const pollsWhileOffline = harness.requestGets.mock.callCount();

        harness.runtime.handleMessage(togglePush());
        await harness.advance(0);

        assert.equal(harness.requestGets.mock.callCount(), pollsWhileOffline + 1);
        harness.runtime.stop();
    });

    it('forwards recordPush() and clearMqtt() to the poller', async (t: TestContext) => {
        const harness = createHarness(t);

        harness.runtime.start();
        await harness.advance(0);
        assert.equal(harness.requestGets.mock.callCount(), 1);

        harness.runtime.recordPush();
        await harness.advance(INTERVAL_MS);
        assert.equal(harness.requestGets.mock.callCount(), 1);

        harness.runtime.clearMqtt();
        await harness.advance(INTERVAL_MS);
        assert.equal(harness.requestGets.mock.callCount(), 2);

        harness.runtime.stop();
    });

    it('threads onPackedFallback from the caller-supplied requestGets to the poller instance', async (t: TestContext) => {
        let capturedFallback: (() => void) | undefined;
        const harness = createHarness(t, {
            requestGets: async (gets, _maxCmdNum, onPackedFallback) => {
                capturedFallback = onPackedFallback;
                return gets.map((get) => encodeMessage({
                    namespace: get.namespace,
                    method: 'GETACK',
                    key: KEY,
                    from: `/appliance/${UUID}/publish`,
                    uuid: UUID,
                    payload: get.payload ?? {}
                }));
            }
        });

        harness.runtime.start();
        await harness.advance(0);

        assert.equal(typeof capturedFallback, 'function');
        capturedFallback?.();

        harness.runtime.stop();
    });

    it('publishes LAN vs MQTT protocol from isCloudPath', async (t: TestContext) => {
        let cloud = false;
        const harness = createHarness(t, { isCloudPath: () => cloud });
        const seen: Protocol[] = [];
        harness.endpoint.on('protocol', (protocol) => seen.push(protocol));

        harness.runtime.start();
        assert.equal(harness.endpoint.protocol(), 'http');

        cloud = true;
        await harness.advance(INTERVAL_MS);
        assert.equal(harness.endpoint.protocol(), 'mqtt');
        assert.deepEqual(seen, ['http', 'mqtt']);
        harness.runtime.stop();
    });

    it('still warns from SystemTrait when availability swallowed the same malformed All', () => {
        const { runtime, warnings } = createSystemRuntime();
        const bad = systemAllGetAck({});
        runtime.handleMessage(bad);
        assert.equal(warnings.length, 0);
        runtime.handlePush(bad);
        assertSystemAllWarning(warnings);
    });

    it('routes System.Runtime GETACK through SystemDescriptor.push to getRuntime', () => {
        const { runtime, endpoint } = createSystemRuntime();
        runtime.handlePush(runtimeGetAck({
            signal: 50,
            netType: 2,
            iotStatus: 2,
            ssid: 'test'
        }));

        const snapshot = endpoint.system?.getRuntime();
        assert.deepEqual(snapshot, {
            signal: 50,
            netType: 2,
            ssid: 'test'
        });
        assert.equal('iotStatus' in (snapshot ?? {}), false);
        runtime.stop();
    });

    it('applies packed All GETACK to availability from handlePush', async (t: TestContext) => {
        const ips: Array<string | undefined> = [];
        const harness = createHarness(t, {
            onInnerIp(innerIp: string | undefined): void {
                ips.push(innerIp);
            }
        });
        harness.runtime.start();
        await harness.advance(0);
        harness.runtime.recordPush();
        harness.runtime.handlePush(systemAllGetAck({
            all: {
                system: {
                    hardware: { type: 'mss110', uuid: UUID },
                    firmware: { innerIp: '10.0.0.42' },
                    online: { status: 2 }
                },
                digest: {}
            }
        }));

        assert.deepEqual(ips, ['10.0.0.42']);
        await harness.advance(INTERVAL_MS);
        assert.equal(harness.requestGets.mock.callCount(), 2);
        harness.runtime.stop();
    });

    it('applies packed All hub digest from handlePush', () => {
        const hubUuid = '9109182170548290880048b1a9522933';
        const sensorId = '120027D21C19';
        const hub = new Endpoint({ id: hubUuid, traits: ['dnd'], initialOnline: true });
        const sensor = new Endpoint({
            id: `${hubUuid}#${sensorId}`,
            traits: ['sensor'],
            initialOnline: true
        });
        const sensorSeen: boolean[] = [];
        sensor.on('availability', (online) => sensorSeen.push(online));
        const runtime = new DeviceRuntime({
            uuid: hubUuid,
            initialOnline: true,
            endpoints: [hub, sensor],
            request: unreachable,
            isCloudPath: () => false,
            maxCmdNum: () => 1,
            requestGets: async () => [],
            onAck: () => {}
        });
        runtime.handlePush(systemAllGetAck({
            all: {
                system: {
                    hardware: { type: 'msh300', uuid: hubUuid },
                    firmware: { innerIp: '10.0.0.1' },
                    online: { status: 1 }
                },
                digest: {
                    hub: { subdevice: [{ id: sensorId, status: 2 }] }
                }
            }
        }, hubUuid));

        assert.deepEqual(sensorSeen, [false]);
        runtime.stop();
    });

    it('marks offline and warns when the heartbeat All body is malformed', async (t: TestContext) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        let clock = 0;
        const { runtime, endpoint, warnings } = createSystemRuntime({
            heartbeatIntervalMs: INTERVAL_MS,
            now(): number {
                return clock;
            },
            request: async () => systemAllGetAck({}),
            pollIntervalMs: 60_000,
            startDelayMs: 60_000
        });
        const seen: boolean[] = [];
        endpoint.on('availability', (online) => seen.push(online));
        runtime.start();
        runtime.handleMessage(togglePush());
        seen.length = 0;
        warnings.length = 0;
        clock = INTERVAL_MS + 1;
        t.mock.timers.tick(INTERVAL_MS + 1);
        await flushMicrotasks(3);

        assert.deepEqual(seen, [false]);
        assertSystemAllWarning(warnings);
        runtime.stop();
    });
});
