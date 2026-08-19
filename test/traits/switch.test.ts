import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { Endpoint } from '../../src/endpoint';
import { CommandError } from '../../src/errors';
import {
    TOGGLEX_NAMESPACE,
    decodeMessage,
    encodeMessage,
    encodeToggleXSet,
    type MerossMessage
} from '../../src/protocol';
import { SwitchTrait } from '../../src/traits/switch';

const fixturesDir = join(process.cwd(), 'test/fixtures');
const KEY = 'stub-key';
const UUID = '2206138957096651080248e1e99705a4';
const CHANNEL = 2;

function loadFixture(name: string): MerossMessage {
    return decodeMessage(JSON.parse(readFileSync(join(fixturesDir, name), 'utf8')) as unknown);
}

function createSwitchHarness(channel = CHANNEL): {
    endpoint: Endpoint;
    trait: SwitchTrait;
    requests: MerossMessage[];
} {
    const requests: MerossMessage[] = [];
    const endpoint = new Endpoint({
        id: `${UUID}:${channel}`,
        traits: ['switch']
    });
    const trait = new SwitchTrait({
        uuid: UUID,
        channel,
        namespace: TOGGLEX_NAMESPACE,
        request: async (options) => {
            const message = encodeMessage({
                namespace: options.namespace,
                method: options.method,
                key: KEY,
                from: '/app/test/subscribe',
                payload: options.payload,
                uuid: UUID
            });
            requests.push(message);
            return encodeMessage({
                namespace: options.namespace,
                method: 'SETACK',
                key: KEY,
                from: `/appliance/${UUID}/publish`,
                messageId: message.header.messageId,
                uuid: UUID,
                payload: {}
            });
        },
        emitChange: (on) => endpoint.emit('change', { trait: 'switch', values: { on } })
    });
    return { endpoint, trait, requests };
}

describe('SwitchTrait.setOn', () => {
    it('sends ToggleX SET on the enrolled channel and returns the requested state', async () => {
        const { trait, requests } = createSwitchHarness();

        const result = await trait.setOn(false);

        assert.deepEqual(result, { on: false });
        assert.equal(requests.length, 1);
        assert.equal(requests[0]?.header.namespace, TOGGLEX_NAMESPACE);
        assert.equal(requests[0]?.header.method, 'SET');
        assert.deepEqual(requests[0]?.payload, encodeToggleXSet({ channel: CHANNEL, on: false }));
    });

    it('emits a change patch on the endpoint after SETACK', async () => {
        const { endpoint, trait } = createSwitchHarness();
        const changes: Array<{ trait: string; values: Record<string, unknown> }> = [];
        endpoint.on('change', (change) => changes.push(change));

        await trait.setOn(true);

        assert.deepEqual(changes, [{ trait: 'switch', values: { on: true } }]);
    });

    it('does not emit change when setOn repeats the same state', async () => {
        const { endpoint, trait } = createSwitchHarness();
        const changes: unknown[] = [];
        endpoint.on('change', (change) => changes.push(change));

        await trait.setOn(true);
        await trait.setOn(true);

        assert.equal(changes.length, 1);
    });

    it('throws CommandError when the device replies with ERROR', async () => {
        const endpoint = new Endpoint({ id: `${UUID}:0`, traits: ['switch'] });
        const trait = new SwitchTrait({
            uuid: UUID,
            channel: 0,
            namespace: TOGGLEX_NAMESPACE,
            request: async () => {
                throw new CommandError('Device returned error: {}', 'COMMAND_FAILED');
            },
            emitChange: (on) => endpoint.emit('change', { trait: 'switch', values: { on } })
        });

        await assert.rejects(
            () => trait.setOn(false),
            (err: unknown) => err instanceof CommandError
        );
    });
});

describe('SwitchTrait PUSH', () => {
    it('applies ToggleX PUSH for the bound channel and emits change', () => {
        const { endpoint, trait } = createSwitchHarness();
        const changes: unknown[] = [];
        endpoint.on('change', (change) => changes.push(change));

        const push = loadFixture('togglex-push.json');
        push.header.from = `/appliance/${UUID}/publish`;
        push.payload.togglex = [{ channel: CHANNEL, onoff: 1, entity: 1, lmTime: 1 }];

        trait.handlePush(push);

        assert.deepEqual(changes, [{ trait: 'switch', values: { on: true } }]);
    });

    it('ignores PUSH entries for other channels on the same board', () => {
        const { endpoint, trait } = createSwitchHarness();
        const changes: unknown[] = [];
        endpoint.on('change', (change) => changes.push(change));

        const push = loadFixture('togglex-push.json');
        push.header.from = `/appliance/${UUID}/publish`;
        push.payload.togglex = [{ channel: 0, onoff: 1, entity: 1, lmTime: 1 }];

        trait.handlePush(push);

        assert.deepEqual(changes, []);
    });

    it('ignores PUSH when uuid or namespace does not match the bind', () => {
        const { endpoint, trait } = createSwitchHarness();
        const changes: unknown[] = [];
        endpoint.on('change', (change) => changes.push(change));

        const push = loadFixture('togglex-push.json');
        push.header.from = '/appliance/other-device/publish';

        trait.handlePush(push);

        assert.deepEqual(changes, []);
    });
});
