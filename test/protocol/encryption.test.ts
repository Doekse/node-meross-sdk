import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { ProtocolError } from '../../src/errors';
import {
    ENCRYPT_ECDHE_NAMESPACE,
    ENCRYPT_SUITE_NAMESPACE,
    EcdheHandshake,
    decodeEncryptEcdheSetAck,
    decodeEncryptSuiteGetAck,
    decryptPayload,
    deriveEncryptionKey,
    encodeEncryptEcdheSet,
    encryptPayload,
    macAddressFromUuid,
    supportsLanEncryption
} from '../../src/protocol/encryption';
import { decodeMessage, encodeMessage } from '../../src/protocol/message';

const fixturesDir = join(process.cwd(), 'test/fixtures');
const key = deriveEncryptionKey(
    '12345678-0000-0000-0000-000000000000',
    '0123456789abcdefghijklmnopqr',
    'aa:bb:cc:dd:ee:ff'
);

function loadFixture(name: string) {
    return decodeMessage(
        JSON.parse(readFileSync(join(fixturesDir, name), 'utf8')) as unknown
    );
}

describe('mrskey AES-256-CBC', () => {
    it('derives a 32-byte key from the uuid/mrskey/mac mix', () => {
        assert.equal(key.toString('utf8'), 'c197d53870ee031ee86446050a7ae2c2');
    });

    it('infers MAC from the trailing 12 hex digits of the uuid', () => {
        assert.equal(
            macAddressFromUuid('2206138957096651080248e1e99705a4'),
            '48:e1:e9:97:05:a4'
        );
    });

    it('encrypts with a frozen ciphertext so padding and IV stay pinned', () => {
        assert.equal(encryptPayload('ping', key), 'fcUs01G3zssRHwxVlbTMsw==');
        assert.equal(decryptPayload('fcUs01G3zssRHwxVlbTMsw==', key), 'ping');
    });

    it('round-trips a signed envelope the way LAN HTTP will wrap bodies', () => {
        const message = encodeMessage({
            namespace: 'Appliance.Control.ToggleX',
            method: 'GET',
            key: 'k',
            from: '/app/1/subscribe',
            payload: loadFixture('togglex-get.json').payload,
            messageId: '91a936cd22f48cb18b210c649e42b5b3',
            timestamp: 1673927162
        });
        const json = JSON.stringify(message);
        const plain = decryptPayload(encryptPayload(json, key), key);
        assert.equal(plain, json);
        assert.deepEqual(decodeMessage(plain, 'k'), message);
    });

    it('always pads a full block when plaintext is already aligned', () => {
        const aligned = '0123456789abcdef';
        const cipher = encryptPayload(aligned, key);
        assert.equal(Buffer.from(cipher, 'base64').length, 32);
        assert.equal(decryptPayload(cipher, key), aligned);
    });
});

describe('Encrypt.Suite codec', () => {
    it('GET payload is empty in the firmware example', () => {
        const get = loadFixture('encrypt-suite-get.json');

        assert.equal(get.header.namespace, ENCRYPT_SUITE_NAMESPACE);
        assert.deepEqual(get.payload, {});
    });

    it('decodes GETACK ka/se/ds from the firmware example', () => {
        const getack = loadFixture('encrypt-suite-getack.json');

        assert.deepEqual(decodeEncryptSuiteGetAck(getack.payload), {
            ka: 'ecdhe256',
            se: 'mrskey',
            ds: ''
        });
    });

    it('rejects GETACK when suite fields are missing', () => {
        assert.throws(
            () => decodeEncryptSuiteGetAck({ suite: { ka: 'ecdhe256' } }),
            (err: unknown) => err instanceof ProtocolError
        );
    });
});

describe('Encrypt.ECDHE codec and handshake', () => {
    it('encodes SET step 1 from the firmware example', () => {
        const pubkey = '273A6A98B87C9CD123456789AF273A6A98B87C9CD123456789AF273ABCD1234';
        const set = loadFixture('encrypt-ecdhe-set.json');

        assert.equal(set.header.namespace, ENCRYPT_ECDHE_NAMESPACE);
        assert.deepEqual(encodeEncryptEcdheSet(pubkey), set.payload);
    });

    it('decodes SETACK step 2 from the firmware example', () => {
        const pubkey = '273A6A98B87C9CD123456789AF273A6A98B87C9CD123456789AF273ABCD1234';
        const setack = loadFixture('encrypt-ecdhe-setack.json');

        assert.deepEqual(decodeEncryptEcdheSetAck(setack.payload), { step: 2, pubkey });
    });

    it('rejects SETACK when step is not 2', () => {
        assert.throws(
            () => decodeEncryptEcdheSetAck({ ecdhe: { step: 1, pubkey: 'abc' } }),
            (err: unknown) => err instanceof ProtocolError
        );
    });

    it('completes a P-256 handshake so both peers share the same secret', () => {
        const client = new EcdheHandshake();
        const device = new EcdheHandshake();
        const secret = client.computeSharedSecret(device.publicKey());
        assert.deepEqual(secret, device.computeSharedSecret(client.publicKey()));
        assert.equal(secret.length, 32);
    });
});

describe('LAN encryption ability', () => {
    it('is advertised by Appliance.Encrypt.ECDHE', () => {
        assert.equal(supportsLanEncryption({ [ENCRYPT_ECDHE_NAMESPACE]: {} }), true);
    });

    it('is not advertised by Encrypt.Suite alone', () => {
        assert.equal(supportsLanEncryption({ [ENCRYPT_SUITE_NAMESPACE]: {} }), false);
        assert.equal(supportsLanEncryption({}), false);
    });
});
