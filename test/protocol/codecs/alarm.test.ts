import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ProtocolError } from '../../../src/errors';
import {
    decodeAlarmGetAck,
    decodeAlarmPush,
    encodeAlarmGet,
    encodeAlarmLinkedSet,
    encodeAlarmSet
} from '../../../src/protocol/codecs/alarm';

describe('Control.Alarm codec', () => {
    it('encodes GET as a one-channel list', () => {
        assert.deepEqual(encodeAlarmGet({ channel: 0 }), { alarm: [{ channel: 0 }] });
        assert.deepEqual(encodeAlarmGet({ channel: 2, subId: 'abc' }), {
            alarm: [{ channel: 2, subId: 'abc' }]
        });
    });

    it('encodes SET security execute/normal with optional duration', () => {
        assert.deepEqual(encodeAlarmSet({ channel: 0, on: true, durationSeconds: 30 }), {
            alarm: [{
                channel: 0,
                event: { security: { value: 1, time: 30 } }
            }]
        });
        assert.deepEqual(encodeAlarmSet({ channel: 1, on: false }), {
            alarm: [{
                channel: 1,
                event: { security: { value: 2 } }
            }]
        });
        assert.deepEqual(encodeAlarmSet({ channel: 0, on: true, maSecurity: true, durationSeconds: 15 }), {
            alarm: [{
                channel: 0,
                event: { maSecurity: { value: 1, time: 15 } }
            }]
        });
        assert.deepEqual(encodeAlarmSet({ channel: 0, subId: 'abc', on: false, maSecurity: true }), {
            alarm: [{
                channel: 0,
                event: { maSecurity: { value: 2 } }
            }]
        });
    });

    it('encodes SET interConn with local scope', () => {
        assert.deepEqual(encodeAlarmLinkedSet({ channel: 0, on: true }), {
            alarm: [{
                channel: 0,
                event: { interConn: { value: 1, type: 1 } }
            }]
        });
    });

    it('decodes GETACK/PUSH object and array payloads', () => {
        assert.deepEqual(
            decodeAlarmGetAck({
                alarm: {
                    channel: 0,
                    event: { security: { value: 1, timestamp: 100 } }
                }
            }),
            [{ channel: 0, on: true }]
        );
        const [entry] = decodeAlarmPush({
            alarm: [{
                channel: 0,
                event: {
                    interConn: { value: 1, timestamp: 100 },
                    security: { value: 2, timestamp: 100 },
                    demolish: { value: 1, timestamp: 100 },
                    maSecurity: { value: 1, timestamp: 100 }
                }
            }]
        });
        assert.deepEqual(entry, { channel: 0, on: false, linked: true });
        assert.deepEqual(
            decodeAlarmGetAck({
                alarm: [{
                    channel: 0,
                    event: { maSecurity: { value: 1, timestamp: 100 } }
                }]
            }),
            [{ channel: 0, on: true, maSecurity: true }]
        );
    });

    it('uses PUSH decoder interchangeably with GETACK', () => {
        const payload = {
            alarm: [{ channel: 0, event: { security: { value: 1, timestamp: 1 } } }]
        };
        assert.deepEqual(decodeAlarmPush(payload), decodeAlarmGetAck(payload));
    });

    it('decodes optional subId', () => {
        const [entry] = decodeAlarmPush({
            alarm: [{
                channel: 0,
                subId: '123456',
                event: { security: { value: 1, timestamp: 1 } }
            }]
        });
        assert.deepEqual(entry, { channel: 0, subId: '123456', on: true });
    });

    it('rejects a missing alarm payload', () => {
        assert.throws(() => decodeAlarmGetAck({}), ProtocolError);
    });
});
