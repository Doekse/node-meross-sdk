import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ProtocolDispatcher } from '../../src/protocol/dispatcher';
import { encodeMessage, type MerossMessage } from '../../src/protocol';

const KEY = 'stub-key';

class FakeTransport {
    constructor(private readonly dispatcher: ProtocolDispatcher) {}

    request(message: MerossMessage): Promise<MerossMessage> {
        return this.dispatcher.pending.register(message.header.messageId);
    }

    deliver(message: MerossMessage) {
        return this.dispatcher.handle(message);
    }
}

describe('ProtocolDispatcher.onInbound', () => {
    it('notifies onInbound for replies and push', async () => {
        const inbound: string[] = [];
        const dispatcher = new ProtocolDispatcher({
            onInbound: (message) => {
                inbound.push(`${message.header.method}:${message.header.namespace}`);
            },
            onPush: (message) => {
                inbound.push(`push-handler:${message.header.namespace}`);
            }
        });
        const transport = new FakeTransport(dispatcher);

        const request = encodeMessage({
            namespace: 'Appliance.System.Online',
            method: 'GET',
            key: KEY,
            from: '/app/test/subscribe',
            uuid: 'uuid-1'
        });
        const pending = transport.request(request);

        const reply = encodeMessage({
            namespace: 'Appliance.System.Online',
            method: 'GETACK',
            key: KEY,
            from: '/appliance/uuid-1/publish',
            messageId: request.header.messageId,
            uuid: 'uuid-1',
            payload: { online: { status: 1 } }
        });
        assert.equal(transport.deliver(reply), 'reply');
        await pending;
        assert.deepEqual(inbound, ['GETACK:Appliance.System.Online']);

        const push = encodeMessage({
            namespace: 'Appliance.System.Online',
            method: 'PUSH',
            key: KEY,
            from: '/appliance/uuid-1/publish',
            uuid: 'uuid-1',
            payload: { online: { status: 2 } }
        });
        assert.equal(transport.deliver(push), 'push');
        assert.deepEqual(inbound, [
            'GETACK:Appliance.System.Online',
            'PUSH:Appliance.System.Online',
            'push-handler:Appliance.System.Online'
        ]);
    });

    it('accepts a legacy push-only callback constructor', () => {
        const pushed: string[] = [];
        const dispatcher = new ProtocolDispatcher((message) => {
            pushed.push(message.header.method);
        });
        const push = encodeMessage({
            namespace: 'Appliance.System.Online',
            method: 'PUSH',
            key: KEY,
            from: '/appliance/uuid-1/publish',
            uuid: 'uuid-1',
            payload: {}
        });
        dispatcher.handle(push);
        assert.deepEqual(pushed, ['PUSH']);
    });
});
