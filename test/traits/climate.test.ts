import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Endpoint } from '../../src/endpoint';
import {
    THERMOSTAT_MODE_NAMESPACE,
    THERMOSTAT_MODEB_NAMESPACE,
    THERMOSTAT_MODEC_NAMESPACE,
    THERMOSTAT_SYSTEM_NAMESPACE,
    HUB_MTS100_ADJUST_NAMESPACE,
    HUB_MTS100_MODE_NAMESPACE,
    HUB_MTS100_TEMPERATURE_NAMESPACE,
    HUB_TOGGLEX_NAMESPACE,
    HOLD_ACTION_NAMESPACE,
    WINDOW_OPENED_NAMESPACE,
    TEMP_UNIT_NAMESPACE,
    PHYSICAL_LOCK_NAMESPACE,
    SCREEN_BRIGHTNESS_NAMESPACE,
    SENSOR_LATEST_NAMESPACE,
    SENSOR_HISTORY_NAMESPACE,
    encodeMessage,
    type MerossMessage
} from '../../src/protocol';
import { ClimateTrait } from '../../src/traits/climate';
import type { ClimateTraitBind } from '../../src/traits/climate';

const KEY = 'stub-key';
const UUID = '2206138957096651080248e1e99705a4';
const CHANNEL = 0;
const SUB_DEVICE_ID = '00000101';

function createBoardHarness(
    generation: 'mode' | 'modeB' | 'modeC',
    namespaces: readonly string[] = []
): {
    endpoint: Endpoint;
    trait: ClimateTrait;
    requests: MerossMessage[];
} {
    const requests: MerossMessage[] = [];
    const endpoint = new Endpoint({ id: `${UUID}:${CHANNEL}`, traits: ['climate'] });
    const bind: ClimateTraitBind = {
        kind: 'board',
        uuid: UUID,
        channel: CHANNEL,
        generation,
        namespaces: new Set(namespaces),
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
        emitChange: (values) => endpoint.emit('change', { trait: 'climate', values: { ...values } })
    };
    return { endpoint, trait: new ClimateTrait(bind), requests };
}

function createHubHarness(namespaces: readonly string[] = []): {
    endpoint: Endpoint;
    trait: ClimateTrait;
    requests: MerossMessage[];
} {
    const requests: MerossMessage[] = [];
    const endpoint = new Endpoint({ id: `${UUID}#${SUB_DEVICE_ID}`, traits: ['climate'] });
    const bind: ClimateTraitBind = {
        kind: 'hub',
        uuid: UUID,
        subDeviceId: SUB_DEVICE_ID,
        namespaces: new Set(namespaces),
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
        emitChange: (values) => endpoint.emit('change', { trait: 'climate', values: { ...values } })
    };
    return { endpoint, trait: new ClimateTrait(bind), requests };
}

function push(namespace: string, payload: MerossMessage['payload']): MerossMessage {
    return encodeMessage({
        namespace,
        method: 'PUSH',
        key: KEY,
        from: `/appliance/${UUID}/publish`,
        uuid: UUID,
        payload
    });
}

describe('ClimateTrait board Mode generation', () => {
    it('setOn(true) sends Thermostat.Mode SET', async () => {
        const { trait, requests } = createBoardHarness('mode');

        await trait.setOn(true);

        assert.equal(requests.length, 1);
        assert.equal(requests[0]?.header.namespace, THERMOSTAT_MODE_NAMESPACE);
        assert.equal(requests[0]?.header.method, 'SET');
    });

    it('setOn(false) sends off mode', async () => {
        const { trait, requests } = createBoardHarness('mode');

        await trait.setOn(false);

        const payload = requests[0]?.payload as { mode: Array<{ onoff: number }> };
        assert.equal(payload.mode[0]?.onoff, 0);
    });

    it('setMode sends Thermostat.Mode SET', async () => {
        const { trait, requests } = createBoardHarness('mode');

        const result = await trait.setMode('cool');

        assert.equal(result.mode, 'cool');
        assert.equal(requests[0]?.header.namespace, THERMOSTAT_MODE_NAMESPACE);
    });

    it('setTargetTemperature sends targetTemp ×10', async () => {
        const { trait, requests } = createBoardHarness('mode');

        await trait.setTargetTemperature(22);

        const payload = requests[0]?.payload as { mode: Array<{ targetTemp: number }> };
        assert.equal(payload.mode[0]?.targetTemp, 220);
    });

    it('handlePush applies Thermostat.Mode PUSH and emits change', () => {
        const { endpoint, trait } = createBoardHarness('mode');
        const changes: unknown[] = [];
        endpoint.on('change', (c) => changes.push(c));

        trait.handlePush(push(THERMOSTAT_MODE_NAMESPACE, {
            mode: [{ channel: CHANNEL, onoff: 1, mode: 0, targetTemp: 220, currentTemp: 180 }]
        }));

        assert.equal(changes.length, 1);
        const change = changes[0] as { trait: string; values: Record<string, unknown> };
        assert.equal(change.trait, 'climate');
        assert.equal(change.values.on, true);
        assert.equal(change.values.targetTemperature, 22);
        assert.equal(change.values.currentTemperature, 18);
    });

    it('does not emit change when PUSH repeats the same state', () => {
        const { endpoint, trait } = createBoardHarness('mode');
        const changes: unknown[] = [];
        endpoint.on('change', (c) => changes.push(c));

        const msg = push(THERMOSTAT_MODE_NAMESPACE, {
            mode: [{ channel: CHANNEL, onoff: 1, mode: 0 }]
        });
        trait.handlePush(msg);
        trait.handlePush(msg);

        assert.equal(changes.length, 1);
    });
});

describe('ClimateTrait board ModeB generation', () => {
    it('setOn(false) sends ModeB SET with onoff=2', async () => {
        const { trait, requests } = createBoardHarness('modeB');

        await trait.setOn(false);

        assert.equal(requests[0]?.header.namespace, THERMOSTAT_MODEB_NAMESPACE);
        const payload = requests[0]?.payload as { modeB: Array<{ onoff: number }> };
        assert.equal(payload.modeB[0]?.onoff, 2);
    });

    it('setTargetTemperature sends targetTemp ×100 with mode=1', async () => {
        const { trait, requests } = createBoardHarness('modeB');

        await trait.setTargetTemperature(22);

        const payload = requests[0]?.payload as { modeB: Array<{ targetTemp: number; mode: number }> };
        assert.equal(payload.modeB[0]?.targetTemp, 2200);
        assert.equal(payload.modeB[0]?.mode, 1);
    });

    it('handlePush applies ModeB PUSH', () => {
        const { endpoint, trait } = createBoardHarness('modeB');
        const changes: unknown[] = [];
        endpoint.on('change', (c) => changes.push(c));

        trait.handlePush(push(THERMOSTAT_MODEB_NAMESPACE, {
            modeB: [{ channel: CHANNEL, onoff: 1, mode: 1, targetTemp: 2200, currentTemp: 1800 }]
        }));

        const change = changes[0] as { values: Record<string, unknown> };
        assert.equal(change.values.on, true);
        assert.equal(change.values.targetTemperature, 22);
        assert.equal(change.values.currentTemperature, 18);
    });
});

describe('ClimateTrait board ModeC generation', () => {
    it('setOn(true) uses ModeC SET with mode=heat', async () => {
        const { trait, requests } = createBoardHarness('modeC');

        await trait.setOn(true);

        assert.equal(requests[0]?.header.namespace, THERMOSTAT_MODEC_NAMESPACE);
        const payload = requests[0]?.payload as { control: Array<{ mode: number }> };
        assert.equal(payload.control[0]?.mode, 1);
    });

    it('setOn(false) uses ModeC SET with mode=0 (off)', async () => {
        const { trait, requests } = createBoardHarness('modeC');

        await trait.setOn(false);

        const payload = requests[0]?.payload as { control: Array<{ mode: number }> };
        assert.equal(payload.control[0]?.mode, 0);
    });

    it('setTargetTemperature sends {heat, cold} ×100', async () => {
        const { trait, requests } = createBoardHarness('modeC');

        await trait.setTargetTemperature(21);

        const payload = requests[0]?.payload as {
            control: Array<{ targetTemp: { heat: number; cold: number } }>
        };
        assert.deepEqual(payload.control[0]?.targetTemp, { heat: 2100, cold: 2100 });
    });

    it('handlePush applies ModeC PUSH with nested targetTemp', () => {
        const { endpoint, trait } = createBoardHarness('modeC');
        const changes: unknown[] = [];
        endpoint.on('change', (c) => changes.push(c));

        trait.handlePush(push(THERMOSTAT_MODEC_NAMESPACE, {
            control: [{
                channel: CHANNEL,
                mode: 1,
                targetTemp: { heat: 2100, cold: 2400 },
                currentTemp: 2200
            }]
        }));

        const change = changes[0] as { values: Record<string, unknown> };
        assert.equal(change.values.on, true);
        assert.equal(change.values.mode, 'heat');
        assert.equal(change.values.targetTemperature, 21);
        assert.equal(change.values.currentTemperature, 22);
    });

    it('handlePush applies Thermostat.System without GETing on start', async () => {
        const { endpoint, trait, requests } = createBoardHarness('modeC', [THERMOSTAT_SYSTEM_NAMESPACE]);
        const changes: unknown[] = [];
        endpoint.on('change', (c) => changes.push(c));

        trait.start();
        await new Promise((resolve) => setImmediate(resolve));
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(
            requests.some((r) => r.header.namespace === THERMOSTAT_SYSTEM_NAMESPACE),
            false
        );

        trait.handlePush(push(THERMOSTAT_SYSTEM_NAMESPACE, {
            control: [{
                channel: CHANNEL,
                fLevel: 1,
                hLevel: 1,
                cLevel: 1,
                sysType: 0,
                compTempEnable: 1,
                compTemp: 150,
                wire: { R: 2, Rh: 2, Rc: 1, C: 1, E: 2, WAux: 1 }
            }]
        }));

        const change = changes[0] as { values: Record<string, unknown> };
        assert.equal(change.values.compTemp, 1.5);
        assert.equal(change.values.compTempEnable, true);
        assert.deepEqual(change.values.wire, { R: 2, Rh: 2, Rc: 1, C: 1, E: 2, WAux: 1 });

        const system = trait.getSystem();
        assert.equal(system?.fLevel, 1);
        assert.equal(system?.compTemp, 1.5);
        assert.deepEqual(system?.wire, { R: 2, Rh: 2, Rc: 1, C: 1, E: 2, WAux: 1 });
    });

    it('setSystem SETs when advertised and getSystem is a no-op without Ability', async () => {
        const missing = createBoardHarness('modeC');
        assert.equal(missing.trait.getSystem(), undefined);
        assert.deepEqual(await missing.trait.setSystem({ compTemp: 2 }), { compTemp: 2 });
        assert.equal(missing.requests.length, 0);

        const { trait, requests } = createBoardHarness('modeC', [THERMOSTAT_SYSTEM_NAMESPACE]);
        const result = await trait.setSystem({
            compTempEnable: true,
            compTemp: 1.5,
            wire: { R: 2, WAux: 1 }
        });
        assert.equal(requests[0]?.header.namespace, THERMOSTAT_SYSTEM_NAMESPACE);
        assert.equal(requests[0]?.header.method, 'SET');
        const payload = requests[0]?.payload as {
            control: Array<{ compTemp: number; compTempEnable: number; wire: Record<string, number> }>
        };
        assert.equal(payload.control[0]?.compTemp, 150);
        assert.equal(payload.control[0]?.compTempEnable, 1);
        assert.deepEqual(result.wire, { R: 2, WAux: 1 });
        assert.deepEqual(trait.getSystem(), result);
    });
});

describe('ClimateTrait hub valve', () => {
    it('setOn sends Hub.ToggleX SET', async () => {
        const { trait, requests } = createHubHarness();

        await trait.setOn(true);

        assert.equal(requests.length, 1);
        assert.equal(requests[0]?.header.namespace, HUB_TOGGLEX_NAMESPACE);
        const payload = requests[0]?.payload as { togglex: Array<{ id: string; onoff: number }> };
        assert.equal(payload.togglex[0]?.id, SUB_DEVICE_ID);
        assert.equal(payload.togglex[0]?.onoff, 1);
    });

    it('setMode sends Hub.Mts100.Mode SET', async () => {
        const { trait, requests } = createHubHarness();

        await trait.setMode('heat');

        assert.equal(requests[0]?.header.namespace, HUB_MTS100_MODE_NAMESPACE);
        const payload = requests[0]?.payload as { mode: Array<{ id: string; state: number }> };
        assert.equal(payload.mode[0]?.state, 1);
    });

    it('setTargetTemperature sends Hub.Mts100.Temperature SET ×10', async () => {
        const { trait, requests } = createHubHarness();

        await trait.setTargetTemperature(22);

        assert.equal(requests[0]?.header.namespace, HUB_MTS100_TEMPERATURE_NAMESPACE);
        const payload = requests[0]?.payload as { temperature: Array<{ custom: number }> };
        assert.equal(payload.temperature[0]?.custom, 220);
    });

    it('handlePush applies Hub.ToggleX PUSH for matching subDeviceId', () => {
        const { endpoint, trait } = createHubHarness();
        const changes: unknown[] = [];
        endpoint.on('change', (c) => changes.push(c));

        trait.handlePush(push(HUB_TOGGLEX_NAMESPACE, {
            togglex: [{ id: SUB_DEVICE_ID, onoff: 1 }]
        }));

        const change = changes[0] as { values: Record<string, unknown> };
        assert.equal(change.values.on, true);
    });

    it('handlePush applies Hub.Mts100.Temperature PUSH', () => {
        const { endpoint, trait } = createHubHarness();
        const changes: unknown[] = [];
        endpoint.on('change', (c) => changes.push(c));

        trait.handlePush(push(HUB_MTS100_TEMPERATURE_NAMESPACE, {
            temperature: [{ id: SUB_DEVICE_ID, room: 180, currentSet: 220 }]
        }));

        const change = changes[0] as { values: Record<string, unknown> };
        assert.equal(change.values.currentTemperature, 18);
        assert.equal(change.values.targetTemperature, 22);
    });

    it('setMode(custom) sends Hub.Mts100.Mode state 0', async () => {
        const { trait, requests } = createHubHarness();

        await trait.setMode('custom');

        const payload = requests[0]?.payload as { mode: Array<{ state: number }> };
        assert.equal(payload.mode[0]?.state, 0);
    });

    it('setMode(off) sends Hub.ToggleX SET', async () => {
        const { trait, requests } = createHubHarness();

        await trait.setMode('off');

        assert.equal(requests[0]?.header.namespace, HUB_TOGGLEX_NAMESPACE);
    });

    it('ignores Hub.ToggleX PUSH for a different subDeviceId', () => {
        const { endpoint, trait } = createHubHarness();
        const changes: unknown[] = [];
        endpoint.on('change', (c) => changes.push(c));

        trait.handlePush(push(HUB_TOGGLEX_NAMESPACE, {
            togglex: [{ id: 'other-device', onoff: 1 }]
        }));

        assert.deepEqual(changes, []);
    });
});

describe('ClimateTrait extras', () => {
    it('setHold is a no-op when HoldAction is not advertised', async () => {
        const { trait, requests } = createBoardHarness('mode');

        await trait.setHold('untilSchedule');

        assert.equal(requests.length, 0);
    });

    it('setHold sends HoldAction SET when advertised', async () => {
        const { trait, requests } = createBoardHarness('mode', [HOLD_ACTION_NAMESPACE]);

        await trait.setHold('untilSchedule');

        assert.equal(requests[0]?.header.namespace, HOLD_ACTION_NAMESPACE);
        const payload = requests[0]?.payload as { holdAction: Array<{ mode: number }> };
        assert.equal(payload.holdAction[0]?.mode, 1);
    });

    it('setWindowDetect is a no-op when WindowOpened is not advertised', async () => {
        const { trait, requests } = createBoardHarness('mode');

        await trait.setWindowDetect(true);

        assert.equal(requests.length, 0);
    });

    it('setWindowDetect sends WindowOpened SET when advertised', async () => {
        const { trait, requests } = createBoardHarness('mode', [WINDOW_OPENED_NAMESPACE]);

        await trait.setWindowDetect(true);

        assert.equal(requests[0]?.header.namespace, WINDOW_OPENED_NAMESPACE);
        const payload = requests[0]?.payload as { windowOpened: Array<{ detect: number }> };
        assert.equal(payload.windowOpened[0]?.detect, 1);
    });

    it('setMode(eco) sends Mode wire 2', async () => {
        const { trait, requests } = createBoardHarness('mode');

        await trait.setMode('eco');

        const payload = requests[0]?.payload as { mode: Array<{ mode: number }> };
        assert.equal(payload.mode[0]?.mode, 2);
    });

    it('setMode(cool) on ModeB sends working=2', async () => {
        const { trait, requests } = createBoardHarness('modeB');

        await trait.setMode('cool');

        const payload = requests[0]?.payload as { modeB: Array<{ working: number; onoff: number }> };
        assert.equal(payload.modeB[0]?.working, 2);
        assert.equal(payload.modeB[0]?.onoff, 1);
    });

    it('setWorkMode is a no-op on Mode generation', async () => {
        const { trait, requests } = createBoardHarness('mode');

        await trait.setWorkMode('schedule');

        assert.equal(requests.length, 0);
    });

    it('setCalibration on hub sends Adjust ×100 when advertised', async () => {
        const { trait, requests } = createHubHarness([HUB_MTS100_ADJUST_NAMESPACE]);

        await trait.setCalibration(-2);

        assert.equal(requests[0]?.header.namespace, HUB_MTS100_ADJUST_NAMESPACE);
        const payload = requests[0]?.payload as { adjust: Array<{ temperature: number }> };
        assert.equal(payload.adjust[0]?.temperature, -200);
    });

    it('handlePush applies HoldAction when advertised', () => {
        const { endpoint, trait } = createBoardHarness('mode', [HOLD_ACTION_NAMESPACE]);
        const changes: unknown[] = [];
        endpoint.on('change', (c) => changes.push(c));

        trait.handlePush(push(HOLD_ACTION_NAMESPACE, {
            holdAction: [{ channel: CHANNEL, mode: 0 }]
        }));

        const change = changes[0] as { values: Record<string, unknown> };
        assert.equal(change.values.holdMode, 'permanent');
    });
});

describe('ClimateTrait device settings', () => {
    it('setTempUnit is a no-op when TempUnit is not advertised', async () => {
        const { trait, requests } = createBoardHarness('mode');

        await trait.setTempUnit('fahrenheit');

        assert.equal(requests.length, 0);
    });

    it('setTempUnit sends TempUnit SET when advertised', async () => {
        const { trait, requests } = createBoardHarness('mode', [TEMP_UNIT_NAMESPACE]);

        await trait.setTempUnit('fahrenheit');

        assert.equal(requests[0]?.header.namespace, TEMP_UNIT_NAMESPACE);
        const payload = requests[0]?.payload as { tempUnit: Array<{ tempUnit: number }> };
        assert.equal(payload.tempUnit[0]?.tempUnit, 2);
    });

    it('setChildLock sends PhysicalLock SET on board when advertised', async () => {
        const { trait, requests } = createBoardHarness('mode', [PHYSICAL_LOCK_NAMESPACE]);

        await trait.setChildLock(true);

        assert.equal(requests[0]?.header.namespace, PHYSICAL_LOCK_NAMESPACE);
        const payload = requests[0]?.payload as { lock: Array<{ onoff: number; channel: number }> };
        assert.equal(payload.lock[0]?.channel, CHANNEL);
        assert.equal(payload.lock[0]?.onoff, 1);
    });

    it('setChildLock sends PhysicalLock SET on hub with subId when advertised', async () => {
        const { trait, requests } = createHubHarness([PHYSICAL_LOCK_NAMESPACE]);

        await trait.setChildLock(false);

        assert.equal(requests[0]?.header.namespace, PHYSICAL_LOCK_NAMESPACE);
        const payload = requests[0]?.payload as { lock: Array<{ subId: string; onoff: number }> };
        assert.equal(payload.lock[0]?.subId, SUB_DEVICE_ID);
        assert.equal(payload.lock[0]?.onoff, 0);
    });

    it('setScreenBrightness is a no-op when Screen.Brightness is not advertised', async () => {
        const { trait, requests } = createBoardHarness('mode');

        await trait.setScreenBrightness({ operation: 0.5 });

        assert.equal(requests.length, 0);
    });

    it('setScreenBrightness sends wire 0–100 when advertised', async () => {
        const { trait, requests } = createBoardHarness('mode', [SCREEN_BRIGHTNESS_NAMESPACE]);

        await trait.setScreenBrightness({ standby: 0, operation: 0.5, standbyView: true });

        assert.equal(requests[0]?.header.namespace, SCREEN_BRIGHTNESS_NAMESPACE);
        const payload = requests[0]?.payload as {
            brightness: Array<{ standby: number; operation: number; standbyView: number }>;
        };
        assert.deepEqual(payload.brightness[0], {
            channel: CHANNEL,
            standby: 0,
            operation: 50,
            standbyView: 1
        });
    });

    it('handlePush applies TempUnit when advertised', () => {
        const { endpoint, trait } = createBoardHarness('mode', [TEMP_UNIT_NAMESPACE]);
        const changes: unknown[] = [];
        endpoint.on('change', (c) => changes.push(c));

        trait.handlePush(push(TEMP_UNIT_NAMESPACE, {
            tempUnit: [{ channel: CHANNEL, tempUnit: 2 }]
        }));

        const change = changes[0] as { values: Record<string, unknown> };
        assert.equal(change.values.tempUnit, 'fahrenheit');
    });

    it('handlePush applies PhysicalLock on hub when advertised', () => {
        const { endpoint, trait } = createHubHarness([PHYSICAL_LOCK_NAMESPACE]);
        const changes: unknown[] = [];
        endpoint.on('change', (c) => changes.push(c));

        trait.handlePush(push(PHYSICAL_LOCK_NAMESPACE, {
            lock: [{ channel: 0, subId: SUB_DEVICE_ID, onoff: 1 }]
        }));

        const change = changes[0] as { values: Record<string, unknown> };
        assert.equal(change.values.childLock, true);
    });
});

describe('ClimateTrait board sensor readings', () => {
    const LATEST_ACK = {
        latest: [{
            channel: CHANNEL,
            capacity: 2,
            value: [{ timestamp: 1718302939, humi: 596 }]
        }]
    };

    const HISTORY_ACK = {
        history: [{
            channel: CHANNEL,
            capacity: 3,
            value: [
                { timestamp: 1718222159, temp: 166, humi: 607 },
                { timestamp: 1718225759, temp: 172, humi: 616 }
            ]
        }]
    };

    function createSensorHarness(namespaces: readonly string[]): {
        endpoint: Endpoint;
        trait: ClimateTrait;
        requests: MerossMessage[];
        changes: Record<string, unknown>[];
    } {
        const requests: MerossMessage[] = [];
        const changes: Record<string, unknown>[] = [];
        const endpoint = new Endpoint({ id: `${UUID}:${CHANNEL}`, traits: ['climate'] });
        const bind: ClimateTraitBind = {
            kind: 'board',
            uuid: UUID,
            channel: CHANNEL,
            generation: 'mode',
            namespaces: new Set(namespaces),
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
                let replyPayload: MerossMessage['payload'] = {};
                if (options.namespace === THERMOSTAT_MODE_NAMESPACE) {
                    replyPayload = { mode: [{ channel: CHANNEL, onoff: 1, mode: 1, targetTemp: 210, currentTemp: 205 }] };
                } else if (options.namespace === SENSOR_LATEST_NAMESPACE) {
                    replyPayload = LATEST_ACK;
                } else if (options.namespace === SENSOR_HISTORY_NAMESPACE) {
                    replyPayload = HISTORY_ACK;
                }
                return encodeMessage({
                    namespace: options.namespace,
                    method: 'GETACK',
                    key: KEY,
                    from: `/appliance/${UUID}/publish`,
                    messageId: message.header.messageId,
                    uuid: UUID,
                    payload: replyPayload
                });
            },
            emitChange: (values) => {
                changes.push({ ...values });
                endpoint.emit('change', { trait: 'climate', values: { ...values } });
            }
        };
        return { endpoint, trait: new ClimateTrait(bind), requests, changes };
    }

    it('handlePush applies humidity from Sensor.Latest when advertised', () => {
        const { endpoint, trait } = createBoardHarness('mode', [SENSOR_LATEST_NAMESPACE]);
        const changes: unknown[] = [];
        endpoint.on('change', (c) => changes.push(c));

        trait.handlePush(push(SENSOR_LATEST_NAMESPACE, LATEST_ACK));

        const change = changes[0] as { values: Record<string, unknown> };
        assert.equal(change.values.humidity, 59.6);
    });

    it('GETs Sensor.Latest on start when advertised', async () => {
        const { trait, requests, changes } = createSensorHarness([SENSOR_LATEST_NAMESPACE]);
        trait.start();
        await new Promise((resolve) => setImmediate(resolve));
        await new Promise((resolve) => setImmediate(resolve));
        assert.ok(requests.some((r) => r.header.namespace === SENSOR_LATEST_NAMESPACE));
        assert.equal(changes.find((c) => c.humidity !== undefined)?.humidity, 59.6);
    });

    it('getHistory returns undefined when Sensor.History is not advertised', async () => {
        const { trait, requests } = createBoardHarness('mode');

        const samples = await trait.getHistory();

        assert.equal(samples, undefined);
        assert.equal(requests.length, 0);
    });

    it('getHistory returns undefined for hub valves', async () => {
        const { trait, requests } = createHubHarness([SENSOR_HISTORY_NAMESPACE]);

        const samples = await trait.getHistory();

        assert.equal(samples, undefined);
        assert.equal(requests.length, 0);
    });

    it('getHistory returns decoded samples when advertised', async () => {
        const { trait, requests } = createSensorHarness([SENSOR_HISTORY_NAMESPACE]);

        const samples = await trait.getHistory();

        assert.equal(requests[0]?.header.namespace, SENSOR_HISTORY_NAMESPACE);
        assert.deepEqual(
            (requests[0]?.payload as { history: Array<{ channel: number }> }).history[0],
            { channel: CHANNEL }
        );
        assert.equal(samples?.length, 2);
        assert.equal(samples?.[0]?.temperature, 16.6);
        assert.equal(samples?.[0]?.humidity, 60.7);
    });
});
