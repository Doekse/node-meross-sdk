import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Endpoint } from '../../src/endpoint';
import { MerossError, TransportError } from '../../src/errors';
import {
    CONFIG_STANDBY_KILLER_NAMESPACE,
    encodeMessage,
    encodeStandbyKillerGet,
    encodeStandbyKillerSet,
    type MerossMessage
} from '../../src/protocol';
import { StandbyKillerTrait } from '../../src/traits/standbykiller';
import type { StandbyKillerTraitBind, StandbyKillerValues } from '../../src/traits/standbykiller';
import {
    createRequestRecorder,
    recordedCalls,
    traitAck,
    type RequestRecorderOptions
} from '../helpers/request';

const KEY = 'stub-key';
const UUID = '2206138957096651080248e1e99705a4';
const CHANNEL = 0;

function createHarness(options: {
    channel?: number;
    namespaces?: ReadonlySet<string>;
    ack?: RequestRecorderOptions['ack'];
} = {}): {
    trait: StandbyKillerTrait;
    requests: MerossMessage[];
    changes: StandbyKillerValues[];
} {
    const channel = options.channel ?? CHANNEL;
    const changes: StandbyKillerValues[] = [];
    const endpoint = new Endpoint({ id: `${UUID}:${channel}`, traits: ['standbykiller'] });
    const { requests, request } = createRequestRecorder({
        uuid: UUID,
        key: KEY,
        ack: options.ack ?? ((_opts, sent) => traitAck(sent, {
            key: KEY,
            method: 'GETACK',
            payload: {
                config: [{
                    channel,
                    power: 5000,
                    time: 300,
                    enable: 1,
                    alert: 2
                }]
            }
        }))
    });
    const bind: StandbyKillerTraitBind = {
        channel,
        namespaces: options.namespaces ?? new Set([CONFIG_STANDBY_KILLER_NAMESPACE]),
        request,
        emitChange: (values) => {
            changes.push({ ...values });
            endpoint.emit('change', { trait: 'standbykiller', values: { ...values } });
        }
    };
    return { trait: new StandbyKillerTrait(bind), requests, changes };
}

function pushMessage(
    namespace: string,
    payload: Record<string, unknown>,
    method: 'PUSH' | 'SET' = 'PUSH'
): MerossMessage {
    return encodeMessage({
        namespace,
        method,
        key: KEY,
        from: `/appliance/${UUID}/publish`,
        uuid: UUID,
        payload
    });
}

describe('StandbyKillerTrait', () => {
    it('poll GETs this channel, applies, and returns a snapshot', async () => {
        const { trait, requests, changes } = createHarness();

        const snapshot = await trait.poll();

        assert.deepEqual(recordedCalls(requests), [{
            namespace: CONFIG_STANDBY_KILLER_NAMESPACE,
            method: 'GET',
            payload: encodeStandbyKillerGet(CHANNEL)
        }]);
        assert.equal(trait.isEnabled(), true);
        assert.equal(trait.getPower(), 5);
        assert.equal(trait.getTime(), 300);
        assert.equal(trait.isAlert(), false);
        assert.deepEqual(snapshot, {
            enabled: true,
            power: 5,
            time: 300,
            alert: false
        });
        assert.deepEqual(changes, [{
            enabled: true,
            power: 5,
            time: 300,
            alert: false
        }]);
    });

    it('poll leaves last unchanged when GETACK config is empty', async () => {
        const { trait, changes } = createHarness({
            ack: (_opts, sent) => traitAck(sent, {
                key: KEY,
                method: 'GETACK',
                payload: { config: [] }
            })
        });

        const snapshot = await trait.poll();

        assert.deepEqual(snapshot, {});
        assert.equal(trait.isEnabled(), undefined);
        assert.deepEqual(changes, []);
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
            namespace: CONFIG_STANDBY_KILLER_NAMESPACE,
            method: 'GET',
            payload: encodeStandbyKillerGet(CHANNEL)
        }]);
        assert.equal(trait.isEnabled(), undefined);
    });

    it('SETs StandbyKiller thresholds and emits change', async () => {
        const { trait, requests, changes } = createHarness();

        await trait.set({
            enabled: true,
            power: 5,
            time: 300,
            alert: false
        });

        assert.deepEqual(recordedCalls(requests), [{
            namespace: CONFIG_STANDBY_KILLER_NAMESPACE,
            method: 'SET',
            payload: encodeStandbyKillerSet({
                channel: CHANNEL,
                enabled: true,
                power: 5,
                time: 300,
                alert: false
            })
        }]);
        assert.deepEqual(changes, [{
            enabled: true,
            power: 5,
            time: 300,
            alert: false
        }]);
    });

    it('throws NAMESPACE_NOT_ADVERTISED when StandbyKiller is absent', async () => {
        const { trait, requests } = createHarness({ namespaces: new Set() });

        await assert.rejects(
            () => trait.set({ enabled: true, power: 1 }),
            (error: unknown) => error instanceof MerossError
                && error.code === 'NAMESPACE_NOT_ADVERTISED'
        );
        assert.equal(requests.length, 0);
    });

    it('applies StandbyKiller PUSH for the bound channel', () => {
        const { trait, changes } = createHarness();

        trait.handlePush(pushMessage(CONFIG_STANDBY_KILLER_NAMESPACE, {
            config: [{
                channel: CHANNEL,
                power: 0,
                time: 300,
                enable: 2,
                alert: 2
            }]
        }));

        assert.deepEqual(changes, [{
            enabled: false,
            power: 0,
            time: 300,
            alert: false
        }]);
    });

    it('ignores StandbyKiller PUSH for other channels', () => {
        const { trait, changes } = createHarness();

        trait.handlePush(pushMessage(CONFIG_STANDBY_KILLER_NAMESPACE, {
            config: [{
                channel: 1,
                power: 1000,
                time: 60,
                enable: 1,
                alert: 1
            }]
        }));

        assert.deepEqual(changes, []);
    });

    it('does not emit change when StandbyKiller PUSH repeats', () => {
        const { trait, changes } = createHarness();
        const message = pushMessage(CONFIG_STANDBY_KILLER_NAMESPACE, {
            config: [{
                channel: CHANNEL,
                power: 0,
                time: 300,
                enable: 2,
                alert: 2
            }]
        });

        trait.handlePush(message);
        trait.handlePush(message);

        assert.equal(changes.length, 1);
    });
});
