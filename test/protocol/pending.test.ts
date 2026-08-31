import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CommandError, ProtocolError } from '../../src/errors';
import { encodeMessage } from '../../src/protocol/message';
import { PendingRequests } from '../../src/protocol/pending';

function ack(messageId: string, method = 'GETACK') {
    return encodeMessage({
        namespace: 'Appliance.Control.ToggleX',
        method,
        key: 'k',
        from: '/appliance/abc/publish',
        messageId,
        timestamp: 1_700_000_000
    });
}

describe('PendingRequests', () => {
    it('resolves the registered promise with the matching ACK', async () => {
        const pending = new PendingRequests();
        const promise = pending.register('msg-1', 5_000);
        assert.equal(pending.has('msg-1'), true);

        const reply = ack('msg-1');
        assert.equal(pending.settle(reply), true);
        assert.equal(pending.has('msg-1'), false);
        assert.deepEqual(await promise, reply);
    });

    it('accepts SETACK and DELETEACK as successful replies', async () => {
        const pending = new PendingRequests();
        for (const method of ['SETACK', 'DELETEACK']) {
            const messageId = `msg-${method}`;
            const promise = pending.register(messageId, 5_000);
            assert.equal(pending.settle(ack(messageId, method)), true);
            assert.equal((await promise).header.method, method);
        }
    });

    it('rejects ERROR method replies with COMMAND_FAILED', async () => {
        const pending = new PendingRequests();
        const promise = pending.register('msg-err', 5_000);
        const reply = encodeMessage({
            namespace: 'Appliance.Control.ToggleX',
            method: 'ERROR',
            key: 'k',
            from: '/appliance/abc/publish',
            messageId: 'msg-err',
            payload: { error: { code: 5000 } }
        });

        assert.equal(pending.settle(reply), true);
        await assert.rejects(
            promise,
            (err: unknown) => err instanceof CommandError
                && err.code === 'COMMAND_FAILED'
                && err.deviceCode === 5000
        );
    });

    it('rejects ERROR 5001 as INVALID_KEY', async () => {
        const pending = new PendingRequests();
        const promise = pending.register('msg-key', 5_000);
        const reply = encodeMessage({
            namespace: 'Appliance.Control.ToggleX',
            method: 'ERROR',
            key: 'k',
            from: '/appliance/abc/publish',
            messageId: 'msg-key',
            payload: { error: { code: 5001 } }
        });

        assert.equal(pending.settle(reply), true);
        await assert.rejects(
            promise,
            (err: unknown) => err instanceof CommandError
                && err.code === 'INVALID_KEY'
                && err.deviceCode === 5001
        );
    });

    it('rejects on timeout with COMMAND_TIMEOUT', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const pending = new PendingRequests();
        const promise = pending.register('msg-timeout', 3_000);

        t.mock.timers.tick(3_000);

        await assert.rejects(
            promise,
            (err: unknown) => err instanceof CommandError && err.code === 'COMMAND_TIMEOUT'
        );
        assert.equal(pending.has('msg-timeout'), false);
        assert.equal(pending.settle(ack('msg-timeout')), false);
    });

    it('throws when the same messageId is registered twice', () => {
        const pending = new PendingRequests();
        const first = pending.register('dup', 5_000);
        first.catch(() => {});

        assert.throws(
            () => pending.register('dup', 5_000),
            (err: unknown) => err instanceof ProtocolError && err.code === 'DUPLICATE_MESSAGE_ID'
        );
        pending.clear();
    });

    it('settle returns false for an unknown messageId', () => {
        const pending = new PendingRequests();
        assert.equal(pending.settle(ack('unknown')), false);
    });

    it('reject clears the entry so a later ACK cannot resolve it', async () => {
        const pending = new PendingRequests();
        const transportError = new Error('publish failed');
        const promise = pending.register('msg-reject', 5_000);

        assert.equal(pending.reject('msg-reject', transportError), true);
        assert.equal(pending.has('msg-reject'), false);
        await assert.rejects(promise, transportError);
        assert.equal(pending.reject('msg-reject', transportError), false);
        assert.equal(pending.settle(ack('msg-reject')), false);
    });

    it('clear rejects outstanding requests with COMMAND_CANCELLED', async () => {
        const pending = new PendingRequests();
        const first = pending.register('msg-a', 5_000);
        const second = pending.register('msg-b', 5_000);

        pending.clear();
        assert.equal(pending.has('msg-a'), false);
        assert.equal(pending.has('msg-b'), false);

        for (const promise of [first, second]) {
            await assert.rejects(
                promise,
                (err: unknown) => err instanceof CommandError && err.code === 'COMMAND_CANCELLED'
            );
        }
    });
});
