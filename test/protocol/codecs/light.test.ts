import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    LIGHT_CAPACITY_EFFECT,
    LIGHT_CAPACITY_LUMINANCE,
    LIGHT_CAPACITY_RGB,
    LIGHT_CAPACITY_TEMPERATURE,
    decodeLightGetAck,
    encodeLightGet,
    encodeLightSet
} from '../../../src/protocol/codecs/light';

describe('Control.Light codec', () => {
    it('encodes GET with an empty payload', () => {
        assert.deepEqual(encodeLightGet(), {});
    });

    it('encodes SET as a single light object', () => {
        const payload = encodeLightSet({
            channel: 0,
            capacity: LIGHT_CAPACITY_RGB | LIGHT_CAPACITY_TEMPERATURE | LIGHT_CAPACITY_LUMINANCE | LIGHT_CAPACITY_EFFECT,
            rgb: 0x112233,
            temperature: 10,
            luminance: 50,
            effect: 2,
            onoff: true
        });

        assert.deepEqual(payload, {
            light: {
                channel: 0,
                capacity: LIGHT_CAPACITY_RGB | LIGHT_CAPACITY_TEMPERATURE | LIGHT_CAPACITY_LUMINANCE | LIGHT_CAPACITY_EFFECT,
                rgb: 0x112233,
                temperature: 10,
                luminance: 50,
                effect: 2,
                onoff: 1
            }
        });
    });

    it('decodes GETACK/PUSH fields and ignores -1 unsupported values', () => {
        const decoded = decodeLightGetAck({
            light: {
                channel: 0,
                capacity: LIGHT_CAPACITY_RGB | LIGHT_CAPACITY_LUMINANCE | LIGHT_CAPACITY_TEMPERATURE,
                rgb: 0x112233,
                temperature: -1,
                luminance: 50,
                effect: -1,
                onoff: 0
            }
        });

        assert.equal(decoded.channel, 0);
        assert.equal(decoded.capacity, LIGHT_CAPACITY_RGB | LIGHT_CAPACITY_LUMINANCE | LIGHT_CAPACITY_TEMPERATURE);
        assert.deepEqual(decoded.rgb, 0x112233);
        assert.equal(decoded.temperature, undefined);
        assert.equal(decoded.luminance, 50);
        assert.equal(decoded.effect, undefined);
        assert.equal(decoded.onoff, false);
    });

    it('rejects malformed Control.Light payload', () => {
        assert.throws(
            () => decodeLightGetAck({ light: null }),
            (err: unknown) => err instanceof Error
        );
    });
});

