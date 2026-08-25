import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ProtocolError } from '../../../src/errors';
import { decodeHubOnline } from '../../../src/protocol/codecs/online';

describe('Hub.Online codec', () => {
    it('decodes status 1 as online', () => {
        assert.deepEqual(decodeHubOnline({
            online: [
                { id: '00000101', status: 1, lastActiveTime: 148222212335 },
                { id: '00000102', status: 2 }
            ]
        }), [
            { id: '00000101', online: true },
            { id: '00000102', online: false }
        ]);
    });

    it('skips exception-only rows that have no status', () => {
        assert.deepEqual(decodeHubOnline({
            online: [
                { id: 'ghost', exception: { code: 5062 } },
                { id: '00000101', status: 1 }
            ]
        }), [
            { id: '00000101', online: true }
        ]);
    });

    it('rejects a missing or non-array online payload', () => {
        assert.throws(() => decodeHubOnline({}), ProtocolError);
        assert.throws(() => decodeHubOnline({ online: { status: 1 } }), ProtocolError);
    });
});
