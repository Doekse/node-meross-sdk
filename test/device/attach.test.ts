import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { AbilityMap, GraphEndpoint, PhysicalDevice } from '../../src/device';
import { attachEndpoint } from '../../src/device/attach';
import type { Endpoint, EndpointChange, TraitName } from '../../src/endpoint';
import {
    CONTROL_TIMER_NAMESPACE,
    CONTROL_TRIGGER_NAMESPACE,
    CONTROL_ALERT_CONFIG_NAMESPACE,
    CONFIG_STANDBY_KILLER_NAMESPACE,
    DND_MODE_NAMESPACE,
    FAN_NAMESPACE,
    GARAGE_STATE_NAMESPACE,
    HUB_SENSOR_ALL_NAMESPACE,
    HUB_TOGGLEX_NAMESPACE,
    LIGHT_NAMESPACE,
    SHUTTER_POSITION_NAMESPACE,
    SHUTTER_STATE_NAMESPACE,
    THERMOSTAT_MODE_NAMESPACE,
    THERMOSTAT_MODEB_NAMESPACE,
    THERMOSTAT_MODEC_NAMESPACE,
    TIMERX_NAMESPACE,
    TOGGLEX_NAMESPACE,
    TRIGGERX_NAMESPACE,
    encodeLightSet,
    encodeMessage,
    type MerossMessage
} from '../../src/protocol';
import { createRequestRecorder } from '../helpers/request';

const KEY = 'stub-key';
const UUID = '2206138957096651080248e1e99705a4';
const CHANNEL = 0;
const SUB_DEVICE_ID = '00000101';
const TOGGLE_NAMESPACE = 'Appliance.Control.Toggle';

const TIMER_SET = {
    id: 'timer1',
    alias: 'on',
    time: 720,
    week: 255,
    on: true,
    createTime: 1
};

const TRIGGER_SET = {
    id: 'trig1',
    alias: 'auto',
    rule: { duration: 900, week: 255 },
    createTime: 1
};

/**
 * Ability extras (Toggle vs ToggleX, ModeC, TimerX) live on PhysicalDevice.
 */
function physical(ability: AbilityMap, model: string): PhysicalDevice {
    return {
        uuid: UUID,
        model,
        name: model,
        ability,
        maxCmdNum: 1,
        online: true,
        system: {
            firmware: {},
            hardware: { type: model, uuid: UUID }
        },
        digestNamespaces: new Set(),
        endpoints: []
    };
}

/**
 * Hub children are identified by `subDeviceId`; attach does not read classHint.
 */
function graphEndpoint({
    traits,
    subDeviceId,
    model = 'mss110'
}: {
    traits: readonly TraitName[];
    subDeviceId?: string;
    model?: string;
}): GraphEndpoint {
    const isHubChild = subDeviceId !== undefined;
    return {
        id: isHubChild ? `${UUID}#${subDeviceId}` : `${UUID}:${CHANNEL}`,
        uuid: UUID,
        channel: isHubChild ? undefined : CHANNEL,
        subDeviceId,
        name: model,
        model,
        classHint: 'socket',
        traits,
        online: true
    };
}

function createHarness(options: {
    traits: readonly TraitName[];
    ability: AbilityMap;
    subDeviceId?: string;
    model?: string;
    ack?: Parameters<typeof createRequestRecorder>[0]['ack'];
}): {
    endpoint: Endpoint;
    requests: MerossMessage[];
} {
    const graph = graphEndpoint({
        traits: options.traits,
        subDeviceId: options.subDeviceId,
        model: options.model
    });
    const { requests, request } = createRequestRecorder({
        uuid: UUID,
        key: KEY,
        ack: options.ack
    });
    const endpoint = attachEndpoint(graph, request, physical(options.ability, graph.model));
    return { endpoint, requests };
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

describe('attachEndpoint switch', () => {
    it('binds classic Toggle when Toggle is present and ToggleX is absent', async () => {
        const { endpoint, requests } = createHarness({
            traits: ['switch'],
            ability: { [TOGGLE_NAMESPACE]: {} }
        });

        await endpoint.switch!.setOn(true);

        assert.equal(requests[0]?.header.namespace, TOGGLE_NAMESPACE);
    });

    it('binds ToggleX when only ToggleX is advertised', async () => {
        const { endpoint, requests } = createHarness({
            traits: ['switch'],
            ability: { [TOGGLEX_NAMESPACE]: {} }
        });

        await endpoint.switch!.setOn(true);

        assert.equal(requests[0]?.header.namespace, TOGGLEX_NAMESPACE);
    });

    it('binds ToggleX when both Toggle and ToggleX are advertised', async () => {
        const { endpoint, requests } = createHarness({
            traits: ['switch'],
            ability: { [TOGGLE_NAMESPACE]: {}, [TOGGLEX_NAMESPACE]: {} }
        });

        await endpoint.switch!.setOn(true);

        assert.equal(requests[0]?.header.namespace, TOGGLEX_NAMESPACE);
    });

    it('binds Hub.ToggleX for hub children, not board ToggleX', async () => {
        const { endpoint, requests } = createHarness({
            traits: ['switch'],
            subDeviceId: SUB_DEVICE_ID,
            ability: { [TOGGLEX_NAMESPACE]: {}, [HUB_TOGGLEX_NAMESPACE]: {} }
        });

        await endpoint.switch!.setOn(true);

        assert.equal(requests[0]?.header.namespace, HUB_TOGGLEX_NAMESPACE);
    });
});

describe('attachEndpoint sensor', () => {
    it('omits SensorTrait when the model has no family but keeps the trait name', () => {
        const { endpoint } = createHarness({
            traits: ['sensor'],
            subDeviceId: SUB_DEVICE_ID,
            model: 'not-a-sensor',
            ability: { [HUB_SENSOR_ALL_NAMESPACE]: {} }
        });

        assert.equal(endpoint.sensor, undefined);
        assert.ok(endpoint.traits.includes('sensor'));
        assert.doesNotThrow(() => endpoint.handlePush(pushMessage(HUB_SENSOR_ALL_NAMESPACE, {})));
    });

    it('constructs SensorTrait for ms100', () => {
        const { endpoint } = createHarness({
            traits: ['sensor'],
            subDeviceId: SUB_DEVICE_ID,
            model: 'ms100',
            ability: { [HUB_SENSOR_ALL_NAMESPACE]: {} }
        });

        assert.ok(endpoint.sensor);
    });
});

describe('attachEndpoint dnd', () => {
    it('emits { trait: dnd, values: { on } } on PUSH', () => {
        const { endpoint } = createHarness({
            traits: ['dnd'],
            ability: { [DND_MODE_NAMESPACE]: {} }
        });
        const changes: EndpointChange[] = [];
        const narrowedOn: Array<boolean | undefined> = [];
        endpoint.on('change', (change) => {
            changes.push(change);
            if (change.trait === 'dnd' || change.trait === 'switch') {
                narrowedOn.push(change.values.on);
            }
        });

        endpoint.handlePush(pushMessage(DND_MODE_NAMESPACE, { DNDMode: { mode: 1 } }));

        assert.deepEqual(changes, [{ trait: 'dnd', values: { on: true } }]);
        assert.deepEqual(narrowedOn, [true]);
    });
});

describe('attachEndpoint alert', () => {
    it('emits { trait: alert, values } on AlertConfig PUSH', () => {
        const { endpoint } = createHarness({
            traits: ['alert'],
            ability: { [CONTROL_ALERT_CONFIG_NAMESPACE]: {} }
        });
        const changes: EndpointChange[] = [];
        endpoint.on('change', (change) => changes.push(change));

        endpoint.handlePush(pushMessage(CONTROL_ALERT_CONFIG_NAMESPACE, {
            config: [{ channel: CHANNEL, type: 3, value: { em06: { a: 1 } } }]
        }));

        assert.deepEqual(changes, [{
            trait: 'alert',
            values: { type: 3, value: { em06: { a: 1 } } }
        }]);
    });
});

describe('attachEndpoint standbykiller', () => {
    it('emits { trait: standbykiller, values } on StandbyKiller PUSH', () => {
        const { endpoint } = createHarness({
            traits: ['standbykiller'],
            ability: { [CONFIG_STANDBY_KILLER_NAMESPACE]: {} }
        });
        const changes: EndpointChange[] = [];
        endpoint.on('change', (change) => changes.push(change));

        endpoint.handlePush(pushMessage(CONFIG_STANDBY_KILLER_NAMESPACE, {
            config: [{
                channel: CHANNEL,
                power: 0,
                time: 300,
                enable: 2,
                alert: 2
            }]
        }));

        assert.deepEqual(changes, [{
            trait: 'standbykiller',
            values: {
                enabled: false,
                power: 0,
                time: 300,
                alert: false
            }
        }]);
    });
});

describe('attachEndpoint light', () => {
    it('uses ability capacity when Light is present without Toggle/ToggleX', async () => {
        const { endpoint, requests } = createHarness({
            traits: ['light'],
            ability: { [LIGHT_NAMESPACE]: { capacity: 5 } }
        });

        await endpoint.light!.setOn(true);

        assert.equal(requests[0]?.header.namespace, LIGHT_NAMESPACE);
        assert.equal(requests[0]?.header.method, 'SET');
        assert.deepEqual(
            requests[0]?.payload,
            encodeLightSet({ channel: CHANNEL, capacity: 5, onoff: true })
        );
    });

    it('defaults capacity to 0 when ability capacity is missing or non-number', async () => {
        const missing = createHarness({
            traits: ['light'],
            ability: { [LIGHT_NAMESPACE]: {} }
        });
        await missing.endpoint.light!.setOn(true);
        assert.deepEqual(
            missing.requests[0]?.payload,
            encodeLightSet({ channel: CHANNEL, capacity: 0, onoff: true })
        );

        const nonNumber = createHarness({
            traits: ['light'],
            ability: { [LIGHT_NAMESPACE]: { capacity: '5' } }
        });
        await nonNumber.endpoint.light!.setOn(true);
        assert.deepEqual(
            nonNumber.requests[0]?.payload,
            encodeLightSet({ channel: CHANNEL, capacity: 0, onoff: true })
        );
    });
});

describe('attachEndpoint cover', () => {
    it('defaults to garage when RollerShutter.State is absent', async () => {
        const { endpoint, requests } = createHarness({
            traits: ['cover'],
            ability: { [GARAGE_STATE_NAMESPACE]: {} },
            ack: (_opts, sent) => encodeMessage({
                namespace: sent.header.namespace,
                method: 'SETACK',
                key: KEY,
                from: `/appliance/${UUID}/publish`,
                messageId: sent.header.messageId,
                uuid: UUID,
                payload: {
                    state: { channel: CHANNEL, open: 1, execute: 0, lmTime: 0 }
                }
            })
        });

        await endpoint.cover!.open();

        assert.equal(requests[0]?.header.namespace, GARAGE_STATE_NAMESPACE);
    });

    it('binds shutter when RollerShutter.State is advertised', async () => {
        const { endpoint, requests } = createHarness({
            traits: ['cover'],
            ability: { [SHUTTER_STATE_NAMESPACE]: {}, [SHUTTER_POSITION_NAMESPACE]: {} }
        });

        await endpoint.cover!.open();

        assert.equal(requests[0]?.header.namespace, SHUTTER_POSITION_NAMESPACE);
    });
});

describe('attachEndpoint fan', () => {
    it('binds ToggleX when both Toggle and ToggleX are advertised', async () => {
        const { endpoint, requests } = createHarness({
            traits: ['fan'],
            ability: {
                [FAN_NAMESPACE]: {},
                [TOGGLE_NAMESPACE]: {},
                [TOGGLEX_NAMESPACE]: {}
            }
        });

        await endpoint.fan!.setOn(true);

        assert.equal(requests[0]?.header.namespace, TOGGLEX_NAMESPACE);
    });

    it('binds classic Toggle when Toggle is present and ToggleX is absent', async () => {
        const { endpoint, requests } = createHarness({
            traits: ['fan'],
            ability: { [FAN_NAMESPACE]: {}, [TOGGLE_NAMESPACE]: {} }
        });

        await endpoint.fan!.setOn(true);

        assert.equal(requests[0]?.header.namespace, TOGGLE_NAMESPACE);
    });
});

describe('attachEndpoint climate', () => {
    it('binds ModeC when ModeC ability is present', async () => {
        const { endpoint, requests } = createHarness({
            traits: ['climate'],
            ability: { [THERMOSTAT_MODEC_NAMESPACE]: {} }
        });

        await endpoint.climate!.setOn(true);

        assert.equal(requests[0]?.header.namespace, THERMOSTAT_MODEC_NAMESPACE);
    });

    it('binds ModeB when ModeB is present and ModeC is absent', async () => {
        const { endpoint, requests } = createHarness({
            traits: ['climate'],
            ability: { [THERMOSTAT_MODEB_NAMESPACE]: {} }
        });

        await endpoint.climate!.setOn(true);

        assert.equal(requests[0]?.header.namespace, THERMOSTAT_MODEB_NAMESPACE);
    });

    it('binds Mode when ModeC and ModeB are absent', async () => {
        const { endpoint, requests } = createHarness({
            traits: ['climate'],
            ability: { [THERMOSTAT_MODE_NAMESPACE]: {} }
        });

        await endpoint.climate!.setOn(true);

        assert.equal(requests[0]?.header.namespace, THERMOSTAT_MODE_NAMESPACE);
    });

    it('binds hub climate when subDeviceId is set', async () => {
        const { endpoint, requests } = createHarness({
            traits: ['climate'],
            subDeviceId: SUB_DEVICE_ID,
            ability: { [HUB_TOGGLEX_NAMESPACE]: {}, [THERMOSTAT_MODEC_NAMESPACE]: {} }
        });

        await endpoint.climate!.setOn(true);

        assert.equal(requests[0]?.header.namespace, HUB_TOGGLEX_NAMESPACE);
    });
});

describe('attachEndpoint timer/trigger', () => {
    it('binds TimerX generation when TIMERX ability is present', async () => {
        const { endpoint, requests } = createHarness({
            traits: ['timer'],
            ability: { [TIMERX_NAMESPACE]: {} }
        });

        await endpoint.timer!.set(TIMER_SET);

        assert.equal(requests[0]?.header.namespace, TIMERX_NAMESPACE);
    });

    it('binds legacy timer when TIMERX ability is absent', async () => {
        const { endpoint, requests } = createHarness({
            traits: ['timer'],
            ability: { [CONTROL_TIMER_NAMESPACE]: {} }
        });

        await endpoint.timer!.set(TIMER_SET);

        assert.equal(requests[0]?.header.namespace, CONTROL_TIMER_NAMESPACE);
    });

    it('binds TriggerX generation when TRIGGERX ability is present', async () => {
        const { endpoint, requests } = createHarness({
            traits: ['trigger'],
            ability: { [TRIGGERX_NAMESPACE]: {} }
        });

        await endpoint.trigger!.set(TRIGGER_SET);

        assert.equal(requests[0]?.header.namespace, TRIGGERX_NAMESPACE);
    });

    it('binds legacy trigger when TRIGGERX ability is absent', async () => {
        const { endpoint, requests } = createHarness({
            traits: ['trigger'],
            ability: { [CONTROL_TRIGGER_NAMESPACE]: {} }
        });

        await endpoint.trigger!.set(TRIGGER_SET);

        assert.equal(requests[0]?.header.namespace, CONTROL_TRIGGER_NAMESPACE);
    });
});
