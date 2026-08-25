import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ProtocolError } from '../../../src/errors';
import {
    decodeConsumptionConfigGetAck,
    decodeConsumptionConfigPush,
    encodeConsumptionConfigGet
} from '../../../src/protocol/codecs/consumptionconfig';

describe('ConsumptionConfig codec', () => {
    it('encodes GET as an empty payload', () => {
        assert.deepEqual(encodeConsumptionConfigGet(), {});
    });

    it('decodes firmware GETACK with all calibration fields', () => {
        assert.deepEqual(
            decodeConsumptionConfigGetAck({
                config: {
                    voltageRatio: 118,
                    electricityRatio: 98,
                    maxElectricityCurrent: 11_000
                }
            }),
            {
                voltageRatio: 118,
                electricityRatio: 98,
                maxElectricityCurrent: 11_000
            }
        );
    });

    it('decodes GETACK when maxElectricityCurrent is omitted', () => {
        assert.deepEqual(
            decodeConsumptionConfigGetAck({
                config: { voltageRatio: 186, electricityRatio: 121 }
            }),
            { voltageRatio: 186, electricityRatio: 121 }
        );
    });

    it('decodes PUSH the same way as GETACK', () => {
        const payload = {
            config: { voltageRatio: 188, electricityRatio: 102, maxElectricityCurrent: 11_000 }
        };
        assert.deepEqual(decodeConsumptionConfigPush(payload), decodeConsumptionConfigGetAck(payload));
    });

    it('ignores extra meross_lan fields such as powerRatio', () => {
        assert.deepEqual(
            decodeConsumptionConfigPush({
                config: {
                    voltageRatio: 188,
                    electricityRatio: 102,
                    maxElectricityCurrent: 11_000,
                    powerRatio: 0
                }
            }),
            {
                voltageRatio: 188,
                electricityRatio: 102,
                maxElectricityCurrent: 11_000
            }
        );
    });

    it('rejects a missing or invalid config field', () => {
        assert.throws(
            () => decodeConsumptionConfigGetAck({}),
            (err: unknown) => err instanceof ProtocolError
        );
        assert.throws(
            () => decodeConsumptionConfigGetAck({ config: { voltageRatio: 100 } }),
            (err: unknown) => err instanceof ProtocolError
        );
    });
});
