'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const sdk = require('../dist/index.js');

describe('CJS public surface', () => {
    it('exports Session, SwitchTrait, and NotImplementedError', () => {
        assert.equal(typeof sdk.Session, 'function');
        assert.equal(typeof sdk.SwitchTrait, 'function');
        assert.equal(typeof sdk.NotImplementedError, 'function');
    });

    it('does not export protocol or transport internals', () => {
        assert.equal(sdk.MqttManager, undefined);
        assert.equal(sdk.HttpManager, undefined);
        assert.equal(sdk.Transport, undefined);
        assert.equal(sdk.Device, undefined);
        assert.equal(sdk.namespaces, undefined);
        assert.equal(sdk.encodeToggleXSet, undefined);
        assert.equal(sdk.PendingRequests, undefined);
        assert.equal(sdk.ProtocolDispatcher, undefined);
        assert.equal(sdk.CommandError, undefined);
        assert.equal(sdk.encryptPayload, undefined);
        assert.equal(sdk.EcdheHandshake, undefined);
        assert.equal(sdk.deriveEncryptionKey, undefined);
    });
});
