'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const sdk = require('..');

describe('CJS public surface', () => {
    it('exports Session, Endpoint, Inventory, and public errors', () => {
        assert.equal(typeof sdk.Session, 'function');
        assert.equal(typeof sdk.Session.login, 'function');
        assert.equal(typeof sdk.Session.restore, 'function');
        assert.equal(typeof sdk.Session.prototype.connect, 'function');
        assert.equal(typeof sdk.Session.prototype.disconnect, 'function');
        assert.equal(typeof sdk.Session.prototype.endpoint, 'function');
        assert.equal(typeof sdk.Session.prototype.getToken, 'function');
        assert.equal(typeof sdk.Session.prototype.listDevices, 'function');
        assert.equal(typeof sdk.Session.prototype.sync, 'function');
        assert.equal(typeof sdk.Endpoint, 'function');
        assert.equal(typeof sdk.Inventory, 'function');
        assert.equal(typeof sdk.AuthError, 'function');
        assert.equal(typeof sdk.CloudError, 'function');
        assert.equal(typeof sdk.MerossError, 'function');
        assert.equal(typeof sdk.CommandError, 'function');
        assert.equal(typeof sdk.TransportError, 'function');
        assert.equal(typeof sdk.ProtocolError, 'function');
        assert.ok(new sdk.CommandError('x') instanceof sdk.MerossError);
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
        assert.equal(sdk.encryptPayload, undefined);
        assert.equal(sdk.EcdheHandshake, undefined);
        assert.equal(sdk.deriveEncryptionKey, undefined);
        assert.equal(sdk.CloudClient, undefined);
        assert.equal(sdk.CloudDevice, undefined);
        assert.equal(sdk.MqttTransport, undefined);
        assert.equal(sdk.connectMqtt, undefined);
        assert.equal(sdk.defaultConnect, undefined);
        assert.equal(sdk.DeviceGraph, undefined);
        assert.equal(sdk.enrollPhysicalDevice, undefined);
        assert.equal(sdk.decodeAbilityGetAck, undefined);
        assert.equal(sdk.encodeArray, undefined);
        assert.equal(sdk.decodeArray, undefined);
        assert.equal(sdk.SwitchTrait, undefined);
        assert.equal(sdk.ClimateTrait, undefined);
        assert.equal(sdk.SensorTrait, undefined);
        assert.equal(sdk.NotImplementedError, undefined);
        assert.equal(sdk.SessionOptions, undefined);
    });
});
