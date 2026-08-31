import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ProtocolError } from '../../../src/errors';
import {
    decodeDndGetAck,
    decodeDndPush,
    encodeDndGet,
    encodeDndSet
} from '../../../src/protocol/codecs/dnd';

describe('System.DNDMode codec', () => {
    it('encodes GET as an empty payload', () => {
        assert.deepEqual(encodeDndGet(), {});
    });

    it('encodes SET with mode 0/1', () => {
        assert.deepEqual(encodeDndSet({ on: true }), {
            DNDMode: { mode: 1 }
        });
        assert.deepEqual(encodeDndSet({ on: false }), {
            DNDMode: { mode: 0 }
        });
    });

    it('decodes GETACK mode 1 as on', () => {
        assert.deepEqual(decodeDndGetAck({ DNDMode: { mode: 1 } }), { on: true });
    });

    it('decodes PUSH mode 0 as off', () => {
        assert.deepEqual(decodeDndPush({ DNDMode: { mode: 0 } }), { on: false });
    });

    it('rejects a missing DNDMode object', () => {
        assert.throws(() => decodeDndGetAck({}), ProtocolError);
    });

    it('rejects an unknown DND mode value', () => {
        assert.throws(() => decodeDndGetAck({ DNDMode: { mode: 2 } }), ProtocolError);
    });
});
