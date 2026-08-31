import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Endpoint } from '../../src/endpoint';
import {
    MP3_NAMESPACE,
    encodeMessage,
    type MerossMessage
} from '../../src/protocol';
import { MediaTrait } from '../../src/traits/media';
import type { MediaTraitBind } from '../../src/traits/media';
import { createRequestRecorder, traitAck } from '../helpers/request';

const KEY = 'stub-key';
const UUID = '2206138957096651080248e1e99705a4';
const CHANNEL = 0;

function createHarness(): {
    trait: MediaTrait;
    requests: MerossMessage[];
    changes: Record<string, unknown>[];
} {
    const changes: Record<string, unknown>[] = [];
    const endpoint = new Endpoint({ id: `${UUID}:${CHANNEL}`, traits: ['media'] });
    const { requests, request } = createRequestRecorder({
        uuid: UUID,
        key: KEY,
        ack: (options, sent) => traitAck(sent, {
            key: KEY,
            payload: options.method === 'GET'
                ? { mp3: { channel: CHANNEL, song: 9, mute: 1, volume: 8 } }
                : {}
        })
    });
    const bind: MediaTraitBind = {
        uuid: UUID,
        channel: CHANNEL,
        request,
        emitChange: (values) => {
            changes.push({ ...values });
            endpoint.emit('change', { trait: 'media', values: { ...values } });
        }
    };
    return { trait: new MediaTrait(bind), requests, changes };
}

function pushMessage(payload: Record<string, unknown>): MerossMessage {
    return encodeMessage({
        namespace: MP3_NAMESPACE,
        method: 'PUSH',
        key: KEY,
        from: `/appliance/${UUID}/publish`,
        uuid: UUID,
        payload
    });
}

describe('MediaTrait', () => {
    it('handlePush scales volume 0..1', () => {
        const { trait, changes } = createHarness();
        trait.handlePush(pushMessage({
            mp3: { channel: CHANNEL, mute: 1, volume: 8, song: 9 }
        }));
        assert.equal(trait.isMuted(), true);
        assert.equal(trait.getVolume(), 0.5);
        assert.equal(trait.getSong(), 9);
        assert.deepEqual(changes[0], { muted: true, volume: 0.5, song: 9 });
    });

    it('setMuted writes mute 0/1', async () => {
        const { trait, requests } = createHarness();
        await trait.setMuted(false);
        assert.deepEqual(requests[0]?.payload, { mp3: { channel: CHANNEL, mute: 0 } });
        assert.equal(trait.isMuted(), false);
    });

    it('setVolume writes 0–16', async () => {
        const { trait, requests } = createHarness();
        await trait.setVolume(0.5);
        assert.deepEqual(requests[0]?.payload, { mp3: { channel: CHANNEL, volume: 8 } });
        assert.equal(trait.getVolume(), 0.5);
    });

    it('setSong writes the track id', async () => {
        const { trait, requests } = createHarness();
        await trait.setSong(3);
        assert.deepEqual(requests[0]?.payload, { mp3: { channel: CHANNEL, song: 3 } });
        assert.equal(trait.getSong(), 3);
    });

    it('handlePush applies this channel only', () => {
        const { trait, changes } = createHarness();
        trait.handlePush(pushMessage({
            mp3: { channel: CHANNEL, mute: 0, volume: 16, song: 2 }
        }));
        assert.equal(trait.isMuted(), false);
        assert.equal(trait.getVolume(), 1);
        assert.equal(trait.getSong(), 2);
        assert.deepEqual(changes[0], { muted: false, volume: 1, song: 2 });
    });

    it('ignores PUSH for a different channel', () => {
        const { trait, changes } = createHarness();
        trait.handlePush(pushMessage({
            mp3: { channel: 1, mute: 0, volume: 16, song: 2 }
        }));
        assert.equal(changes.length, 0);
    });

    it('ignores PUSH when uuid does not match the bind', () => {
        const { trait, changes } = createHarness();
        trait.handlePush(encodeMessage({
            namespace: MP3_NAMESPACE,
            method: 'PUSH',
            key: KEY,
            from: '/appliance/other/publish',
            uuid: 'other',
            payload: { mp3: { channel: CHANNEL, mute: 0, volume: 16, song: 2 } }
        }));
        assert.equal(changes.length, 0);
    });
});
