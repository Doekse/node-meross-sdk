import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Endpoint } from '../../src/endpoint';
import {
    CONTROL_WATER_NAMESPACE,
    DEVICE_CFG_NAMESPACE,
    HUB_TOGGLEX_NAMESPACE,
    encodeMessage,
    type MerossMessage
} from '../../src/protocol';
import { SprinklerTrait } from '../../src/traits/sprinkler';
import type { SprinklerTraitBind } from '../../src/traits/sprinkler';

const KEY = 'stub-key';
const UUID = '2206138957096651080248e1e99705a4';
const SUB_DEVICE_ID = 'aabbcc';

const SPRINKLER_NAMESPACES = new Set([
    CONTROL_WATER_NAMESPACE,
    DEVICE_CFG_NAMESPACE
]);

function createHarness(
    getAckByNamespace: Record<string, Record<string, unknown>> = {},
    namespaces: ReadonlySet<string> = SPRINKLER_NAMESPACES
): {
    endpoint: Endpoint;
    trait: SprinklerTrait;
    requests: MerossMessage[];
    changes: Record<string, unknown>[];
} {
    const requests: MerossMessage[] = [];
    const changes: Record<string, unknown>[] = [];
    const endpoint = new Endpoint({ id: `${UUID}#${SUB_DEVICE_ID}`, traits: ['sprinkler'] });
    const bind: SprinklerTraitBind = {
        uuid: UUID,
        subDeviceId: SUB_DEVICE_ID,
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
            return encodeMessage({
                namespace: options.namespace,
                method: 'GETACK',
                key: KEY,
                from: `/appliance/${UUID}/publish`,
                messageId: message.header.messageId,
                uuid: UUID,
                payload: getAckByNamespace[options.namespace] ?? {}
            });
        },
        emitChange: (values) => {
            changes.push({ ...values });
            endpoint.emit('change', { trait: 'sprinkler', values: { ...values } });
        }
    };
    return { endpoint, trait: new SprinklerTrait(bind), requests, changes };
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

describe('SprinklerTrait', () => {
    it('polls Control.Water and DeviceCfg on start', async () => {
        const { trait, requests, changes } = createHarness({
            [CONTROL_WATER_NAMESPACE]: {
                control: [{ channel: 0, subId: SUB_DEVICE_ID, onoff: 2, dura: 7200 }]
            },
            [DEVICE_CFG_NAMESPACE]: {
                config: [{ channel: 0, subId: SUB_DEVICE_ID, mstCfg: { dura: 3600 } }]
            }
        });
        trait.start();
        await new Promise((resolve) => setImmediate(resolve));

        assert.equal(requests.length, 2);
        assert.equal(requests[0]?.header.namespace, CONTROL_WATER_NAMESPACE);
        assert.equal(requests[1]?.header.namespace, DEVICE_CFG_NAMESPACE);
        assert.equal(trait.isOn(), false);
        assert.equal(trait.getDuration(), 3600);
        assert.deepEqual(changes[changes.length - 1], { duration: 3600 });
    });

    it('setOn uses Control.Water onoff 1/2 and never Hub.ToggleX', async () => {
        const { trait, requests } = createHarness();
        await trait.setOn(true);
        await trait.setOn(false);

        assert.equal(requests.length, 2);
        for (const message of requests) {
            assert.equal(message.header.namespace, CONTROL_WATER_NAMESPACE);
            assert.equal(message.header.method, 'SET');
            assert.notEqual(message.header.namespace, HUB_TOGGLEX_NAMESPACE);
        }
        assert.deepEqual(
            (requests[0]?.payload as { control: Array<{ onoff: number }> }).control[0]?.onoff,
            1
        );
        assert.deepEqual(
            (requests[1]?.payload as { control: Array<{ onoff: number }> }).control[0]?.onoff,
            2
        );
        assert.equal(trait.isOn(), false);
    });

    it('setDuration writes DeviceCfg mstCfg.dura in seconds', async () => {
        const { trait, requests } = createHarness();
        await trait.setDuration(5400);

        assert.equal(requests.length, 1);
        assert.equal(requests[0]?.header.namespace, DEVICE_CFG_NAMESPACE);
        assert.deepEqual(requests[0]?.payload, {
            config: [{ subId: SUB_DEVICE_ID, channel: 0, mstCfg: { dura: 5400 } }]
        });
        assert.equal(trait.getDuration(), 5400);
    });

    it('handlePush applies Control.Water for this subId only', () => {
        const { trait, changes } = createHarness();
        trait.handlePush(pushMessage(CONTROL_WATER_NAMESPACE, {
            control: [
                { channel: 0, subId: SUB_DEVICE_ID, onoff: 1, dura: 900 },
                { channel: 0, subId: 'other-id', onoff: 2 }
            ]
        }));

        assert.equal(trait.isOn(), true);
        assert.deepEqual(changes, [{ on: true, duration: 900 }]);
    });
});
