import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    decodeThermostatModeGetAck,
    decodeThermostatModeBGetAck,
    decodeThermostatModeCGetAck,
    encodeThermostatModeSet,
    encodeThermostatModeBSet,
    encodeThermostatModeCSet,
    decodeHubToggleXGetAck,
    decodeHubMts100ModeGetAck,
    decodeHubMts100TemperatureGetAck,
    encodeHubToggleXSet,
    encodeHubMts100ModeSet,
    encodeHubMts100TemperatureSet,
    SCHEDULEB_HUB_OFF,
    SCHEDULEB_OFF,
    decodeAlarm,
    decodeFrost,
    decodeHoldAction,
    decodeHubMts100All,
    decodeHubSchedule,
    decodeSchedule,
    decodeWindowOpened,
    encodeHoldActionSet,
    encodeHubScheduleSet,
    encodeOverheatSet,
    encodePhysicalLockSet,
    encodeScheduleSet,
    encodeScreenBrightnessSet,
    encodeTempUnitSet,
    encodeWindowOpenedSet,
    encodeThermostatSystemSet,
    decodePhysicalLock,
    decodeScreenBrightness,
    decodeTempUnit,
    decodeThermostatSystemGetAck,
    decodeThermostatSystemPush
} from '../../../src/protocol/codecs/climate';

describe('Thermostat.Mode codec', () => {
    it('decodes a GETACK array with temps ×10', () => {
        const [entry] = decodeThermostatModeGetAck({
            mode: [{ channel: 0, onoff: 1, mode: 0, targetTemp: 220, currentTemp: 180 }]
        });
        assert.equal(entry?.channel, 0);
        assert.equal(entry?.on, true);
        assert.equal(entry?.mode, 'heat');
        assert.equal(entry?.targetTemperature, 22);
        assert.equal(entry?.currentTemperature, 18);
    });

    it('maps onoff=0 to mode off', () => {
        const [entry] = decodeThermostatModeGetAck({
            mode: [{ channel: 0, onoff: 0, mode: 0, targetTemp: 220 }]
        });
        assert.equal(entry?.on, false);
        assert.equal(entry?.mode, 'off');
    });

    it('maps wire mode 1 to cool', () => {
        const [entry] = decodeThermostatModeGetAck({
            mode: [{ channel: 0, onoff: 1, mode: 1 }]
        });
        assert.equal(entry?.mode, 'cool');
    });

    it('maps wire mode 3 to auto', () => {
        const [entry] = decodeThermostatModeGetAck({
            mode: [{ channel: 0, onoff: 1, mode: 3 }]
        });
        assert.equal(entry?.mode, 'auto');
    });

    it('maps wire mode 2 to eco', () => {
        const [entry] = decodeThermostatModeGetAck({
            mode: [{ channel: 0, onoff: 1, mode: 2 }]
        });
        assert.equal(entry?.mode, 'eco');
    });

    it('maps wire mode 4 to manual', () => {
        const [entry] = decodeThermostatModeGetAck({
            mode: [{ channel: 0, onoff: 1, mode: 4 }]
        });
        assert.equal(entry?.mode, 'manual');
    });

    it('encodes SET for mode=eco', () => {
        const payload = encodeThermostatModeSet({ channel: 0, mode: 'eco' });
        assert.deepEqual(payload, { mode: [{ channel: 0, onoff: 1, mode: 2 }] });
    });

    it('encodes SET for mode=manual', () => {
        const payload = encodeThermostatModeSet({ channel: 0, mode: 'manual' });
        assert.deepEqual(payload, { mode: [{ channel: 0, onoff: 1, mode: 4 }] });
    });

    it('encodes SET for targetTemperature ×10', () => {
        const payload = encodeThermostatModeSet({ channel: 0, targetTemperature: 22 });
        assert.deepEqual(payload, { mode: [{ channel: 0, targetTemp: 220 }] });
    });

    it('encodes SET for mode=off with onoff=0', () => {
        const payload = encodeThermostatModeSet({ channel: 0, mode: 'off' });
        assert.deepEqual(payload, { mode: [{ channel: 0, onoff: 0, mode: 0 }] });
    });
});

describe('Thermostat.ModeB codec', () => {
    it('decodes a GETACK array with temps ×100', () => {
        const [entry] = decodeThermostatModeBGetAck({
            modeB: [{ channel: 0, onoff: 1, mode: 1, targetTemp: 2200, currentTemp: 1800 }]
        });
        assert.equal(entry?.on, true);
        assert.equal(entry?.mode, 'heat');
        assert.equal(entry?.workMode, 'manual');
        assert.equal(entry?.targetTemperature, 22);
        assert.equal(entry?.currentTemperature, 18);
    });

    it('maps working=2 to cool and mode=2 to schedule', () => {
        const [entry] = decodeThermostatModeBGetAck({
            modeB: [{ channel: 0, onoff: 1, mode: 2, working: 2 }]
        });
        assert.equal(entry?.mode, 'cool');
        assert.equal(entry?.workMode, 'schedule');
    });

    it('maps onoff=2 to off', () => {
        const [entry] = decodeThermostatModeBGetAck({
            modeB: [{ channel: 0, onoff: 2, mode: 1 }]
        });
        assert.equal(entry?.on, false);
        assert.equal(entry?.mode, 'off');
    });

    it('encodes SET for onoff', () => {
        const payload = encodeThermostatModeBSet({ channel: 0, on: false });
        assert.deepEqual(payload, { modeB: [{ channel: 0, onoff: 2 }] });
    });

    it('encodes SET for targetTemperature ×100', () => {
        const payload = encodeThermostatModeBSet({ channel: 0, targetTemperature: 22 });
        assert.deepEqual(payload, { modeB: [{ channel: 0, mode: 1, targetTemp: 2200 }] });
    });

    it('encodes SET for working and workMode', () => {
        const payload = encodeThermostatModeBSet({
            channel: 0,
            working: 'cool',
            workMode: 'timer'
        });
        assert.deepEqual(payload, { modeB: [{ channel: 0, working: 2, mode: 3 }] });
    });
});

describe('Thermostat.ModeC codec', () => {
    it('decodes a GETACK array with nested targetTemp and temps ×100', () => {
        const [entry] = decodeThermostatModeCGetAck({
            control: [{
                channel: 0,
                mode: 1,
                targetTemp: { heat: 2100, cold: 2400 },
                currentTemp: 2200
            }]
        });
        assert.equal(entry?.on, true);
        assert.equal(entry?.mode, 'heat');
        assert.equal(entry?.targetTemperature, 21);
        assert.equal(entry?.heatTemperature, 21);
        assert.equal(entry?.coolTemperature, 24);
        assert.equal(entry?.currentTemperature, 22);
    });

    it('maps cool mode target to cold setpoint', () => {
        const [entry] = decodeThermostatModeCGetAck({
            control: [{
                channel: 0,
                mode: 2,
                targetTemp: { heat: 2100, cold: 2400 }
            }]
        });
        assert.equal(entry?.mode, 'cool');
        assert.equal(entry?.targetTemperature, 24);
    });

    it('decodes work, fan, and humidity', () => {
        const [entry] = decodeThermostatModeCGetAck({
            control: [{
                channel: 0,
                mode: 1,
                work: 2,
                fan: { speed: 3, fMode: 1, hTime: 30 },
                more: { humi: 495 }
            }]
        });
        assert.equal(entry?.workMode, 'schedule');
        assert.equal(entry?.fanSpeed, 'high');
        assert.equal(entry?.fanHoldMinutes, 30);
        assert.equal(entry?.humidity, 49.5);
    });

    it('maps mode=0 to off', () => {
        const [entry] = decodeThermostatModeCGetAck({
            control: [{ channel: 0, mode: 0 }]
        });
        assert.equal(entry?.on, false);
        assert.equal(entry?.mode, 'off');
    });

    it('maps mode=2 to cool', () => {
        const [entry] = decodeThermostatModeCGetAck({
            control: [{ channel: 0, mode: 2 }]
        });
        assert.equal(entry?.mode, 'cool');
    });

    it('maps mode=3 to auto', () => {
        const [entry] = decodeThermostatModeCGetAck({
            control: [{ channel: 0, mode: 3 }]
        });
        assert.equal(entry?.mode, 'auto');
    });

    it('encodes SET for targetTemperature as {heat,cold} ×100', () => {
        const payload = encodeThermostatModeCSet({ channel: 0, targetTemperature: 21 });
        assert.deepEqual(payload, { control: [{ channel: 0, targetTemp: { heat: 2100, cold: 2100 } }] });
    });

    it('encodes SET for heat setpoint only', () => {
        const payload = encodeThermostatModeCSet({ channel: 0, heatTemperature: 21 });
        assert.deepEqual(payload, { control: [{ channel: 0, targetTemp: { heat: 2100 } }] });
    });
});

describe('Hub.ToggleX codec', () => {
    it('decodes GETACK array', () => {
        const entries = decodeHubToggleXGetAck({
            togglex: [{ id: '00000101', onoff: 1 }]
        });
        assert.deepEqual(entries, [{ id: '00000101', on: true }]);
    });

    it('encodes SET', () => {
        const payload = encodeHubToggleXSet({ id: '00000101', on: false });
        assert.deepEqual(payload, { togglex: [{ id: '00000101', onoff: 0 }] });
    });
});

describe('Hub.Mts100.Mode codec', () => {
    it('decodes GETACK', () => {
        const entries = decodeHubMts100ModeGetAck({
            mode: [{ id: '00000101', state: 1 }]
        });
        assert.deepEqual(entries, [{ id: '00000101', state: 1 }]);
    });

    it('encodes SET', () => {
        const payload = encodeHubMts100ModeSet({ id: '00000101', state: 2 });
        assert.deepEqual(payload, { mode: [{ id: '00000101', state: 2 }] });
    });
});

describe('Hub.Mts100.Temperature codec', () => {
    it('decodes GETACK with temps ×10', () => {
        const entries = decodeHubMts100TemperatureGetAck({
            temperature: [{ id: '00000101', room: 180, currentSet: 220 }]
        });
        assert.deepEqual(entries, [{
            id: '00000101',
            currentTemperature: 18,
            targetTemperature: 22
        }]);
    });

    it('decodes custom/comfort/economy/away and window', () => {
        const entries = decodeHubMts100TemperatureGetAck({
            temperature: [{
                id: '00000101',
                room: 180,
                currentSet: 220,
                custom: 240,
                comfort: 260,
                economy: 200,
                away: 100,
                openWindow: 1,
                heating: 1
            }]
        });
        assert.deepEqual(entries, [{
            id: '00000101',
            currentTemperature: 18,
            targetTemperature: 22,
            custom: 24,
            comfort: 26,
            economy: 20,
            away: 10,
            windowOpen: true,
            heating: true
        }]);
    });

    it('encodes SET for targetTemperature ×10', () => {
        const payload = encodeHubMts100TemperatureSet({ id: '00000101', targetTemperature: 22 });
        assert.deepEqual(payload, { temperature: [{ id: '00000101', custom: 220 }] });
    });
});

describe('Thermostat extra codecs', () => {
    it('encodes HoldAction until-schedule', () => {
        const payload = encodeHoldActionSet({ channel: 0, mode: 'untilSchedule' });
        assert.deepEqual(payload, { holdAction: [{ channel: 0, mode: 1 }] });
    });

    it('decodes HoldAction expire', () => {
        const [entry] = decodeHoldAction({
            holdAction: [{ channel: 0, mode: 2, time: 80, expire: 1558161256 }]
        });
        assert.deepEqual(entry, {
            channel: 0,
            holdMode: 'until',
            holdMinutes: 80,
            holdExpiresAt: 1558161256
        });
    });

    it('encodes WindowOpened detect and status', () => {
        assert.deepEqual(
            encodeWindowOpenedSet({ channel: 0, detect: true, windowOpen: false }),
            { windowOpened: [{ channel: 0, detect: 1, status: 0 }] }
        );
    });

    it('decodes WindowOpened', () => {
        const [entry] = decodeWindowOpened({
            windowOpened: [{ channel: 0, detect: 1, status: 0 }]
        });
        assert.deepEqual(entry, { channel: 0, windowDetect: true, windowOpen: false });
    });

    it('scales Frost ×10 and ×100', () => {
        const [mode] = decodeFrost({ frost: [{ channel: 0, onoff: 1, value: 50 }] }, 10);
        const [modeB] = decodeFrost({ frost: [{ channel: 0, onoff: 1, value: 500 }] }, 100);
        assert.equal(mode?.frostTemperature, 5);
        assert.equal(modeB?.frostTemperature, 5);
    });

    it('encodes Overheat ×10', () => {
        const payload = encodeOverheatSet({ channel: 0, overheat: true, overheatTemperature: 33.5 });
        assert.deepEqual(payload, { overheat: [{ channel: 0, onoff: 1, value: 335 }] });
    });

    it('leaves ScheduleB OFF sentinel unscaled', () => {
        const payload = encodeScheduleSet({
            channel: 0,
            scale: 100,
            key: 'scheduleB',
            schedule: { mon: [[480, SCHEDULEB_OFF]] }
        });
        assert.deepEqual(payload, {
            scheduleB: [{ channel: 0, mon: [[480, SCHEDULEB_OFF]] }]
        });
        const [entry] = decodeSchedule(payload, 100, 'scheduleB');
        assert.deepEqual(entry?.schedule.mon, [[480, SCHEDULEB_OFF]]);
    });

    it('decodes Alarm types', () => {
        const [entry] = decodeAlarm({ alarm: [{ channel: 0, type: 2, temp: 500 }] });
        assert.equal(entry?.alarm, 'low');
        assert.equal(entry?.alarmTemperature, 5);
    });
});

describe('Hub MTS100 extra codecs', () => {
    it('decodes All snapshot', () => {
        const [entry] = decodeHubMts100All({
            all: [{
                id: '00000101',
                togglex: { onoff: 1 },
                mode: { state: 0 },
                temperature: {
                    room: 160,
                    currentSet: 200,
                    custom: 240,
                    openWindow: 1,
                    heating: 0
                },
                timeSync: { state: 1 }
            }]
        });
        assert.deepEqual(entry, {
            id: '00000101',
            on: true,
            modeRaw: 0,
            currentTemperature: 16,
            targetTemperature: 20,
            custom: 24,
            windowOpen: true,
            heating: false,
            timeSync: true
        });
    });

    it('encodes hub schedule under schedule key and keeps 0xFFFF off', () => {
        const payload = encodeHubScheduleSet({
            id: '00000101',
            scale: 10,
            schedule: { sun: [[120, SCHEDULEB_HUB_OFF]] }
        });
        assert.deepEqual(payload, {
            schedule: [{ id: '00000101', sun: [[120, SCHEDULEB_HUB_OFF]] }]
        });
        const [entry] = decodeHubSchedule(payload, 10);
        assert.deepEqual(entry?.schedule.sun, [[120, SCHEDULEB_HUB_OFF]]);
    });
});

describe('Control.TempUnit codec', () => {
    it('decodes GETACK with celsius and fahrenheit', () => {
        const [celsius] = decodeTempUnit({ tempUnit: [{ channel: 0, tempUnit: 1 }] });
        const [fahrenheit] = decodeTempUnit({ tempUnit: [{ channel: 1, tempUnit: 2 }] });
        assert.equal(celsius?.tempUnit, 'celsius');
        assert.equal(fahrenheit?.tempUnit, 'fahrenheit');
    });

    it('encodes SET with wire tempUnit', () => {
        assert.deepEqual(
            encodeTempUnitSet({ channel: 0, tempUnit: 'fahrenheit' }),
            { tempUnit: [{ channel: 0, tempUnit: 2 }] }
        );
    });
});

describe('Control.PhysicalLock codec', () => {
    it('decodes lock state and maps subId to id', () => {
        const [entry] = decodePhysicalLock({
            lock: [{ channel: 0, subId: '00000101', onoff: 1 }]
        });
        assert.equal(entry?.childLock, true);
        assert.equal(entry?.id, '00000101');
    });

    it('encodes SET with onoff and optional subId', () => {
        assert.deepEqual(
            encodePhysicalLockSet({ channel: 0, locked: false, subId: '00000101' }),
            { lock: [{ channel: 0, onoff: 0, subId: '00000101' }] }
        );
    });
});

describe('Control.Screen.Brightness codec', () => {
    it('decodes wire 0–100 to host 0–1', () => {
        const [entry] = decodeScreenBrightness({
            brightness: [{ channel: 0, standby: 0, operation: 50, standbyView: 1 }]
        });
        assert.equal(entry?.screenStandbyBrightness, 0);
        assert.equal(entry?.screenOperationBrightness, 0.5);
        assert.equal(entry?.screenStandbyView, true);
    });

    it('encodes host 0–1 to wire 0–100', () => {
        assert.deepEqual(
            encodeScreenBrightnessSet({ channel: 0, standby: 0.25, operation: 0.5, standbyView: false }),
            { brightness: [{ channel: 0, standby: 25, operation: 50, standbyView: 2 }] }
        );
    });
});

describe('Thermostat.System codec', () => {
    const MTS300_CONTROL = {
        channel: 0,
        fLevel: 1,
        hLevel: 1,
        cLevel: 1,
        sysType: 0,
        hdType: 0,
        compTempEnable: 1,
        compType: 0,
        compTemp: 150,
        OBType: 0,
        AUXType: 0,
        AUXWorkType: 0,
        dType: 0,
        wire: { R: 2, Rh: 2, Rc: 1, C: 1, E: 2, WAux: 1 }
    };

    it('decodes an MTS300 PUSH with ModeC ×100 compTemp', () => {
        const [entry] = decodeThermostatSystemPush({ control: [MTS300_CONTROL] });
        assert.equal(entry?.channel, 0);
        assert.equal(entry?.fLevel, 1);
        assert.equal(entry?.hLevel, 1);
        assert.equal(entry?.cLevel, 1);
        assert.equal(entry?.sysType, 0);
        assert.equal(entry?.compTempEnable, true);
        assert.equal(entry?.compTemp, 1.5);
        assert.deepEqual(entry?.wire, { R: 2, Rh: 2, Rc: 1, C: 1, E: 2, WAux: 1 });
    });

    it('passes unknown wire terminals through', () => {
        const [entry] = decodeThermostatSystemPush({
            control: [{ channel: 0, wire: { R: 2, Y: 1, W: 1 } }]
        });
        assert.deepEqual(entry?.wire, { R: 2, Y: 1, W: 1 });
    });

    it('decodes an empty GETACK control array', () => {
        assert.deepEqual(decodeThermostatSystemGetAck({ control: [] }), []);
    });

    it('encodes SET with scaled compTemp and wire as-is', () => {
        assert.deepEqual(
            encodeThermostatSystemSet({
                channel: 0,
                compTempEnable: true,
                compTemp: 1.5,
                wire: { R: 2, Rh: 2, Rc: 1, C: 1, E: 2, WAux: 1 }
            }),
            {
                control: [{
                    channel: 0,
                    compTempEnable: 1,
                    compTemp: 150,
                    wire: { R: 2, Rh: 2, Rc: 1, C: 1, E: 2, WAux: 1 }
                }]
            }
        );
    });
});
