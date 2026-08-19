import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    Endpoint,
    Inventory,
    NotImplementedError,
    Session,
    SwitchTrait
} from '../src/index';

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

    it('SwitchTrait.setOn rejects with NotImplementedError', async () => {
        const trait = new SwitchTrait();
        await assert.rejects(
            () => trait.setOn(true),
            (err: unknown) => err instanceof NotImplementedError
        );
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
