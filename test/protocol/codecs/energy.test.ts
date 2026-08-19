import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { ProtocolError } from '../../../src/errors';
import {
    decodeConsumptionXGetAck,
    encodeConsumptionXGet
} from '../../../src/protocol/codecs/consumptionx';
import {
    decodeElectricityGetAck,
    encodeElectricityGet
} from '../../../src/protocol/codecs/electricity';
import { decodeMessage } from '../../../src/protocol/message';

const fixturesDir = join(process.cwd(), 'test/fixtures');

function loadFixture(name: string) {
    return decodeMessage(
        JSON.parse(readFileSync(join(fixturesDir, name), 'utf8')) as unknown
    );
}

describe('Electricity codec', () => {
    it('encodes GET as a firmware channel object', () => {
        assert.deepEqual(
            encodeElectricityGet({ channel: 0 }),
            loadFixture('electricity-get.json').payload
        );
    });

    it('decodes firmware GETACK into host units (W, A, V)', () => {
        const fixture = loadFixture('electricity-getack.json');
        assert.deepEqual(decodeElectricityGetAck(fixture.payload), {
            channel: 0,
            current: 0,
            voltage: 0.1,
            power: 0.001,
            consume: 2,
            config: {
                voltageRatio: 193,
                electricityRatio: 102,
                maxElectricityCurrent: 16000
            }
        });
    });

    it('scales classic field readings (mW, mA, deci-volts)', () => {
        assert.deepEqual(
            decodeElectricityGetAck({
                electricity: {
                    channel: 0,
                    power: 11_000,
                    current: 50,
                    voltage: 2300
                }
            }),
            {
                channel: 0,
                power: 11,
                current: 0.05,
                voltage: 230
            }
        );
    });

    it('rejects a missing or array electricity field', () => {
        assert.throws(
            () => decodeElectricityGetAck({}),
            (err: unknown) => err instanceof ProtocolError
        );
        assert.throws(
            () => decodeElectricityGetAck({ electricity: [] }),
            (err: unknown) => err instanceof ProtocolError
        );
    });
});

describe('ConsumptionX codec', () => {
    it('encodes GET as an empty firmware payload', () => {
        assert.deepEqual(
            encodeConsumptionXGet(),
            loadFixture('consumptionx-get.json').payload
        );
    });

    it('decodes firmware GETACK daily Wh rows', () => {
        const fixture = loadFixture('consumptionx-getack.json');
        assert.deepEqual(decodeConsumptionXGetAck(fixture.payload), [
            { date: '2018-03-05', value: 1000, time: 1673855028 },
            { date: '2018-03-06', value: 1000, time: 1673855028 }
        ]);
    });

    it('rejects a non-array consumptionx field', () => {
        assert.throws(
            () => decodeConsumptionXGetAck({ consumptionx: {} }),
            (err: unknown) => err instanceof ProtocolError
        );
    });
});
