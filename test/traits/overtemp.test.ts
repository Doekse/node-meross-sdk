import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Endpoint } from '../../src/endpoint';
import { MerossError, TransportError } from '../../src/errors';
import {
    CONFIG_OVERTEMP_NAMESPACE,
    CONTROL_OVERTEMP_NAMESPACE,
    encodeConfigOverTempGet,
    encodeConfigOverTempSet,
    encodeMessage,
    type MerossMessage
} from '../../src/protocol';
import { OverTempTrait } from '../../src/traits/overtemp';
import type { OverTempTraitBind, OverTempValues } from '../../src/traits/overtemp';
import {
    createRequestRecorder,
    recordedCalls,
    traitAck,
    type RequestRecorderOptions
} from '../helpers/request';

const KEY = 'stub-key';
const UUID = '2206138957096651080248e1e99705a4';

function createHarness(options: {
    namespaces?: ReadonlySet<string>;
    ack?: RequestRecorderOptions['ack'];
} = {}): {
    trait: OverTempTrait;
    requests: MerossMessage[];
    changes: OverTempValues[];
} {
    const changes: OverTempValues[] = [];
    const endpoint = new Endpoint({ id: `${UUID}:0`, traits: ['overtemp'] });
    const { requests, request } = createRequestRecorder({
        uuid: UUID,
        key: KEY,
        ack: options.ack ?? ((_opts, sent) => traitAck(sent, {
            key: KEY,
            method: 'GETACK',
            payload: { overTemp: { enable: 1, type: 1 } }
        }))
    });
    const bind: OverTempTraitBind = {
        namespaces: options.namespaces ?? new Set([
            CONFIG_OVERTEMP_NAMESPACE,
            CONTROL_OVERTEMP_NAMESPACE
        ]),
        request,
        emitChange: (values) => {
            changes.push({ ...values });
            endpoint.emit('change', { trait: 'overtemp', values: { ...values } });
        }
    };
    return { trait: new OverTempTrait(bind), requests, changes };
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

describe('OverTempTrait', () => {
    it('poll GETs { overTemp: {} }, applies, and returns a snapshot', async () => {
        const { trait, requests, changes } = createHarness();

        const snapshot = await trait.poll();

        assert.deepEqual(recordedCalls(requests), [{
            namespace: CONFIG_OVERTEMP_NAMESPACE,
            method: 'GET',
            payload: encodeConfigOverTempGet()
        }]);
        assert.equal(trait.isEnabled(), true);
        assert.equal(trait.getType(), 1);
        assert.deepEqual(snapshot, { enabled: true, type: 1 });
        assert.deepEqual(changes, [{ enabled: true, type: 1 }]);
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
            namespace: CONFIG_OVERTEMP_NAMESPACE,
            method: 'GET',
            payload: encodeConfigOverTempGet()
        }]);
        assert.equal(trait.isEnabled(), undefined);
    });

    it('SETs Config.OverTemp and emits change', async () => {
        const { trait, requests, changes } = createHarness();

        await trait.set({ enabled: false, type: 2 });

        assert.deepEqual(recordedCalls(requests), [{
            namespace: CONFIG_OVERTEMP_NAMESPACE,
            method: 'SET',
            payload: encodeConfigOverTempSet({ enabled: false, type: 2 })
        }]);
        assert.equal(trait.isEnabled(), false);
        assert.equal(trait.getType(), 2);
        assert.deepEqual(changes, [{ enabled: false, type: 2 }]);
    });

    it('throws NAMESPACE_NOT_ADVERTISED when Config.OverTemp is absent', async () => {
        const { trait, requests } = createHarness({ namespaces: new Set() });

        await assert.rejects(
            () => trait.set({ enabled: true }),
            (error: unknown) => error instanceof MerossError
                && error.code === 'NAMESPACE_NOT_ADVERTISED'
        );
        assert.equal(requests.length, 0);
    });

    it('does not emit change when Config.OverTemp PUSH repeats the same values', () => {
        const { trait, changes } = createHarness();

        trait.handlePush(pushMessage(CONFIG_OVERTEMP_NAMESPACE, {
            overTemp: { enable: 1, type: 1 }
        }));
        trait.handlePush(pushMessage(CONFIG_OVERTEMP_NAMESPACE, {
            overTemp: { enable: 1, type: 1 }
        }));

        assert.deepEqual(changes, [{ enabled: true, type: 1 }]);
    });

    it('ignores Control.OverTemp PUSH for other channels', () => {
        const { trait, changes } = createHarness();

        trait.handlePush(pushMessage(CONTROL_OVERTEMP_NAMESPACE, {
            overTemp: [{
                channel: 1,
                value: 1,
                timestamp: 99,
                type: 1
            }]
        }));

        assert.deepEqual(changes, []);
    });

    it('applies Control.OverTemp SET for channel 0', () => {
        const { trait, changes } = createHarness();

        trait.handlePush(pushMessage(CONTROL_OVERTEMP_NAMESPACE, {
            overTemp: {
                value: 1,
                timestamp: 42,
                type: 1
            }
        }, 'SET'));

        assert.equal(trait.isActive(), true);
        assert.equal(trait.getTimestamp(), 42);
        assert.equal(trait.getType(), 1);
        assert.deepEqual(changes, [{ active: true, timestamp: 42, type: 1 }]);
    });

    it('applies Control.OverTemp SET type 2 when the relay is shut down', () => {
        const { trait, changes } = createHarness();

        trait.handlePush(pushMessage(CONTROL_OVERTEMP_NAMESPACE, {
            overTemp: {
                value: 1,
                timestamp: 42,
                type: 2
            }
        }, 'SET'));

        assert.equal(trait.isActive(), true);
        assert.equal(trait.getType(), 2);
        assert.deepEqual(changes, [{ active: true, timestamp: 42, type: 2 }]);
    });
});
