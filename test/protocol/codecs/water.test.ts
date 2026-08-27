import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ProtocolError } from '../../../src/errors';
import {
    decodeDeviceCfgGetAck,
    decodeDeviceCfgPush,
    decodeWaterEventPush,
    decodeWaterGetAck,
    decodeWaterPlanGetAck,
    decodeWaterPlanPush,
    decodeWaterPush,
    encodeDeviceCfgGet,
    encodeDeviceCfgSet,
    encodeWaterGet,
    encodeWaterPlanGet,
    encodeWaterPlanSet,
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

describe('Config.WaterPlan codec', () => {
    it('encodes GET with subId and channel 0 under config', () => {
        assert.deepEqual(encodeWaterPlanGet({ subId: SUB_ID }), {
            config: [{ subId: SUB_ID, channel: 0 }]
        });
    });

    it('encodes SET by spreading opaque schedule fields', () => {
        assert.deepEqual(encodeWaterPlanSet([{
            subId: SUB_ID,
            channel: 0,
            schedule: { enable: 1, week: 127, time: 360, dura: 900 }
        }]), {
            config: [{
                subId: SUB_ID,
                channel: 0,
                enable: 1,
                week: 127,
                time: 360,
                dura: 900
            }]
        });
    });

    it('decodes GETACK rows keyed by subId with opaque schedule', () => {
        const [entry] = decodeWaterPlanGetAck({
            config: [{
                channel: 0,
                subId: SUB_ID,
                enable: 1,
                week: 127,
                time: 360,
                dura: 900
            }]
        });
        assert.equal(entry.subId, SUB_ID);
        assert.equal(entry.channel, 0);
        assert.deepEqual(entry.schedule, {
            enable: 1,
            week: 127,
            time: 360,
            dura: 900
        });
    });

    it('uses PUSH decoder interchangeably with GETACK', () => {
        const payload = {
            config: [{ channel: 0, subId: SUB_ID, enable: 0 }]
        };
        assert.deepEqual(decodeWaterPlanPush(payload), decodeWaterPlanGetAck(payload));
    });

    it('rejects a non-array config payload', () => {
        assert.throws(() => decodeWaterPlanGetAck({ config: {} }), ProtocolError);
    });

    it('rejects an entry without subId', () => {
        assert.throws(
            () => decodeWaterPlanGetAck({ config: [{ channel: 0 }] }),
            ProtocolError
        );
    });
});

describe('Control.WaterEvent codec', () => {
    it('decodes a completed-cycle PUSH keyed by control and subId', () => {
        const [entry] = decodeWaterEventPush({
            control: [{
                channel: 0,
                subId: SUB_ID,
                dura: 900,
                waCon: 42,
                timestamp: 1_724_000_000
            }]
        });
        assert.deepEqual(entry, {
            subId: SUB_ID,
            channel: 0,
            duration: 900,
            waterConsumption: 42,
            timestamp: 1_724_000_000
        });
    });

    it('keeps optional dura, waCon, and timestamp independently', () => {
        const [entry] = decodeWaterEventPush({
            control: [{ subId: SUB_ID, dura: 900 }]
        });
        assert.deepEqual(entry, { subId: SUB_ID, channel: 0, duration: 900 });
    });

    it('omits rows that have no dura, waCon, or timestamp', () => {
        assert.deepEqual(decodeWaterEventPush({
            control: [{ subId: SUB_ID, channel: 0 }]
        }), []);
    });

    it('rejects a non-array control payload', () => {
        assert.throws(() => decodeWaterEventPush({ control: {} }), ProtocolError);
    });

    it('rejects an entry without subId', () => {
        assert.throws(
            () => decodeWaterEventPush({ control: [{ channel: 0, dura: 60 }] }),
            ProtocolError
        );
    });
});
