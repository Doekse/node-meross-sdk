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
import { createRequestRecorder, traitAck } from '../helpers/request';

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
    const changes: Record<string, unknown>[] = [];
    const endpoint = new Endpoint({ id: `${UUID}:${CHANNEL}`, traits: ['fan'] });
    const namespaces = options.namespaces ?? new Set<string>();
    const { requests, request } = createRequestRecorder({
        uuid: UUID,
        key: KEY,
        ack: (requestOptions, sent) => {
            if (requestOptions.namespace === FAN_NAMESPACE && requestOptions.method === 'GET') {
                return traitAck(sent, {
                    key: KEY,
                    method: 'GETACK',
                    payload: options.fanGetAck ?? { fan: [{ channel: CHANNEL, speed: 3, maxSpeed: 4 }] }
                });
            }
            if (requestOptions.namespace === FAN_CONFIG_NAMESPACE && requestOptions.method === 'GET') {
                return traitAck(sent, {
                    key: KEY,
                    method: 'GETACK',
                    payload: options.configGetAck ?? { config: [{ channel: CHANNEL, maxSpeed: 0 }] }
                });
            }
            if (
                requestOptions.namespace === FILTER_MAINTENANCE_NAMESPACE
                && requestOptions.method === 'PUSH'
            ) {
                return traitAck(sent, {
                    key: KEY,
                    method: 'PUSH',
                    payload: options.filterPush
                        ?? { filter: [{ channel: CHANNEL, life: 80, lmTime: 1 }] }
                });
            }
            if (
                requestOptions.namespace === FAN_BTN_CONFIG_NAMESPACE
                && requestOptions.method === 'PUSH'
            ) {
                return traitAck(sent, {
                    key: KEY,
                    method: 'PUSH',
                    payload: options.btnPush ?? {
                        config: [
                            { channel: CHANNEL, powerBtn: { type: 1 } },
                            { channel: 1, controlBtn: { onoffType: 1, levelType: 2 } }
                        ]
                    }
                });
            }
            if (requestOptions.namespace === TOGGLEX_NAMESPACE && requestOptions.method === 'GET') {
                return traitAck(sent, {
                    key: KEY,
                    method: 'GETACK',
                    payload: { togglex: { channel: CHANNEL, onoff: 1, entity: 1, lmTime: 1 } }
                });
            }
            return traitAck(sent, { key: KEY, method: 'SETACK' });
        }
    });
    const bind: FanTraitBind = {
        uuid: UUID,
        channel: CHANNEL,
        namespaces,
        hasToggleX: options.hasToggleX ?? true,
        hasToggle: options.hasToggle ?? false,
        request,
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

function getAck(namespace: string, payload: Record<string, unknown>): MerossMessage {
    return encodeMessage({
        namespace,
        method: 'GETACK',
        key: KEY,
        from: `/appliance/${UUID}/publish`,
        uuid: UUID,
        payload
    });
}

/** Seeds Control.Fan maxSpeed/speed the way DevicePoller GETACK would. */
function seedFan(
    trait: FanTrait,
    payload: Record<string, unknown> = { fan: [{ channel: CHANNEL, speed: 3, maxSpeed: 4 }] }
): void {
    trait.handlePush(getAck(FAN_NAMESPACE, payload));
}

describe('FanTrait', () => {
    it('setOn uses ToggleX when advertised', async () => {
        const { trait, requests } = createHarness();
        seedFan(trait);
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
        seedFan(trait);
        requests.length = 0;
        await trait.setOn(false);
        assert.equal(requests[0]?.header.namespace, FAN_NAMESPACE);
        assert.deepEqual(requests[0]?.payload, { fan: [{ channel: CHANNEL, speed: 0 }] });
        assert.equal(trait.isOn(), false);
    });

    it('setSpeed writes wire 0..maxSpeed', async () => {
        const { trait, requests } = createHarness();
        seedFan(trait);
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

    it('applies Fan.Config and ignores zero maxSpeed when Fan already set it', () => {
        const { trait, changes } = createHarness({
            namespaces: new Set([FAN_CONFIG_NAMESPACE])
        });
        seedFan(trait);
        trait.handlePush(getAck(FAN_CONFIG_NAMESPACE, { config: [{ channel: CHANNEL, maxSpeed: 0 }] }));
        assert.equal(trait.getSpeed(), 0.75);
        assert.ok(!changes.some((c) => c.maxSpeed === 0));
    });

    it('applies Fan.Config maxSpeed when Control.Fan omitted it', () => {
        const { trait, changes } = createHarness({
            namespaces: new Set([FAN_CONFIG_NAMESPACE]),
            hasToggleX: false,
            hasToggle: false
        });
        seedFan(trait, { fan: [{ channel: CHANNEL, speed: 2 }] });
        trait.handlePush(getAck(FAN_CONFIG_NAMESPACE, { config: [{ channel: CHANNEL, maxSpeed: 4 }] }));
        assert.ok(changes.some((c) => c.maxSpeed === 4));
        assert.equal(trait.getSpeed(), 0.5);
    });

    it('applies Fan.Config maxSpeed from a meross_lan fan-keyed GETACK', () => {
        const { trait, changes } = createHarness({
            namespaces: new Set([FAN_CONFIG_NAMESPACE]),
            hasToggleX: false,
            hasToggle: false
        });
        seedFan(trait, { fan: [{ channel: CHANNEL, speed: 2 }] });
        trait.handlePush(getAck(FAN_CONFIG_NAMESPACE, { fan: [{ channel: CHANNEL, maxSpeed: 4 }] }));
        assert.ok(changes.some((c) => c.maxSpeed === 4));
        assert.equal(trait.getSpeed(), 0.5);
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

    it('getButtonConfig uses PUSH-query', async () => {
        const { trait, requests } = createHarness({
            namespaces: new Set([FAN_BTN_CONFIG_NAMESPACE])
        });
        const config = await trait.getButtonConfig();
        assert.equal(requests[0]?.header.namespace, FAN_BTN_CONFIG_NAMESPACE);
        assert.equal(requests[0]?.header.method, 'PUSH');
        assert.deepEqual(config, { channel: CHANNEL, powerBtn: { type: 1 } });
    });

    it('setButtonConfig SETs when advertised', async () => {
        const { trait, requests } = createHarness({
            namespaces: new Set([FAN_BTN_CONFIG_NAMESPACE])
        });

        await trait.setButtonConfig({ powerBtn: { type: 2 } });

        assert.equal(requests[0]?.header.namespace, FAN_BTN_CONFIG_NAMESPACE);
        assert.equal(requests[0]?.header.method, 'SET');
        assert.deepEqual(requests[0]?.payload, {
            config: [{ channel: CHANNEL, powerBtn: { type: 2 } }]
        });
    });

    it('setButtonConfig is a no-op when Fan.BtnConfig is not advertised', async () => {
        const { trait, requests } = createHarness();

        await trait.setButtonConfig({ powerBtn: { type: 1 } });

        assert.equal(requests.length, 0);
        assert.equal(await trait.getButtonConfig(), undefined);
    });
});
