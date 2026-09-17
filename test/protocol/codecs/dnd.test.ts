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
    it('encodes GET as { DNDMode: {} }', () => {
        assert.deepEqual(encodeDndGet(), { DNDMode: {} });
    });

    it('encodes SET with LED on as mode 0', () => {
        assert.deepEqual(encodeDndSet({ on: true }), {
            DNDMode: { mode: 0 }
        });
        assert.deepEqual(encodeDndSet({ on: false }), {
            DNDMode: { mode: 1 }
        });
    });

    it('decodes GETACK mode 1 as LED off', () => {
        assert.deepEqual(decodeDndGetAck({ DNDMode: { mode: 1 } }), { on: false });
    });

    it('decodes PUSH mode 0 as LED on', () => {
        assert.deepEqual(decodeDndPush({ DNDMode: { mode: 0 } }), { on: true });
    });

    it('rejects a missing DNDMode object', () => {
        assert.throws(() => decodeDndGetAck({}), ProtocolError);
    });

    it('rejects an unknown DND mode value', () => {
        assert.throws(() => decodeDndGetAck({ DNDMode: { mode: 2 } }), ProtocolError);
    });
});
