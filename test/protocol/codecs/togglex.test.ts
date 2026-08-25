import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { ProtocolError } from '../../../src/errors';
import {
    TOGGLEX_ALL_CHANNELS,
    decodeToggleXGetAck,
    decodeToggleXPush,
    encodeToggleXGet,
    encodeToggleXSet
} from '../../../src/protocol/codecs/togglex';
import { decodeMessage } from '../../../src/protocol/message';

const fixturesDir = join(process.cwd(), 'test/fixtures');

function loadFixture(name: string) {
    return decodeMessage(
        JSON.parse(readFileSync(join(fixturesDir, name), 'utf8')) as unknown
    );
}

describe('ToggleX codec', () => {
    it('encodes SET as a firmware object without lmTime', () => {
        const fixture = loadFixture('togglex-set.json');
        const payload = encodeToggleXSet({ channel: 0, on: false, entity: 1 });

        assert.equal(Array.isArray(payload.togglex), false);
        assert.deepEqual(payload, fixture.payload);
        assert.deepEqual(encodeToggleXSet({ channel: 2, on: true }).togglex, {
            onoff: 1,
            channel: 2
        });
    });

    it('encodes SET touch: 1 only when asked to bump lmTime without switching', () => {
        assert.deepEqual(
            encodeToggleXSet({ channel: 0, on: true, touch: true }).togglex,
            { onoff: 1, channel: 0, touch: 1 }
        );
    });

    it('encodes GET as an object and defaults channel to 0xffff', () => {
        const all = encodeToggleXGet();
        assert.equal(Array.isArray(all.togglex), false);
        assert.deepEqual(all, { togglex: { channel: TOGGLEX_ALL_CHANNELS } });
        assert.deepEqual(
            encodeToggleXGet({ channel: 0, entity: 1 }),
            loadFixture('togglex-get.json').payload
        );
    });

    it('decodes GETACK object (one channel) and array (0xffff) from firmware examples', () => {
        const one = loadFixture('togglex-getack-one.json');
        assert.equal(Array.isArray(one.payload.togglex), false);
        assert.deepEqual(decodeToggleXGetAck(one.payload), [
            { channel: 0, on: true, entity: 1, lmTime: 1673911325 }
        ]);

        const all = loadFixture('togglex-getack-all.json');
        assert.ok(Array.isArray(all.payload.togglex));
        assert.equal(all.payload.channel, TOGGLEX_ALL_CHANNELS);
        assert.deepEqual(decodeToggleXGetAck(all.payload), [
            { channel: 0, on: true, lmTime: 1673855028 },
            { channel: 1, on: true, lmTime: 1673855028 },
            { channel: 2, on: true, lmTime: 1673855028 },
            { channel: 3, on: true, lmTime: 1673855028 },
            { channel: 4, on: true, lmTime: 1673855028 }
        ]);
    });

    it('decodes firmware PUSH as an array of channel states', () => {
        const fixture = loadFixture('togglex-push.json');
        assert.ok(Array.isArray(fixture.payload.togglex));
        assert.deepEqual(decodeToggleXPush(fixture.payload), [
            { channel: 0, on: true, entity: 1, lmTime: 1673934346 }
        ]);
    });

    it('decodes historical single-channel PUSH when togglex is an object', () => {
        assert.deepEqual(
            decodeToggleXPush({ togglex: { channel: 0, onoff: 1 } }),
            [{ channel: 0, on: true }]
        );
    });

    it('rejects channel entries missing channel or onoff', () => {
        assert.throws(
            () => decodeToggleXGetAck({ togglex: { onoff: 1 } }),
            (err: unknown) => err instanceof ProtocolError
        );
    });
});
