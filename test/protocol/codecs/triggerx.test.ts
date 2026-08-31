import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ProtocolError } from '../../../src/errors';
import {
    decodeControlTriggerGetAck,
    decodeDigestTriggerXGetAck,
    decodeTriggerXGetAck,
    decodeTriggerXPush,
    encodeControlTriggerGet,
    encodeControlTriggerSet,
    encodeDigestTriggerXGet,
    encodeTriggerXDelete,
    encodeTriggerXGet,
    encodeTriggerXSet
} from '../../../src/protocol/codecs/triggerx';

const SAMPLE = {
    type: 1,
    rule: {
        week: 255,
        duration: 46800
    },
    id: 'qm7n5caqxjapjfh5',
    enable: 1,
    createTime: 1614716670,
    channel: 1,
    alias: 'Apagado pergola'
};

describe('Control.TriggerX codec', () => {
    it('encodes GET by id', () => {
        assert.deepEqual(encodeTriggerXGet({ id: 'qm7n5caqxjapjfh5' }), {
            triggerx: { id: 'qm7n5caqxjapjfh5' }
        });
    });

    it('encodes SET as a single triggerx object with rule', () => {
        assert.deepEqual(encodeTriggerXSet({
            id: 'qm7n5caqxjapjfh5',
            channel: 1,
            alias: 'Apagado pergola',
            enabled: true,
            type: 1,
            createTime: 1614716670,
            rule: { duration: 46800, week: 255 }
        }), { triggerx: SAMPLE });
    });

    it('encodes DELETE by id', () => {
        assert.deepEqual(encodeTriggerXDelete({ id: '3lewklurxp2eqnza' }), {
            triggerx: { id: '3lewklurxp2eqnza' }
        });
    });

    it('decodes a GETACK object as a one-entry list', () => {
        assert.deepEqual(decodeTriggerXGetAck({ triggerx: SAMPLE }), [{
            id: 'qm7n5caqxjapjfh5',
            channel: 1,
            alias: 'Apagado pergola',
            enabled: true,
            type: 1,
            createTime: 1614716670,
            rule: { duration: 46800, week: 255 }
        }]);
    });

    it('decodes a PUSH array of trigger rows', () => {
        const [entry] = decodeTriggerXPush({
            triggerx: [{
                type: 0,
                rule: { week: 136, duration: 9600 },
                id: '3lewklurxp2eqnza',
                enable: 0,
                createTime: 1675675346,
                channel: 0,
                alias: 'stop'
            }]
        });
        assert.deepEqual(entry, {
            id: '3lewklurxp2eqnza',
            channel: 0,
            alias: 'stop',
            enabled: false,
            type: 0,
            createTime: 1675675346,
            rule: { duration: 9600, week: 136 }
        });
    });

    it('decodes GETACK array payloads from firmware samples', () => {
        const [entry] = decodeTriggerXGetAck({
            triggerx: [{
                type: 0,
                rule: { week: 136, duration: 9600 },
                id: '3lewklurxp2eqnza',
                enable: 1,
                createTime: 1675675346,
                channel: 0,
                alias: 'stop'
            }],
            digest: [{ id: '3lewklurxp2eqnza', count: 0, channel: 0 }]
        });
        assert.equal(entry.id, '3lewklurxp2eqnza');
        assert.equal(entry.rule.duration, 9600);
    });

    it('rejects a missing triggerx payload', () => {
        assert.throws(() => decodeTriggerXGetAck({}), ProtocolError);
    });
});

describe('Digest.TriggerX codec', () => {
    it('encodes GET as an empty payload', () => {
        assert.deepEqual(encodeDigestTriggerXGet(), {});
    });

    it('decodes GETACK digest rows', () => {
        assert.deepEqual(decodeDigestTriggerXGetAck({
            digest: [
                { channel: 0, id: '5px03r9l5p90i66r', count: 3 },
                { channel: 0, id: 'wnqy8b6js3alm364', count: 2 }
            ]
        }), [
            { channel: 0, id: '5px03r9l5p90i66r', count: 3 },
            { channel: 0, id: 'wnqy8b6js3alm364', count: 2 }
        ]);
    });

    it('rejects a missing digest payload', () => {
        assert.throws(() => decodeDigestTriggerXGetAck({}), ProtocolError);
    });
});

describe('Control.Trigger codec', () => {
    const LEGACY = {
        id: 'abcdefghijklm123',
        type: 0,
        enable: 1,
        alias: 'test auto off',
        createTime: 1560513139,
        rule: {
            _if_: { toggle: { onoff: 1, lmTime: 0 } },
            _then_: { delay: { week: 129, duration: 69300 } },
            _do_: { toggle: { onoff: 0, lmTime: 0 } }
        }
    };

    it('encodes GET as an empty trigger dict', () => {
        assert.deepEqual(encodeControlTriggerGet(), { trigger: {} });
    });

    it('encodes SET expanding host rule into _if_/_then_/_do_', () => {
        assert.deepEqual(encodeControlTriggerSet([{
            id: 'abcdefghijklm123',
            channel: 0,
            alias: 'test auto off',
            enabled: true,
            type: 0,
            createTime: 1560513139,
            rule: { duration: 69300, week: 129 }
        }]), { trigger: [LEGACY] });
    });

    it('decodes nested legacy rule into duration/week', () => {
        assert.deepEqual(decodeControlTriggerGetAck({ trigger: [LEGACY] }), [{
            id: 'abcdefghijklm123',
            channel: 0,
            alias: 'test auto off',
            enabled: true,
            type: 0,
            createTime: 1560513139,
            rule: { duration: 69300, week: 129 }
        }]);
    });

    it('rejects a missing trigger payload', () => {
        assert.throws(() => decodeControlTriggerGetAck({}), ProtocolError);
    });

    it('rejects a malformed trigger payload', () => {
        assert.throws(() => decodeControlTriggerGetAck({ trigger: 1 }), ProtocolError);
    });
});
