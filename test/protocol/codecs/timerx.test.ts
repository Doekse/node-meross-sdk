import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ProtocolError } from '../../../src/errors';
import {
    decodeControlTimerGetAck,
    decodeDigestTimerXGetAck,
    decodeTimerXGetAck,
    decodeTimerXPush,
    encodeControlTimerGet,
    encodeControlTimerSet,
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

    it('decodes a GETACK object as a one-entry list', () => {
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
    });

    it('decodes a PUSH array of timer rows', () => {
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

describe('Control.Timer codec', () => {
    const LEGACY = {
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

    it('encodes GET as an empty timer list', () => {
        assert.deepEqual(encodeControlTimerGet(), { timer: [] });
    });

    it('encodes SET as a full timer list without channel', () => {
        assert.deepEqual(encodeControlTimerSet([{
            id: 'abcdefghijklm123',
            channel: 0,
            alias: 'on 20:52',
            enabled: true,
            type: 1,
            time: 1252,
            week: 129,
            duration: 0,
            sunOffset: 0,
            createTime: 1560513180,
            on: true
        }]), { timer: [LEGACY] });
    });

    it('decodes GETACK list and defaults channel to 0', () => {
        assert.deepEqual(decodeControlTimerGetAck({ timer: [LEGACY] }), [{
            id: 'abcdefghijklm123',
            channel: 0,
            alias: 'on 20:52',
            enabled: true,
            type: 1,
            time: 1252,
            week: 129,
            duration: 0,
            sunOffset: 0,
            createTime: 1560513180,
            on: true
        }]);
    });

    it('rejects a missing timer payload', () => {
        assert.throws(() => decodeControlTimerGetAck({}), ProtocolError);
    });

    it('rejects a non-array timer payload', () => {
        assert.throws(() => decodeControlTimerGetAck({ timer: {} }), ProtocolError);
    });
});
