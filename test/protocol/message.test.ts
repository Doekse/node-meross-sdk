import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { ProtocolError } from '../../src/errors';
import {
    DEFAULT_TRIGGER_SRC,
    PAYLOAD_VERSION,
    decodeMessage,
    encodeMessage
} from '../../src/protocol/message';
import { signMessage, verifySignature } from '../../src/protocol/sign';

const fixturesDir = join(process.cwd(), 'test/fixtures');

/**
 * Lifted from docs/firmware-api.md Appliance.Control.ToggleX examples.
 * Signs in those captures cannot be verified without the original cloud key.
 */
const FIRMWARE_FIXTURES = [
    'togglex-set.json',
    'togglex-setack.json',
    'togglex-get.json',
    'togglex-getack-one.json',
    'togglex-getack-all.json',
    'togglex-push.json'
] as const;

function loadFixture(name: string): unknown {
    return JSON.parse(readFileSync(join(fixturesDir, name), 'utf8')) as unknown;
}

describe('protocol sign', () => {
    it('hashes messageId + key + timestamp as lowercase MD5 hex', () => {
        const messageId = '91a936cd22f48cb18b210c649e42b5b3';
        const key = 'test-key';
        const timestamp = 1673927162;
        const sign = signMessage(messageId, key, timestamp);

        assert.equal(sign, 'e551280644ced2d6d8e35cb071a27e11');
        assert.notEqual(sign, signMessage(messageId, 'other-key', timestamp));
        assert.notEqual(sign, signMessage(messageId, key, timestamp + 1));
    });

    it('does not mix the payload into the signature', () => {
        const shared = {
            namespace: 'Appliance.Control.ToggleX',
            method: 'SET',
            key: 'k',
            from: '/app/1/subscribe',
            messageId: '91a936cd22f48cb18b210c649e42b5b3',
            timestamp: 1673927162
        };
        const off = encodeMessage({ ...shared, payload: { togglex: { onoff: 0, channel: 0 } } });
        const on = encodeMessage({ ...shared, payload: { togglex: { onoff: 1, channel: 0 } } });
        assert.equal(off.header.sign, on.header.sign);
        assert.notDeepEqual(off.payload, on.payload);
    });

    it('accepts uppercase hex signs from firmware that emit them', () => {
        const messageId = 'e41c0fd0cb56bf9e1004f58718290c4a';
        const timestamp = 1673925168;
        const sign = signMessage(messageId, 'k', timestamp);
        assert.equal(
            verifySignature({ messageId, timestamp, sign: sign.toUpperCase() }, 'k'),
            true
        );
    });

    it('rejects a signature produced with a different key', () => {
        const messageId = 'e41c0fd0cb56bf9e1004f58718290c4a';
        const timestamp = 1673925168;
        const sign = signMessage(messageId, 'k', timestamp);
        assert.equal(
            verifySignature({ messageId, timestamp, sign }, 'wrong'),
            false
        );
    });
});

describe('protocol message envelope', () => {
    it('decodes firmware ToggleX envelope examples', () => {
        for (const name of FIRMWARE_FIXTURES) {
            const message = decodeMessage(loadFixture(name));
            assert.equal(message.header.namespace, 'Appliance.Control.ToggleX');
            assert.equal(message.header.payloadVersion, PAYLOAD_VERSION);
            assert.match(message.header.method, /^(GET|SET|GETACK|SETACK|PUSH)$/);
            assert.deepEqual(decodeMessage(JSON.stringify(message)), message);
        }
    });

    it('preserves optional firmware header fields (triggerSrc, timestampMs, uuid)', () => {
        const set = decodeMessage(loadFixture('togglex-set.json'));
        assert.equal(set.header.triggerSrc, 'CloudAlexa');
        assert.equal(set.header.timestampMs, undefined);

        const setack = decodeMessage(loadFixture('togglex-setack.json'));
        assert.equal(setack.header.timestampMs, 218);
        assert.equal(setack.header.triggerSrc, undefined);
        assert.deepEqual(setack.payload, {});

        const getack = decodeMessage(loadFixture('togglex-getack-one.json'));
        assert.equal(getack.header.uuid, '2201208098807451860148e1e986b2fb');
        assert.equal(getack.header.triggerSrc, 'CloudAlexa');
        assert.equal(getack.header.timestampMs, 749);
    });

    it('keeps GETACK object-vs-array payload shapes from the firmware examples', () => {
        const one = decodeMessage(loadFixture('togglex-getack-one.json'));
        assert.equal(Array.isArray(one.payload.togglex), false);
        assert.equal((one.payload.togglex as { channel: number }).channel, 0);

        const all = decodeMessage(loadFixture('togglex-getack-all.json'));
        assert.equal(all.payload.channel, 65535);
        assert.ok(Array.isArray(all.payload.togglex));
        assert.equal((all.payload.togglex as unknown[]).length, 5);

        const push = decodeMessage(loadFixture('togglex-push.json'));
        assert.ok(Array.isArray(push.payload.togglex));
    });

    it('encodes a signed SET around the firmware ToggleX payload', () => {
        const fixture = decodeMessage(loadFixture('togglex-set.json'));
        const encoded = encodeMessage({
            namespace: fixture.header.namespace,
            method: fixture.header.method,
            payload: fixture.payload,
            key: 'test-key',
            from: '/app/123-test/subscribe',
            messageId: fixture.header.messageId,
            timestamp: fixture.header.timestamp,
            triggerSrc: fixture.header.triggerSrc
        });

        assert.equal(encoded.header.payloadVersion, PAYLOAD_VERSION);
        assert.equal(encoded.header.timestampMs, 0);
        assert.equal(
            encoded.header.sign,
            signMessage(fixture.header.messageId, 'test-key', fixture.header.timestamp)
        );
        assert.deepEqual(encoded.payload, fixture.payload);
        assert.deepEqual(decodeMessage(JSON.stringify(encoded), 'test-key'), encoded);
    });

    it('defaults triggerSrc and generates a 32-hex messageId', () => {
        const encoded = encodeMessage({
            namespace: 'Appliance.Control.ToggleX',
            method: 'GET',
            key: 'k',
            from: '/app/1/subscribe',
            payload: { togglex: { channel: 65535 } }
        });
        assert.equal(encoded.header.triggerSrc, DEFAULT_TRIGGER_SRC);
        assert.match(encoded.header.messageId, /^[0-9a-f]{32}$/);
        assert.equal(verifySignature(encoded.header, 'k'), true);
    });

    it('omits uuid when the caller does not supply one', () => {
        const without = encodeMessage({
            namespace: 'Appliance.Control.ToggleX',
            method: 'GET',
            key: 'k',
            from: '/app/1/subscribe'
        });
        assert.equal(without.header.uuid, undefined);
    });

    it('includes uuid when the caller supplies one', () => {
        const withUuid = encodeMessage({
            namespace: 'Appliance.Control.ToggleX',
            method: 'GET',
            key: 'k',
            from: '/app/1/subscribe',
            uuid: '2201208098807451860148e1e986b2fb'
        });
        assert.equal(withUuid.header.uuid, '2201208098807451860148e1e986b2fb');
    });

    it('decodes UTF-8 buffers the way MQTT delivers payloads', () => {
        const encoded = encodeMessage({
            namespace: 'Appliance.Control.ToggleX',
            method: 'SETACK',
            key: 'k',
            from: '/appliance/abc/publish'
        });
        const decoded = decodeMessage(Buffer.from(JSON.stringify(encoded), 'utf8'), 'k');
        assert.deepEqual(decoded, encoded);
    });

    it('rejects a wrong key when decode is asked to verify', () => {
        const encoded = encodeMessage({
            namespace: 'Appliance.Control.ToggleX',
            method: 'GET',
            key: 'right',
            from: '/app/1/subscribe'
        });
        assert.throws(
            () => decodeMessage(encoded, 'wrong'),
            (err: unknown) => err instanceof ProtocolError && err.code === 'SIGNATURE_ERROR'
        );
    });

    it('accepts ERROR 5001 signed with the device key when the caller key is wrong', () => {
        // Device replies ERROR 5001 signed with its own key; the caller's wrong
        // key cannot verify. decodeMessage must still return the envelope so
        // PendingRequests can reject with INVALID_KEY.
        const reply = encodeMessage({
            namespace: 'Appliance.Control.ToggleX',
            method: 'ERROR',
            key: 'device-key',
            from: '/appliance/abc/publish',
            messageId: '91a936cd22f48cb18b210c649e42b5b3',
            timestamp: 1_700_000_000,
            payload: { error: { code: 5001 } }
        });
        const decoded = decodeMessage(reply, 'wrong-caller-key');
        assert.equal(decoded.header.method, 'ERROR');
        assert.equal(
            (decoded.payload as { error: { code: number } }).error.code,
            5001
        );
    });

    it('still rejects a non-5001 ERROR with a wrong key as SIGNATURE_ERROR', () => {
        const reply = encodeMessage({
            namespace: 'Appliance.Control.ToggleX',
            method: 'ERROR',
            key: 'device-key',
            from: '/appliance/abc/publish',
            payload: { error: { code: 5000 } }
        });
        assert.throws(
            () => decodeMessage(reply, 'wrong-caller-key'),
            (err: unknown) => err instanceof ProtocolError && err.code === 'SIGNATURE_ERROR'
        );
    });

    it('rejects an envelope missing header', () => {
        assert.throws(
            () => decodeMessage({ payload: {} }),
            (err: unknown) => err instanceof ProtocolError
        );
    });

    it('rejects an envelope missing payload', () => {
        assert.throws(
            () => decodeMessage({ header: { messageId: 'x' } }),
            (err: unknown) => err instanceof ProtocolError
        );
    });

    it('rejects a non-JSON string', () => {
        assert.throws(
            () => decodeMessage('not-json'),
            (err: unknown) => err instanceof ProtocolError
        );
    });
});
