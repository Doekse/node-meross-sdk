import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ProtocolError } from '../../src/errors';
import {
    decodePresenceConfigGetAck,
    decodePresenceConfigPush,
    encodePresenceConfigGet,
    encodePresenceConfigSet,
    encodePresenceStudySet
} from '../../src/protocol/codecs/presence';

const SAMPLE_CONFIG_PAYLOAD = {
    config: [
        {
            channel: 0,
            mode: { workMode: 1, testMode: 2 },
            noBodyTime: { time: 15 },
            distance: { value: 8100 },
            sensitivity: { level: 2 },
            mthx: { mth1: 120, mth2: 72, mth3: 72 }
        }
    ]
};

describe('presence codec', () => {
    describe('encodePresenceConfigGet', () => {
        it('wraps channel in a config array', () => {
            assert.deepEqual(encodePresenceConfigGet(0), { config: [{ channel: 0 }] });
        });
    });

    describe('encodePresenceConfigSet', () => {
        it('converts distance from meters to mm', () => {
            const payload = encodePresenceConfigSet({ channel: 0, distance: 8.1 });
            const entry = (payload.config as Array<Record<string, unknown>>)[0];
            assert.deepEqual(entry.distance, { value: 8100 });
        });

        it('omits absent sub-keys', () => {
            const payload = encodePresenceConfigSet({ channel: 0, sensitivity: 2 });
            const entry = (payload.config as Array<Record<string, unknown>>)[0];
            assert.equal('noBodyTime' in entry, false);
            assert.equal('distance' in entry, false);
            assert.deepEqual(entry.sensitivity, { level: 2 });
        });

        it('encodes noBodyTime as { time }', () => {
            const payload = encodePresenceConfigSet({ channel: 0, noBodyTime: 15 });
            const entry = (payload.config as Array<Record<string, unknown>>)[0];
            assert.deepEqual(entry.noBodyTime, { time: 15 });
        });

        it('passes mode fields through', () => {
            const payload = encodePresenceConfigSet({ channel: 0, mode: { workMode: 1, testMode: 2 } });
            const entry = (payload.config as Array<Record<string, unknown>>)[0];
            assert.deepEqual(entry.mode, { workMode: 1, testMode: 2 });
        });
    });

    describe('decodePresenceConfigGetAck', () => {
        it('parses the meross_lan ms600 sample payload', () => {
            const [entry] = decodePresenceConfigGetAck(SAMPLE_CONFIG_PAYLOAD);
            assert.equal(entry.channel, 0);
            assert.equal(entry.noBodyTime, 15);
            assert.equal(entry.distance, 8.1);
            assert.equal(entry.sensitivity, 2);
            assert.deepEqual(entry.mode, { workMode: 1, testMode: 2 });
        });

        it('throws on non-array config', () => {
            assert.throws(
                () => decodePresenceConfigGetAck({ config: {} }),
                ProtocolError
            );
        });

        it('throws on entry without channel', () => {
            assert.throws(
                () => decodePresenceConfigGetAck({ config: [{ noBodyTime: { time: 5 } }] }),
                ProtocolError
            );
        });

        it('throws when a required nested field is missing', () => {
            assert.throws(
                () => decodePresenceConfigGetAck({
                    config: [{
                        channel: 0,
                        noBodyTime: { time: 15 },
                        distance: { value: 8100 },
                        sensitivity: { level: 2 }
                    }]
                }),
                ProtocolError
            );
        });
    });

    describe('decodePresenceConfigPush', () => {
        it('delegates to the same decoder as GETACK', () => {
            const [entry] = decodePresenceConfigPush(SAMPLE_CONFIG_PAYLOAD);
            assert.equal(entry.channel, 0);
            assert.equal(entry.noBodyTime, 15);
        });
    });

    describe('encodePresenceStudySet', () => {
        it('starts calibration as study[{ channel, status: 1 }]', () => {
            assert.deepEqual(encodePresenceStudySet(0), { study: [{ channel: 0, status: 1 }] });
        });
    });
});
