import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ProtocolError } from '../../../src/errors';
import {
    decodeConfigOverTempGetAck,
    decodeConfigOverTempPush,
    decodeControlOverTempGetAck,
    decodeControlOverTempPush,
    encodeConfigOverTempGet,
    encodeConfigOverTempSet,
    encodeControlOverTempGet
} from '../../../src/protocol/codecs/overtemp';

describe('Config.OverTemp codec', () => {
    it('encodes GET as an empty payload', () => {
        assert.deepEqual(encodeConfigOverTempGet(), {});
    });

    it('encodes SET with enable 1/2', () => {
        assert.deepEqual(encodeConfigOverTempSet({ enabled: true, type: 1 }), {
            overTemp: { enable: 1, type: 1 }
        });
        assert.deepEqual(encodeConfigOverTempSet({ enabled: false }), {
            overTemp: { enable: 2 }
        });
    });

    it('decodes firmware GETACK enable/type', () => {
        assert.deepEqual(
            decodeConfigOverTempGetAck({
                overTemp: { enable: 1, type: 1 }
            }),
            { enabled: true, type: 1 }
        );
        assert.deepEqual(
            decodeConfigOverTempGetAck({
                overTemp: { enable: 2, type: 2 }
            }),
            { enabled: false, type: 2 }
        );
    });

    it('tolerates boards that report type -1', () => {
        assert.deepEqual(
            decodeConfigOverTempGetAck({
                overTemp: { enable: 1, type: -1 }
            }),
            { enabled: true, type: -1 }
        );
    });

    it('tolerates missing optional type', () => {
        assert.deepEqual(
            decodeConfigOverTempGetAck({ overTemp: { enable: 1 } }),
            { enabled: true }
        );
    });

    it('decodes PUSH the same way as GETACK', () => {
        const payload = { overTemp: { enable: 1, type: 1 } };
        assert.deepEqual(decodeConfigOverTempPush(payload), decodeConfigOverTempGetAck(payload));
    });

    it('rejects a missing or invalid overTemp object', () => {
        assert.throws(
            () => decodeConfigOverTempGetAck({}),
            (err: unknown) => err instanceof ProtocolError
        );
        assert.throws(
            () => decodeConfigOverTempGetAck({ overTemp: [] }),
            (err: unknown) => err instanceof ProtocolError
        );
        assert.throws(
            () => decodeConfigOverTempGetAck({ overTemp: { enable: 3 } }),
            (err: unknown) => err instanceof ProtocolError
        );
    });
});

describe('Control.OverTemp codec', () => {
    it('encodes GET as a one-channel list', () => {
        assert.deepEqual(encodeControlOverTempGet(0), {
            overTemp: [{ channel: 0 }]
        });
    });

    it('decodes firmware SET object without channel as channel 0', () => {
        assert.deepEqual(
            decodeControlOverTempPush({
                overTemp: {
                    value: 1,
                    timestamp: 1,
                    type: 1
                }
            }),
            [{ channel: 0, active: true, timestamp: 1, type: 1 }]
        );
    });

    it('decodes GETACK list with normal and active values', () => {
        assert.deepEqual(
            decodeControlOverTempGetAck({
                overTemp: [
                    { channel: 0, value: 2, timestamp: 100, type: 2 },
                    { channel: 1, value: 1, timestamp: 200, type: 1 }
                ]
            }),
            [
                { channel: 0, active: false, timestamp: 100, type: 2 },
                { channel: 1, active: true, timestamp: 200, type: 1 }
            ]
        );
    });

    it('uses PUSH decoder interchangeably with GETACK', () => {
        const payload = {
            overTemp: [{ channel: 0, value: 1, timestamp: 42, type: 1 }]
        };
        assert.deepEqual(decodeControlOverTempPush(payload), decodeControlOverTempGetAck(payload));
    });

    it('rejects a missing overTemp payload or invalid value', () => {
        assert.throws(
            () => decodeControlOverTempGetAck({}),
            (err: unknown) => err instanceof ProtocolError
        );
        assert.throws(
            () => decodeControlOverTempGetAck({ overTemp: [{ channel: 0 }] }),
            (err: unknown) => err instanceof ProtocolError
        );
    });
});
