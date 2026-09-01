import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Endpoint } from '../../src/endpoint';
import { MerossError } from '../../src/errors';
import {
    CONTROL_TRIGGER_NAMESPACE,
    DIGEST_TRIGGERX_NAMESPACE,
    TRIGGERX_NAMESPACE,
    encodeMessage,
    type MerossMessage
} from '../../src/protocol';
import { TriggerTrait } from '../../src/traits/trigger';
import type { TriggerGeneration, TriggerTraitBind } from '../../src/traits/trigger';
import { createRequestRecorder, traitAck } from '../helpers/request';

const KEY = 'stub-key';
const UUID = '2201201075575151809248e1e988531b';
const CHANNEL = 0;

const WIRE_ENTRY = {
    type: 0,
    rule: {
        week: 136,
        duration: 9600
    },
    id: '3lewklurxp2eqnza',
    enable: 1,
    createTime: 1675675346,
    channel: CHANNEL,
    alias: 'stop'
};

const HOST_ENTRY = {
    id: '3lewklurxp2eqnza',
    channel: CHANNEL,
    alias: 'stop',
    enabled: true,
    type: 0,
    createTime: 1675675346,
    rule: { duration: 9600, week: 136 }
};

function createHarness(options: {
    getAck?: Record<string, unknown>;
    namespaces?: ReadonlySet<string>;
    generation?: TriggerGeneration;
} = {}): {
    trait: TriggerTrait;
    requests: MerossMessage[];
    changes: Record<string, unknown>[];
} {
    const changes: Record<string, unknown>[] = [];
    const generation = options.generation ?? 'x';
    const endpoint = new Endpoint({ id: `${UUID}:${CHANNEL}`, traits: ['trigger'] });
    const namespaces = options.namespaces ?? new Set(
        generation === 'legacy'
            ? [CONTROL_TRIGGER_NAMESPACE]
            : [TRIGGERX_NAMESPACE, DIGEST_TRIGGERX_NAMESPACE]
    );
    const { requests, request } = createRequestRecorder({
        uuid: UUID,
        key: KEY,
        ack: (requestOptions, sent) => {
            if (requestOptions.namespace === DIGEST_TRIGGERX_NAMESPACE) {
                return traitAck(sent, {
                    key: KEY,
                    method: 'GETACK',
                    payload: {
                        digest: [{ channel: CHANNEL, id: WIRE_ENTRY.id, count: 1 }]
                    }
                });
            }
            if (requestOptions.method === 'GET') {
                return traitAck(sent, {
                    key: KEY,
                    method: 'GETACK',
                    payload: options.getAck ?? { triggerx: WIRE_ENTRY }
                });
            }
            return traitAck(sent, { key: KEY });
        }
    });
    const bind: TriggerTraitBind = {
        uuid: UUID,
        channel: CHANNEL,
        generation,
        namespaces,
        request,
        emitChange: (values) => {
            changes.push({ ...values });
            endpoint.emit('change', { trait: 'trigger', values: { ...values } });
        }
    };
    return { trait: new TriggerTrait(bind), requests, changes };
}

async function flush(): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
}

function pushMessage(payload: Record<string, unknown>): MerossMessage {
    return encodeMessage({
        namespace: TRIGGERX_NAMESPACE,
        method: 'PUSH',
        key: KEY,
        from: `/appliance/${UUID}/publish`,
        uuid: UUID,
        payload
    });
}

function digestGetAck(digest: Array<Record<string, unknown>>): MerossMessage {
    return encodeMessage({
        namespace: DIGEST_TRIGGERX_NAMESPACE,
        method: 'GETACK',
        key: KEY,
        from: `/appliance/${UUID}/publish`,
        uuid: UUID,
        payload: { digest }
    });
}

/** DevicePoller GETACK path: Digest resolve then Control.TriggerX GET-by-id. */
async function seedFromDigest(
    trait: TriggerTrait,
    digest: Array<Record<string, unknown>> = [{ channel: CHANNEL, id: WIRE_ENTRY.id, count: 1 }]
): Promise<void> {
    trait.handlePush(digestGetAck(digest));
    await flush();
}

describe('TriggerTrait', () => {
    it('resolves GET by id from Digest GETACK', async () => {
        const { trait, requests, changes } = createHarness();

        await seedFromDigest(trait);
        assert.equal(requests[0]?.header.namespace, TRIGGERX_NAMESPACE);
        assert.deepEqual(requests[0]?.payload, { triggerx: { id: WIRE_ENTRY.id } });
        assert.deepEqual(trait.list(), [HOST_ENTRY]);
        assert.equal((changes[0]?.entries as unknown[])?.length, 1);
    });

    it('list stays empty when Digest.TriggerX is not advertised', () => {
        const { trait } = createHarness({
            namespaces: new Set([TRIGGERX_NAMESPACE])
        });
        assert.deepEqual(trait.list(), []);
    });

    it('each channel resolves its own Digest ids after a shared Digest GETACK', async () => {
        const namespaces = new Set([TRIGGERX_NAMESPACE, DIGEST_TRIGGERX_NAMESPACE]);
        const { requests, request } = createRequestRecorder({
            uuid: UUID,
            key: KEY,
            ack: (requestOptions, sent) => {
                const raw = requestOptions.payload?.triggerx;
                const id = typeof raw === 'object' && raw !== null && typeof (raw as { id?: unknown }).id === 'string'
                    ? (raw as { id: string }).id
                    : WIRE_ENTRY.id;
                const channel = id === 'trigger-ch1' ? 1 : 0;
                return traitAck(sent, {
                    key: KEY,
                    method: 'GETACK',
                    payload: {
                        triggerx: { ...WIRE_ENTRY, id, channel }
                    }
                });
            }
        });
        const trait0 = new TriggerTrait({
            uuid: UUID,
            channel: 0,
            generation: 'x',
            namespaces,
            request,
            emitChange: () => {}
        });
        const trait1 = new TriggerTrait({
            uuid: UUID,
            channel: 1,
            generation: 'x',
            namespaces,
            request,
            emitChange: () => {}
        });

        const digest = digestGetAck([
            { channel: 0, id: 'trigger-ch0', count: 1 },
            { channel: 1, id: 'trigger-ch1', count: 1 }
        ]);
        trait0.handlePush(digest);
        trait1.handlePush(digest);
        await flush();
        await flush();

        assert.equal(
            requests.filter((message) => message.header.namespace === DIGEST_TRIGGERX_NAMESPACE).length,
            0
        );
        assert.equal(trait0.list()[0]?.id, 'trigger-ch0');
        assert.equal(trait1.list()[0]?.id, 'trigger-ch1');
    });

    it('set SETs a triggerx object with rule and updates the list', async () => {
        const { trait, requests, changes } = createHarness({ getAck: { triggerx: [] } });
        const entry = await trait.set({
            id: 'qm7n5caqxjapjfh5',
            alias: 'Apagado pergola',
            createTime: 1614716670,
            rule: { duration: 46800, week: 255 }
        });
        assert.equal(requests[0]?.header.method, 'SET');
        assert.deepEqual(requests[0]?.payload, {
            triggerx: {
                id: 'qm7n5caqxjapjfh5',
                channel: CHANNEL,
                type: 1,
                enable: 1,
                alias: 'Apagado pergola',
                createTime: 1614716670,
                rule: { duration: 46800, week: 255 }
            }
        });
        assert.equal(entry.rule.duration, 46800);
        assert.equal(trait.list().length, 1);
        assert.deepEqual(changes[0], { entries: trait.list() });
    });

    it('setEnabled SETs enable from a cached entry', async () => {
        const { trait, requests } = createHarness();
        await seedFromDigest(trait);
        requests.length = 0;
        await trait.setEnabled(HOST_ENTRY.id, false);
        assert.equal(requests[0]?.header.method, 'SET');
        assert.equal((requests[0]?.payload.triggerx as { enable: number }).enable, 0);
        assert.equal(trait.list()[0]?.enabled, false);
    });

    it('setEnabled throws when the id is unknown', async () => {
        const { trait } = createHarness({ getAck: { triggerx: [] } });
        await assert.rejects(
            () => trait.setEnabled('missing', true),
            (error: unknown) => error instanceof MerossError && error.code === 'TRIGGER_NOT_FOUND'
        );
    });

    it('remove DELETEs by id and drops the local row without waiting for PUSH', async () => {
        const { trait, requests, changes } = createHarness();
        await seedFromDigest(trait);
        changes.length = 0;
        requests.length = 0;
        await trait.remove(HOST_ENTRY.id);
        assert.equal(requests[0]?.header.method, 'DELETE');
        assert.deepEqual(requests[0]?.payload, { triggerx: { id: HOST_ENTRY.id } });
        assert.deepEqual(trait.list(), []);
        assert.deepEqual(changes[0], { entries: [] });
    });

    it('handlePush upserts this channel only', () => {
        const { trait, changes } = createHarness({ getAck: { triggerx: [] } });
        trait.handlePush(pushMessage({
            triggerx: [
                {
                    ...WIRE_ENTRY,
                    id: '50d64c3bd2b391b0',
                    alias: 'patio off',
                    rule: { duration: 1800, week: 255 }
                },
                {
                    ...WIRE_ENTRY,
                    channel: 1,
                    id: 'other-channel'
                }
            ]
        }));
        assert.equal(trait.list().length, 1);
        assert.equal(trait.list()[0]?.id, '50d64c3bd2b391b0');
        assert.equal(trait.list()[0]?.rule.duration, 1800);
        assert.equal((changes[0]?.entries as unknown[])?.length, 1);
    });

    it('handlePush does not emit when the list is unchanged', async () => {
        const { trait, changes } = createHarness();
        await seedFromDigest(trait);
        changes.length = 0;
        trait.handlePush(pushMessage({ triggerx: [WIRE_ENTRY] }));
        assert.equal(changes.length, 0);
    });

});

describe('TriggerTrait legacy Control.Trigger', () => {
    const LEGACY_WIRE = {
        id: 'abcdefghijklm123',
        type: 0,
        enable: 1,
        alias: 'test auto off',
        createTime: 1560513139,
        rule: {
            _if_: { toggle: { onoff: 1, lmTime: 0 } },
            _then_: { delay: { week: 129, duration: 69300 } },
            _do_: { toggle: { onoff: 0, lmTime: 0 } }
        }
    };

    it('applies Control.Trigger GETACK with a flattened rule', () => {
        const { trait, changes } = createHarness({ generation: 'legacy' });

        trait.handlePush(encodeMessage({
            namespace: CONTROL_TRIGGER_NAMESPACE,
            method: 'GETACK',
            key: KEY,
            from: `/appliance/${UUID}/publish`,
            uuid: UUID,
            payload: { trigger: [LEGACY_WIRE] }
        }));

        assert.deepEqual(trait.list()[0]?.rule, { duration: 69300, week: 129 });
        assert.equal(changes.length, 1);
    });


    it('set SETs expanded legacy rules including the new entry', async () => {
        const { trait, requests } = createHarness({ generation: 'legacy' });
        trait.handlePush(encodeMessage({
            namespace: CONTROL_TRIGGER_NAMESPACE,
            method: 'GETACK',
            key: KEY,
            from: `/appliance/${UUID}/publish`,
            uuid: UUID,
            payload: { trigger: [LEGACY_WIRE] }
        }));
        requests.length = 0;

        await trait.set({
            id: 'newtrig1',
            alias: 'auto off',
            rule: { duration: 900, week: 255 },
            createTime: 1673168351
        });

        assert.equal(requests[0]?.header.namespace, CONTROL_TRIGGER_NAMESPACE);
        const setList = requests[0]?.payload.trigger as Array<{
            id: string;
            rule: { _then_: { delay: { duration: number } } };
        }>;
        assert.equal(setList.length, 2);
        const created = setList.find((entry) => entry.id === 'newtrig1');
        assert.equal(created?.rule._then_.delay.duration, 900);
    });

    it('remove SETs Control.Trigger without the deleted id', async () => {
        const { trait, requests } = createHarness({ generation: 'legacy' });
        trait.handlePush(encodeMessage({
            namespace: CONTROL_TRIGGER_NAMESPACE,
            method: 'GETACK',
            key: KEY,
            from: `/appliance/${UUID}/publish`,
            uuid: UUID,
            payload: {
                trigger: [
                    LEGACY_WIRE,
                    { ...LEGACY_WIRE, id: 'newtrig1', alias: 'auto off' }
                ]
            }
        }));
        requests.length = 0;

        await trait.remove(LEGACY_WIRE.id);

        assert.deepEqual(
            (requests[0]?.payload.trigger as Array<{ id: string }>).map((entry) => entry.id),
            ['newtrig1']
        );
    });
});

