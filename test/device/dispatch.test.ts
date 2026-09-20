import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';

import { DeviceRuntime } from '../../src/device/runtime';
import {
    Endpoint,
    type EndpointChange,
    type EndpointOptions,
    type TraitName
} from '../../src/endpoint';
import {
    HUB_SENSOR_ALL_NAMESPACE,
    HUB_SENSOR_TEMPHUM_NAMESPACE,
    TOGGLEX_NAMESPACE,
    encodeMessage,
    type MerossMessage
} from '../../src/protocol';
import type { DeviceRequest } from '../../src/request';
import { ClimateTrait } from '../../src/traits/climate';
import { LightTrait } from '../../src/traits/light';
import { SensorTrait } from '../../src/traits/sensor';
import { SwitchTrait } from '../../src/traits/switch';
import { SystemTrait } from '../../src/traits/system';
import { createRequestRecorder } from '../helpers/request';

const KEY = 'stub-key';
const UUID = '2206138957096651080248e1e99705a4';
const CHANNEL = 0;
const TEMP_HUM_ID = '00000102';
const CONTACT_ID = '00000200';
const CLIMATE_ID = '00000101';

type EmitChange = (change: EndpointChange) => void;

function deviceMessage(
    namespace: string,
    method: string,
    payload: Record<string, unknown>
): MerossMessage {
    return encodeMessage({
        namespace,
        method,
        key: KEY,
        from: `/appliance/${UUID}/publish`,
        uuid: UUID,
        payload
    });
}

function pushMessage(namespace: string, payload: Record<string, unknown>): MerossMessage {
    return deviceMessage(namespace, 'PUSH', payload);
}

function togglexPush(on: boolean): MerossMessage {
    return pushMessage(TOGGLEX_NAMESPACE, {
        togglex: [{ channel: CHANNEL, onoff: on ? 1 : 0, entity: 1, lmTime: 1 }]
    });
}

function ignoreAck(): void {}

/**
 * Runtime for handlePush-only tests; poller/availability stay idle without start().
 */
function createRuntime(
    endpoints: readonly Endpoint[],
    onAck: (message: MerossMessage) => void = ignoreAck
): DeviceRuntime {
    return new DeviceRuntime({
        uuid: UUID,
        initialOnline: true,
        endpoints,
        request: async () => deviceMessage('Appliance.System.All', 'GETACK', {}),
        isCloudPath: () => false,
        maxCmdNum: () => 3,
        requestGets: async () => [],
        onAck
    });
}

function deviceRequest(): DeviceRequest {
    return createRequestRecorder({ uuid: UUID, key: KEY }).request;
}

/**
 * Traits emit onto the Endpoint they belong to, but those fields are
 * readonly and only set in the constructor.
 */
function wiredEndpoint<T extends Omit<EndpointOptions, 'id' | 'traits'>>(
    id: string,
    names: readonly TraitName[],
    createTraits: (emit: EmitChange) => T
): T & { endpoint: Endpoint } {
    let endpoint!: Endpoint;
    function emit(change: EndpointChange): void {
        endpoint.emit('change', change);
    }
    const instances = createTraits(emit);
    endpoint = new Endpoint({ id, traits: names, ...instances });
    return { endpoint, ...instances };
}

function boardSwitch(emit: EmitChange): SwitchTrait {
    return new SwitchTrait({
        kind: 'board',
        channel: CHANNEL,
        namespace: TOGGLEX_NAMESPACE,
        request: deviceRequest(),
        emitChange: (values) => emit({ trait: 'switch', values: { ...values } })
    });
}

function lightTrait(emit: EmitChange): LightTrait {
    return new LightTrait({
        channel: CHANNEL,
        hasToggleX: true,
        hasToggle: false,
        lightCapacity: 0,
        hasLightEffect: false,
        request: deviceRequest(),
        emitChange: (values) => emit({ trait: 'light', values })
    });
}

function systemTrait(emit: EmitChange): SystemTrait {
    return new SystemTrait({
        initialFirmware: { version: '7.3.13' },
        initialHardware: { type: 'mss110', uuid: UUID },
        now: () => 0,
        request: deviceRequest(),
        emitChange: (values) => emit({ trait: 'system', values: { ...values } })
    });
}

function sensorTrait(
    subDeviceId: string,
    family: 'tempHum' | 'contact',
    emit: EmitChange
): SensorTrait {
    return new SensorTrait({
        subDeviceId,
        family,
        namespaces: new Set([HUB_SENSOR_TEMPHUM_NAMESPACE, HUB_SENSOR_ALL_NAMESPACE]),
        request: deviceRequest(),
        emitChange: (values) => emit({ trait: 'sensor', values })
    });
}

function climateTrait(emit: EmitChange): ClimateTrait {
    return new ClimateTrait({
        kind: 'hub',
        subDeviceId: CLIMATE_ID,
        namespaces: new Set(),
        request: deviceRequest(),
        emitChange: (values) => emit({ trait: 'climate', values })
    });
}

describe('DeviceRuntime.handlePush', () => {
    it('(a) ToggleX routes to switch, not system', (t: TestContext) => {
        const { endpoint, system, switch: sw } = wiredEndpoint(
            `${UUID}:0`,
            ['system', 'switch'],
            (emit) => ({
                system: systemTrait(emit),
                switch: boardSwitch(emit)
            })
        );

        const systemPush = t.mock.method(system, 'handlePush');
        const runtime = createRuntime([endpoint]);

        runtime.handlePush(togglexPush(true));

        assert.equal(sw.isOn(), true);
        assert.equal(systemPush.mock.callCount(), 0);
        runtime.stop();
    });

    it('(b) ToggleX updates switch and light in traits order', () => {
        const { endpoint, switch: sw, light } = wiredEndpoint(
            `${UUID}:0`,
            ['switch', 'light'],
            (emit) => ({
                switch: boardSwitch(emit),
                light: lightTrait(emit)
            })
        );

        const order: TraitName[] = [];
        endpoint.on('change', (change: EndpointChange) => {
            order.push(change.trait);
        });

        const runtime = createRuntime([endpoint]);
        runtime.handlePush(togglexPush(true));

        assert.equal(sw.isOn(), true);
        assert.equal(light.isOn(), true);
        assert.deepEqual(order, ['switch', 'light']);
        runtime.stop();
    });

    it('(c) light throw still applies switch and emits one warning', (t: TestContext) => {
        const { endpoint, switch: sw, light } = wiredEndpoint(
            `${UUID}:0`,
            ['switch', 'light'],
            (emit) => ({
                switch: boardSwitch(emit),
                light: lightTrait(emit)
            })
        );

        t.mock.method(light, 'handlePush', () => {
            throw new Error('light failed');
        });

        const warnings: Array<{ trait: TraitName; message: string }> = [];
        endpoint.on('warning', (error, trait) => {
            warnings.push({ trait, message: error.message });
        });

        const runtime = createRuntime([endpoint]);
        runtime.handlePush(togglexPush(false));

        assert.equal(sw.isOn(), false);
        assert.equal(warnings.length, 1);
        assert.equal(warnings[0]?.trait, 'light');
        assert.equal(warnings[0]?.message, 'light failed');
        runtime.stop();
    });

    it('(d) ToggleX GETACK via onAck updates switch; ERROR is skipped', () => {
        const { endpoint, switch: sw } = wiredEndpoint(
            `${UUID}:0`,
            ['switch'],
            (emit) => ({ switch: boardSwitch(emit) })
        );

        let runtime!: DeviceRuntime;
        function onAck(message: MerossMessage): void {
            runtime.handlePush(message);
        }
        runtime = createRuntime([endpoint], onAck);

        onAck(deviceMessage(TOGGLEX_NAMESPACE, 'GETACK', {
            togglex: [{ channel: CHANNEL, onoff: 1, entity: 1, lmTime: 1 }]
        }));
        assert.equal(sw.isOn(), true);

        onAck(deviceMessage(TOGGLEX_NAMESPACE, 'ERROR', {
            togglex: [{ channel: CHANNEL, onoff: 0, entity: 1, lmTime: 2 }]
        }));
        assert.equal(sw.isOn(), true);

        runtime.stop();
    });

    it('(e) unknown namespace is a no-op', () => {
        const { endpoint, switch: sw } = wiredEndpoint(
            `${UUID}:0`,
            ['switch'],
            (emit) => ({ switch: boardSwitch(emit) })
        );

        const changes: EndpointChange[] = [];
        const warnings: unknown[] = [];
        endpoint.on('change', (change) => changes.push(change));
        endpoint.on('warning', (...args) => warnings.push(args));

        const runtime = createRuntime([endpoint]);
        assert.doesNotThrow(() => {
            runtime.handlePush(pushMessage('Appliance.Control.DoesNotExist', { x: 1 }));
        });
        assert.equal(changes.length, 0);
        assert.equal(warnings.length, 0);
        assert.equal(sw.isOn(), undefined);
        runtime.stop();
    });

    it('hub TempHum updates matching sensor without climate handlePush or contact change', (t: TestContext) => {
        const { endpoint: tempHumEndpoint } = wiredEndpoint(
            `${UUID}#${TEMP_HUM_ID}`,
            ['sensor'],
            (emit) => ({ sensor: sensorTrait(TEMP_HUM_ID, 'tempHum', emit) })
        );
        const { endpoint: contactEndpoint, sensor: contact } = wiredEndpoint(
            `${UUID}#${CONTACT_ID}`,
            ['sensor'],
            (emit) => ({ sensor: sensorTrait(CONTACT_ID, 'contact', emit) })
        );
        const { endpoint: climateEndpoint, climate } = wiredEndpoint(
            `${UUID}#${CLIMATE_ID}`,
            ['climate'],
            (emit) => ({ climate: climateTrait(emit) })
        );

        const climatePush = t.mock.method(climate, 'handlePush');
        const contactPush = t.mock.method(contact, 'handlePush');

        const contactChanges: EndpointChange[] = [];
        contactEndpoint.on('change', (change) => contactChanges.push(change));

        const tempHumChanges: EndpointChange[] = [];
        tempHumEndpoint.on('change', (change) => tempHumChanges.push(change));

        const runtime = createRuntime([tempHumEndpoint, contactEndpoint, climateEndpoint]);
        runtime.handlePush(pushMessage(HUB_SENSOR_TEMPHUM_NAMESPACE, {
            tempHum: [{ id: TEMP_HUM_ID, latestTemperature: 230, latestHumidity: 450 }]
        }));

        assert.equal(tempHumChanges.length, 1);
        assert.equal(tempHumChanges[0]?.trait, 'sensor');
        if (tempHumChanges[0]?.trait === 'sensor') {
            assert.equal(tempHumChanges[0].values.temperature, 23);
            assert.equal(tempHumChanges[0].values.humidity, 45);
        }
        assert.equal(contactPush.mock.callCount(), 1);
        assert.equal(contactChanges.length, 0);
        assert.equal(climatePush.mock.callCount(), 0);
        runtime.stop();
    });

    it('listed sensor without instance does not throw or warn on Hub.Sensor.All', () => {
        const endpoint = new Endpoint({
            id: `${UUID}#missing`,
            traits: ['sensor']
        });
        assert.equal(endpoint.sensor, undefined);
        assert.ok(endpoint.traits.includes('sensor'));

        const warnings: unknown[] = [];
        endpoint.on('warning', (...args) => warnings.push(args));

        const runtime = createRuntime([endpoint]);
        assert.doesNotThrow(() => {
            runtime.handlePush(pushMessage(HUB_SENSOR_ALL_NAMESPACE, {
                all: [{ id: 'missing', onlineStatus: 1 }]
            }));
        });
        assert.equal(warnings.length, 0);
        runtime.stop();
    });
});
