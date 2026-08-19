import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
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

    it('SwitchTrait.setOn drives on/off when bound to a transport', async () => {
        const endpoint = new Endpoint({ id: 'device-1', traits: ['switch'] });
        const trait = new SwitchTrait({
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
