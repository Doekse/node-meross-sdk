import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ProtocolDispatcher } from '../../src/protocol/dispatcher';
import { encodeMessage } from '../../src/protocol';
import { FakeTransport } from '../helpers/dispatcher';

const KEY = 'stub-key';

describe('ProtocolDispatcher.onInbound', () => {
    it('notifies onInbound for a matching GETACK', async () => {
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
    });

    it('notifies onInbound then onPush for PUSH', () => {
        const inbound: string[] = [];
        const dispatcher = new ProtocolDispatcher({
            onInbound: (message) => {
                inbound.push(`${message.header.method}:${message.header.namespace}`);
            },
            onPush: (message) => {
                inbound.push(`push-handler:${message.header.namespace}`);
            }
        });

        const push = encodeMessage({
            namespace: 'Appliance.System.Online',
            method: 'PUSH',
            key: KEY,
            from: '/appliance/uuid-1/publish',
            uuid: 'uuid-1',
            payload: { online: { status: 2 } }
        });
        assert.equal(dispatcher.handle(push), 'push');

        assert.deepEqual(inbound, [
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

    it('forwards originUuid to onInbound', () => {
        let origin: string | undefined;
        const dispatcher = new ProtocolDispatcher({
            onInbound: (_message, originUuid) => {
                origin = originUuid;
            }
        });
        const ack = encodeMessage({
            namespace: 'Appliance.System.Online',
            method: 'GETACK',
            key: KEY,
            from: '/app/test/subscribe',
            payload: {}
        });

        dispatcher.handle(ack, 'device-1');

        assert.equal(origin, 'device-1');
    });
});
