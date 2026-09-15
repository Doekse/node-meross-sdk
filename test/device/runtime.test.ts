import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';

import { DeviceRuntime, type DeviceRuntimeOptions } from '../../src/device/runtime';
import { Endpoint } from '../../src/endpoint';
import { encodeMessage, type MerossMessage } from '../../src/protocol';
import type { GetCommand } from '../../src/transport/router';

const UUID = '2206138957096651080248e1e99705a4';
const KEY = 'stub-key';
const INTERVAL_MS = 1_000;

function onlineMessage(status: number): MerossMessage {
    return encodeMessage({
        namespace: 'Appliance.System.Online',
        method: 'PUSH',
        key: KEY,
        from: `/appliance/${UUID}/publish`,
        uuid: UUID,
        payload: { online: { status } }
    });
}

function flushMicrotasks(): Promise<void> {
    return Promise.resolve().then(() => Promise.resolve());
}

interface Harness {
    runtime: DeviceRuntime;
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

    const request = t.mock.fn(async () => encodeMessage({
        namespace: 'Appliance.System.All',
        method: 'GETACK',
        key: KEY,
        from: `/appliance/${UUID}/publish`,
        uuid: UUID,
        payload: {}
    }));

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
        requestGets,
        request,
        advance: async (ms: number) => {
            if (ms === 0) {
                t.mock.timers.tick(0);
                await flushMicrotasks();
                await flushMicrotasks();
                return;
            }
            let remaining = ms;
            while (remaining > 0) {
                const delta = Math.min(INTERVAL_MS, remaining);
                clock += delta;
                t.mock.timers.tick(delta);
                await flushMicrotasks();
                await flushMicrotasks();
                remaining -= delta;
            }
        }
    };
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
        const harness = createHarness(t);

        harness.runtime.start();
        await harness.advance(0);
        assert.equal(harness.requestGets.mock.callCount(), 1);

        harness.runtime.handleMessage(onlineMessage(0));
        harness.runtime.handleMessage(onlineMessage(1));
        await harness.advance(0);

        assert.equal(harness.requestGets.mock.callCount(), 2);
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
});
