import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Endpoint } from '../../src/endpoint';
import { SENSOR_LATESTX_NAMESPACE, encodeMessage, type MerossMessage } from '../../src/protocol';
import { PresenceTrait } from '../../src/traits/presence';
import type { PresenceTraitBind } from '../../src/traits/presence';

const KEY = 'stub-key';
const UUID = '2206138957096651080248e1e99705a4';
const CHANNEL = 0;

function createHarness(): {
    trait: PresenceTrait;
    requests: MerossMessage[];
    changes: Record<string, unknown>[];
} {
    const requests: MerossMessage[] = [];
    const changes: Record<string, unknown>[] = [];
    const endpoint = new Endpoint({ id: `${UUID}:${CHANNEL}`, traits: ['presence'] });
    const bind: PresenceTraitBind = {
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
                payload: {
                    latest: [{
                        channel: CHANNEL,
                        data: {
                            presence: [{ times: 1, distance: 760, value: 2, timestamp: 1 }],
                            light: [{ value: 24, timestamp: 1 }]
                        }
                    }]
                }
            });
        },
        emitChange: (values) => {
            changes.push({ ...values });
            endpoint.emit('change', { trait: 'presence', values: { ...values } });
        }
    };
    return { trait: new PresenceTrait(bind), requests, changes };
}

describe('PresenceTrait', () => {
    it('applies present, distance in meters, and lux from LatestX PUSH', () => {
        const { trait, changes } = createHarness();
        trait.handlePush(encodeMessage({
            namespace: SENSOR_LATESTX_NAMESPACE,
            method: 'PUSH',
            key: KEY,
            from: `/appliance/${UUID}/publish`,
            uuid: UUID,
            payload: {
                latest: [{
                    channel: CHANNEL,
                    data: {
                        presence: [{ times: 3, distance: 2100, value: 1, timestamp: 1 }],
                        light: [{ value: 40, timestamp: 1 }]
                    }
                }]
            }
        }));
        assert.equal(changes[0].present, false);
        assert.equal(changes[0].distance, 2.1);
        assert.equal(changes[0].light, 40);
        assert.equal(changes[0].times, 3);
    });

    it('ignores hub LatestX PUSH that carries a subId', () => {
        const { trait, changes } = createHarness();
        trait.handlePush(encodeMessage({
            namespace: SENSOR_LATESTX_NAMESPACE,
            method: 'PUSH',
            key: KEY,
            from: `/appliance/${UUID}/publish`,
            uuid: UUID,
            payload: {
                latest: [{
                    subId: 'ms130',
                    channel: CHANNEL,
                    data: { light: [{ value: 99, timestamp: 1 }] }
                }]
            }
        }));
        assert.equal(changes.length, 0);
    });

    it('GETs LatestX presence and light on start', async () => {
        const { trait, requests, changes } = createHarness();
        trait.start();
        await new Promise((resolve) => setImmediate(resolve));
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(requests[0].header.namespace, SENSOR_LATESTX_NAMESPACE);
        assert.deepEqual(
            (requests[0].payload.latest as Array<{ data: string[] }>)[0].data,
            ['presence', 'light']
        );
        assert.equal(changes[0].present, true);
        assert.equal(changes[0].distance, 0.76);
        assert.equal(changes[0].light, 24);
    });

    it('ignores PUSH when uuid does not match the bind', () => {
        const { trait, changes } = createHarness();
        trait.handlePush(encodeMessage({
            namespace: SENSOR_LATESTX_NAMESPACE,
            method: 'PUSH',
            key: KEY,
            from: '/appliance/other/publish',
            uuid: 'other',
            payload: {
                latest: [{
                    channel: CHANNEL,
                    data: { presence: [{ times: 1, distance: 100, value: 2, timestamp: 1 }] }
                }]
            }
        }));
        assert.equal(changes.length, 0);
    });
});
