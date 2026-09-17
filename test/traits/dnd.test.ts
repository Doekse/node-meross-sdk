import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Endpoint } from '../../src/endpoint';
import { TransportError } from '../../src/errors';
import {
    DND_MODE_NAMESPACE,
    encodeDndGet,
    encodeMessage,
    type MerossMessage
} from '../../src/protocol';
import { DndTrait } from '../../src/traits/dnd';
import type { DndTraitBind, DndValues } from '../../src/traits/dnd';
import {
    createRequestRecorder,
    recordedCalls,
    traitAck,
    type RequestRecorderOptions
} from '../helpers/request';

const KEY = 'stub-key';
const UUID = '2206138957096651080248e1e99705a4';

function createHarness(options: {
    ack?: RequestRecorderOptions['ack'];
} = {}): {
    trait: DndTrait;
    requests: MerossMessage[];
    changes: DndValues[];
} {
    const changes: DndValues[] = [];
    const endpoint = new Endpoint({ id: `${UUID}:0`, traits: ['dnd'] });
    const { requests, request } = createRequestRecorder({
        uuid: UUID,
        key: KEY,
        ack: options.ack ?? ((_opts, sent) => traitAck(sent, {
            key: KEY,
            method: 'GETACK',
            payload: { DNDMode: { mode: 1 } }
        }))
    });
    const bind: DndTraitBind = {
        request,
        emitChange: (values) => {
            changes.push({ ...values });
            endpoint.emit('change', { trait: 'dnd', values: { ...values } });
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
    it('poll GETs { DNDMode: {} }, applies, and returns a snapshot', async () => {
        const { trait, requests, changes } = createHarness();

        const snapshot = await trait.poll();

        assert.deepEqual(recordedCalls(requests), [{
            namespace: DND_MODE_NAMESPACE,
            method: 'GET',
            payload: encodeDndGet()
        }]);
        assert.equal(trait.isOn(), true);
        assert.deepEqual(snapshot, { on: true });
        assert.deepEqual(changes, [{ on: true }]);
    });

    it('rejects poll when the GET throws TransportError', async () => {
        const { trait, requests } = createHarness({
            ack: () => {
                throw new TransportError('LAN unreachable', 'LAN_UNREACHABLE');
            }
        });

        await assert.rejects(
            () => trait.poll(),
            (err: unknown) => err instanceof TransportError
        );
        assert.deepEqual(recordedCalls(requests), [{
            namespace: DND_MODE_NAMESPACE,
            method: 'GET',
            payload: encodeDndGet()
        }]);
        assert.equal(trait.isOn(), undefined);
    });

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
        assert.deepEqual(changes, [{ on: true }]);
    });

    it('does not emit change when PUSH repeats the same DND mode', () => {
        const { trait, changes } = createHarness();

        trait.handlePush(pushMessage({ DNDMode: { mode: 1 } }));
        trait.handlePush(pushMessage({ DNDMode: { mode: 1 } }));

        assert.deepEqual(changes, [{ on: true }]);
    });
});
