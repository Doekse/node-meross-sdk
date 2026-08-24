import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Endpoint } from '../../src/endpoint';
import {
    FAN_BTN_CONFIG_NAMESPACE,
    FAN_CONFIG_NAMESPACE,
    FAN_NAMESPACE,
    FILTER_MAINTENANCE_NAMESPACE,
    TOGGLEX_NAMESPACE,
    encodeMessage,
    type MerossMessage
} from '../../src/protocol';
import { FanTrait } from '../../src/traits/fan';
import type { FanTraitBind } from '../../src/traits/fan';

const KEY = 'stub-key';
const UUID = '2206138957096651080248e1e99705a4';
const CHANNEL = 0;

function createHarness(options: {
    hasToggleX?: boolean;
    hasToggle?: boolean;
    namespaces?: ReadonlySet<string>;
    fanGetAck?: Record<string, unknown>;
    configGetAck?: Record<string, unknown>;
    filterPush?: Record<string, unknown>;
    btnPush?: Record<string, unknown>;
} = {}): {
    trait: FanTrait;
    requests: MerossMessage[];
    changes: Record<string, unknown>[];
} {
    const requests: MerossMessage[] = [];
    const changes: Record<string, unknown>[] = [];
    const endpoint = new Endpoint({ id: `${UUID}:${CHANNEL}`, traits: ['fan'] });
    const namespaces = options.namespaces ?? new Set<string>();
    const bind: FanTraitBind = {
        uuid: UUID,
        channel: CHANNEL,
        namespaces,
        hasToggleX: options.hasToggleX ?? true,
        hasToggle: options.hasToggle ?? false,
        request: async (requestOptions) => {
            const message = encodeMessage({
                namespace: requestOptions.namespace,
                method: requestOptions.method,
                key: KEY,
                from: '/app/test/subscribe',
                payload: requestOptions.payload,
                uuid: UUID
            });
            requests.push(message);
            if (requestOptions.namespace === FAN_NAMESPACE && requestOptions.method === 'GET') {
                return encodeMessage({
                    namespace: FAN_NAMESPACE,
                    method: 'GETACK',
                    key: KEY,
                    from: `/appliance/${UUID}/publish`,
                    messageId: message.header.messageId,
                    uuid: UUID,
                    payload: options.fanGetAck ?? { fan: [{ channel: CHANNEL, speed: 3, maxSpeed: 4 }] }
                });
            }
            if (requestOptions.namespace === FAN_CONFIG_NAMESPACE && requestOptions.method === 'GET') {
                return encodeMessage({
                    namespace: FAN_CONFIG_NAMESPACE,
                    method: 'GETACK',
                    key: KEY,
                    from: `/appliance/${UUID}/publish`,
                    messageId: message.header.messageId,
                    uuid: UUID,
                    payload: options.configGetAck ?? { config: [{ channel: CHANNEL, maxSpeed: 0 }] }
                });
            }
            if (
                requestOptions.namespace === FILTER_MAINTENANCE_NAMESPACE
                && requestOptions.method === 'PUSH'
            ) {
                return encodeMessage({
                    namespace: FILTER_MAINTENANCE_NAMESPACE,
                    method: 'PUSH',
                    key: KEY,
                    from: `/appliance/${UUID}/publish`,
                    messageId: message.header.messageId,
                    uuid: UUID,
                    payload: options.filterPush
                        ?? { filter: [{ channel: CHANNEL, life: 80, lmTime: 1 }] }
                });
            }
            if (
                requestOptions.namespace === FAN_BTN_CONFIG_NAMESPACE
                && requestOptions.method === 'PUSH'
            ) {
                return encodeMessage({
                    namespace: FAN_BTN_CONFIG_NAMESPACE,
                    method: 'PUSH',
                    key: KEY,
                    from: `/appliance/${UUID}/publish`,
                    messageId: message.header.messageId,
                    uuid: UUID,
                    payload: options.btnPush ?? {
                        config: [
                            { channel: CHANNEL, powerBtn: { type: 1 } },
                            { channel: 1, controlBtn: { onoffType: 1, levelType: 2 } }
                        ]
                    }
                });
            }
            if (requestOptions.namespace === TOGGLEX_NAMESPACE && requestOptions.method === 'GET') {
                return encodeMessage({
                    namespace: TOGGLEX_NAMESPACE,
                    method: 'GETACK',
                    key: KEY,
                    from: `/appliance/${UUID}/publish`,
                    messageId: message.header.messageId,
                    uuid: UUID,
                    payload: { togglex: { channel: CHANNEL, onoff: 1, entity: 1, lmTime: 1 } }
                });
            }
            return encodeMessage({
                namespace: requestOptions.namespace,
                method: 'SETACK',
                key: KEY,
                from: `/appliance/${UUID}/publish`,
                messageId: message.header.messageId,
                uuid: UUID,
                payload: {}
            });
        },
        emitChange: (values) => {
            changes.push({ ...values });
            endpoint.emit('change', { trait: 'fan', values: { ...values } });
        }
    };
    return { trait: new FanTrait(bind), requests, changes };
}

function pushMessage(namespace: string, payload: Record<string, unknown>): MerossMessage {
    return encodeMessage({
        namespace,
        method: 'PUSH',
        key: KEY,
        from: `/appliance/${UUID}/publish`,
        uuid: UUID,
        payload
    });
}

describe('FanTrait', () => {
    it('polls Fan then ToggleX on start', async () => {
        const { trait, requests, changes } = createHarness();
        trait.start();
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(requests[0]?.header.namespace, FAN_NAMESPACE);
        assert.equal(requests[1]?.header.namespace, TOGGLEX_NAMESPACE);
        assert.equal(trait.getSpeed(), 0.75);
        assert.equal(trait.isOn(), true);
        assert.ok(changes.some((c) => c.speed === 0.75));
        assert.ok(changes.some((c) => c.on === true));
    });

    it('setOn uses ToggleX when advertised', async () => {
        const { trait, requests } = createHarness();
        trait.start();
        await new Promise((resolve) => setImmediate(resolve));
        requests.length = 0;
        await trait.setOn(false);
        await trait.setOn(true);
        assert.equal(requests.length, 2);
        assert.equal(requests[0]?.header.namespace, TOGGLEX_NAMESPACE);
        assert.equal(requests[1]?.header.namespace, TOGGLEX_NAMESPACE);
        assert.equal(trait.isOn(), true);
    });

    it('setOn without ToggleX or Toggle writes Control.Fan speed', async () => {
        const { trait, requests } = createHarness({ hasToggleX: false, hasToggle: false });
        trait.start();
        await new Promise((resolve) => setImmediate(resolve));
        requests.length = 0;
        await trait.setOn(false);
        assert.equal(requests[0]?.header.namespace, FAN_NAMESPACE);
        assert.deepEqual(requests[0]?.payload, { fan: [{ channel: CHANNEL, speed: 0 }] });
        assert.equal(trait.isOn(), false);
    });

    it('setSpeed writes wire 0..maxSpeed', async () => {
        const { trait, requests } = createHarness();
        trait.start();
        await new Promise((resolve) => setImmediate(resolve));
        requests.length = 0;
        await trait.setSpeed(0.5);
        assert.deepEqual(requests[0]?.payload, { fan: [{ channel: CHANNEL, speed: 2 }] });
        assert.equal(trait.getSpeed(), 0.5);
    });

    it('handlePush applies this channel only', () => {
        const { trait, changes } = createHarness();
        trait.handlePush(pushMessage(FAN_NAMESPACE, {
            fan: [{ channel: CHANNEL, speed: 1, maxSpeed: 4 }, { channel: 1, speed: 4, maxSpeed: 4 }]
        }));
        assert.equal(trait.getSpeed(), 0.25);
        assert.deepEqual(changes[0], { speed: 0.25, maxSpeed: 4 });
    });

    it('applies ToggleX PUSH to on/off', () => {
        const { trait, changes } = createHarness();
        trait.handlePush(pushMessage(TOGGLEX_NAMESPACE, {
            togglex: [
                { channel: CHANNEL, onoff: 0, entity: 1, lmTime: 1 },
                { channel: 1, onoff: 1, entity: 1, lmTime: 1 }
            ]
        }));
        assert.equal(trait.isOn(), false);
        assert.deepEqual(changes, [{ on: false }]);
    });

    it('ignores PUSH when uuid does not match the bind', () => {
        const { trait, changes } = createHarness();
        trait.handlePush(encodeMessage({
            namespace: FAN_NAMESPACE,
            method: 'PUSH',
            key: KEY,
            from: '/appliance/other/publish',
            uuid: 'other',
            payload: { fan: [{ channel: CHANNEL, speed: 1, maxSpeed: 4 }] }
        }));
        assert.equal(changes.length, 0);
    });

    it('polls Fan.Config after Fan and ignores zero maxSpeed when Fan already set it', async () => {
        const { trait, requests, changes } = createHarness({
            namespaces: new Set([FAN_CONFIG_NAMESPACE])
        });
        trait.start();
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(requests[0]?.header.namespace, FAN_NAMESPACE);
        assert.equal(requests[1]?.header.namespace, FAN_CONFIG_NAMESPACE);
        assert.equal(requests[1]?.header.method, 'GET');
        assert.equal(trait.getSpeed(), 0.75);
        assert.ok(!changes.some((c) => c.maxSpeed === 0));
    });

    it('applies Fan.Config maxSpeed when Control.Fan omitted it', async () => {
        const { trait, changes } = createHarness({
            namespaces: new Set([FAN_CONFIG_NAMESPACE]),
            fanGetAck: { fan: [{ channel: CHANNEL, speed: 2 }] },
            configGetAck: { config: [{ channel: CHANNEL, maxSpeed: 4 }] },
            hasToggleX: false,
            hasToggle: false
        });
        trait.start();
        await new Promise((resolve) => setImmediate(resolve));
        assert.ok(changes.some((c) => c.maxSpeed === 4));
        assert.equal(trait.getSpeed(), 0.5);
    });

    it('PUSH-queries FilterMaintenance on start and emits filterLife 0..1', async () => {
        const { trait, requests, changes } = createHarness({
            namespaces: new Set([FILTER_MAINTENANCE_NAMESPACE])
        });
        trait.start();
        await new Promise((resolve) => setImmediate(resolve));
        const filterReq = requests.find((r) => r.header.namespace === FILTER_MAINTENANCE_NAMESPACE);
        assert.equal(filterReq?.header.method, 'PUSH');
        assert.deepEqual(filterReq?.payload, {});
        assert.equal(trait.getFilterLife(), 0.8);
        assert.ok(changes.some((c) => c.filterLife === 0.8));
    });

    it('applies FilterMaintenance PUSH', () => {
        const { trait, changes } = createHarness({
            namespaces: new Set([FILTER_MAINTENANCE_NAMESPACE])
        });
        trait.handlePush(pushMessage(FILTER_MAINTENANCE_NAMESPACE, {
            filter: [{ channel: CHANNEL, life: 40, lmTime: 2 }]
        }));
        assert.equal(trait.getFilterLife(), 0.4);
        assert.deepEqual(changes[0], { filterLife: 0.4 });
    });

    it('getButtonConfig uses PUSH-query and does not run on start', async () => {
        const { trait, requests } = createHarness({
            namespaces: new Set([FAN_BTN_CONFIG_NAMESPACE])
        });
        trait.start();
        await new Promise((resolve) => setImmediate(resolve));
        assert.ok(!requests.some((r) => r.header.namespace === FAN_BTN_CONFIG_NAMESPACE));
        requests.length = 0;
        const config = await trait.getButtonConfig();
        assert.equal(requests[0]?.header.namespace, FAN_BTN_CONFIG_NAMESPACE);
        assert.equal(requests[0]?.header.method, 'PUSH');
        assert.deepEqual(config, { channel: CHANNEL, powerBtn: { type: 1 } });
    });

    it('setButtonConfig SETs and no-ops without Ability', async () => {
        const withNs = createHarness({
            namespaces: new Set([FAN_BTN_CONFIG_NAMESPACE])
        });
        await withNs.trait.setButtonConfig({ powerBtn: { type: 2 } });
        assert.equal(withNs.requests[0]?.header.namespace, FAN_BTN_CONFIG_NAMESPACE);
        assert.equal(withNs.requests[0]?.header.method, 'SET');
        assert.deepEqual(withNs.requests[0]?.payload, {
            config: [{ channel: CHANNEL, powerBtn: { type: 2 } }]
        });

        const without = createHarness();
        await without.trait.setButtonConfig({ powerBtn: { type: 1 } });
        assert.equal(without.requests.length, 0);
        assert.equal(await without.trait.getButtonConfig(), undefined);
    });
});
