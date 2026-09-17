import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ProtocolError } from '../../../src/errors';
import { decodeArray, encodeArray } from '../../../src/protocol/codecs/payload';

function assertProtocolMessage(fn: () => unknown, message: string): void {
    assert.throws(fn, (err: unknown) => {
        assert.ok(err instanceof ProtocolError);
        assert.equal(err.message, message);
        return true;
    });
}

describe('encodeArray', () => {
    it('wraps one entry under the firmware list key', () => {
        const entry = { channel: 0 };

        const payload = encodeArray('alarm', entry);

        assert.deepEqual(payload, { alarm: [{ channel: 0 }] });
        assert.equal((payload.alarm as unknown[])[0], entry);
    });

    it('allocates a new wrap for each key and call', () => {
        const first = encodeArray('alarm', { channel: 0 });
        const second = encodeArray('control', { channel: 1 });

        assert.notEqual(first.alarm, second.control);
        assert.deepEqual(first, { alarm: [{ channel: 0 }] });
        assert.deepEqual(second, { control: [{ channel: 1 }] });
    });
});

describe('decodeArray', () => {
    it('returns the same row object references on a new list', () => {
        const row = { channel: 0 };
        const raw = [row];
        const rows = decodeArray({ control: raw }, 'control', 'Control.Water');

        assert.equal(rows.length, 1);
        assert.equal(rows[0], row);
        assert.notEqual(rows, raw);
    });

    it('returns an empty list when the array is empty', () => {
        assert.deepEqual(decodeArray({ control: [] }, 'control', 'Control.Water'), []);
    });

    it('rejects a missing key, object, null, or scalar with the list-key message', () => {
        const message = 'Control.Water payload must contain a control array';
        for (const payload of [{}, { control: {} }, { control: null }, { control: 1 }]) {
            assertProtocolMessage(
                () => decodeArray(payload, 'control', 'Control.Water'),
                message
            );
        }
    });

    it('interpolates a second firmware key and label into the list-slot error', () => {
        assertProtocolMessage(
            () => decodeArray({}, 'latest', 'Control.Sensor.Latest'),
            'Control.Sensor.Latest payload must contain a latest array'
        );
    });

    it('rejects a null or number row', () => {
        const message = 'Control.Water entry must be an object';
        for (const row of [null, 1]) {
            assertProtocolMessage(
                () => decodeArray({ control: [row] }, 'control', 'Control.Water'),
                message
            );
        }
    });

    it('rejects a mixed list on the first non-object row', () => {
        assertProtocolMessage(
            () => decodeArray({ control: [{ channel: 0 }, 1] }, 'control', 'Control.Water'),
            'Control.Water entry must be an object'
        );
    });

    /**
     * Nested arrays currently pass (`typeof [] === 'object'`). Callers own
     * field maps; tightening this would change decode of malformed GETACKs.
     */
    it('keeps a nested array row as an object entry', () => {
        const row: unknown[] = [1];
        const rows = decodeArray({ control: [row] }, 'control', 'Control.Water');

        assert.equal(rows.length, 1);
        assert.equal(rows[0], row);
    });
});
