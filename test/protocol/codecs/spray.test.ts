import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ProtocolError } from '../../../src/errors';
import {
    decodeSprayGetAck,
    decodeSprayPush,
    encodeSprayGet,
    encodeSpraySet
} from '../../../src/protocol/codecs/spray';

describe('Control.Spray codec', () => {
    it('encodes GET as an empty spray object', () => {
        assert.deepEqual(encodeSprayGet(), { spray: {} });
    });

    it('encodes SET as a single spray object', () => {
        assert.deepEqual(encodeSpraySet({ channel: 0, mode: 'continuous' }), {
            spray: { channel: 0, mode: 1 }
        });
        assert.deepEqual(encodeSpraySet({ channel: 0, mode: 'off' }).spray, { channel: 0, mode: 0 });
        assert.deepEqual(encodeSpraySet({ channel: 0, mode: 'intermittent' }).spray, { channel: 0, mode: 2 });
    });

    it('decodes a GETACK object', () => {
        const [entry] = decodeSprayGetAck({
            spray: { channel: 0, mode: 0, lmTime: 1629035486, lastMode: 1 }
        });
        assert.equal(entry.channel, 0);
        assert.equal(entry.mode, 'off');
    });

    it('decodes a PUSH array', () => {
        const entries = decodeSprayPush({
            spray: [{ channel: 0, mode: 1 }, { channel: 1, mode: 2 }]
        });
        assert.deepEqual(entries, [
            { channel: 0, mode: 'continuous' },
            { channel: 1, mode: 'intermittent' }
        ]);
    });

    it('rejects an unknown mode and a missing spray key', () => {
        assert.throws(() => decodeSprayGetAck({ spray: { channel: 0, mode: 9 } }), ProtocolError);
        assert.throws(() => decodeSprayGetAck({}), ProtocolError);
    });
});
