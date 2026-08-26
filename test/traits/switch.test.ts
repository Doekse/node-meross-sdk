import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { Endpoint } from '../../src/endpoint';
import { CommandError } from '../../src/errors';
import {
    HUB_EXCEPTION_NAMESPACE,
    HUB_SUBDEVICE_VERSION_NAMESPACE,
    HUB_TOGGLEX_NAMESPACE,
    TOGGLEX_NAMESPACE,
    decodeMessage,
    encodeHubToggleXSet,
    encodeMessage,
    encodeToggleXSet,
    type MerossMessage
} from '../../src/protocol';
import { SwitchTrait } from '../../src/traits/switch';

const fixturesDir = join(process.cwd(), 'test/fixtures');
const KEY = 'stub-key';
const UUID = '2206138957096651080248e1e99705a4';
const CHANNEL = 2;
const SUB_DEVICE_ID = '0000dead';

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
        kind: 'board',
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
        emitChange: (values) => endpoint.emit('change', { trait: 'switch', values: { ...values } })
    });
    return { endpoint, trait, requests };
}

function createHubSwitchHarness(): {
    endpoint: Endpoint;
    trait: SwitchTrait;
    requests: MerossMessage[];
} {
    const requests: MerossMessage[] = [];
    const endpoint = new Endpoint({ id: `${UUID}#${SUB_DEVICE_ID}`, traits: ['switch'] });
    const trait = new SwitchTrait({
        kind: 'hub',
        uuid: UUID,
        subDeviceId: SUB_DEVICE_ID,
        namespaces: new Set([HUB_EXCEPTION_NAMESPACE, HUB_SUBDEVICE_VERSION_NAMESPACE]),
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
        emitChange: (values) => endpoint.emit('change', { trait: 'switch', values: { ...values } })
    });
    return { endpoint, trait, requests };
}

function hubPush(payload: Record<string, unknown>): MerossMessage {
    return encodeMessage({
        namespace: HUB_TOGGLEX_NAMESPACE,
        method: 'PUSH',
        key: KEY,
        from: `/appliance/${UUID}/publish`,
        uuid: UUID,
        payload
    });
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
            kind: 'board',
            uuid: UUID,
            channel: 0,
            namespace: TOGGLEX_NAMESPACE,
            request: async () => {
                throw new CommandError('Device returned error: {}', 'COMMAND_FAILED');
            },
            emitChange: (values) => endpoint.emit('change', { trait: 'switch', values: { ...values } })
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

describe('SwitchTrait initial state', () => {
    it('exposes digest onoff without emitting change', () => {
        const { endpoint } = createSwitchHarness();
        const withDigest = new SwitchTrait({
            kind: 'board',
            uuid: UUID,
            channel: CHANNEL,
            namespace: TOGGLEX_NAMESPACE,
            initialOn: true,
            request: async () => encodeMessage({
                namespace: TOGGLEX_NAMESPACE,
                method: 'GETACK',
                key: KEY,
                from: `/appliance/${UUID}/publish`,
                uuid: UUID,
                payload: {}
            }),
            emitChange: (values) => endpoint.emit('change', { trait: 'switch', values: { ...values } })
        });
        const changes: unknown[] = [];
        endpoint.on('change', (change) => changes.push(change));

        assert.equal(withDigest.isOn(), true);
        assert.deepEqual(changes, []);
    });
});

describe('SwitchTrait hub bind', () => {
    it('setOn sends Hub.ToggleX SET with subDeviceId not channel', async () => {
        const { trait, requests } = createHubSwitchHarness();

        await trait.setOn(true);

        assert.equal(requests.length, 1);
        assert.equal(requests[0]?.header.namespace, HUB_TOGGLEX_NAMESPACE);
        assert.equal(requests[0]?.header.method, 'SET');
        assert.deepEqual(
            requests[0]?.payload,
            encodeHubToggleXSet({ id: SUB_DEVICE_ID, on: true })
        );
    });

    it('handlePush applies Hub.ToggleX PUSH for matching subDeviceId', () => {
        const { endpoint, trait } = createHubSwitchHarness();
        const changes: unknown[] = [];
        endpoint.on('change', (change) => changes.push(change));

        trait.handlePush(hubPush({ togglex: [{ id: SUB_DEVICE_ID, onoff: 1 }] }));

        assert.deepEqual(changes, [{ trait: 'switch', values: { on: true } }]);
    });

    it('ignores Hub.ToggleX PUSH for a different subDeviceId', () => {
        const { endpoint, trait } = createHubSwitchHarness();
        const changes: unknown[] = [];
        endpoint.on('change', (change) => changes.push(change));

        trait.handlePush(hubPush({ togglex: [{ id: 'other-device', onoff: 1 }] }));

        assert.deepEqual(changes, []);
    });

    it('applies fault and firmware/hardware versions from hub diagnostics PUSH', () => {
        const { endpoint, trait } = createHubSwitchHarness();
        const changes: Array<{ values: Record<string, unknown> }> = [];
        endpoint.on('change', (change) => changes.push(change));

        trait.handlePush(encodeMessage({
            namespace: HUB_EXCEPTION_NAMESPACE,
            method: 'PUSH',
            key: KEY,
            from: `/appliance/${UUID}/publish`,
            uuid: UUID,
            payload: { exception: [{ id: SUB_DEVICE_ID, code: 5061 }] }
        }));
        trait.handlePush(encodeMessage({
            namespace: HUB_SUBDEVICE_VERSION_NAMESPACE,
            method: 'PUSH',
            key: KEY,
            from: `/appliance/${UUID}/publish`,
            uuid: UUID,
            payload: { version: [{ id: SUB_DEVICE_ID, hardware: '1.1.5', firmware: '5.1.8' }] }
        }));

        assert.equal(changes[0].values.fault, 5061);
        assert.equal(changes[1].values.firmwareVersion, '5.1.8');
        assert.equal(changes[1].values.hardwareVersion, '1.1.5');
    });
});
