import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ProtocolError } from '../../../src/errors';
import {
    decodeFanGetAck,
    decodeFanPush,
    encodeFanGet,
    encodeFanSet
} from '../../../src/protocol/codecs/fan';

describe('Control.Fan codec', () => {
    it('encodes GET as a one-channel list', () => {
        assert.deepEqual(encodeFanGet({ channel: 0 }), { fan: [{ channel: 0 }] });
    });

    it('encodes SET with channel and speed', () => {
        assert.deepEqual(encodeFanSet({ channel: 0, speed: 3 }), {
            fan: [{ channel: 0, speed: 3 }]
        });
    });

    it('decodes GETACK with maxSpeed', () => {
        const [entry] = decodeFanGetAck({
            fan: [{ channel: 0, speed: 3, maxSpeed: 4 }]
        });
        assert.equal(entry.channel, 0);
        assert.equal(entry.speed, 3);
        assert.equal(entry.maxSpeed, 4);
    });

    it('decodes GETACK/PUSH object and array payloads', () => {
        assert.deepEqual(
            decodeFanGetAck({ fan: { channel: 0, speed: 2 } }),
            [{ channel: 0, speed: 2 }]
        );
        assert.deepEqual(
            decodeFanPush({ fan: [{ channel: 0, speed: 0 }, { channel: 1, speed: 3 }] }),
            [{ channel: 0, speed: 0 }, { channel: 1, speed: 3 }]
        );
    });

    it('uses PUSH decoder interchangeably with GETACK', () => {
        const payload = { fan: [{ channel: 2, speed: 0 }] };
        assert.deepEqual(decodeFanPush(payload), decodeFanGetAck(payload));
    });

    it('rejects a missing speed', () => {
        assert.throws(() => decodeFanGetAck({ fan: [{ channel: 0 }] }), ProtocolError);
    });
});
