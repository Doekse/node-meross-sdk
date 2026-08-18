import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { ProtocolError } from '../../../src/errors';
import {
    HUB_TOGGLEX_NAMESPACE,
    MULTIPLE_NAMESPACE,
    SYSTEM_ALL_NAMESPACE,
    TOGGLEX_NAMESPACE,
    canPackInMultiple,
    decodeMultipleAck,
    encodeMultipleSet
} from '../../../src/protocol';
import { decodeMessage } from '../../../src/protocol/message';

const fixturesDir = join(process.cwd(), 'test/fixtures');

function loadFixture(name: string) {
    return decodeMessage(
        JSON.parse(readFileSync(join(fixturesDir, name), 'utf8')) as unknown
    );
}

describe('Control.Multiple codec', () => {
    it('encodes SET as the firmware example (object headers, no nested envelope)', () => {
        const fixture = loadFixture('multiple-set.json');
        const payload = encodeMultipleSet([
            {
                header: { method: 'SET', namespace: TOGGLEX_NAMESPACE },
                payload: { togglex: { onoff: 0, channel: 0 } }
            }
        ]);

        assert.equal(fixture.header.namespace, MULTIPLE_NAMESPACE);
        assert.deepEqual(payload, fixture.payload);
    });

    it('decodes SETACK sub-commands in order from the firmware example', () => {
        const fixture = loadFixture('multiple-setack.json');
        assert.equal(fixture.header.method, 'SETACK');
        assert.deepEqual(decodeMultipleAck(fixture.payload), [
            {
                header: { namespace: TOGGLEX_NAMESPACE, method: 'SETACK' },
                payload: {}
            }
        ]);
    });

    it('does not pack System.All, Control.Multiple, or Hub.ToggleX', () => {
        assert.equal(canPackInMultiple(TOGGLEX_NAMESPACE), true);
        for (const namespace of [MULTIPLE_NAMESPACE, SYSTEM_ALL_NAMESPACE, HUB_TOGGLEX_NAMESPACE]) {
            assert.equal(canPackInMultiple(namespace), false);
        }
    });

    it('rejects a SETACK without a multiple array', () => {
        assert.throws(() => decodeMultipleAck({}), ProtocolError);
        assert.throws(() => decodeMultipleAck({ multiple: ['nope'] }), ProtocolError);
    });
});
