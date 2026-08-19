import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ProtocolError } from '../../../src/errors';
import {
    decodeDeviceCfgGetAck,
    decodeDeviceCfgPush,
    decodeWaterGetAck,
    decodeWaterPush,
    encodeDeviceCfgGet,
    encodeDeviceCfgSet,
    encodeWaterGet,
    encodeWaterSet
} from '../../../src/protocol/codecs/water';

const SUB_ID = '1B00839E9A6D';

describe('Control.Water codec', () => {
    it('encodes GET with subId and channel 0', () => {
        assert.deepEqual(encodeWaterGet({ subId: SUB_ID }), {
            control: [{ subId: SUB_ID, channel: 0 }]
        });
    });

    it('encodes SET on with onoff 1', () => {
        assert.deepEqual(encodeWaterSet({ subId: SUB_ID, on: true }), {
            control: [{ subId: SUB_ID, channel: 0, onoff: 1 }]
        });
    });

    it('encodes SET off with onoff 2', () => {
        assert.deepEqual(encodeWaterSet({ subId: SUB_ID, on: false }), {
            control: [{ subId: SUB_ID, channel: 0, onoff: 2 }]
        });
    });

    it('decodes MST100-shaped GETACK from meross_lan trace', () => {
        const payload = {
            control: [{
                channel: 0,
                subId: SUB_ID,
                onoff: 2,
                dura: 7200,
                lmTime: 0
            }]
        };
        const [entry] = decodeWaterGetAck(payload);
        assert.equal(entry.subId, SUB_ID);
        assert.equal(entry.channel, 0);
        assert.equal(entry.on, false);
        assert.equal(entry.duration, 7200);
    });

    it('uses PUSH decoder interchangeably with GETACK', () => {
        const payload = {
            control: [{ channel: 0, subId: SUB_ID, onoff: 1, dura: 900 }]
        };
        assert.deepEqual(decodeWaterPush(payload), decodeWaterGetAck(payload));
    });

    it('rejects a non-array control payload', () => {
        assert.throws(() => decodeWaterGetAck({ control: {} }), ProtocolError);
    });

    it('rejects an entry without onoff', () => {
        assert.throws(
            () => decodeWaterGetAck({ control: [{ channel: 0, subId: SUB_ID }] }),
            ProtocolError
        );
    });
});

describe('Config.DeviceCfg codec', () => {
    it('encodes GET with subId and channel 0', () => {
        assert.deepEqual(encodeDeviceCfgGet({ subId: SUB_ID }), {
            config: [{ subId: SUB_ID, channel: 0 }]
        });
    });

    it('encodes SET with mstCfg.dura', () => {
        assert.deepEqual(encodeDeviceCfgSet({ subId: SUB_ID, duration: 3600 }), {
            config: [{ subId: SUB_ID, channel: 0, mstCfg: { dura: 3600 } }]
        });
    });

    it('decodes mstCfg.dura from GETACK', () => {
        const [entry] = decodeDeviceCfgGetAck({
            config: [{
                channel: 0,
                subId: SUB_ID,
                mstCfg: { dura: 7200, wfm: 0, calibration: { waCon: 0, onoff: 0, lmTime: 0 } }
            }]
        });
        assert.equal(entry.subId, SUB_ID);
        assert.equal(entry.channel, 0);
        assert.equal(entry.duration, 7200);
    });

    it('uses PUSH decoder interchangeably with GETACK', () => {
        const payload = {
            config: [{ channel: 0, subId: SUB_ID, mstCfg: { dura: 1800 } }]
        };
        assert.deepEqual(decodeDeviceCfgPush(payload), decodeDeviceCfgGetAck(payload));
    });
});
