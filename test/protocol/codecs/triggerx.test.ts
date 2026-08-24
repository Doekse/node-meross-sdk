import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ProtocolError } from '../../../src/errors';
import {
    decodeDigestTriggerXGetAck,
    decodeTriggerXGetAck,
    decodeTriggerXPush,
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

    it('decodes GETACK object and PUSH array payloads', () => {
        assert.deepEqual(decodeTriggerXGetAck({ triggerx: SAMPLE }), [{
            id: 'qm7n5caqxjapjfh5',
            channel: 1,
            alias: 'Apagado pergola',
            enabled: true,
            type: 1,
            createTime: 1614716670,
            rule: { duration: 46800, week: 255 }
        }]);
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
