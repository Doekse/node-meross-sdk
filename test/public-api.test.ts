import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    AuthError,
    CloudError,
    Endpoint,
    Inventory,
    Session,
    SwitchTrait
} from '../src/index';
import { TOGGLEX_NAMESPACE } from '../src/protocol';
import { encodeMessage } from '../src/protocol';

describe('public API', () => {
    it('exposes Session.login, restore, and prototype methods', () => {
        assert.equal(typeof Session.login, 'function');
        assert.equal(typeof Session.restore, 'function');
        assert.equal(typeof Session.prototype.connect, 'function');
        assert.equal(typeof Session.prototype.disconnect, 'function');
        assert.equal(typeof Session.prototype.endpoint, 'function');
        assert.equal(typeof Session.prototype.getToken, 'function');
        assert.equal(typeof Session.prototype.sync, 'function');
        assert.equal(typeof Session.prototype.on, 'function');
    });

    it('exposes AuthError and CloudError for login and token failures', () => {
        assert.equal(typeof AuthError, 'function');
        assert.equal(typeof CloudError, 'function');
        const expired = new AuthError('Unauthorized', 'TOKEN_EXPIRED');
        assert.ok(expired instanceof AuthError);
        assert.equal(expired.code, 'TOKEN_EXPIRED');
    });

    it('Session.restore returns a session with a copyable token', () => {
        const session = Session.restore({
            token: 't',
            key: 'k',
            userId: '1',
            domain: 'https://example.com',
            mqttDomain: 'mqtt.example.com'
        });
        assert.equal(session.getToken().token, 't');
        assert.deepEqual(session.inventory.endpoints(), []);
    });

    it('Session can emit connection and ratelimit like Endpoint emits availability', () => {
        const session = Session.restore({
            token: 't',
            key: 'k',
            userId: '1',
            domain: 'https://example.com',
            mqttDomain: 'mqtt.example.com'
        });
        const seen: boolean[] = [];
        const drops: Array<[string, number]> = [];
        session.on('connection', (connected) => {
            seen.push(connected);
        });
        session.on('ratelimit', (uuid, dropped) => {
            drops.push([uuid, dropped]);
        });
        session.emit('connection', true);
        session.emit('ratelimit', 'device-1', 3);
        assert.deepEqual(seen, [true]);
        assert.deepEqual(drops, [['device-1', 3]]);
    });

    it('SwitchTrait.setOn drives on/off when bound to a transport', async () => {
        const endpoint = new Endpoint({ id: 'device-1', traits: ['switch'] });
        const trait = new SwitchTrait({
            kind: 'board',
            uuid: 'uuid-1',
            channel: 0,
            namespace: TOGGLEX_NAMESPACE,
            request: async () => encodeMessage({
                namespace: TOGGLEX_NAMESPACE,
                method: 'SETACK',
                key: 'k',
                from: '/appliance/uuid-1/publish',
                uuid: 'uuid-1',
                payload: {}
            }),
            emitChange: (on) => endpoint.emit('change', { trait: 'switch', values: { on } })
        });
        assert.deepEqual(await trait.setOn(true), { on: true });
    });

    it('Inventory.endpoints starts empty before graph enrollment', () => {
        assert.deepEqual(new Inventory().endpoints(), []);
    });

    it('Endpoint can be constructed and emit availability', () => {
        const endpoint = new Endpoint({ id: 'device-1' });
        let seen: boolean | undefined;
        endpoint.on('availability', (online) => {
            seen = online;
        });
        endpoint.emit('availability', true);
        assert.equal(seen, true);
        assert.equal(endpoint.id, 'device-1');
    });
});
