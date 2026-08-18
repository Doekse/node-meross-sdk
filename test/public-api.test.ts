import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    Endpoint,
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

    it('Session.login rejects with NotImplementedError', async () => {
        await assert.rejects(
            () => Session.login({ email: 'you@example.com', password: 'secret' }),
            (err: unknown) => err instanceof NotImplementedError
        );
    });

    it('Session.restore throws NotImplementedError', () => {
        assert.throws(
            () => Session.restore({
                token: 't',
                key: 'k',
                userId: '1',
                domain: 'https://example.com',
                mqttDomain: 'mqtt.example.com'
            }),
            (err: unknown) => err instanceof NotImplementedError
        );
    });

    it('SwitchTrait.setOn rejects with NotImplementedError', async () => {
        const trait = new SwitchTrait();
        await assert.rejects(
            () => trait.setOn(true),
            (err: unknown) => err instanceof NotImplementedError
        );
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
