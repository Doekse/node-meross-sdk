import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Endpoint } from '../../src/endpoint';
import { MerossError } from '../../src/errors';
import {
    CONTROL_TIMER_NAMESPACE,
    DIGEST_TIMERX_NAMESPACE,
    TIMERX_NAMESPACE,
    encodeMessage,
    type MerossMessage
} from '../../src/protocol';
import { TimerTrait } from '../../src/traits/timer';
import type { TimerGeneration, TimerTraitBind } from '../../src/traits/timer';
import { createRequestRecorder, traitAck } from '../helpers/request';

const KEY = 'stub-key';
const UUID = '2201201075575151809248e1e988531b';
const CHANNEL = 0;

const WIRE_ENTRY = {
    week: 159,
    channel: CHANNEL,
    type: 1,
    sunOffset: 0,
    duration: 0,
    extend: { toggle: { onoff: 1, lmTime: 0 } },
    createTime: 1658821809,
    enable: 1,
    alias: 'Toilet open',
    id: 'wf3d4ewfeh7ld2pr',
    time: 1110
};

const HOST_ENTRY = {
    id: 'wf3d4ewfeh7ld2pr',
    channel: CHANNEL,
    alias: 'Toilet open',
    enabled: true,
    type: 1,
    time: 1110,
    week: 159,
    duration: 0,
    sunOffset: 0,
    createTime: 1658821809,
    on: true
};

function createHarness(options: {
    getAck?: Record<string, unknown>;
    namespaces?: ReadonlySet<string>;
    generation?: TimerGeneration;
} = {}): {
    trait: TimerTrait;
    requests: MerossMessage[];
    changes: Record<string, unknown>[];
} {
    const changes: Record<string, unknown>[] = [];
    const generation = options.generation ?? 'x';
    const endpoint = new Endpoint({ id: `${UUID}:${CHANNEL}`, traits: ['timer'] });
    const namespaces = options.namespaces ?? new Set(
        generation === 'legacy'
            ? [CONTROL_TIMER_NAMESPACE]
            : [TIMERX_NAMESPACE, DIGEST_TIMERX_NAMESPACE]
    );
    const { requests, request } = createRequestRecorder({
        uuid: UUID,
        key: KEY,
        ack: (requestOptions, sent) => {
            if (requestOptions.namespace === DIGEST_TIMERX_NAMESPACE) {
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
                    payload: options.getAck ?? { timerx: WIRE_ENTRY }
                });
            }
            return traitAck(sent, { key: KEY });
        }
    });
    const bind: TimerTraitBind = {
        uuid: UUID,
        channel: CHANNEL,
        generation,
        namespaces,
        request,
        emitChange: (values) => {
            changes.push({ ...values });
            endpoint.emit('change', { trait: 'timer', values: { ...values } });
        }
    };
    return { trait: new TimerTrait(bind), requests, changes };
}

async function flush(): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
}

function pushMessage(payload: Record<string, unknown>): MerossMessage {
    return encodeMessage({
        namespace: TIMERX_NAMESPACE,
        method: 'PUSH',
        key: KEY,
        from: `/appliance/${UUID}/publish`,
        uuid: UUID,
        payload
    });
}

function digestGetAck(digest: Array<Record<string, unknown>>): MerossMessage {
    return encodeMessage({
        namespace: DIGEST_TIMERX_NAMESPACE,
        method: 'GETACK',
        key: KEY,
        from: `/appliance/${UUID}/publish`,
        uuid: UUID,
        payload: { digest }
    });
}

/** DevicePoller GETACK path: Digest resolve then Control.TimerX GET-by-id. */
async function seedFromDigest(
    trait: TimerTrait,
    digest: Array<Record<string, unknown>> = [{ channel: CHANNEL, id: WIRE_ENTRY.id, count: 1 }]
): Promise<void> {
    trait.handlePush(digestGetAck(digest));
    await flush();
}

describe('TimerTrait', () => {
    it('resolves GET by id from Digest GETACK', async () => {
        const { trait, requests, changes } = createHarness();

        await seedFromDigest(trait);
        assert.equal(requests[0]?.header.namespace, TIMERX_NAMESPACE);
        assert.deepEqual(requests[0]?.payload, { timerx: { id: WIRE_ENTRY.id } });
        assert.deepEqual(trait.list(), [HOST_ENTRY]);
        assert.equal((changes[0]?.entries as unknown[])?.length, 1);
    });

    it('list stays empty when Digest.TimerX is not advertised', () => {
        const { trait } = createHarness({
            namespaces: new Set([TIMERX_NAMESPACE])
        });
        assert.deepEqual(trait.list(), []);
    });

    it('each channel resolves its own Digest ids after a shared Digest GETACK', async () => {
        const namespaces = new Set([TIMERX_NAMESPACE, DIGEST_TIMERX_NAMESPACE]);
        const { requests, request } = createRequestRecorder({
            uuid: UUID,
            key: KEY,
            ack: (requestOptions, sent) => {
                const raw = requestOptions.payload?.timerx;
                const id = typeof raw === 'object' && raw !== null && typeof (raw as { id?: unknown }).id === 'string'
                    ? (raw as { id: string }).id
                    : WIRE_ENTRY.id;
                const channel = id === 'timer-ch1' ? 1 : 0;
                return traitAck(sent, {
                    key: KEY,
                    method: 'GETACK',
                    payload: {
                        timerx: { ...WIRE_ENTRY, id, channel }
                    }
                });
            }
        });
        const trait0 = new TimerTrait({
            uuid: UUID,
            channel: 0,
            generation: 'x',
            namespaces,
            request,
            emitChange: () => {}
        });
        const trait1 = new TimerTrait({
            uuid: UUID,
            channel: 1,
            generation: 'x',
            namespaces,
            request,
            emitChange: () => {}
        });

        const digest = digestGetAck([
            { channel: 0, id: 'timer-ch0', count: 1 },
            { channel: 1, id: 'timer-ch1', count: 1 }
        ]);
        trait0.handlePush(digest);
        trait1.handlePush(digest);
        await flush();
        await flush();

        assert.equal(
            requests.filter((message) => message.header.namespace === DIGEST_TIMERX_NAMESPACE).length,
            0
        );
        assert.equal(trait0.list()[0]?.id, 'timer-ch0');
        assert.equal(trait1.list()[0]?.id, 'timer-ch1');
    });

    it('set SETs a toggle-shaped timerx object and updates the list', async () => {
        const { trait, requests, changes } = createHarness({ getAck: { timerx: [] } });
        const entry = await trait.set({
            id: '14z2y0cwdi5d64vf',
            alias: 'Fan off',
            time: 720,
            week: 255,
            on: false,
            createTime: 1673168351
        });
        assert.equal(requests[0]?.header.method, 'SET');
        assert.deepEqual(requests[0]?.payload, {
            timerx: {
                id: '14z2y0cwdi5d64vf',
                channel: CHANNEL,
                type: 1,
                time: 720,
                week: 255,
                duration: 0,
                sunOffset: 0,
                enable: 1,
                alias: 'Fan off',
                createTime: 1673168351,
                extend: { toggle: { onoff: 0, lmTime: 0 } }
            }
        });
        assert.equal(entry.on, false);
        assert.equal(trait.list().length, 1);
        assert.deepEqual(changes[0], { entries: trait.list() });
    });

    it('setEnabled SETs enable from a cached entry', async () => {
        const { trait, requests } = createHarness();
        await seedFromDigest(trait);
        requests.length = 0;
        await trait.setEnabled(HOST_ENTRY.id, false);
        assert.equal(requests[0]?.header.method, 'SET');
        assert.equal((requests[0]?.payload.timerx as { enable: number }).enable, 0);
        assert.equal(trait.list()[0]?.enabled, false);
    });

    it('setEnabled throws when the id is unknown', async () => {
        const { trait } = createHarness({ getAck: { timerx: [] } });
        await assert.rejects(
            () => trait.setEnabled('missing', true),
            (error: unknown) => error instanceof MerossError && error.code === 'TIMER_NOT_FOUND'
        );
    });

    it('remove DELETEs by id and drops the local row without waiting for PUSH', async () => {
        const { trait, requests, changes } = createHarness();
        await seedFromDigest(trait);
        changes.length = 0;
        requests.length = 0;
        await trait.remove(HOST_ENTRY.id);
        assert.equal(requests[0]?.header.method, 'DELETE');
        assert.deepEqual(requests[0]?.payload, { timerx: { id: HOST_ENTRY.id } });
        assert.deepEqual(trait.list(), []);
        assert.deepEqual(changes[0], { entries: [] });
    });

    it('handlePush upserts this channel only', () => {
        const { trait, changes } = createHarness({ getAck: { timerx: [] } });
        trait.handlePush(pushMessage({
            timerx: [
                {
                    ...WIRE_ENTRY,
                    id: '50d64c3bd2b391b0',
                    alias: 'patio Lights off',
                    time: 1290,
                    week: 255,
                    extend: { toggle: { onoff: 0, lmTime: 0 } }
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
        assert.equal(trait.list()[0]?.on, false);
        assert.equal((changes[0]?.entries as unknown[])?.length, 1);
    });

    it('handlePush does not emit when the list is unchanged', async () => {
        const { trait, changes } = createHarness();
        await seedFromDigest(trait);
        changes.length = 0;
        trait.handlePush(pushMessage({ timerx: [WIRE_ENTRY] }));
        assert.equal(changes.length, 0);
    });

});

describe('TimerTrait legacy Control.Timer', () => {
    const LEGACY_WIRE = {
        id: 'abcdefghijklm123',
        type: 1,
        enable: 1,
        alias: 'on 20:52',
        time: 1252,
        week: 129,
        duration: 0,
        createTime: 1560513180,
        extend: { toggle: { onoff: 1, lmTime: 0 } }
    };

    it('applies Control.Timer GETACK for this device', () => {
        const { trait, changes } = createHarness({ generation: 'legacy' });

        trait.handlePush(encodeMessage({
            namespace: CONTROL_TIMER_NAMESPACE,
            method: 'GETACK',
            key: KEY,
            from: `/appliance/${UUID}/publish`,
            uuid: UUID,
            payload: { timer: [LEGACY_WIRE] }
        }));

        assert.equal(trait.list().length, 1);
        assert.equal(trait.list()[0]?.id, LEGACY_WIRE.id);
        assert.equal(trait.list()[0]?.on, true);
        assert.equal(changes.length, 1);
    });


    it('set SETs the full Control.Timer list including the new entry', async () => {
        const { trait, requests } = createHarness({ generation: 'legacy' });
        trait.handlePush(encodeMessage({
            namespace: CONTROL_TIMER_NAMESPACE,
            method: 'GETACK',
            key: KEY,
            from: `/appliance/${UUID}/publish`,
            uuid: UUID,
            payload: { timer: [LEGACY_WIRE] }
        }));
        requests.length = 0;

        await trait.set({
            id: 'newtimer1',
            alias: 'Fan off',
            time: 720,
            week: 255,
            on: false,
            createTime: 1673168351
        });

        assert.equal(requests[0]?.header.namespace, CONTROL_TIMER_NAMESPACE);
        assert.equal(requests[0]?.header.method, 'SET');
        const setList = requests[0]?.payload.timer as Array<{ id: string }>;
        assert.equal(setList.length, 2);
        assert.ok(setList.some((entry) => entry.id === LEGACY_WIRE.id));
        assert.ok(setList.some((entry) => entry.id === 'newtimer1'));
    });

    it('remove SETs Control.Timer without the deleted id', async () => {
        const { trait, requests } = createHarness({ generation: 'legacy' });
        trait.handlePush(encodeMessage({
            namespace: CONTROL_TIMER_NAMESPACE,
            method: 'GETACK',
            key: KEY,
            from: `/appliance/${UUID}/publish`,
            uuid: UUID,
            payload: {
                timer: [
                    LEGACY_WIRE,
                    { ...LEGACY_WIRE, id: 'newtimer1', alias: 'Fan off', time: 720, week: 255 }
                ]
            }
        }));
        requests.length = 0;

        await trait.remove(LEGACY_WIRE.id);

        assert.equal(requests[0]?.header.method, 'SET');
        assert.deepEqual(
            (requests[0]?.payload.timer as Array<{ id: string }>).map((entry) => entry.id),
            ['newtimer1']
        );
        assert.deepEqual(trait.list().map((entry) => entry.id), ['newtimer1']);
    });

    it('does not emit when GETACK list is unchanged', () => {
        const { trait, changes } = createHarness({ generation: 'legacy' });
        const ack = encodeMessage({
            namespace: CONTROL_TIMER_NAMESPACE,
            method: 'GETACK',
            key: KEY,
            from: `/appliance/${UUID}/publish`,
            uuid: UUID,
            payload: { timer: [LEGACY_WIRE] }
        });
        trait.handlePush(ack);
        changes.length = 0;
        trait.handlePush(ack);
        assert.equal(changes.length, 0);
    });
});

