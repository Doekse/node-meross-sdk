import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ProtocolError } from '../../../src/errors';
import {
    decodeGarageConfigGetAck,
    decodeGarageGetAck,
    decodeGarageMultipleConfigGetAck,
    decodeGarageMultipleConfigPush,
    decodeGaragePush,
    decodeShutterPositionGetAck,
    decodeShutterStatePush,
    encodeGarageConfigGet,
    encodeGarageConfigSet,
    encodeGarageGet,
    encodeGarageMultipleConfigGet,
    encodeGarageMultipleConfigSet,
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
            decodeGarageGetAck({
                state: { channel: 0, open: 0, lmTime: 1686273341, execute: 1 }
            }),
            [{ channel: 0, open: false, execute: true }]
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

describe('GarageDoor.Config codec', () => {
    it('encodes GET as an empty payload', () => {
        assert.deepEqual(encodeGarageConfigGet(), {});
    });

    it('encodes SET with partial config fields', () => {
        assert.deepEqual(
            encodeGarageConfigSet({ signalDuration: 2000, buzzerEnable: 1 }),
            { config: { signalDuration: 2000, buzzerEnable: 1 } }
        );
    });

    it('decodes GETACK with all optional fields', () => {
        assert.deepEqual(
            decodeGarageConfigGetAck({
                config: { signalDuration: 2000, buzzerEnable: 1, doorOpenDuration: 15000, doorCloseDuration: 15000 }
            }),
            { signalDuration: 2000, buzzerEnable: 1, doorOpenDuration: 15000, doorCloseDuration: 15000 }
        );
    });

    it('decodes GETACK with only signalDuration', () => {
        assert.deepEqual(
            decodeGarageConfigGetAck({ config: { signalDuration: 500 } }),
            { signalDuration: 500 }
        );
    });

    it('rejects a GETACK payload missing signalDuration', () => {
        assert.throws(
            () => decodeGarageConfigGetAck({ config: { buzzerEnable: 1 } }),
            (err: unknown) => err instanceof ProtocolError
        );
    });

    it('rejects a GETACK payload where config is an array', () => {
        assert.throws(
            () => decodeGarageConfigGetAck({ config: [] }),
            (err: unknown) => err instanceof ProtocolError
        );
    });
});

describe('GarageDoor.MultipleConfig codec', () => {
    const sampleEntries = [
        { channel: 0, signalClose: 2000, signalOpen: 2000, doorOpenDuration: 15000, doorCloseDuration: 15000, buzzerEnable: 1 },
        { channel: 1, signalClose: 2000, signalOpen: 2000, doorOpenDuration: 15000, doorCloseDuration: 15000, buzzerEnable: 0 }
    ];

    it('encodes GET as an empty payload', () => {
        assert.deepEqual(encodeGarageMultipleConfigGet(), {});
    });

    it('encodes SET as a single channel config object', () => {
        assert.deepEqual(
            encodeGarageMultipleConfigSet({ channel: 1, buzzerEnable: 0, signalClose: 1500, signalOpen: 1500 }),
            { config: { channel: 1, buzzerEnable: 0, signalClose: 1500, signalOpen: 1500 } }
        );
    });

    it('decodes GETACK array with all optional fields', () => {
        assert.deepEqual(
            decodeGarageMultipleConfigGetAck({ config: sampleEntries }),
            sampleEntries
        );
    });

    it('decodes PUSH array', () => {
        assert.deepEqual(
            decodeGarageMultipleConfigPush({ config: sampleEntries }),
            sampleEntries
        );
    });

    it('rejects a non-array config payload', () => {
        assert.throws(
            () => decodeGarageMultipleConfigGetAck({ config: sampleEntries[0] }),
            (err: unknown) => err instanceof ProtocolError
        );
    });

    it('rejects an entry missing channel', () => {
        assert.throws(
            () => decodeGarageMultipleConfigGetAck({ config: [{ buzzerEnable: 1 }] }),
            (err: unknown) => err instanceof ProtocolError
        );
    });
});
