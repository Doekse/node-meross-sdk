import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Endpoint } from '../../src/endpoint';
import {
    GARAGE_CONFIG_NAMESPACE,
    GARAGE_MULTIPLE_CONFIG_NAMESPACE,
    GARAGE_STATE_NAMESPACE,
    SHUTTER_POSITION_NAMESPACE,
    SHUTTER_STATE_NAMESPACE,
    encodeGarageSet,
    encodeMessage,
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
            const ackPayload = getAckPayloads[options.namespace] ?? {};
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

describe('CoverTrait.open/close', () => {
    it('open() sends GarageDoor.State SET and returns the requested state', async () => {
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

    it('ignores PUSH entries for other channels on the same board', () => {
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

    it('getConfig() sends GarageDoor.Config GET and returns decoded config', async () => {
        const { trait, requests } = createCoverHarness(
            'garage',
            new Set([GARAGE_CONFIG_NAMESPACE]),
            { [GARAGE_CONFIG_NAMESPACE]: configPayload }
        );

        const result = await trait.getConfig();

        assert.equal(requests.length, 1);
        assert.equal(requests[0]?.header.namespace, GARAGE_CONFIG_NAMESPACE);
        assert.equal(requests[0]?.header.method, 'GET');
        assert.deepEqual(result, {
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

    it('getConfig() returns undefined when no config namespace is advertised', async () => {
        const { trait, requests } = createCoverHarness('garage');
        const result = await trait.getConfig();
        assert.equal(result, undefined);
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

    it('getConfig() prefers MultipleConfig over Config and returns the matching channel entry', async () => {
        const { trait, requests } = createCoverHarness(
            'garage',
            new Set([GARAGE_CONFIG_NAMESPACE, GARAGE_MULTIPLE_CONFIG_NAMESPACE]),
            { [GARAGE_MULTIPLE_CONFIG_NAMESPACE]: multipleConfigPayload }
        );

        const result = await trait.getConfig();

        assert.equal(requests.length, 1);
        assert.equal(requests[0]?.header.namespace, GARAGE_MULTIPLE_CONFIG_NAMESPACE);
        assert.deepEqual(result, {
            channel: 0, signalClose: 2000, signalOpen: 2000,
            doorOpenDuration: 15000, doorCloseDuration: 15000, buzzerEnable: 1
        });
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
