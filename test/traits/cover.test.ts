import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Endpoint } from '../../src/endpoint';
import {
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

function createCoverHarness(kind: 'garage' | 'shutter'): {
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
            return encodeMessage({
                namespace: options.namespace,
                method: 'SETACK',
                key: KEY,
                from: `/appliance/${UUID}/publish`,
                messageId: message.header.messageId,
                uuid: UUID,
                payload: {}
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
