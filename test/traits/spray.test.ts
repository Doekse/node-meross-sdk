import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Endpoint } from '../../src/endpoint';
import { SPRAY_NAMESPACE, encodeMessage, type MerossMessage } from '../../src/protocol';
import { SprayTrait } from '../../src/traits/spray';
import type { SprayTraitBind } from '../../src/traits/spray';

const KEY = 'stub-key';
const UUID = '2206138957096651080248e1e99705a4';
const CHANNEL = 0;

function createHarness(): {
    trait: SprayTrait;
    requests: MerossMessage[];
    changes: Record<string, unknown>[];
} {
    const requests: MerossMessage[] = [];
    const changes: Record<string, unknown>[] = [];
    const endpoint = new Endpoint({ id: `${UUID}:${CHANNEL}`, traits: ['spray'] });
    const bind: SprayTraitBind = {
        uuid: UUID,
        channel: CHANNEL,
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
                method: 'GETACK',
                key: KEY,
                from: `/appliance/${UUID}/publish`,
                messageId: message.header.messageId,
                uuid: UUID,
                payload: { spray: { channel: CHANNEL, mode: 1 } }
            });
        },
        emitChange: (values) => {
            changes.push({ ...values });
            endpoint.emit('change', { trait: 'spray', values: { ...values } });
        }
    };
    return { trait: new SprayTrait(bind), requests, changes };
}

function pushMessage(payload: Record<string, unknown>): MerossMessage {
    return encodeMessage({
        namespace: SPRAY_NAMESPACE,
        method: 'PUSH',
        key: KEY,
        from: `/appliance/${UUID}/publish`,
        uuid: UUID,
        payload
    });
}

describe('SprayTrait', () => {
    it('polls Control.Spray on start', async () => {
        const { trait, requests, changes } = createHarness();
        trait.start();
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(requests[0]?.header.namespace, SPRAY_NAMESPACE);
        assert.equal(trait.getMode(), 'continuous');
        assert.deepEqual(changes[0], { mode: 'continuous' });
    });

    it('setMode sends a dict SET', async () => {
        const { trait, requests } = createHarness();
        await trait.setMode('intermittent');
        assert.equal(requests[0]?.header.method, 'SET');
        assert.deepEqual(requests[0]?.payload, { spray: { channel: CHANNEL, mode: 2 } });
        assert.equal(trait.getMode(), 'intermittent');
    });

    it('handlePush applies this channel only', () => {
        const { trait, changes } = createHarness();
        trait.handlePush(pushMessage({
            spray: [{ channel: CHANNEL, mode: 0 }, { channel: 1, mode: 1 }]
        }));
        assert.equal(trait.getMode(), 'off');
        assert.deepEqual(changes, [{ mode: 'off' }]);
    });

    it('ignores PUSH when uuid does not match the bind', () => {
        const { trait, changes } = createHarness();
        trait.handlePush(encodeMessage({
            namespace: SPRAY_NAMESPACE,
            method: 'PUSH',
            key: KEY,
            from: '/appliance/other/publish',
            uuid: 'other',
            payload: { spray: { channel: CHANNEL, mode: 0 } }
        }));
        assert.equal(changes.length, 0);
    });
});
