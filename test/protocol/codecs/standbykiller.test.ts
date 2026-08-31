import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ProtocolError } from '../../../src/errors';
import {
    decodeStandbyKillerGetAck,
    decodeStandbyKillerPush,
    encodeStandbyKillerGet,
    encodeStandbyKillerSet
} from '../../../src/protocol/codecs/standbykiller';

describe('Config.StandbyKiller codec', () => {
    it('encodes GET for a channel', () => {
        assert.deepEqual(encodeStandbyKillerGet(0), {
            config: [{ channel: 0 }]
        });
    });

    it('encodes SET converting watts to milliwatts and enable 1/2', () => {
        assert.deepEqual(
            encodeStandbyKillerSet({
                channel: 0,
                power: 5,
                time: 300,
                enabled: true,
                alert: false
            }),
            {
                config: [{
                    channel: 0,
                    power: 5000,
                    time: 300,
                    enable: 1,
                    alert: 2
                }]
            }
        );
    });

    it('encodes SET with only the fields the caller supplies', () => {
        assert.deepEqual(
            encodeStandbyKillerSet({ channel: 1, enabled: false }),
            { config: [{ channel: 1, enable: 2 }] }
        );
    });

    it('decodes a firmware GETACK row', () => {
        const payload = {
            config: [{
                channel: 0,
                power: 0,
                time: 300,
                enable: 2,
                alert: 2
            }]
        };

        assert.deepEqual(decodeStandbyKillerGetAck(payload), [{
            channel: 0,
            power: 0,
            time: 300,
            enabled: false,
            alert: false
        }]);
    });

    it('decodes PUSH with the same shape as GETACK', () => {
        const payload = {
            config: [{
                channel: 0,
                power: 0,
                time: 300,
                enable: 2,
                alert: 2
            }]
        };

        assert.deepEqual(decodeStandbyKillerPush(payload), decodeStandbyKillerGetAck(payload));
    });

    it('decodes an empty config as no rows', () => {
        assert.deepEqual(decodeStandbyKillerGetAck({ config: [] }), []);
        assert.deepEqual(decodeStandbyKillerGetAck({}), []);
    });

    it('tolerates missing optional fields and converts power to watts', () => {
        assert.deepEqual(
            decodeStandbyKillerGetAck({ config: [{ channel: 0, power: 1500 }] }),
            [{ channel: 0, power: 1.5 }]
        );
    });

    it('rejects a non-array config', () => {
        assert.throws(
            () => decodeStandbyKillerGetAck({ config: { channel: 0 } }),
            (err: unknown) => err instanceof ProtocolError
        );
    });

    it('rejects an invalid enable flag', () => {
        assert.throws(
            () => decodeStandbyKillerGetAck({
                config: [{ channel: 0, enable: 3 }]
            }),
            (err: unknown) => err instanceof ProtocolError
        );
    });

    it('rejects an invalid alert flag', () => {
        assert.throws(
            () => decodeStandbyKillerGetAck({
                config: [{ channel: 0, alert: 0 }]
            }),
            (err: unknown) => err instanceof ProtocolError
        );
    });
});
