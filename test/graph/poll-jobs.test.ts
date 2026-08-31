import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildPollJobs } from '../../src/graph/poll-jobs';
import {
    CLOUDMQTT_PERIOD_MS,
    ENERGY_CLOUD_PERIOD_MS,
    ENERGY_PERIOD_MS,
    HUB_BATTERY_PERIOD_MS,
    SENSOR_FAST_CLOUD_PERIOD_MS,
    SENSOR_FAST_PERIOD_MS,
    SENSOR_SLOW_CLOUD_PERIOD_MS,
    SENSOR_SLOW_PERIOD_MS,
    SYSTEM_ALL_PERIOD_MS,
    type PollJob
} from '../../src/graph/poller';
import { SYSTEM_ALL_NAMESPACE } from '../../src/graph/system-all';
import type { AbilityMap } from '../../src/graph/ability';
import { CONTROL_ALERT_CONFIG_NAMESPACE } from '../../src/protocol/codecs/alertconfig';
import { CONTROL_ALARM_NAMESPACE, CONTROL_BEEP_NAMESPACE } from '../../src/protocol/codecs/alarm';
import { CONSUMPTION_CONFIG_NAMESPACE } from '../../src/protocol/codecs/consumptionconfig';
import { CONSUMPTIONH_NAMESPACE } from '../../src/protocol/codecs/consumptionh';
import { CONSUMPTIONX_NAMESPACE } from '../../src/protocol/codecs/consumptionx';
import {
    DIFFUSER_LIGHT_NAMESPACE,
    DIFFUSER_SENSOR_NAMESPACE,
    DIFFUSER_SPRAY_NAMESPACE
} from '../../src/protocol/codecs/diffuser';
import {
    GARAGE_CONFIG_NAMESPACE,
    GARAGE_MULTIPLE_CONFIG_NAMESPACE,
    SHUTTER_ADJUST_NAMESPACE,
    SHUTTER_CONFIG_NAMESPACE
} from '../../src/protocol/codecs/cover';
import { DND_MODE_NAMESPACE } from '../../src/protocol/codecs/dnd';
import { ELECTRICITY_NAMESPACE, ELECTRICITYX_NAMESPACE } from '../../src/protocol/codecs/electricity';
import {
    FAN_BTN_CONFIG_NAMESPACE,
    FAN_CONFIG_NAMESPACE,
    FAN_NAMESPACE,
    FILTER_MAINTENANCE_NAMESPACE
} from '../../src/protocol/codecs/fan';
import { LIGHT_EFFECT_NAMESPACE } from '../../src/protocol/codecs/light';
import { MP3_NAMESPACE } from '../../src/protocol/codecs/mp3';
import {
    CONFIG_OVERTEMP_NAMESPACE,
    CONTROL_OVERTEMP_NAMESPACE
} from '../../src/protocol/codecs/overtemp';
import { PRESENCE_CONFIG_NAMESPACE } from '../../src/protocol/codecs/presence';
import {
    CONFIG_SENSOR_ASSOCIATION_NAMESPACE,
    HUB_BATTERY_NAMESPACE,
    HUB_SENSOR_ALL_NAMESPACE,
    HUB_SENSOR_MOTION_NAMESPACE,
    HUB_SENSOR_SMOKE_NAMESPACE,
    HUB_SENSOR_TEMPHUM_NAMESPACE,
    HUB_SUBDEVICE_VERSION_NAMESPACE,
    SENSOR_HISTORYX_NAMESPACE,
    SENSOR_LATEST_NAMESPACE,
    SENSOR_LATESTX_NAMESPACE,
    SMOKE_CONFIG_NAMESPACE
} from '../../src/protocol/codecs/sensor';
import { CONFIG_STANDBY_KILLER_NAMESPACE } from '../../src/protocol/codecs/standbykiller';
import { SPRAY_NAMESPACE } from '../../src/protocol/codecs/spray';
import {
    SYSTEM_DEBUG_NAMESPACE,
    SYSTEM_FIRMWARE_NAMESPACE,
    SYSTEM_HARDWARE_NAMESPACE,
    SYSTEM_POSITION_NAMESPACE,
    SYSTEM_TIME_NAMESPACE
} from '../../src/protocol/codecs/system';
import {
    CONTROL_TIMER_NAMESPACE,
    DIGEST_TIMERX_NAMESPACE,
    TIMERX_NAMESPACE
} from '../../src/protocol/codecs/timerx';
import { TOGGLEX_NAMESPACE } from '../../src/protocol/codecs/togglex';
import {
    CONTROL_TRIGGER_NAMESPACE,
    DIGEST_TRIGGERX_NAMESPACE,
    TRIGGERX_NAMESPACE
} from '../../src/protocol/codecs/triggerx';
import {
    CONTROL_WATER_NAMESPACE,
    DEVICE_CFG_NAMESPACE,
    WATER_PLAN_NAMESPACE
} from '../../src/protocol/codecs/water';

const CHANNEL = 0;
const SUB_ID = '00000102';
/** Production poll table keys this namespace as a string literal. */
const SYSTEM_RUNTIME_NAMESPACE = 'Appliance.System.Runtime';

function ability(...namespaces: string[]): AbilityMap {
    return Object.fromEntries(namespaces.map((namespace) => [namespace, {}]));
}

function job(jobs: PollJob[], namespace: string): PollJob | undefined {
    return jobs.find((entry) => entry.namespace === namespace);
}

function namespaces(jobs: PollJob[]): string[] {
    return jobs.map((entry) => entry.namespace);
}

describe('buildPollJobs', () => {
    it('registers Electricity as smart fast', () => {
        const jobs = buildPollJobs(
            ability(ELECTRICITY_NAMESPACE),
            [{ channel: CHANNEL, traits: ['energy'] }]
        );
        assert.deepEqual(job(jobs, ELECTRICITY_NAMESPACE), {
            namespace: ELECTRICITY_NAMESPACE,
            strategy: 'smart',
            periodMs: SENSOR_FAST_PERIOD_MS,
            periodCloudMs: SENSOR_FAST_CLOUD_PERIOD_MS,
            payload: { electricity: { channel: CHANNEL } }
        });
    });

    it('registers ConsumptionX as smart energy', () => {
        const jobs = buildPollJobs(
            ability(CONSUMPTIONX_NAMESPACE),
            [{ channel: CHANNEL, traits: ['energy'] }]
        );
        assert.deepEqual(job(jobs, CONSUMPTIONX_NAMESPACE), {
            namespace: CONSUMPTIONX_NAMESPACE,
            strategy: 'smart',
            periodMs: ENERGY_PERIOD_MS,
            periodCloudMs: ENERGY_CLOUD_PERIOD_MS,
            payload: {}
        });
    });

    it('registers ElectricityX when classic Electricity is absent', () => {
        const jobs = buildPollJobs(
            ability(ELECTRICITYX_NAMESPACE),
            [{ channel: CHANNEL, traits: ['energy'] }]
        );
        assert.deepEqual(job(jobs, ELECTRICITYX_NAMESPACE), {
            namespace: ELECTRICITYX_NAMESPACE,
            strategy: 'smart',
            periodMs: SENSOR_FAST_PERIOD_MS,
            periodCloudMs: SENSOR_FAST_CLOUD_PERIOD_MS,
            payload: { electricity: { channel: 0xffff } }
        });
    });

    it('registers ConsumptionH when classic ConsumptionX is absent', () => {
        const jobs = buildPollJobs(
            ability(CONSUMPTIONH_NAMESPACE),
            [{ channel: CHANNEL, traits: ['energy'] }]
        );
        assert.deepEqual(job(jobs, CONSUMPTIONH_NAMESPACE), {
            namespace: CONSUMPTIONH_NAMESPACE,
            strategy: 'smart',
            periodMs: ENERGY_PERIOD_MS,
            periodCloudMs: ENERGY_CLOUD_PERIOD_MS,
            payload: { consumptionH: [{ channel: CHANNEL }] }
        });
    });

    it('does not include ConsumptionConfig', () => {
        const jobs = buildPollJobs(
            ability(ELECTRICITY_NAMESPACE, CONSUMPTIONX_NAMESPACE, CONSUMPTION_CONFIG_NAMESPACE),
            [{ channel: CHANNEL, traits: ['energy'] }]
        );
        assert.equal(namespaces(jobs).includes(CONSUMPTION_CONFIG_NAMESPACE), false);
    });

    it('registers ToggleX when advertised', () => {
        const jobs = buildPollJobs(
            ability(TOGGLEX_NAMESPACE),
            [{ channel: CHANNEL, traits: ['switch'] }]
        );
        assert.deepEqual(job(jobs, TOGGLEX_NAMESPACE), {
            namespace: TOGGLEX_NAMESPACE,
            strategy: 'default',
            periodMs: 0,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: { togglex: { channel: 0xffff } }
        });
    });

    it('registers Spray when advertised', () => {
        const jobs = buildPollJobs(
            ability(SPRAY_NAMESPACE),
            [{ channel: CHANNEL, traits: ['spray'] }]
        );
        assert.deepEqual(job(jobs, SPRAY_NAMESPACE), {
            namespace: SPRAY_NAMESPACE,
            strategy: 'default',
            periodMs: 0,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: { spray: {} }
        });
    });

    it('registers Mp3 when advertised', () => {
        const jobs = buildPollJobs(
            ability(MP3_NAMESPACE),
            [{ channel: CHANNEL, traits: ['media'] }]
        );
        assert.deepEqual(job(jobs, MP3_NAMESPACE), {
            namespace: MP3_NAMESPACE,
            strategy: 'default',
            periodMs: 0,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: { mp3: {} }
        });
    });

    it('registers DND when advertised', () => {
        const jobs = buildPollJobs(
            ability(DND_MODE_NAMESPACE),
            [{ channel: CHANNEL, traits: ['dnd'] }]
        );
        assert.deepEqual(job(jobs, DND_MODE_NAMESPACE), {
            namespace: DND_MODE_NAMESPACE,
            strategy: 'smart',
            periodMs: SENSOR_SLOW_PERIOD_MS,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: {}
        });
    });

    it('registers Alarm when advertised', () => {
        const jobs = buildPollJobs(
            ability(CONTROL_ALARM_NAMESPACE),
            [{ channel: CHANNEL, traits: ['alarm'] }]
        );
        assert.deepEqual(job(jobs, CONTROL_ALARM_NAMESPACE), {
            namespace: CONTROL_ALARM_NAMESPACE,
            strategy: 'default',
            periodMs: 0,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: { alarm: [{ channel: CHANNEL }] }
        });
    });

    it('registers Control.Beep as SMART_CONFIG with alarm-keyed channel list', () => {
        const jobs = buildPollJobs(
            ability(CONTROL_BEEP_NAMESPACE),
            [{ channel: CHANNEL, traits: ['alarm'] }]
        );
        assert.deepEqual(job(jobs, CONTROL_BEEP_NAMESPACE), {
            namespace: CONTROL_BEEP_NAMESPACE,
            strategy: 'smart',
            periodMs: SENSOR_SLOW_PERIOD_MS,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: { alarm: [{ channel: CHANNEL }] }
        });
    });

    it('registers Diffuser.Light when advertised', () => {
        const jobs = buildPollJobs(
            ability(DIFFUSER_LIGHT_NAMESPACE),
            [{ channel: CHANNEL, traits: ['diffuser'] }]
        );
        assert.deepEqual(job(jobs, DIFFUSER_LIGHT_NAMESPACE), {
            namespace: DIFFUSER_LIGHT_NAMESPACE,
            strategy: 'default',
            periodMs: 0,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: {}
        });
    });

    it('registers Diffuser.Spray when advertised', () => {
        const jobs = buildPollJobs(
            ability(DIFFUSER_SPRAY_NAMESPACE),
            [{ channel: CHANNEL, traits: ['diffuser'] }]
        );
        assert.deepEqual(job(jobs, DIFFUSER_SPRAY_NAMESPACE), {
            namespace: DIFFUSER_SPRAY_NAMESPACE,
            strategy: 'default',
            periodMs: 0,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: {}
        });
    });

    it('registers Diffuser.Sensor as smart slow when advertised', () => {
        const jobs = buildPollJobs(
            ability(DIFFUSER_SENSOR_NAMESPACE),
            [{ channel: CHANNEL, traits: ['diffuser'] }]
        );
        assert.deepEqual(job(jobs, DIFFUSER_SENSOR_NAMESPACE), {
            namespace: DIFFUSER_SENSOR_NAMESPACE,
            strategy: 'smart',
            periodMs: SENSOR_SLOW_PERIOD_MS,
            periodCloudMs: SENSOR_SLOW_CLOUD_PERIOD_MS,
            payload: {}
        });
    });

    it('skips Diffuser.Sensor when not advertised', () => {
        const jobs = buildPollJobs(
            ability(DIFFUSER_LIGHT_NAMESPACE, DIFFUSER_SPRAY_NAMESPACE),
            [{ channel: CHANNEL, traits: ['diffuser'] }]
        );
        assert.equal(namespaces(jobs).includes(DIFFUSER_SENSOR_NAMESPACE), false);
    });

    it('registers Fan when advertised', () => {
        const jobs = buildPollJobs(
            ability(FAN_NAMESPACE),
            [{ channel: CHANNEL, traits: ['fan'] }]
        );
        assert.deepEqual(job(jobs, FAN_NAMESPACE), {
            namespace: FAN_NAMESPACE,
            strategy: 'default',
            periodMs: 0,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: { fan: [{ channel: CHANNEL }] }
        });
    });

    it('registers ToggleX when advertised on a fan', () => {
        const jobs = buildPollJobs(
            ability(TOGGLEX_NAMESPACE),
            [{ channel: CHANNEL, traits: ['fan'] }]
        );
        assert.ok(namespaces(jobs).includes(TOGGLEX_NAMESPACE));
    });

    it('registers Fan.Config as smart config', () => {
        const jobs = buildPollJobs(
            ability(FAN_CONFIG_NAMESPACE),
            [{ channel: CHANNEL, traits: ['fan'] }]
        );
        assert.deepEqual(job(jobs, FAN_CONFIG_NAMESPACE), {
            namespace: FAN_CONFIG_NAMESPACE,
            strategy: 'smart',
            periodMs: SENSOR_SLOW_PERIOD_MS,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: { config: [{ channel: CHANNEL }] }
        });
    });

    it('registers FilterMaintenance as PUSH-query', () => {
        const jobs = buildPollJobs(
            ability(FILTER_MAINTENANCE_NAMESPACE),
            [{ channel: CHANNEL, traits: ['fan'] }]
        );
        assert.deepEqual(job(jobs, FILTER_MAINTENANCE_NAMESPACE), {
            namespace: FILTER_MAINTENANCE_NAMESPACE,
            strategy: 'smart',
            periodMs: CLOUDMQTT_PERIOD_MS,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: {},
            method: 'PUSH'
        });
    });

    it('does not register Fan.Btn.Config even when advertised', () => {
        const jobs = buildPollJobs(
            ability(FAN_NAMESPACE, FAN_BTN_CONFIG_NAMESPACE),
            [{ channel: CHANNEL, traits: ['fan'] }]
        );
        assert.equal(namespaces(jobs).includes(FAN_BTN_CONFIG_NAMESPACE), false);
    });

    it('registers Light.Effect as smart config when advertised', () => {
        const jobs = buildPollJobs(
            ability(LIGHT_EFFECT_NAMESPACE),
            [{ channel: CHANNEL, traits: ['light'] }]
        );
        assert.deepEqual(job(jobs, LIGHT_EFFECT_NAMESPACE), {
            namespace: LIGHT_EFFECT_NAMESPACE,
            strategy: 'smart',
            periodMs: SENSOR_SLOW_PERIOD_MS,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: { effect: [] }
        });
    });

    it('registers Hub.Sensor.All as smart all', () => {
        const jobs = buildPollJobs(
            ability(HUB_SENSOR_ALL_NAMESPACE),
            [{ subDeviceId: SUB_ID, traits: ['sensor'] }]
        );
        assert.deepEqual(job(jobs, HUB_SENSOR_ALL_NAMESPACE), {
            namespace: HUB_SENSOR_ALL_NAMESPACE,
            strategy: 'smart',
            periodMs: SYSTEM_ALL_PERIOD_MS,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: { all: [{ id: SUB_ID }] }
        });
    });

    it('skips Hub.Sensor.TempHum when Hub.Sensor.All is advertised', () => {
        const jobs = buildPollJobs(
            ability(HUB_SENSOR_ALL_NAMESPACE, HUB_SENSOR_TEMPHUM_NAMESPACE),
            [{ subDeviceId: SUB_ID, traits: ['sensor'] }]
        );
        assert.equal(namespaces(jobs).includes(HUB_SENSOR_TEMPHUM_NAMESPACE), false);
    });

    it('still registers Hub.Battery when Hub.Sensor.All is advertised', () => {
        const jobs = buildPollJobs(
            ability(HUB_SENSOR_ALL_NAMESPACE, HUB_BATTERY_NAMESPACE),
            [{ subDeviceId: SUB_ID, traits: ['sensor'] }]
        );
        assert.ok(namespaces(jobs).includes(HUB_BATTERY_NAMESPACE));
    });

    it('registers Hub.Sensor.TempHum when Hub.Sensor.All is absent', () => {
        const jobs = buildPollJobs(
            ability(HUB_SENSOR_TEMPHUM_NAMESPACE),
            [{ subDeviceId: SUB_ID, traits: ['sensor'] }]
        );
        assert.deepEqual(job(jobs, HUB_SENSOR_TEMPHUM_NAMESPACE), {
            namespace: HUB_SENSOR_TEMPHUM_NAMESPACE,
            strategy: 'default',
            periodMs: 0,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: { tempHum: [{ id: SUB_ID }] }
        });
    });

    it('registers Hub.Battery when Hub.Sensor.All is absent', () => {
        const jobs = buildPollJobs(
            ability(HUB_BATTERY_NAMESPACE),
            [{ subDeviceId: SUB_ID, traits: ['sensor'] }]
        );
        assert.deepEqual(job(jobs, HUB_BATTERY_NAMESPACE), {
            namespace: HUB_BATTERY_NAMESPACE,
            strategy: 'smart',
            periodMs: HUB_BATTERY_PERIOD_MS,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: { battery: [{ id: SUB_ID }] }
        });
    });

    it('registers Hub.SubDevice.Version as once with idList', () => {
        const jobs = buildPollJobs(
            ability(HUB_SUBDEVICE_VERSION_NAMESPACE),
            [{ subDeviceId: SUB_ID, traits: ['sensor'] }]
        );
        assert.deepEqual(job(jobs, HUB_SUBDEVICE_VERSION_NAMESPACE), {
            namespace: HUB_SUBDEVICE_VERSION_NAMESPACE,
            strategy: 'once',
            periodMs: 0,
            periodCloudMs: 0,
            payload: { version: [{ id: SUB_ID }] }
        });
    });

    it('registers Hub.Sensor.Smoke when advertised', () => {
        const jobs = buildPollJobs(
            ability(HUB_SENSOR_SMOKE_NAMESPACE),
            [{ subDeviceId: SUB_ID, traits: ['sensor'] }]
        );
        assert.deepEqual(job(jobs, HUB_SENSOR_SMOKE_NAMESPACE), {
            namespace: HUB_SENSOR_SMOKE_NAMESPACE,
            strategy: 'default',
            periodMs: 0,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: { smokeAlarm: [{ id: SUB_ID }] }
        });
    });

    it('registers Smoke.Config when advertised', () => {
        const jobs = buildPollJobs(
            ability(SMOKE_CONFIG_NAMESPACE),
            [{ subDeviceId: SUB_ID, traits: ['sensor'] }]
        );
        assert.deepEqual(job(jobs, SMOKE_CONFIG_NAMESPACE), {
            namespace: SMOKE_CONFIG_NAMESPACE,
            strategy: 'smart',
            periodMs: SENSOR_SLOW_PERIOD_MS,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: { config: [{ channel: 0, subId: SUB_ID }] }
        });
    });

    it('registers Hub.Sensor.Motion as default when All is absent', () => {
        const jobs = buildPollJobs(
            ability(HUB_SENSOR_MOTION_NAMESPACE),
            [{ subDeviceId: SUB_ID, traits: ['sensor'] }]
        );
        assert.deepEqual(job(jobs, HUB_SENSOR_MOTION_NAMESPACE), {
            namespace: HUB_SENSOR_MOTION_NAMESPACE,
            strategy: 'default',
            periodMs: 0,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: { motion: [{ id: SUB_ID }] }
        });
    });

    it('skips Hub.Sensor.Motion when Hub.Sensor.All is advertised', () => {
        const jobs = buildPollJobs(
            ability(HUB_SENSOR_ALL_NAMESPACE, HUB_SENSOR_MOTION_NAMESPACE),
            [{ subDeviceId: SUB_ID, traits: ['sensor'] }]
        );
        assert.equal(namespaces(jobs).includes(HUB_SENSOR_MOTION_NAMESPACE), false);
    });

    it('registers Digest.TimerX as once', () => {
        const jobs = buildPollJobs(
            ability(DIGEST_TIMERX_NAMESPACE),
            [{ channel: CHANNEL, traits: ['timer'] }]
        );
        assert.deepEqual(job(jobs, DIGEST_TIMERX_NAMESPACE), {
            namespace: DIGEST_TIMERX_NAMESPACE,
            strategy: 'once',
            periodMs: 0,
            periodCloudMs: 0,
            payload: {}
        });
    });

    it('registers Digest.TriggerX as once', () => {
        const jobs = buildPollJobs(
            ability(DIGEST_TRIGGERX_NAMESPACE),
            [{ channel: CHANNEL, traits: ['trigger'] }]
        );
        assert.deepEqual(job(jobs, DIGEST_TRIGGERX_NAMESPACE), {
            namespace: DIGEST_TRIGGERX_NAMESPACE,
            strategy: 'once',
            periodMs: 0,
            periodCloudMs: 0,
            payload: {}
        });
    });

    it('registers Control.Timer when TimerX is absent', () => {
        const jobs = buildPollJobs(
            ability(CONTROL_TIMER_NAMESPACE),
            [{ channel: CHANNEL, traits: ['timer'] }]
        );
        assert.deepEqual(job(jobs, CONTROL_TIMER_NAMESPACE), {
            namespace: CONTROL_TIMER_NAMESPACE,
            strategy: 'smart',
            periodMs: SENSOR_SLOW_PERIOD_MS,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: { timer: [] }
        });
    });

    it('registers Control.Trigger when TriggerX is absent', () => {
        const jobs = buildPollJobs(
            ability(CONTROL_TRIGGER_NAMESPACE),
            [{ channel: CHANNEL, traits: ['trigger'] }]
        );
        assert.deepEqual(job(jobs, CONTROL_TRIGGER_NAMESPACE), {
            namespace: CONTROL_TRIGGER_NAMESPACE,
            strategy: 'smart',
            periodMs: SENSOR_SLOW_PERIOD_MS,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: { trigger: {} }
        });
    });

    it('skips Control.Timer when TimerX is advertised', () => {
        const jobs = buildPollJobs(
            ability(CONTROL_TIMER_NAMESPACE, TIMERX_NAMESPACE),
            [{ channel: CHANNEL, traits: ['timer'] }]
        );
        assert.equal(namespaces(jobs).includes(CONTROL_TIMER_NAMESPACE), false);
    });

    it('skips Control.Trigger when TriggerX is advertised', () => {
        const jobs = buildPollJobs(
            ability(CONTROL_TRIGGER_NAMESPACE, TRIGGERX_NAMESPACE),
            [{ channel: CHANNEL, traits: ['trigger'] }]
        );
        assert.equal(namespaces(jobs).includes(CONTROL_TRIGGER_NAMESPACE), false);
    });

    it('registers Presence LatestX', () => {
        const jobs = buildPollJobs(
            ability(SENSOR_LATESTX_NAMESPACE),
            [{ channel: CHANNEL, traits: ['presence'] }]
        );
        assert.deepEqual(job(jobs, SENSOR_LATESTX_NAMESPACE), {
            namespace: SENSOR_LATESTX_NAMESPACE,
            strategy: 'smart',
            periodMs: SENSOR_FAST_PERIOD_MS,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: {
                latest: [{ channel: CHANNEL, data: ['presence', 'light'] }]
            }
        });
    });

    it('registers Presence Config', () => {
        const jobs = buildPollJobs(
            ability(PRESENCE_CONFIG_NAMESPACE),
            [{ channel: CHANNEL, traits: ['presence'] }]
        );
        assert.deepEqual(job(jobs, PRESENCE_CONFIG_NAMESPACE), {
            namespace: PRESENCE_CONFIG_NAMESPACE,
            strategy: 'smart',
            periodMs: SENSOR_SLOW_PERIOD_MS,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: { config: [{ channel: CHANNEL }] }
        });
    });

    it('registers hub LatestX for sensor children only', () => {
        const jobs = buildPollJobs(
            ability(SENSOR_LATESTX_NAMESPACE),
            [
                { subDeviceId: SUB_ID, traits: ['sensor'] },
                { subDeviceId: 'mts100', traits: ['climate'] }
            ]
        );
        assert.deepEqual(job(jobs, SENSOR_LATESTX_NAMESPACE)?.payload, {
            latest: [{ channel: 0, subId: SUB_ID, data: ['light', 'temp', 'humi'] }]
        });
    });

    it('registers Sprinkler Water when advertised', () => {
        const jobs = buildPollJobs(
            ability(CONTROL_WATER_NAMESPACE),
            [{ subDeviceId: SUB_ID, traits: ['sprinkler'] }]
        );
        assert.deepEqual(job(jobs, CONTROL_WATER_NAMESPACE), {
            namespace: CONTROL_WATER_NAMESPACE,
            strategy: 'default',
            periodMs: 0,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: { control: [{ subId: SUB_ID, channel: 0 }] }
        });
    });

    it('registers Sprinkler DeviceCfg when advertised', () => {
        const jobs = buildPollJobs(
            ability(DEVICE_CFG_NAMESPACE),
            [{ subDeviceId: SUB_ID, traits: ['sprinkler'] }]
        );
        assert.deepEqual(job(jobs, DEVICE_CFG_NAMESPACE), {
            namespace: DEVICE_CFG_NAMESPACE,
            strategy: 'smart',
            periodMs: SENSOR_SLOW_PERIOD_MS,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: { config: [{ subId: SUB_ID, channel: 0 }] }
        });
    });

    it('does not register WaterPlan even when advertised', () => {
        const jobs = buildPollJobs(
            ability(WATER_PLAN_NAMESPACE),
            [{ subDeviceId: SUB_ID, traits: ['sprinkler'] }]
        );
        assert.equal(namespaces(jobs).includes(WATER_PLAN_NAMESPACE), false);
    });

    it('registers System.All with strategy all', () => {
        const jobs = buildPollJobs(ability(SYSTEM_ALL_NAMESPACE), []);
        assert.deepEqual(job(jobs, SYSTEM_ALL_NAMESPACE), {
            namespace: SYSTEM_ALL_NAMESPACE,
            strategy: 'all',
            periodMs: SYSTEM_ALL_PERIOD_MS,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: {}
        });
    });

    it('registers Sensor.Latest as smart fast when advertised', () => {
        const jobs = buildPollJobs(
            ability(SENSOR_LATEST_NAMESPACE),
            [{ channel: CHANNEL, traits: ['climate'] }]
        );
        assert.deepEqual(job(jobs, SENSOR_LATEST_NAMESPACE), {
            namespace: SENSOR_LATEST_NAMESPACE,
            strategy: 'smart',
            periodMs: SENSOR_FAST_PERIOD_MS,
            periodCloudMs: SENSOR_SLOW_CLOUD_PERIOD_MS,
            payload: { latest: [{ channel: CHANNEL }] }
        });
    });

    it('registers garage Config when advertised', () => {
        const jobs = buildPollJobs(
            ability(GARAGE_CONFIG_NAMESPACE),
            [{ channel: CHANNEL, traits: ['cover'] }]
        );
        assert.deepEqual(job(jobs, GARAGE_CONFIG_NAMESPACE), {
            namespace: GARAGE_CONFIG_NAMESPACE,
            strategy: 'smart',
            periodMs: SENSOR_SLOW_PERIOD_MS,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: {}
        });
    });

    it('registers garage MultipleConfig when advertised', () => {
        const jobs = buildPollJobs(
            ability(GARAGE_MULTIPLE_CONFIG_NAMESPACE),
            [{ channel: CHANNEL, traits: ['cover'] }]
        );
        assert.deepEqual(job(jobs, GARAGE_MULTIPLE_CONFIG_NAMESPACE), {
            namespace: GARAGE_MULTIPLE_CONFIG_NAMESPACE,
            strategy: 'smart',
            periodMs: SENSOR_SLOW_PERIOD_MS,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: {}
        });
    });

    it('registers shutter Config when advertised', () => {
        const jobs = buildPollJobs(
            ability(SHUTTER_CONFIG_NAMESPACE),
            [{ channel: CHANNEL, traits: ['cover'] }]
        );
        assert.deepEqual(job(jobs, SHUTTER_CONFIG_NAMESPACE), {
            namespace: SHUTTER_CONFIG_NAMESPACE,
            strategy: 'smart',
            periodMs: SENSOR_SLOW_PERIOD_MS,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: {}
        });
    });

    it('registers shutter Adjust when advertised', () => {
        const jobs = buildPollJobs(
            ability(SHUTTER_ADJUST_NAMESPACE),
            [{ channel: CHANNEL, traits: ['cover'] }]
        );
        assert.deepEqual(job(jobs, SHUTTER_ADJUST_NAMESPACE), {
            namespace: SHUTTER_ADJUST_NAMESPACE,
            strategy: 'smart',
            periodMs: SENSOR_SLOW_PERIOD_MS,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: { adjust: [{ channel: CHANNEL }] }
        });
    });

    it('does not register Sensor.HistoryX even when advertised', () => {
        const jobs = buildPollJobs(
            ability(SENSOR_HISTORYX_NAMESPACE),
            [{ channel: CHANNEL, traits: ['climate'] }]
        );
        assert.deepEqual(jobs, []);
    });

    it('registers System.Runtime as smart config', () => {
        const jobs = buildPollJobs(
            ability(SYSTEM_RUNTIME_NAMESPACE),
            [{ channel: CHANNEL, traits: ['energy'] }]
        );
        assert.deepEqual(job(jobs, SYSTEM_RUNTIME_NAMESPACE), {
            namespace: SYSTEM_RUNTIME_NAMESPACE,
            strategy: 'smart',
            periodMs: SENSOR_SLOW_PERIOD_MS,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: {}
        });
    });

    it('registers Config.OverTemp as smart config', () => {
        const jobs = buildPollJobs(
            ability(CONFIG_OVERTEMP_NAMESPACE),
            [{ channel: CHANNEL, traits: ['energy'] }]
        );
        assert.deepEqual(job(jobs, CONFIG_OVERTEMP_NAMESPACE), {
            namespace: CONFIG_OVERTEMP_NAMESPACE,
            strategy: 'smart',
            periodMs: SENSOR_SLOW_PERIOD_MS,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: {}
        });
    });

    it('registers Control.OverTemp as smart config', () => {
        const jobs = buildPollJobs(
            ability(CONTROL_OVERTEMP_NAMESPACE),
            [{ channel: CHANNEL, traits: ['energy'] }]
        );
        assert.deepEqual(job(jobs, CONTROL_OVERTEMP_NAMESPACE), {
            namespace: CONTROL_OVERTEMP_NAMESPACE,
            strategy: 'smart',
            periodMs: SENSOR_SLOW_PERIOD_MS,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: { overTemp: [{ channel: CHANNEL }] }
        });
    });

    it('registers Sensor.Association as smart config', () => {
        const jobs = buildPollJobs(
            ability(CONFIG_SENSOR_ASSOCIATION_NAMESPACE),
            [{ channel: CHANNEL, traits: ['energy'] }]
        );
        assert.deepEqual(job(jobs, CONFIG_SENSOR_ASSOCIATION_NAMESPACE), {
            namespace: CONFIG_SENSOR_ASSOCIATION_NAMESPACE,
            strategy: 'smart',
            periodMs: SENSOR_SLOW_PERIOD_MS,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: { config: [{ channel: CHANNEL }] }
        });
    });

    it('registers AlertConfig as smart config', () => {
        const jobs = buildPollJobs(
            ability(CONTROL_ALERT_CONFIG_NAMESPACE),
            [{ channel: CHANNEL, traits: ['energy'] }]
        );
        assert.deepEqual(job(jobs, CONTROL_ALERT_CONFIG_NAMESPACE), {
            namespace: CONTROL_ALERT_CONFIG_NAMESPACE,
            strategy: 'smart',
            periodMs: SENSOR_SLOW_PERIOD_MS,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: { config: [{ channel: CHANNEL }] }
        });
    });

    it('registers StandbyKiller as smart config', () => {
        const jobs = buildPollJobs(
            ability(CONFIG_STANDBY_KILLER_NAMESPACE),
            [{ channel: CHANNEL, traits: ['energy'] }]
        );
        assert.deepEqual(job(jobs, CONFIG_STANDBY_KILLER_NAMESPACE), {
            namespace: CONFIG_STANDBY_KILLER_NAMESPACE,
            strategy: 'smart',
            periodMs: SENSOR_SLOW_PERIOD_MS,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: { config: [{ channel: CHANNEL }] }
        });
    });

    it('skips System.Time when System.All is advertised', () => {
        const jobs = buildPollJobs(
            ability(SYSTEM_TIME_NAMESPACE, SYSTEM_ALL_NAMESPACE),
            [{ channel: CHANNEL, traits: ['system'] }]
        );
        assert.equal(job(jobs, SYSTEM_TIME_NAMESPACE), undefined);
    });

    it('skips System.Firmware when System.All is advertised', () => {
        const jobs = buildPollJobs(
            ability(SYSTEM_FIRMWARE_NAMESPACE, SYSTEM_ALL_NAMESPACE),
            [{ channel: CHANNEL, traits: ['system'] }]
        );
        assert.equal(job(jobs, SYSTEM_FIRMWARE_NAMESPACE), undefined);
    });

    it('skips System.Hardware when System.All is advertised', () => {
        const jobs = buildPollJobs(
            ability(SYSTEM_HARDWARE_NAMESPACE, SYSTEM_ALL_NAMESPACE),
            [{ channel: CHANNEL, traits: ['system'] }]
        );
        assert.equal(job(jobs, SYSTEM_HARDWARE_NAMESPACE), undefined);
    });

    it('registers System.Position as once when System.All is advertised', () => {
        const jobs = buildPollJobs(
            ability(SYSTEM_POSITION_NAMESPACE, SYSTEM_ALL_NAMESPACE),
            [{ channel: CHANNEL, traits: ['system'] }]
        );
        assert.deepEqual(job(jobs, SYSTEM_POSITION_NAMESPACE), {
            namespace: SYSTEM_POSITION_NAMESPACE,
            strategy: 'once',
            periodMs: 0,
            periodCloudMs: 0,
            payload: {}
        });
    });

    it('registers System.Debug as once when System.All is advertised', () => {
        const jobs = buildPollJobs(
            ability(SYSTEM_DEBUG_NAMESPACE, SYSTEM_ALL_NAMESPACE),
            [{ channel: CHANNEL, traits: ['system'] }]
        );
        assert.deepEqual(job(jobs, SYSTEM_DEBUG_NAMESPACE), {
            namespace: SYSTEM_DEBUG_NAMESPACE,
            strategy: 'once',
            periodMs: 0,
            periodCloudMs: 0,
            payload: {}
        });
    });

    it('registers System.Time as smart config when System.All is absent', () => {
        const jobs = buildPollJobs(
            ability(SYSTEM_TIME_NAMESPACE),
            [{ channel: CHANNEL, traits: ['system'] }]
        );
        assert.deepEqual(job(jobs, SYSTEM_TIME_NAMESPACE), {
            namespace: SYSTEM_TIME_NAMESPACE,
            strategy: 'smart',
            periodMs: SENSOR_SLOW_PERIOD_MS,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: {}
        });
    });

    it('registers System.Firmware once when System.All is absent', () => {
        const jobs = buildPollJobs(
            ability(SYSTEM_FIRMWARE_NAMESPACE),
            [{ channel: CHANNEL, traits: ['system'] }]
        );
        assert.deepEqual(job(jobs, SYSTEM_FIRMWARE_NAMESPACE), {
            namespace: SYSTEM_FIRMWARE_NAMESPACE,
            strategy: 'once',
            periodMs: 0,
            periodCloudMs: 0,
            payload: {}
        });
    });

    it('registers System.Hardware once when System.All is absent', () => {
        const jobs = buildPollJobs(
            ability(SYSTEM_HARDWARE_NAMESPACE),
            [{ channel: CHANNEL, traits: ['system'] }]
        );
        assert.deepEqual(job(jobs, SYSTEM_HARDWARE_NAMESPACE), {
            namespace: SYSTEM_HARDWARE_NAMESPACE,
            strategy: 'once',
            periodMs: 0,
            periodCloudMs: 0,
            payload: {}
        });
    });
});
