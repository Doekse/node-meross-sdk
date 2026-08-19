import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Endpoint } from '../../src/endpoint';
import {
    FAN_NAMESPACE,
    TOGGLEX_NAMESPACE,
    encodeMessage,
    type MerossMessage
} from '../../src/protocol';
import { FanTrait } from '../../src/traits/fan';
import type { FanTraitBind } from '../../src/traits/fan';

const KEY = 'stub-key';
const UUID = '2206138957096651080248e1e99705a4';
const CHANNEL = 0;

function createHarness(options: { hasToggleX?: boolean; hasToggle?: boolean } = {}): {
    trait: FanTrait;
    requests: MerossMessage[];
    changes: Record<string, unknown>[];
} {
    const requests: MerossMessage[] = [];
    const changes: Record<string, unknown>[] = [];
    const endpoint = new Endpoint({ id: `${UUID}:${CHANNEL}`, traits: ['fan'] });
    const bind: FanTraitBind = {
        uuid: UUID,
        channel: CHANNEL,
        hasToggleX: options.hasToggleX ?? true,
        hasToggle: options.hasToggle ?? false,
        request: async (requestOptions) => {
            const message = encodeMessage({
                namespace: requestOptions.namespace,
                method: requestOptions.method,
                key: KEY,
                from: '/app/test/subscribe',
                payload: requestOptions.payload,
                uuid: UUID
            });
            requests.push(message);
            if (requestOptions.namespace === FAN_NAMESPACE && requestOptions.method === 'GET') {
                return encodeMessage({
                    namespace: FAN_NAMESPACE,
                    method: 'GETACK',
                    key: KEY,
                    from: `/appliance/${UUID}/publish`,
                    messageId: message.header.messageId,
                    uuid: UUID,
                    payload: { fan: [{ channel: CHANNEL, speed: 3, maxSpeed: 4 }] }
                });
            }
            if (requestOptions.namespace === TOGGLEX_NAMESPACE && requestOptions.method === 'GET') {
                return encodeMessage({
                    namespace: TOGGLEX_NAMESPACE,
                    method: 'GETACK',
                    key: KEY,
                    from: `/appliance/${UUID}/publish`,
                    messageId: message.header.messageId,
                    uuid: UUID,
                    payload: { togglex: { channel: CHANNEL, onoff: 1, entity: 1, lmTime: 1 } }
                });
            }
            return encodeMessage({
                namespace: requestOptions.namespace,
                method: 'SETACK',
                key: KEY,
                from: `/appliance/${UUID}/publish`,
                messageId: message.header.messageId,
                uuid: UUID,
                payload: {}
            });
        },
        emitChange: (values) => {
            changes.push({ ...values });
            endpoint.emit('change', { trait: 'fan', values: { ...values } });
        }
    };
    return { trait: new FanTrait(bind), requests, changes };
}

function pushMessage(namespace: string, payload: Record<string, unknown>): MerossMessage {
    return encodeMessage({
        namespace,
        method: 'PUSH',
        key: KEY,
        from: `/appliance/${UUID}/publish`,
        uuid: UUID,
        payload
    });
}

describe('FanTrait', () => {
    it('polls Fan then ToggleX on start', async () => {
        const { trait, requests, changes } = createHarness();
        trait.start();
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(requests[0]?.header.namespace, FAN_NAMESPACE);
        assert.equal(requests[1]?.header.namespace, TOGGLEX_NAMESPACE);
        assert.equal(trait.getSpeed(), 0.75);
        assert.equal(trait.isOn(), true);
        assert.ok(changes.some((c) => c.speed === 0.75));
        assert.ok(changes.some((c) => c.on === true));
    });

    it('setOn uses ToggleX when advertised', async () => {
        const { trait, requests } = createHarness();
        trait.start();
        await new Promise((resolve) => setImmediate(resolve));
        requests.length = 0;
        await trait.setOn(false);
        await trait.setOn(true);
        assert.equal(requests.length, 2);
        assert.equal(requests[0]?.header.namespace, TOGGLEX_NAMESPACE);
        assert.equal(requests[1]?.header.namespace, TOGGLEX_NAMESPACE);
        assert.equal(trait.isOn(), true);
    });

    it('setOn without ToggleX or Toggle writes Control.Fan speed', async () => {
        const { trait, requests } = createHarness({ hasToggleX: false, hasToggle: false });
        trait.start();
        await new Promise((resolve) => setImmediate(resolve));
        requests.length = 0;
        await trait.setOn(false);
        assert.equal(requests[0]?.header.namespace, FAN_NAMESPACE);
        assert.deepEqual(requests[0]?.payload, { fan: [{ channel: CHANNEL, speed: 0 }] });
        assert.equal(trait.isOn(), false);
    });

    it('setSpeed writes wire 0..maxSpeed', async () => {
        const { trait, requests } = createHarness();
        trait.start();
        await new Promise((resolve) => setImmediate(resolve));
        requests.length = 0;
        await trait.setSpeed(0.5);
        assert.deepEqual(requests[0]?.payload, { fan: [{ channel: CHANNEL, speed: 2 }] });
        assert.equal(trait.getSpeed(), 0.5);
    });

    it('handlePush applies this channel only', () => {
        const { trait, changes } = createHarness();
        trait.handlePush(pushMessage(FAN_NAMESPACE, {
            fan: [{ channel: CHANNEL, speed: 1, maxSpeed: 4 }, { channel: 1, speed: 4, maxSpeed: 4 }]
        }));
        assert.equal(trait.getSpeed(), 0.25);
        assert.deepEqual(changes[0], { speed: 0.25, maxSpeed: 4 });
    });

    it('applies ToggleX PUSH to on/off', () => {
        const { trait, changes } = createHarness();
        trait.handlePush(pushMessage(TOGGLEX_NAMESPACE, {
            togglex: [
                { channel: CHANNEL, onoff: 0, entity: 1, lmTime: 1 },
                { channel: 1, onoff: 1, entity: 1, lmTime: 1 }
            ]
        }));
        assert.equal(trait.isOn(), false);
        assert.deepEqual(changes, [{ on: false }]);
    });

    it('ignores PUSH when uuid does not match the bind', () => {
        const { trait, changes } = createHarness();
        trait.handlePush(encodeMessage({
            namespace: FAN_NAMESPACE,
            method: 'PUSH',
            key: KEY,
            from: '/appliance/other/publish',
            uuid: 'other',
            payload: { fan: [{ channel: CHANNEL, speed: 1, maxSpeed: 4 }] }
        }));
        assert.equal(changes.length, 0);
    });
});
