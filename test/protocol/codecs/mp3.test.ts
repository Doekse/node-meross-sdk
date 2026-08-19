import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ProtocolError } from '../../../src/errors';
import {
    decodeMp3GetAck,
    decodeMp3Push,
    encodeMp3Get,
    encodeMp3Set
} from '../../../src/protocol/codecs/mp3';

describe('Control.Mp3 codec', () => {
    it('encodes GET with channel', () => {
        assert.deepEqual(encodeMp3Get({ channel: 0 }), { mp3: { channel: 0 } });
    });

    it('encodes SET with only the supplied fields', () => {
        assert.deepEqual(encodeMp3Set({ channel: 0, muted: true }), {
            mp3: { channel: 0, mute: 1 }
        });
        assert.deepEqual(encodeMp3Set({ channel: 0, volume: 11, song: 9 }), {
            mp3: { channel: 0, volume: 11, song: 9 }
        });
    });

    it('decodes a GETACK object', () => {
        const decoded = decodeMp3GetAck({
            mp3: { channel: 0, lmTime: 1630691532, song: 9, mute: 1, volume: 11 }
        });
        assert.equal(decoded.channel, 0);
        assert.equal(decoded.muted, true);
        assert.equal(decoded.volume, 11);
        assert.equal(decoded.song, 9);
    });

    it('uses PUSH decoder interchangeably with GETACK', () => {
        const payload = { mp3: { channel: 0, mute: 0, volume: 6, song: 1 } };
        assert.deepEqual(decodeMp3Push(payload), decodeMp3GetAck(payload));
    });

    it('rejects a missing mp3 object', () => {
        assert.throws(() => decodeMp3GetAck({}), ProtocolError);
    });
});
