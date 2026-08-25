import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ProtocolError } from '../../../src/errors';
import {
    decodeFanBtnConfigPush,
    decodeFanConfigGetAck,
    decodeFanGetAck,
    decodeFanPush,
    decodeFilterMaintenancePush,
    encodeFanBtnConfigPushQuery,
    encodeFanBtnConfigSet,
    encodeFanConfigGet,
    encodeFanGet,
    encodeFanSet,
    encodeFilterMaintenancePushQuery
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

describe('Fan.Config codec', () => {
    it('encodes GET with config channel list', () => {
        assert.deepEqual(encodeFanConfigGet({ channel: 0 }), {
            config: [{ channel: 0 }]
        });
    });

    it('decodes MFC100 GETACK maxSpeed', () => {
        assert.deepEqual(
            decodeFanConfigGetAck({ config: [{ channel: 0, maxSpeed: 0 }] }),
            [{ channel: 0, maxSpeed: 0 }]
        );
    });

    it('decodes meross_lan fan-keyed GETACK', () => {
        assert.deepEqual(
            decodeFanConfigGetAck({ fan: [{ channel: 0, maxSpeed: 3 }] }),
            [{ channel: 0, maxSpeed: 3 }]
        );
    });
});

describe('Fan.BtnConfig codec', () => {
    it('encodes PUSH-query as empty object', () => {
        assert.deepEqual(encodeFanBtnConfigPushQuery(), {});
    });

    it('encodes SET with powerBtn or controlBtn', () => {
        assert.deepEqual(
            encodeFanBtnConfigSet({ channel: 0, powerBtn: { type: 1 } }),
            { config: [{ channel: 0, powerBtn: { type: 1 } }] }
        );
        assert.deepEqual(
            encodeFanBtnConfigSet({ channel: 1, controlBtn: { onoffType: 1, levelType: 2 } }),
            { config: [{ channel: 1, controlBtn: { onoffType: 1, levelType: 2 } }] }
        );
    });

    it('decodes MFC100 PUSH fixture', () => {
        assert.deepEqual(
            decodeFanBtnConfigPush({
                config: [
                    { channel: 0, powerBtn: { type: 1 } },
                    { channel: 1, controlBtn: { onoffType: 1, levelType: 2 } },
                    { channel: 2, controlBtn: { onoffType: 1, levelType: 2 } }
                ]
            }),
            [
                { channel: 0, powerBtn: { type: 1 } },
                { channel: 1, controlBtn: { onoffType: 1, levelType: 2 } },
                { channel: 2, controlBtn: { onoffType: 1, levelType: 2 } }
            ]
        );
    });

    it('decodes meross_lan fan-keyed PUSH', () => {
        assert.deepEqual(
            decodeFanBtnConfigPush({ fan: [{ channel: 0, powerBtn: { type: 1 } }] }),
            [{ channel: 0, powerBtn: { type: 1 } }]
        );
    });

    it('prefers config when both keys are present', () => {
        assert.deepEqual(
            decodeFanBtnConfigPush({
                config: [{ channel: 0, powerBtn: { type: 1 } }],
                fan: [{ channel: 0, powerBtn: { type: 9 } }]
            }),
            [{ channel: 0, powerBtn: { type: 1 } }]
        );
    });
});

describe('FilterMaintenance codec', () => {
    it('encodes PUSH-query as empty object', () => {
        assert.deepEqual(encodeFilterMaintenancePushQuery(), {});
    });

    it('decodes life percent from PUSH', () => {
        assert.deepEqual(
            decodeFilterMaintenancePush({
                filter: [{ channel: 0, life: 100, lmTime: 1748695021 }]
            }),
            [{ channel: 0, life: 100, lmTime: 1748695021 }]
        );
    });

    it('rejects a missing life', () => {
        assert.throws(
            () => decodeFilterMaintenancePush({ filter: [{ channel: 0 }] }),
            ProtocolError
        );
    });
});
