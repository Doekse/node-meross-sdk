import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Endpoint } from '../../src/endpoint';
import {
    PRESENCE_CONFIG_NAMESPACE,
    PRESENCE_STUDY_NAMESPACE,
    SENSOR_LATESTX_NAMESPACE,
    encodeMessage,
    type MerossMessage
} from '../../src/protocol';
import { PresenceTrait } from '../../src/traits/presence';
import type { PresenceTraitBind } from '../../src/traits/presence';
import { createRequestRecorder, traitAck } from '../helpers/request';

const KEY = 'stub-key';
const UUID = '2206138957096651080248e1e99705a4';
const CHANNEL = 0;

const CONFIG_ACK_PAYLOAD = {
    config: [{
        channel: CHANNEL,
        mode: { workMode: 1, testMode: 2 },
        noBodyTime: { time: 15 },
        distance: { value: 8100 },
        sensitivity: { level: 2 },
        mthx: { mth1: 120, mth2: 72, mth3: 72 }
    }]
};

function createHarness(namespaces: readonly string[] = [PRESENCE_CONFIG_NAMESPACE]): {
    trait: PresenceTrait;
    requests: MerossMessage[];
    changes: Record<string, unknown>[];
} {
    const changes: Record<string, unknown>[] = [];
    const endpoint = new Endpoint({ id: `${UUID}:${CHANNEL}`, traits: ['presence'] });
    const { requests, request } = createRequestRecorder({
        uuid: UUID,
        key: KEY,
        ack: (options, sent) => {
            const replyPayload = options.namespace === PRESENCE_CONFIG_NAMESPACE
                ? CONFIG_ACK_PAYLOAD
                : {
                    latest: [{
                        channel: CHANNEL,
                        data: {
                            presence: [{ times: 1, distance: 760, value: 2, timestamp: 1 }],
                            light: [{ value: 24, timestamp: 1 }]
                        }
                    }]
                };
            return traitAck(sent, {
                key: KEY,
                method: options.namespace === PRESENCE_STUDY_NAMESPACE ? 'SETACK' : 'GETACK',
                payload: replyPayload
            });
        }
    });
    const bind: PresenceTraitBind = {
        uuid: UUID,
        channel: CHANNEL,
        namespaces: new Set(namespaces),
        request,
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

    it('emits config fields from Presence.Config PUSH', () => {
        const { trait, changes } = createHarness();
        trait.handlePush(encodeMessage({
            namespace: PRESENCE_CONFIG_NAMESPACE,
            method: 'PUSH',
            key: KEY,
            from: `/appliance/${UUID}/publish`,
            uuid: UUID,
            payload: CONFIG_ACK_PAYLOAD
        }));
        assert.equal(changes[0].noBodyTime, 15);
        assert.equal(changes[0].maxDistance, 8.1);
        assert.equal(changes[0].sensitivity, 2);
        assert.equal(changes[0].workMode, 1);
        assert.equal(changes[0].testMode, 2);
    });

    it('ignores Presence.Config PUSH for a different channel', () => {
        const { trait, changes } = createHarness();
        trait.handlePush(encodeMessage({
            namespace: PRESENCE_CONFIG_NAMESPACE,
            method: 'PUSH',
            key: KEY,
            from: `/appliance/${UUID}/publish`,
            uuid: UUID,
            payload: {
                config: [{
                    channel: 1,
                    noBodyTime: { time: 5 },
                    distance: { value: 1000 },
                    sensitivity: { level: 0 },
                    mode: { workMode: 0, testMode: 0 }
                }]
            }
        }));
        assert.equal(changes.length, 0);
    });

    it('getConfig polls Presence.Config and emits changes', async () => {
        const { trait, requests, changes } = createHarness();
        const result = await trait.getConfig();
        assert.ok(result);
        assert.equal(result.noBodyTime, 15);
        assert.equal(result.distance, 8.1);
        assert.equal(result.sensitivity, 2);
        assert.equal(requests[0].header.namespace, PRESENCE_CONFIG_NAMESPACE);
        assert.equal(changes[0].noBodyTime, 15);
        assert.equal(changes[0].maxDistance, 8.1);
        assert.equal(changes[0].workMode, 1);
        assert.equal(changes[0].testMode, 2);
    });

    it('getConfig is a no-op when Presence.Config is not advertised', async () => {
        const { trait, requests } = createHarness([]);
        const result = await trait.getConfig();
        assert.equal(result, undefined);
        assert.equal(requests.length, 0);
    });

    it('setConfig sends a Presence.Config SET with partial options', async () => {
        const { trait, requests } = createHarness();
        await trait.setConfig({ noBodyTime: 30, distance: 5 });
        assert.equal(requests[0].header.namespace, PRESENCE_CONFIG_NAMESPACE);
        assert.equal(requests[0].header.method, 'SET');
        const entry = (requests[0].payload.config as Array<Record<string, unknown>>)[0];
        assert.deepEqual(entry.noBodyTime, { time: 30 });
        assert.deepEqual(entry.distance, { value: 5000 });
        assert.equal('sensitivity' in entry, false);
    });

    it('setConfig is a no-op when Presence.Config is not advertised', async () => {
        const { trait, requests } = createHarness([]);
        await trait.setConfig({ noBodyTime: 30 });
        assert.equal(requests.length, 0);
    });

    it('startStudy sends Presence.Study SET when advertised', async () => {
        const { trait, requests } = createHarness([PRESENCE_STUDY_NAMESPACE]);
        await trait.startStudy();
        assert.equal(requests[0].header.namespace, PRESENCE_STUDY_NAMESPACE);
        assert.equal(requests[0].header.method, 'SET');
        assert.deepEqual(requests[0].payload.study, [{ channel: CHANNEL, status: 1 }]);
    });

    it('startStudy is a no-op when Presence.Study is not advertised', async () => {
        const { trait, requests } = createHarness();
        await trait.startStudy();
        assert.equal(requests.length, 0);
    });
});
