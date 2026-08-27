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
    it('encodes GET and SET', () => {
        assert.deepEqual(encodeStandbyKillerGet(0), {
            config: [{ channel: 0 }]
        });
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
        assert.deepEqual(
            encodeStandbyKillerSet({ channel: 1, enabled: false }),
            { config: [{ channel: 1, enable: 2 }] }
        );
    });

    it('decodes MSS305 GETACK/PUSH and empty config', () => {
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
        assert.deepEqual(decodeStandbyKillerPush(payload), decodeStandbyKillerGetAck(payload));
        assert.deepEqual(decodeStandbyKillerGetAck({ config: [] }), []);
        assert.deepEqual(decodeStandbyKillerGetAck({}), []);
    });

    it('tolerates missing optional fields and converts power to watts', () => {
        assert.deepEqual(
            decodeStandbyKillerGetAck({ config: [{ channel: 0, power: 1500 }] }),
            [{ channel: 0, power: 1.5 }]
        );
    });

    it('rejects a non-array config or invalid enable/alert', () => {
        assert.throws(
            () => decodeStandbyKillerGetAck({ config: { channel: 0 } }),
            (err: unknown) => err instanceof ProtocolError
        );
        assert.throws(
            () => decodeStandbyKillerGetAck({
                config: [{ channel: 0, enable: 3 }]
            }),
            (err: unknown) => err instanceof ProtocolError
        );
        assert.throws(
            () => decodeStandbyKillerGetAck({
                config: [{ channel: 0, alert: 0 }]
            }),
            (err: unknown) => err instanceof ProtocolError
        );
    });
});
