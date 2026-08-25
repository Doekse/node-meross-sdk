import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ProtocolError } from '../../../src/errors';
import {
    decodeDiffuserLightGetAck,
    decodeDiffuserSensorGetAck,
    decodeDiffuserSprayGetAck,
    encodeDiffuserLightGet,
    encodeDiffuserLightSet,
    encodeDiffuserSensorGet,
    encodeDiffuserSprayGet,
    encodeDiffuserSpraySet
} from '../../../src/protocol/codecs/diffuser';

describe('Diffuser.Light codec', () => {
    it('encodes GET as an empty payload', () => {
        assert.deepEqual(encodeDiffuserLightGet(), {});
    });

    it('encodes SET as a one-entry light list with type mod100', () => {
        assert.deepEqual(encodeDiffuserLightSet({
            channel: 0,
            on: true,
            mode: 'fixed-rgb',
            luminance: 100,
            rgb: 16711935
        }), {
            type: 'mod100',
            light: [{ channel: 0, onoff: 1, mode: 1, luminance: 100, rgb: 16711935 }]
        });
    });

    it('decodes firmware GETACK list', () => {
        const [entry] = decodeDiffuserLightGetAck({
            type: 'mod100',
            light: [{ channel: 0, onoff: 1, mode: 1, rgb: 16711935, luminance: 100 }]
        });
        assert.equal(entry.channel, 0);
        assert.equal(entry.on, true);
        assert.equal(entry.mode, 'fixed-rgb');
        assert.equal(entry.luminance, 100);
        assert.equal(entry.rgb, 16711935);
    });
});

describe('Diffuser.Spray codec', () => {
    it('encodes GET as an empty payload and SET as a list', () => {
        assert.deepEqual(encodeDiffuserSprayGet(), {});
        assert.deepEqual(encodeDiffuserSpraySet({ channel: 0, mode: 'off' }), {
            type: 'mod100',
            spray: [{ channel: 0, mode: 2 }]
        });
    });

    it('decodes firmware modes light/strong/off', () => {
        const entries = decodeDiffuserSprayGetAck({
            type: 'mod100',
            spray: [{ channel: 0, mode: 0, lmTime: 1644353195 }]
        });
        assert.equal(entries[0]?.mode, 'light');
        assert.equal(
            decodeDiffuserSprayGetAck({ spray: [{ channel: 0, mode: 1 }] })[0]?.mode,
            'strong'
        );
    });

    it('rejects an unknown spray mode', () => {
        assert.throws(
            () => decodeDiffuserSprayGetAck({ spray: [{ channel: 0, mode: 9 }] }),
            ProtocolError
        );
    });
});

describe('Diffuser.Sensor codec', () => {
    it('encodes GET as an empty payload', () => {
        assert.deepEqual(encodeDiffuserSensorGet(), {});
    });

    it('decodes humidity percent and temperature tenths as Celsius', () => {
        const decoded = decodeDiffuserSensorGetAck({
            type: 'mod100',
            humidity: { lmTime: 1, value: 70 },
            temperature: { lmTime: 1, value: 365, unit: 0 }
        });
        assert.equal(decoded.humidity, 70);
        assert.equal(decoded.temperature, 36.5);
    });
});
