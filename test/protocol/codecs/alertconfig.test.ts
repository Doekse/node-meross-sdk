import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    decodeAlertConfigGetAck,
    decodeAlertConfigPush,
    decodeAlertReportGetAck,
    decodeAlertReportPush,
    encodeAlertConfigGet,
    encodeAlertConfigSet,
    encodeAlertReportGet
} from '../../../src/protocol/codecs/alertconfig';
import {
    decodeSensorAssociationGetAck,
    decodeSensorAssociationPush,
    encodeSensorAssociationGet,
    encodeSensorAssociationSet
} from '../../../src/protocol/codecs/sensor';

describe('Control.AlertConfig codec', () => {
    it('encodes GET for a channel', () => {
        assert.deepEqual(encodeAlertConfigGet(0), {
            config: [{ channel: 0 }]
        });
    });

    it('encodes SET with type and value', () => {
        assert.deepEqual(
            encodeAlertConfigSet({
                channel: 0,
                type: 5,
                value: { mts300: { hcMal: 1, auxLO: 1, auxLOT: 240 } }
            }),
            {
                config: [{
                    channel: 0,
                    type: 5,
                    value: { mts300: { hcMal: 1, auxLO: 1, auxLOT: 240 } }
                }]
            }
        );
    });

    it('decodes MTS300 GETACK/PUSH and empty config', () => {
        const payload = {
            config: [{
                channel: 0,
                type: 5,
                value: { mts300: { hcMal: 1, auxLO: 1, auxLOT: 240 } }
            }]
        };
        assert.deepEqual(decodeAlertConfigGetAck(payload), [{
            channel: 0,
            type: 5,
            value: { mts300: { hcMal: 1, auxLO: 1, auxLOT: 240 } }
        }]);
        assert.deepEqual(decodeAlertConfigPush(payload), decodeAlertConfigGetAck(payload));
        assert.deepEqual(decodeAlertConfigGetAck({ config: [] }), []);
        assert.deepEqual(decodeAlertConfigGetAck({}), []);
    });

    it('rejects a non-array config payload', () => {
        assert.throws(
            () => decodeAlertConfigGetAck({ config: { channel: 0 } }),
            /AlertConfig/
        );
    });
});

describe('Control.AlertReport codec', () => {
    it('encodes GET', () => {
        assert.deepEqual(encodeAlertReportGet(0), {
            alert: [{ channel: 0 }]
        });
    });

    it('decodes list rows and tolerates missing or malformed alert', () => {
        assert.deepEqual(
            decodeAlertReportGetAck({
                alert: [{ channel: 0, code: 7, message: 'aux' }]
            }),
            [{
                channel: 0,
                fields: { code: 7, message: 'aux' }
            }]
        );
        assert.deepEqual(decodeAlertReportPush({}), []);
        assert.deepEqual(decodeAlertReportGetAck({ alert: {} }), []);
        assert.deepEqual(decodeAlertReportGetAck({ alert: [null, 'x', { channel: 1 }] }), [{
            channel: 1,
            fields: {}
        }]);
    });
});

describe('Config.Sensor.Association codec', () => {
    it('encodes GET for a channel', () => {
        assert.deepEqual(encodeSensorAssociationGet({ channel: 0 }), {
            config: [{ channel: 0 }]
        });
    });

    it('encodes SET with temp association', () => {
        assert.deepEqual(
            encodeSensorAssociationSet({ channel: 0, tempAssociation: 2 }),
            {
                config: [{ channel: 0, temp: { association: 2 } }]
            }
        );
    });

    it('encodes SET with a hub subdevice id', () => {
        assert.deepEqual(
            encodeSensorAssociationSet({
                channel: 0,
                subId: '00000102',
                tempAssociation: 1
            }),
            {
                config: [{
                    channel: 0,
                    subId: '00000102',
                    temp: { association: 1 }
                }]
            }
        );
    });

    it('decodes MTS300 GETACK/PUSH and empty config', () => {
        const payload = {
            config: [{ channel: 0, temp: { association: 2 } }]
        };
        assert.deepEqual(decodeSensorAssociationGetAck(payload), [{
            channel: 0,
            tempAssociation: 2
        }]);
        assert.deepEqual(decodeSensorAssociationPush(payload), decodeSensorAssociationGetAck(payload));
        assert.deepEqual(decodeSensorAssociationGetAck({ config: [] }), []);
    });

    it('rejects a missing config payload', () => {
        assert.throws(
            () => decodeSensorAssociationGetAck({}),
            /Association/
        );
    });

    it('rejects a non-array config payload', () => {
        assert.throws(
            () => decodeSensorAssociationGetAck({ config: { channel: 0 } }),
            /Association/
        );
    });
});
