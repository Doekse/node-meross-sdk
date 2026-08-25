import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { CommandError } from '../../src/errors';
import { ProtocolDispatcher } from '../../src/protocol/dispatcher';
import {
    decodeMessage,
    encodeMessage,
    type MerossMessage
} from '../../src/protocol/message';

const KEY = 'test-key';
const FROM_APP = '/app/1/subscribe';

/**
 * In-memory stand-in for MQTT/LAN: register before "send", then inject
 * inbound envelopes the way a broker would.
 */
class FakeTransport {
    constructor(private readonly dispatcher: ProtocolDispatcher) {}

    request(message: MerossMessage, timeoutMs?: number): Promise<MerossMessage> {
        return this.dispatcher.pending.register(message.header.messageId, timeoutMs);
    }

    deliver(message: MerossMessage) {
        return this.dispatcher.handle(message);
    }
}

function requestMessage(messageId: string): MerossMessage {
    return encodeMessage({
        namespace: 'Appliance.Control.ToggleX',
        method: 'GET',
        key: KEY,
        from: FROM_APP,
        messageId,
        timestamp: 1_700_000_000,
        payload: { togglex: { channel: 65535 } }
    });
}

function replyFor(request: MerossMessage, method: string, payload: MerossMessage['payload'] = {}): MerossMessage {
    return encodeMessage({
        namespace: request.header.namespace,
        method,
        key: KEY,
        from: '/appliance/abc/publish',
        messageId: request.header.messageId,
        timestamp: request.header.timestamp,
        payload
    });
}

function pushMessage(timestamp: number, from: string, extras: {
    timestampMs?: number;
    messageId?: string;
    payload?: MerossMessage['payload'];
} = {}): MerossMessage {
    return encodeMessage({
        namespace: 'Appliance.Control.ToggleX',
        method: 'PUSH',
        key: KEY,
        from,
        messageId: extras.messageId ?? `push-${timestamp}`,
        timestamp,
        timestampMs: extras.timestampMs,
        payload: extras.payload ?? { togglex: [{ channel: 0, onoff: 1 }] }
    });
}

describe('ProtocolDispatcher with fake transport', () => {
    it('matches GETACK to the outbound messageId', async () => {
        const dispatcher = new ProtocolDispatcher();
        const transport = new FakeTransport(dispatcher);
        const request = requestMessage('req-1');
        const pending = transport.request(request, 5_000);

        const ack = replyFor(request, 'GETACK', { togglex: [{ channel: 0, onoff: 1 }] });
        assert.equal(transport.deliver(ack), 'reply');
        assert.deepEqual(await pending, ack);
        assert.equal(dispatcher.pending.has('req-1'), false);
    });

    it('matches SETACK for a SET sent over the fake transport', async () => {
        const dispatcher = new ProtocolDispatcher();
        const transport = new FakeTransport(dispatcher);
        const request = encodeMessage({
            namespace: 'Appliance.Control.ToggleX',
            method: 'SET',
            key: KEY,
            from: FROM_APP,
            messageId: 'set-1',
            timestamp: 1_700_000_000,
            payload: { togglex: { channel: 0, onoff: 1 } }
        });

        const pending = transport.request(request, 5_000);
        assert.equal(transport.deliver(replyFor(request, 'SETACK')), 'reply');
        assert.equal((await pending).header.method, 'SETACK');
    });

    it('rejects a pending request when the device replies with ERROR', async () => {
        const dispatcher = new ProtocolDispatcher();
        const transport = new FakeTransport(dispatcher);
        const request = requestMessage('req-err');
        const pending = transport.request(request, 5_000);

        assert.equal(
            transport.deliver(replyFor(request, 'ERROR', { error: { code: 5000 } })),
            'reply'
        );
        await assert.rejects(
            pending,
            (err: unknown) => err instanceof CommandError && err.code === 'COMMAND_FAILED'
        );
    });

    it('rejects a pending request with INVALID_KEY when the device replies ERROR 5001', async () => {
        const dispatcher = new ProtocolDispatcher();
        const transport = new FakeTransport(dispatcher);
        const request = requestMessage('req-key');
        const pending = transport.request(request, 5_000);

        assert.equal(
            transport.deliver(replyFor(request, 'ERROR', { error: { code: 5001 } })),
            'reply'
        );
        await assert.rejects(
            pending,
            (err: unknown) => err instanceof CommandError
                && err.code === 'INVALID_KEY'
                && err.deviceCode === 5001
        );
    });

    it('times out a request that never receives an ACK', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const dispatcher = new ProtocolDispatcher();
        const transport = new FakeTransport(dispatcher);
        const pending = transport.request(requestMessage('req-timeout'), 2_000);

        t.mock.timers.tick(2_000);
        await assert.rejects(
            pending,
            (err: unknown) => err instanceof CommandError && err.code === 'COMMAND_TIMEOUT'
        );
    });

    it('ignores GETACK that does not match a pending messageId', () => {
        const dispatcher = new ProtocolDispatcher();
        const transport = new FakeTransport(dispatcher);
        assert.equal(transport.deliver(replyFor(requestMessage('no-pending'), 'GETACK')), 'ignored');
    });

    it('applies firmware ToggleX PUSH in timestamp order and drops stale ones', () => {
        const applied: MerossMessage[] = [];
        const dispatcher = new ProtocolDispatcher((message) => {
            applied.push(message);
        });
        const transport = new FakeTransport(dispatcher);
        const fixture = decodeMessage(
            JSON.parse(readFileSync(join(process.cwd(), 'test/fixtures/togglex-push.json'), 'utf8'))
        );
        const from = fixture.header.from;
        const ts = fixture.header.timestamp;

        assert.equal(transport.deliver(fixture), 'push');
        assert.equal(
            transport.deliver(pushMessage(ts - 1, from, {
                timestampMs: 999,
                payload: { togglex: [{ channel: 0, onoff: 0 }] }
            })),
            'stale'
        );
        assert.equal(
            transport.deliver(pushMessage(ts, from, { timestampMs: fixture.header.timestampMs })),
            'push'
        );
        assert.equal(transport.deliver(pushMessage(ts + 1, from)), 'push');
        assert.equal(applied.length, 3);
    });

    it('does not let one appliance PUSH starve another on the same namespace', () => {
        const applied: string[] = [];
        const dispatcher = new ProtocolDispatcher((message) => {
            applied.push(message.header.from);
        });
        const transport = new FakeTransport(dispatcher);

        assert.equal(transport.deliver(pushMessage(200, '/appliance/device-a/publish')), 'push');
        assert.equal(transport.deliver(pushMessage(50, '/appliance/device-b/publish')), 'push');
        assert.deepEqual(applied, [
            '/appliance/device-a/publish',
            '/appliance/device-b/publish'
        ]);
    });

    it('treats a PUSH that reuses a pending messageId as a reply, not a state update', async () => {
        const applied: MerossMessage[] = [];
        const dispatcher = new ProtocolDispatcher((message) => {
            applied.push(message);
        });
        const transport = new FakeTransport(dispatcher);
        const request = requestMessage('shared-id');
        const pending = transport.request(request, 5_000);

        const push = pushMessage(99, '/appliance/abc/publish', { messageId: 'shared-id' });
        assert.equal(transport.deliver(push), 'reply');
        assert.deepEqual(await pending, push);
        assert.equal(applied.length, 0);
    });
});
