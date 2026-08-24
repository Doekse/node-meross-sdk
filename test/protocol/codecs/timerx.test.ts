import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ProtocolError } from '../../../src/errors';
import {
    decodeDigestTimerXGetAck,
    decodeTimerXGetAck,
    decodeTimerXPush,
    encodeDigestTimerXGet,
    encodeTimerXDelete,
    encodeTimerXGet,
    encodeTimerXSet
} from '../../../src/protocol/codecs/timerx';

const SAMPLE = {
    week: 255,
    channel: 0,
    type: 1,
    sunOffset: 0,
    duration: 0,
    extend: { toggle: { lmTime: 0, onoff: 0 } },
    createTime: 1673168351,
    enable: 1,
    alias: 'Fan off',
    id: '14z2y0cwdi5d64vf',
    time: 720
};

describe('Control.TimerX codec', () => {
    it('encodes GET by id', () => {
        assert.deepEqual(encodeTimerXGet({ id: '14z2y0cwdi5d64vf' }), {
            timerx: { id: '14z2y0cwdi5d64vf' }
        });
    });

    it('encodes SET as a single timerx object with toggle extend', () => {
        assert.deepEqual(encodeTimerXSet({
            id: '14z2y0cwdi5d64vf',
            channel: 0,
            alias: 'Fan off',
            enabled: true,
            type: 1,
            time: 720,
            week: 255,
            duration: 0,
            sunOffset: 0,
            createTime: 1673168351,
            on: false
        }), { timerx: SAMPLE });
    });

    it('encodes DELETE by id', () => {
        assert.deepEqual(encodeTimerXDelete({ id: '2db6a3961fe9bfc2' }), {
            timerx: { id: '2db6a3961fe9bfc2' }
        });
    });

    it('decodes GETACK object and PUSH array payloads', () => {
        assert.deepEqual(decodeTimerXGetAck({ timerx: SAMPLE }), [{
            id: '14z2y0cwdi5d64vf',
            channel: 0,
            alias: 'Fan off',
            enabled: true,
            type: 1,
            time: 720,
            week: 255,
            duration: 0,
            sunOffset: 0,
            createTime: 1673168351,
            on: false
        }]);
        const [entry] = decodeTimerXPush({
            timerx: [{
                ...SAMPLE,
                channel: 1,
                enable: 0,
                extend: { toggle: { onoff: 1, lmTime: 0 } }
            }]
        });
        assert.deepEqual(entry, {
            id: '14z2y0cwdi5d64vf',
            channel: 1,
            alias: 'Fan off',
            enabled: false,
            type: 1,
            time: 720,
            week: 255,
            duration: 0,
            sunOffset: 0,
            createTime: 1673168351,
            on: true
        });
    });

    it('ignores non-toggle extend variants', () => {
        const [entry] = decodeTimerXGetAck({
            timerx: {
                ...SAMPLE,
                extend: {
                    hp110a: { mp3: { mute: 0 } },
                    mrs100: { position: { channel: 1, position: 100 } }
                }
            }
        });
        assert.equal(entry.on, undefined);
    });

    it('rejects a missing timerx payload', () => {
        assert.throws(() => decodeTimerXGetAck({}), ProtocolError);
    });
});

describe('Digest.TimerX codec', () => {
    it('encodes GET as an empty payload', () => {
        assert.deepEqual(encodeDigestTimerXGet(), {});
    });

    it('decodes GETACK digest rows', () => {
        assert.deepEqual(decodeDigestTimerXGetAck({
            digest: [
                { channel: 0, id: '4xtkwostzmam4odd', count: 3 },
                { channel: 1, id: '1y8hk5fzssr8fzbe', count: 1 }
            ]
        }), [
            { channel: 0, id: '4xtkwostzmam4odd', count: 3 },
            { channel: 1, id: '1y8hk5fzssr8fzbe', count: 1 }
        ]);
    });

    it('rejects a missing digest payload', () => {
        assert.throws(() => decodeDigestTimerXGetAck({}), ProtocolError);
    });
});
