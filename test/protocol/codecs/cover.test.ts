import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ProtocolError } from '../../../src/errors';
import {
    decodeGarageGetAck,
    decodeGaragePush,
    decodeShutterPositionGetAck,
    decodeShutterStatePush,
    encodeGarageGet,
    encodeGarageSet,
    encodeShutterPositionGet,
    encodeShutterPositionSet
} from '../../../src/protocol/codecs/cover';

describe('GarageDoor.State codec', () => {
    it('encodes SET as a single state object', () => {
        assert.deepEqual(encodeGarageSet({ channel: 0, open: true }), { state: { channel: 0, open: 1 } });
        assert.deepEqual(encodeGarageSet({ channel: 1, open: false }), { state: { channel: 1, open: 0 } });
    });

    it('encodes GET as a channel object', () => {
        assert.deepEqual(encodeGarageGet({ channel: 0 }), { state: { channel: 0 } });
        assert.deepEqual(encodeGarageGet({ channel: 0xffff }), { state: { channel: 0xffff } });
    });

    it('decodes GETACK/PUSH object and array payloads', () => {
        assert.deepEqual(
            decodeGarageGetAck({ state: { channel: 0, open: 1 } }),
            [{ channel: 0, open: true }]
        );
        assert.deepEqual(
            decodeGaragePush({ state: [{ channel: 0, open: 0 }, { channel: 1, open: 1 }] }),
            [{ channel: 0, open: false }, { channel: 1, open: true }]
        );
    });

    it('rejects a missing state field', () => {
        assert.throws(
            () => decodeGaragePush({}),
            (err: unknown) => err instanceof ProtocolError
        );
    });
});

describe('RollerShutter codec', () => {
    it('encodes SET as a single position object', () => {
        assert.deepEqual(
            encodeShutterPositionSet({ channel: 0, position: 50 }),
            { position: { channel: 0, position: 50 } }
        );
        assert.deepEqual(
            encodeShutterPositionSet({ channel: 1, position: -1 }),
            { position: { channel: 1, position: -1 } }
        );
    });

    it('encodes GET with an empty payload', () => {
        assert.deepEqual(encodeShutterPositionGet(), {});
    });

    it('decodes GETACK/PUSH position and state arrays', () => {
        assert.deepEqual(
            decodeShutterPositionGetAck({ position: [{ channel: 0, position: 75 }] }),
            [{ channel: 0, position: 75 }]
        );
        assert.deepEqual(
            decodeShutterStatePush({ state: [{ channel: 0, state: 1 }] }),
            [{ channel: 0, state: 1 }]
        );
    });

    it('rejects a non-array position payload', () => {
        assert.throws(
            () => decodeShutterPositionGetAck({ position: { channel: 0, position: 50 } }),
            (err: unknown) => err instanceof ProtocolError
        );
    });
});
