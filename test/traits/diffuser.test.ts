import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Endpoint } from '../../src/endpoint';
import {
    DIFFUSER_LIGHT_NAMESPACE,
    DIFFUSER_SENSOR_NAMESPACE,
    DIFFUSER_SPRAY_NAMESPACE,
    encodeMessage,
    type MerossMessage
} from '../../src/protocol';
import { DiffuserTrait } from '../../src/traits/diffuser';
import type { DiffuserTraitBind } from '../../src/traits/diffuser';
import { createRequestRecorder, traitAck } from '../helpers/request';

const KEY = 'stub-key';
const UUID = '2206138957096651080248e1e99705a4';
const CHANNEL = 0;

const DIFFUSER_NAMESPACES = new Set([
    DIFFUSER_LIGHT_NAMESPACE,
    DIFFUSER_SPRAY_NAMESPACE,
    DIFFUSER_SENSOR_NAMESPACE
]);

const GET_ACK: Record<string, Record<string, unknown>> = {
    [DIFFUSER_LIGHT_NAMESPACE]: {
        type: 'mod100',
        light: [{ channel: CHANNEL, onoff: 1, mode: 1, rgb: 0x112233, luminance: 50 }]
    },
    [DIFFUSER_SPRAY_NAMESPACE]: {
        type: 'mod100',
        spray: [{ channel: CHANNEL, mode: 2 }]
    },
    [DIFFUSER_SENSOR_NAMESPACE]: {
        type: 'mod100',
        humidity: { value: 70 },
        temperature: { value: 365 }
    }
};

function createHarness(
    namespaces: ReadonlySet<string> = DIFFUSER_NAMESPACES
): {
    trait: DiffuserTrait;
    requests: MerossMessage[];
    changes: Record<string, unknown>[];
} {
    const changes: Record<string, unknown>[] = [];
    const endpoint = new Endpoint({ id: `${UUID}:${CHANNEL}`, traits: ['diffuser'] });
    const { requests, request } = createRequestRecorder({
        uuid: UUID,
        key: KEY,
        ack: (options, sent) => traitAck(sent, {
            key: KEY,
            payload: options.method === 'GET' ? (GET_ACK[options.namespace] ?? {}) : {}
        })
    });
    const bind: DiffuserTraitBind = {
        uuid: UUID,
        channel: CHANNEL,
        namespaces,
        request,
        emitChange: (values) => {
            changes.push({ ...values });
            endpoint.emit('change', { trait: 'diffuser', values: { ...values } });
        }
    };
    return { trait: new DiffuserTrait(bind), requests, changes };
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

describe('DiffuserTrait', () => {
    it('setSprayMode uses Diffuser.Spray wire values', async () => {
        const { trait, requests } = createHarness();
        await trait.setSprayMode('strong');
        assert.equal(requests[0]?.header.namespace, DIFFUSER_SPRAY_NAMESPACE);
        assert.deepEqual(requests[0]?.payload, {
            type: 'mod100',
            spray: [{ channel: CHANNEL, mode: 1 }]
        });
        assert.equal(trait.getSprayMode(), 'strong');
    });

    it('setRgb packs 0xRRGGBB and switches to fixed-rgb', async () => {
        const { trait, requests } = createHarness();
        await trait.setRgb({ r: 0x11, g: 0x22, b: 0x33 });
        assert.equal(requests[0]?.header.namespace, DIFFUSER_LIGHT_NAMESPACE);
        const payload = requests[0]?.payload as { type: string; light: Array<{ rgb: number; mode: number }> };
        assert.equal(payload.type, 'mod100');
        const light = payload.light[0];
        assert.equal(light?.rgb, 0x112233);
        assert.equal(light?.mode, 1);
        assert.deepEqual(trait.getRgb(), { r: 0x11, g: 0x22, b: 0x33 });
        assert.equal(trait.getLightMode(), 'fixed-rgb');
    });

    it('handlePush applies this channel only', () => {
        const { trait, changes } = createHarness();
        trait.handlePush(pushMessage(DIFFUSER_SPRAY_NAMESPACE, {
            spray: [{ channel: CHANNEL, mode: 0 }, { channel: 1, mode: 1 }]
        }));
        assert.equal(trait.getSprayMode(), 'light');
        assert.deepEqual(changes, [{ sprayMode: 'light' }]);
    });

    it('ignores PUSH when uuid does not match the bind', () => {
        const { trait, changes } = createHarness();
        trait.handlePush(encodeMessage({
            namespace: DIFFUSER_SPRAY_NAMESPACE,
            method: 'PUSH',
            key: KEY,
            from: '/appliance/other/publish',
            uuid: 'other',
            payload: { spray: [{ channel: CHANNEL, mode: 0 }] }
        }));
        assert.equal(changes.length, 0);
    });
});
