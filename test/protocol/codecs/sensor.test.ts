import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ProtocolError } from '../../../src/errors';
import {
    decodeSmokeConfigGetAck,
    decodeSmokeConfigPush,
    encodeSmokeConfigGet,
    encodeSmokeConfigSet
} from '../../../src/protocol/codecs/sensor';

describe('Control.Smoke.Config codec', () => {
    it('encodes GET as a config array with channel and subId', () => {
        assert.deepEqual(encodeSmokeConfigGet({ channel: 0, subId: '123456' }), {
            config: [{ channel: 0, subId: '123456' }]
        });
    });

    it('omits subId from GET when not provided', () => {
        assert.deepEqual(encodeSmokeConfigGet({ channel: 0 }), {
            config: [{ channel: 0 }]
        });
    });

    it('encodes SET dnd and detect enable flags as 1/2', () => {
        assert.deepEqual(encodeSmokeConfigSet({
            channel: 0,
            subId: '123456',
            dndEnabled: true,
            detectEnabled: false
        }), {
            config: [{
                channel: 0,
                subId: '123456',
                dnd: { enable: 1 },
                detect: { enable: 2 }
            }]
        });
    });

    it('omits absent SET sub-keys', () => {
        const payload = encodeSmokeConfigSet({ channel: 0, subId: '123456', dndEnabled: true });
        const entry = (payload.config as Array<Record<string, unknown>>)[0];
        assert.equal('detect' in entry, false);
        assert.deepEqual(entry.dnd, { enable: 1 });
    });

    it('decodes firmware GETACK dnd and detect flags', () => {
        const [entry] = decodeSmokeConfigGetAck({
            config: [{
                channel: 0,
                subId: '123456',
                dnd: { enable: 1 },
                detect: { enable: 1 }
            }]
        });
        assert.equal(entry.channel, 0);
        assert.equal(entry.subId, '123456');
        assert.equal(entry.dndEnabled, true);
        assert.equal(entry.detectEnabled, true);
    });

    it('decodes PUSH with the same decoder as GETACK', () => {
        const [entry] = decodeSmokeConfigPush({
            config: [{ channel: 0, subId: '123456', dnd: { enable: 2 } }]
        });
        assert.equal(entry.channel, 0);
        assert.equal(entry.dndEnabled, false);
    });

    it('rejects a non-array config payload', () => {
        assert.throws(() => decodeSmokeConfigGetAck({ config: {} }), ProtocolError);
    });

    it('rejects an entry missing channel', () => {
        assert.throws(() => decodeSmokeConfigGetAck({ config: [{ subId: '123456' }] }), ProtocolError);
    });
});
