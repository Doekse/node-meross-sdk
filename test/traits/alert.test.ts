import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Endpoint } from '../../src/endpoint';
import { MerossError, TransportError } from '../../src/errors';
import {
    CONTROL_ALERT_CONFIG_NAMESPACE,
    CONTROL_ALERT_REPORT_NAMESPACE,
    encodeAlertConfigGet,
    encodeAlertConfigSet,
    encodeMessage,
    type MerossMessage
} from '../../src/protocol';
import { AlertTrait } from '../../src/traits/alert';
import type { AlertTraitBind, AlertValues } from '../../src/traits/alert';
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
    trait: AlertTrait;
    requests: MerossMessage[];
    changes: AlertValues[];
} {
    const channel = options.channel ?? CHANNEL;
    const changes: AlertValues[] = [];
    const endpoint = new Endpoint({ id: `${UUID}:${channel}`, traits: ['alert'] });
    const { requests, request } = createRequestRecorder({
        uuid: UUID,
        key: KEY,
        ack: options.ack ?? ((_opts, sent) => traitAck(sent, {
            key: KEY,
            method: 'GETACK',
            payload: {
                config: [{
                    channel,
                    type: 1,
                    value: { em06: { threshold: 10 } }
                }]
            }
        }))
    });
    const bind: AlertTraitBind = {
        channel,
        namespaces: options.namespaces ?? new Set([
            CONTROL_ALERT_CONFIG_NAMESPACE,
            CONTROL_ALERT_REPORT_NAMESPACE
        ]),
        request,
        emitChange: (values) => {
            changes.push({ ...values });
            endpoint.emit('change', { trait: 'alert', values: { ...values } });
        }
    };
    return { trait: new AlertTrait(bind), requests, changes };
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

describe('AlertTrait', () => {
    it('poll GETs this channel, applies, and returns a snapshot', async () => {
        const { trait, requests, changes } = createHarness();

        const snapshot = await trait.poll();

        assert.deepEqual(recordedCalls(requests), [{
            namespace: CONTROL_ALERT_CONFIG_NAMESPACE,
            method: 'GET',
            payload: encodeAlertConfigGet(CHANNEL)
        }]);
        assert.equal(trait.getType(), 1);
        assert.deepEqual(trait.getValue(), { em06: { threshold: 10 } });
        assert.deepEqual(snapshot, { type: 1, value: { em06: { threshold: 10 } } });
        assert.deepEqual(changes, [{ type: 1, value: { em06: { threshold: 10 } } }]);
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
        assert.equal(trait.getType(), undefined);
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
            namespace: CONTROL_ALERT_CONFIG_NAMESPACE,
            method: 'GET',
            payload: encodeAlertConfigGet(CHANNEL)
        }]);
        assert.equal(trait.getType(), undefined);
    });

    it('SETs AlertConfig value shapes (em06 / mts300) and emits change', async () => {
        const cases = [
            { type: 1, value: { em06: { threshold: 10 } } },
            { type: 5, value: { mts300: { hcMal: 1, auxLO: 1, auxLOT: 240 } } }
        ];

        for (const options of cases) {
            const { trait, requests, changes } = createHarness();
            await trait.set(options);
            assert.deepEqual(recordedCalls(requests), [{
                namespace: CONTROL_ALERT_CONFIG_NAMESPACE,
                method: 'SET',
                payload: encodeAlertConfigSet({ channel: CHANNEL, ...options })
            }]);
            assert.deepEqual(changes, [options]);
        }
    });

    it('throws NAMESPACE_NOT_ADVERTISED when AlertConfig is absent', async () => {
        const { trait, requests } = createHarness({ namespaces: new Set() });

        await assert.rejects(
            () => trait.set({ type: 1 }),
            (error: unknown) => error instanceof MerossError
                && error.code === 'NAMESPACE_NOT_ADVERTISED'
        );
        assert.equal(requests.length, 0);
    });

    it('applies AlertConfig PUSH for the bound channel', () => {
        const { trait, changes } = createHarness();

        trait.handlePush(pushMessage(CONTROL_ALERT_CONFIG_NAMESPACE, {
            config: [{ channel: CHANNEL, type: 3, value: { em06: { a: 1 } } }]
        }));

        assert.deepEqual(changes, [{
            type: 3,
            value: { em06: { a: 1 } }
        }]);
    });

    it('ignores AlertConfig PUSH for other channels', () => {
        const { trait, changes } = createHarness();

        trait.handlePush(pushMessage(CONTROL_ALERT_CONFIG_NAMESPACE, {
            config: [{ channel: 1, type: 3, value: { em06: { a: 1 } } }]
        }));

        assert.deepEqual(changes, []);
    });

    it('does not emit change when AlertConfig PUSH repeats', () => {
        const { trait, changes } = createHarness();
        const message = pushMessage(CONTROL_ALERT_CONFIG_NAMESPACE, {
            config: [{ channel: CHANNEL, type: 3, value: { em06: { a: 1 } } }]
        });

        trait.handlePush(message);
        trait.handlePush(message);

        assert.equal(changes.length, 1);
    });

    it('ignores soft-decode AlertReport PUSH (malformed or empty)', () => {
        const { trait, changes } = createHarness();

        trait.handlePush(pushMessage(CONTROL_ALERT_REPORT_NAMESPACE, {
            alert: { not: 'a list' }
        }));
        trait.handlePush(pushMessage(CONTROL_ALERT_REPORT_NAMESPACE, {}));

        assert.deepEqual(changes, []);
    });

    it('applies AlertReport PUSH for the bound channel', () => {
        const { trait, changes } = createHarness();

        trait.handlePush(pushMessage(CONTROL_ALERT_REPORT_NAMESPACE, {
            alert: [{ channel: CHANNEL, code: 4 }]
        }));

        assert.equal(trait.getReport()?.code, 4);
        assert.deepEqual(changes, [{ report: { code: 4 } }]);
    });

    it('ignores AlertReport PUSH for other channels', () => {
        const { trait, changes } = createHarness();

        trait.handlePush(pushMessage(CONTROL_ALERT_REPORT_NAMESPACE, {
            alert: [{ channel: 1, code: 4 }]
        }));

        assert.deepEqual(changes, []);
    });
});
