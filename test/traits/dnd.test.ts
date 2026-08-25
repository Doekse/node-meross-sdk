import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Endpoint } from '../../src/endpoint';
import {
    DND_MODE_NAMESPACE,
    encodeMessage,
    type MerossMessage
} from '../../src/protocol';
import { DndTrait } from '../../src/traits/dnd';
import type { DndTraitBind } from '../../src/traits/dnd';

const KEY = 'stub-key';
const UUID = '2206138957096651080248e1e99705a4';

function createHarness(): {
    trait: DndTrait;
    requests: MerossMessage[];
    changes: boolean[];
} {
    const requests: MerossMessage[] = [];
    const changes: boolean[] = [];
    const endpoint = new Endpoint({ id: `${UUID}:0`, traits: ['dnd'] });
    const bind: DndTraitBind = {
        uuid: UUID,
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
                payload: { DNDMode: { mode: 1 } }
            });
        },
        emitChange: (on) => {
            changes.push(on);
            endpoint.emit('change', { trait: 'dnd', values: { on } });
        }
    };
    return { trait: new DndTrait(bind), requests, changes };
}

function pushMessage(payload: Record<string, unknown>): MerossMessage {
    return encodeMessage({
        namespace: DND_MODE_NAMESPACE,
        method: 'PUSH',
        key: KEY,
        from: `/appliance/${UUID}/publish`,
        uuid: UUID,
        payload
    });
}

describe('DndTrait', () => {
    it('setOn sends a SET with mode 0/1', async () => {
        const { trait, requests } = createHarness();
        await trait.setOn(false);
        assert.equal(requests[0]?.header.method, 'SET');
        assert.deepEqual(requests[0]?.payload, { DNDMode: { mode: 0 } });
        assert.equal(trait.isOn(), false);
    });

    it('handlePush updates state and emits change', () => {
        const { trait, changes } = createHarness();
        trait.handlePush(pushMessage({ DNDMode: { mode: 1 } }));
        assert.equal(trait.isOn(), true);
        assert.deepEqual(changes, [true]);
    });

    it('ignores duplicate values and foreign uuid PUSH', () => {
        const { trait, changes } = createHarness();
        trait.handlePush(pushMessage({ DNDMode: { mode: 1 } }));
        trait.handlePush(pushMessage({ DNDMode: { mode: 1 } }));
        assert.equal(changes.length, 1);
        trait.handlePush(encodeMessage({
            namespace: DND_MODE_NAMESPACE,
            method: 'PUSH',
            key: KEY,
            from: '/appliance/other/publish',
            uuid: 'other',
            payload: { DNDMode: { mode: 0 } }
        }));
        assert.equal(changes.length, 1);
    });
});
