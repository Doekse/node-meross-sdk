import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Endpoint } from '../../src/endpoint';
import {
    GARAGE_CONFIG_NAMESPACE,
    GARAGE_MULTIPLE_CONFIG_NAMESPACE,
    GARAGE_STATE_NAMESPACE,
    SHUTTER_ADJUST_NAMESPACE,
    SHUTTER_CONFIG_NAMESPACE,
    SHUTTER_POSITION_NAMESPACE,
    SHUTTER_STATE_NAMESPACE,
    encodeGarageSet,
    encodeMessage,
    encodeShutterAdjustSet,
    encodeShutterConfigSet,
    encodeShutterPositionSet,
    type MerossMessage
} from '../../src/protocol';
import { CoverTrait } from '../../src/traits/cover';

const KEY = 'stub-key';
const UUID = '2206138957096651080248e1e99705a4';
const CHANNEL = 0;

function createCoverHarness(
    kind: 'garage' | 'shutter',
    namespaces?: ReadonlySet<string>,
    getAckPayloads: Record<string, MerossMessage['payload']> = {}
): {
    endpoint: Endpoint;
    trait: CoverTrait;
    requests: MerossMessage[];
} {
    const requests: MerossMessage[] = [];
    const endpoint = new Endpoint({
        id: `${UUID}:${CHANNEL}`,
        traits: ['cover']
    });
    const trait = new CoverTrait({
        uuid: UUID,
        channel: CHANNEL,
        kind,
        namespaces,
        request: async (options) => {
            const message = encodeMessage({
                namespace: options.namespace,
                method: options.method,
                key: KEY,
                from: '/app/test/subscribe',
                payload: options.payload,
                uuid: UUID
            });
            requests.push(message);
            const ackPayload = getAckPayloads[options.namespace] ?? (
                options.method === 'SET' && options.namespace === GARAGE_STATE_NAMESPACE
                    ? { state: { ...((options.payload?.state ?? {}) as object), execute: 1 } }
                    : {}
            );
            return encodeMessage({
                namespace: options.namespace,
                method: options.method === 'GET' ? 'GETACK' : 'SETACK',
                key: KEY,
                from: `/appliance/${UUID}/publish`,
                messageId: message.header.messageId,
                uuid: UUID,
                payload: ackPayload
            });
        },
        emitChange: (values) => endpoint.emit('change', { trait: 'cover', values: { ...values } })
    });
    return { endpoint, trait, requests };
}

function push(namespace: string, payload: MerossMessage['payload']): MerossMessage {
    return encodeMessage({
        namespace,
        method: 'PUSH',
        key: KEY,
        from: `/appliance/${UUID}/publish`,
        uuid: UUID,
        payload
    });
}

function getAck(namespace: string, payload: MerossMessage['payload']): MerossMessage {
    return encodeMessage({
        namespace,
        method: 'GETACK',
        key: KEY,
        from: `/appliance/${UUID}/publish`,
        uuid: UUID,
        payload
    });
}

describe('CoverTrait.open/close', () => {
    it('open() sends GarageDoor.State SET and returns SETACK current state', async () => {
        const { trait, requests } = createCoverHarness('garage');

        const result = await trait.open();

        assert.deepEqual(result, { open: true });
        assert.equal(requests.length, 1);
        assert.equal(requests[0]?.header.namespace, GARAGE_STATE_NAMESPACE);
        assert.equal(requests[0]?.header.method, 'SET');
        assert.deepEqual(requests[0]?.payload, encodeGarageSet({ channel: CHANNEL, open: true }));
    });

    it('close() sends GarageDoor.State SET with open=0', async () => {
        const { trait, requests } = createCoverHarness('garage');

        assert.deepEqual(await trait.close(), { open: false });
        assert.deepEqual(requests[0]?.payload, encodeGarageSet({ channel: CHANNEL, open: false }));
    });

    it('stop() is a no-op for garage', async () => {
        const { trait, requests } = createCoverHarness('garage');
        await trait.stop();
        assert.equal(requests.length, 0);
    });

    it('setPosition() is a no-op for garage', async () => {
        const { trait, requests } = createCoverHarness('garage');
        await trait.setPosition(0.5);
        assert.equal(requests.length, 0);
    });

    it('emits a change patch on the endpoint after SETACK', async () => {
        const { endpoint, trait } = createCoverHarness('garage');
        const changes: unknown[] = [];
        endpoint.on('change', (change) => changes.push(change));

        await trait.open();

        assert.deepEqual(changes, [{ trait: 'cover', values: { open: true } }]);
    });

    it('does not emit change when open() repeats the same state', async () => {
        const { endpoint, trait } = createCoverHarness('garage');
        const changes: unknown[] = [];
        endpoint.on('change', (change) => changes.push(change));

        await trait.open();
        await trait.open();

        assert.equal(changes.length, 1);
    });

    it('open() uses SETACK open as current and moving when execute ran against a different state', async () => {
        const { endpoint, trait } = createCoverHarness('garage', undefined, {
            [GARAGE_STATE_NAMESPACE]: {
                state: { channel: CHANNEL, open: 0, execute: 1, lmTime: 0 }
            }
        });
        const changes: unknown[] = [];
        endpoint.on('change', (change) => changes.push(change));

        const result = await trait.open();

        assert.deepEqual(result, { open: false });
        assert.deepEqual(changes, [
            { trait: 'cover', values: { open: false } },
            { trait: 'cover', values: { moving: true } }
        ]);
    });

    it('open() does not set moving when SETACK execute is 0', async () => {
        const { endpoint, trait } = createCoverHarness('garage', undefined, {
            [GARAGE_STATE_NAMESPACE]: {
                state: { channel: CHANNEL, open: 1, execute: 0, lmTime: 0 }
            }
        });
        const changes: unknown[] = [];
        endpoint.on('change', (change) => changes.push(change));

        const result = await trait.open();

        assert.deepEqual(result, { open: true });
        assert.deepEqual(changes, [{ trait: 'cover', values: { open: true } }]);
    });

    it('garage PUSH clears moving after SETACK starts travel', async () => {
        const { endpoint, trait } = createCoverHarness('garage', undefined, {
            [GARAGE_STATE_NAMESPACE]: {
                state: { channel: CHANNEL, open: 0, execute: 1, lmTime: 0 }
            }
        });
        const changes: unknown[] = [];
        endpoint.on('change', (change) => changes.push(change));

        await trait.open();
        trait.handlePush(push(GARAGE_STATE_NAMESPACE, { state: { channel: CHANNEL, open: 1 } }));

        assert.deepEqual(changes, [
            { trait: 'cover', values: { open: false } },
            { trait: 'cover', values: { moving: true } },
            { trait: 'cover', values: { open: true } },
            { trait: 'cover', values: { moving: false } }
        ]);
    });

    it('open() sends RollerShutter.Position SET with position 100', async () => {
        const { trait, requests } = createCoverHarness('shutter');
        await trait.open();
        assert.equal(requests[0]?.header.namespace, SHUTTER_POSITION_NAMESPACE);
        assert.deepEqual(
            requests[0]?.payload,
            encodeShutterPositionSet({ channel: CHANNEL, position: 100 })
        );
    });

    it('close() sends RollerShutter.Position SET with position 0', async () => {
        const { trait, requests } = createCoverHarness('shutter');
        await trait.close();
        assert.deepEqual(
            requests[0]?.payload,
            encodeShutterPositionSet({ channel: CHANNEL, position: 0 })
        );
    });

    it('stop() sends RollerShutter.Position SET with position -1', async () => {
        const { trait, requests } = createCoverHarness('shutter');
        await trait.stop();
        assert.deepEqual(
            requests[0]?.payload,
            encodeShutterPositionSet({ channel: CHANNEL, position: -1 })
        );
    });

    it('setPosition(0.5) sends wire position 50', async () => {
        const { trait, requests } = createCoverHarness('shutter');
        const result = await trait.setPosition(0.5);
        assert.deepEqual(
            requests[0]?.payload,
            encodeShutterPositionSet({ channel: CHANNEL, position: 50 })
        );
        assert.equal(result.position, 0.5);
    });
});

describe('CoverTrait PUSH', () => {
    it('applies GarageDoor.State PUSH for the bound channel and emits change', () => {
        const { endpoint, trait } = createCoverHarness('garage');
        const changes: unknown[] = [];
        endpoint.on('change', (change) => changes.push(change));

        trait.handlePush(push(GARAGE_STATE_NAMESPACE, { state: { channel: CHANNEL, open: 0 } }));

        assert.deepEqual(changes, [{ trait: 'cover', values: { open: false } }]);
    });

    it('ignores PUSH entries for other channels on the same device', () => {
        const { endpoint, trait } = createCoverHarness('garage');
        const changes: unknown[] = [];
        endpoint.on('change', (change) => changes.push(change));

        trait.handlePush(push(GARAGE_STATE_NAMESPACE, { state: { channel: 1, open: 1 } }));

        assert.deepEqual(changes, []);
    });

    it('ignores PUSH when uuid does not match the bind', () => {
        const { endpoint, trait } = createCoverHarness('garage');
        const changes: unknown[] = [];
        endpoint.on('change', (change) => changes.push(change));

        trait.handlePush(encodeMessage({
            namespace: GARAGE_STATE_NAMESPACE,
            method: 'PUSH',
            key: KEY,
            from: '/appliance/other-device/publish',
            uuid: 'other-device',
            payload: { state: { channel: CHANNEL, open: 1 } }
        }));

        assert.deepEqual(changes, []);
    });

    it('applies RollerShutter.Position PUSH and derives open from position 100', () => {
        const { endpoint, trait } = createCoverHarness('shutter');
        const changes: unknown[] = [];
        endpoint.on('change', (change) => changes.push(change));

        trait.handlePush(push(SHUTTER_POSITION_NAMESPACE, {
            position: [{ channel: CHANNEL, position: 100 }]
        }));

        assert.deepEqual(changes, [{ trait: 'cover', values: { position: 1, open: true } }]);
    });

    it('applies RollerShutter.State PUSH and emits moving', () => {
        const { endpoint, trait } = createCoverHarness('shutter');
        const changes: unknown[] = [];
        endpoint.on('change', (change) => changes.push(change));

        trait.handlePush(push(SHUTTER_STATE_NAMESPACE, { state: [{ channel: CHANNEL, state: 1 }] }));
        trait.handlePush(push(SHUTTER_STATE_NAMESPACE, { state: [{ channel: CHANNEL, state: 0 }] }));

        assert.deepEqual(changes, [
            { trait: 'cover', values: { moving: true } },
            { trait: 'cover', values: { moving: false } }
        ]);
    });
});

describe('CoverTrait.getConfig / setConfig (GarageDoor.Config)', () => {
    const configPayload = {
        config: { signalDuration: 2000, buzzerEnable: 1, doorOpenDuration: 15000, doorCloseDuration: 15000 }
    };

    it('getConfig() is undefined until poller GarageDoor.Config GETACK fills it', () => {
        const { trait, requests } = createCoverHarness(
            'garage',
            new Set([GARAGE_CONFIG_NAMESPACE])
        );

        assert.equal(trait.getConfig(), undefined);
        trait.handlePush(getAck(GARAGE_CONFIG_NAMESPACE, configPayload));

        assert.equal(requests.length, 0);
        assert.deepEqual(trait.getConfig(), {
            signalDuration: 2000,
            buzzerEnable: 1,
            doorOpenDuration: 15000,
            doorCloseDuration: 15000
        });
    });

    it('setConfig() sends GarageDoor.Config SET', async () => {
        const { trait, requests } = createCoverHarness(
            'garage',
            new Set([GARAGE_CONFIG_NAMESPACE])
        );

        await trait.setConfig({ signalDuration: 3000, buzzerEnable: 0 });

        assert.equal(requests.length, 1);
        assert.equal(requests[0]?.header.namespace, GARAGE_CONFIG_NAMESPACE);
        assert.equal(requests[0]?.header.method, 'SET');
        assert.deepEqual(requests[0]?.payload, {
            config: { signalDuration: 3000, buzzerEnable: 0 }
        });
    });

    it('getConfig() returns undefined when no config namespace is advertised', () => {
        const { trait, requests } = createCoverHarness('garage');
        assert.equal(trait.getConfig(), undefined);
        assert.equal(requests.length, 0);
    });

    it('setConfig() is a no-op on shutters', async () => {
        const { trait, requests } = createCoverHarness(
            'shutter',
            new Set([GARAGE_CONFIG_NAMESPACE])
        );
        await trait.setConfig({ signalDuration: 1000 });
        assert.equal(requests.length, 0);
    });
});

describe('CoverTrait.getConfig / setConfig (GarageDoor.MultipleConfig)', () => {
    const multipleConfigPayload = {
        config: [
            { channel: 0, signalClose: 2000, signalOpen: 2000, doorOpenDuration: 15000, doorCloseDuration: 15000, buzzerEnable: 1 },
            { channel: 1, signalClose: 2000, signalOpen: 2000, doorOpenDuration: 15000, doorCloseDuration: 15000, buzzerEnable: 0 }
        ]
    };

    it('getConfig() prefers MultipleConfig GETACK over Config when both are advertised', () => {
        const { trait } = createCoverHarness(
            'garage',
            new Set([GARAGE_CONFIG_NAMESPACE, GARAGE_MULTIPLE_CONFIG_NAMESPACE])
        );

        trait.handlePush(getAck(GARAGE_CONFIG_NAMESPACE, {
            config: { signalDuration: 2000, buzzerEnable: 1 }
        }));
        trait.handlePush(getAck(GARAGE_MULTIPLE_CONFIG_NAMESPACE, multipleConfigPayload));

        assert.deepEqual(trait.getConfig(), {
            channel: 0, signalClose: 2000, signalOpen: 2000,
            doorOpenDuration: 15000, doorCloseDuration: 15000, buzzerEnable: 1
        });
    });

    it('getConfig() serves poller MultipleConfig GETACK for the bound channel', () => {
        const { trait, requests } = createCoverHarness(
            'garage',
            new Set([GARAGE_MULTIPLE_CONFIG_NAMESPACE])
        );

        trait.handlePush(getAck(GARAGE_MULTIPLE_CONFIG_NAMESPACE, multipleConfigPayload));

        assert.equal(requests.length, 0);
        assert.deepEqual(trait.getConfig(), {
            channel: 0, signalClose: 2000, signalOpen: 2000,
            doorOpenDuration: 15000, doorCloseDuration: 15000, buzzerEnable: 1
        });
    });

    it('handlePush ignores MultipleConfig entries for other channels', () => {
        const { trait } = createCoverHarness(
            'garage',
            new Set([GARAGE_MULTIPLE_CONFIG_NAMESPACE])
        );

        trait.handlePush(getAck(GARAGE_MULTIPLE_CONFIG_NAMESPACE, {
            config: [{ channel: 1, signalClose: 2000, signalOpen: 2000 }]
        }));

        assert.equal(trait.getConfig(), undefined);
    });

    it('setConfig() uses MultipleConfig SET and merges the bound channel', async () => {
        const { trait, requests } = createCoverHarness(
            'garage',
            new Set([GARAGE_MULTIPLE_CONFIG_NAMESPACE])
        );

        await trait.setConfig({ channel: 0, buzzerEnable: 0, signalClose: 1500, signalOpen: 1500 });

        assert.equal(requests.length, 1);
        assert.equal(requests[0]?.header.namespace, GARAGE_MULTIPLE_CONFIG_NAMESPACE);
        assert.equal(requests[0]?.header.method, 'SET');
        assert.deepEqual(requests[0]?.payload, {
            config: { channel: 0, buzzerEnable: 0, signalClose: 1500, signalOpen: 1500 }
        });
    });
});

describe('CoverTrait.getShutterConfig / setTravelTimes / setDirection', () => {
    const shutterConfigPayload = {
        config: [
            { channel: 0, signalOpen: 20000, signalClose: 20000, signalMiddle: 10000, autoAdjust: 1 },
            { channel: 1, signalOpen: 10000, signalClose: 10000 }
        ]
    };

    it('getShutterConfig() is undefined until poller RollerShutter.Config GETACK fills it', () => {
        const { trait, requests } = createCoverHarness(
            'shutter',
            new Set([SHUTTER_CONFIG_NAMESPACE])
        );

        assert.equal(trait.getShutterConfig(), undefined);
        trait.handlePush(getAck(SHUTTER_CONFIG_NAMESPACE, shutterConfigPayload));

        assert.equal(requests.length, 0);
        assert.deepEqual(trait.getShutterConfig(), {
            channel: 0, signalOpen: 20000, signalClose: 20000, signalMiddle: 10000, autoAdjust: 1
        });
    });

    it('handlePush ignores RollerShutter.Config entries for other channels', () => {
        const { trait } = createCoverHarness(
            'shutter',
            new Set([SHUTTER_CONFIG_NAMESPACE])
        );

        trait.handlePush(getAck(SHUTTER_CONFIG_NAMESPACE, {
            config: [{ channel: 1, signalOpen: 10000, signalClose: 10000 }]
        }));

        assert.equal(trait.getShutterConfig(), undefined);
    });

    it('getShutterConfig() returns undefined when namespace is not advertised', () => {
        const { trait, requests } = createCoverHarness('shutter');
        assert.equal(trait.getShutterConfig(), undefined);
        assert.equal(requests.length, 0);
    });

    it('getShutterConfig() returns undefined for garage kind', () => {
        const { trait, requests } = createCoverHarness(
            'garage',
            new Set([SHUTTER_CONFIG_NAMESPACE])
        );
        assert.equal(trait.getShutterConfig(), undefined);
        assert.equal(requests.length, 0);
    });

    it('setTravelTimes() sends RollerShutter.Config SET with travel times', async () => {
        const { trait, requests } = createCoverHarness(
            'shutter',
            new Set([SHUTTER_CONFIG_NAMESPACE])
        );

        await trait.setTravelTimes({ signalOpen: 15000, signalClose: 12000 });

        assert.equal(requests.length, 1);
        assert.equal(requests[0]?.header.namespace, SHUTTER_CONFIG_NAMESPACE);
        assert.equal(requests[0]?.header.method, 'SET');
        assert.deepEqual(requests[0]?.payload,
            encodeShutterConfigSet({ channel: CHANNEL, signalOpen: 15000, signalClose: 12000 })
        );
    });

    it('setTravelTimes() includes direction when provided', async () => {
        const { trait, requests } = createCoverHarness(
            'shutter',
            new Set([SHUTTER_CONFIG_NAMESPACE])
        );

        await trait.setTravelTimes({ signalOpen: 15000, signalClose: 12000, direction: 2 });

        assert.deepEqual(requests[0]?.payload,
            encodeShutterConfigSet({ channel: CHANNEL, signalOpen: 15000, signalClose: 12000, direction: 2 })
        );
    });

    it('setTravelTimes() is a no-op on garages', async () => {
        const { trait, requests } = createCoverHarness(
            'garage',
            new Set([SHUTTER_CONFIG_NAMESPACE])
        );
        await trait.setTravelTimes({ signalOpen: 15000, signalClose: 12000 });
        assert.equal(requests.length, 0);
    });

    it('setTravelTimes() is a no-op when namespace is not advertised', async () => {
        const { trait, requests } = createCoverHarness('shutter');
        await trait.setTravelTimes({ signalOpen: 15000, signalClose: 12000 });
        assert.equal(requests.length, 0);
    });

});

describe('CoverTrait.calibrate', () => {
    it('calibrate("auto") sends RollerShutter.Adjust SET with value 1', async () => {
        const { trait, requests } = createCoverHarness(
            'shutter',
            new Set([SHUTTER_ADJUST_NAMESPACE])
        );

        await trait.calibrate('auto');

        assert.equal(requests.length, 1);
        assert.equal(requests[0]?.header.namespace, SHUTTER_ADJUST_NAMESPACE);
        assert.equal(requests[0]?.header.method, 'SET');
        assert.deepEqual(requests[0]?.payload, encodeShutterAdjustSet(CHANNEL, 1));
    });

    it('calibrate("stop") sends value 0', async () => {
        const { trait, requests } = createCoverHarness(
            'shutter',
            new Set([SHUTTER_ADJUST_NAMESPACE])
        );
        await trait.calibrate('stop');
        assert.deepEqual(requests[0]?.payload, encodeShutterAdjustSet(CHANNEL, 0));
    });

    it('calibrate("manualClosed") sends value 2', async () => {
        const { trait, requests } = createCoverHarness(
            'shutter',
            new Set([SHUTTER_ADJUST_NAMESPACE])
        );
        await trait.calibrate('manualClosed');
        assert.deepEqual(requests[0]?.payload, encodeShutterAdjustSet(CHANNEL, 2));
    });

    it('calibrate("manualClosedStop") sends value 3', async () => {
        const { trait, requests } = createCoverHarness(
            'shutter',
            new Set([SHUTTER_ADJUST_NAMESPACE])
        );
        await trait.calibrate('manualClosedStop');
        assert.deepEqual(requests[0]?.payload, encodeShutterAdjustSet(CHANNEL, 3));
    });

    it('calibrate("manualOpenStop") sends value 4', async () => {
        const { trait, requests } = createCoverHarness(
            'shutter',
            new Set([SHUTTER_ADJUST_NAMESPACE])
        );
        await trait.calibrate('manualOpenStop');
        assert.deepEqual(requests[0]?.payload, encodeShutterAdjustSet(CHANNEL, 4));
    });

    it('calibrate() is a no-op on garages', async () => {
        const { trait, requests } = createCoverHarness(
            'garage',
            new Set([SHUTTER_ADJUST_NAMESPACE])
        );
        await trait.calibrate('auto');
        assert.equal(requests.length, 0);
    });

    it('calibrate() is a no-op when namespace is not advertised', async () => {
        const { trait, requests } = createCoverHarness('shutter');
        await trait.calibrate('auto');
        assert.equal(requests.length, 0);
    });
});

