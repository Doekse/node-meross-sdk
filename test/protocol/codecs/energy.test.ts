import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { ProtocolError } from '../../../src/errors';
import {
    decodeConsumptionHGetAck,
    encodeConsumptionHGet
} from '../../../src/protocol/codecs/consumptionh';
import {
    decodeConsumptionXGetAck,
    encodeConsumptionXDelete,
    encodeConsumptionXGet
} from '../../../src/protocol/codecs/consumptionx';
import {
    decodeElectricityGetAck,
    decodeElectricityXGetAck,
    encodeElectricityGet,
    encodeElectricityXGet
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

    it('accepts nested config without maxElectricityCurrent', () => {
        assert.deepEqual(
            decodeElectricityGetAck({
                electricity: {
                    channel: 0,
                    power: 1,
                    current: 0,
                    voltage: 1,
                    config: { voltageRatio: 186, electricityRatio: 121 }
                }
            }).config,
            { voltageRatio: 186, electricityRatio: 121 }
        );
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

    it('keeps whichever of power, current, and voltage are present', () => {
        assert.deepEqual(
            decodeElectricityGetAck({
                electricity: { power: 11_000 }
            }),
            { power: 11 }
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

describe('ElectricityX codec', () => {
    it('encodes GET with channel 65535 so every channel is returned', () => {
        assert.deepEqual(encodeElectricityXGet(), { electricity: { channel: 0xffff } });
    });

    it('decodes millivolt GETACK arrays into host units', () => {
        assert.deepEqual(
            decodeElectricityXGetAck({
                electricity: [{
                    channel: 0,
                    current: 2000,
                    voltage: 230000,
                    power: 1500,
                    factor: 95,
                    mConsume: 12345
                }]
            }),
            [{
                channel: 0,
                current: 2,
                voltage: 230,
                power: 1.5,
                consume: 12345,
                powerFactor: 0.95
            }]
        );
    });

    it('accepts a single-channel object GETACK', () => {
        assert.deepEqual(
            decodeElectricityXGetAck({
                electricity: {
                    channel: 1,
                    power: 600,
                    current: 500,
                    voltage: 120000
                }
            }),
            [{
                channel: 1,
                power: 0.6,
                current: 0.5,
                voltage: 120
            }]
        );
    });

    it('skips ElectricityX rows without a channel', () => {
        assert.deepEqual(
            decodeElectricityXGetAck({
                electricity: [
                    { power: 1500, current: 2000, voltage: 230000 },
                    { channel: 2, power: 600 }
                ]
            }),
            [{ channel: 2, power: 0.6 }]
        );
    });

    it('skips null and primitive ElectricityX rows', () => {
        assert.deepEqual(
            decodeElectricityXGetAck({
                electricity: [null, false, 42, 'invalid', { channel: 2, power: 600 }]
            }),
            [{ channel: 2, power: 0.6 }]
        );
    });

    it('keeps partial ElectricityX metrics', () => {
        assert.deepEqual(
            decodeElectricityXGetAck({
                electricity: [{ channel: 2, power: 600, current: 'invalid' }]
            }),
            [{ channel: 2, power: 0.6 }]
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

    it('encodes DELETE as an empty payload', () => {
        assert.deepEqual(encodeConsumptionXDelete(), {});
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

describe('ConsumptionH codec', () => {
    it('encodes GET with a channel-scoped consumptionH selector', () => {
        assert.deepEqual(encodeConsumptionHGet(1), {
            consumptionH: [{ channel: 1 }]
        });
    });

    it('decodes meross_lan-shaped channel rows into hourly samples', () => {
        assert.deepEqual(
            decodeConsumptionHGetAck({
                consumptionH: [{
                    channel: 1,
                    total: 958,
                    data: [
                        { timestamp: 1_721_548_740, value: 0 },
                        { timestamp: 1_721_552_340, value: 12 }
                    ]
                }]
            }),
            [{
                channel: 1,
                hourly: [
                    { timestamp: 1_721_548_740, value: 0 },
                    { timestamp: 1_721_552_340, value: 12 }
                ]
            }]
        );
    });

    it('rejects a non-array consumptionH field', () => {
        assert.throws(
            () => decodeConsumptionHGetAck({ consumptionH: {} }),
            (err: unknown) => err instanceof ProtocolError
        );
    });
});
