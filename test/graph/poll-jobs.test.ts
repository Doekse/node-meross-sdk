import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildPollJobs, type PollEndpoint } from '../../src/graph/poll-jobs';
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
import { CONTROL_ALARM_NAMESPACE } from '../../src/protocol/codecs/alarm';
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
import { PRESENCE_CONFIG_NAMESPACE } from '../../src/protocol/codecs/presence';
import {
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
import { SPRAY_NAMESPACE } from '../../src/protocol/codecs/spray';
import {
    SYSTEM_DEBUG_NAMESPACE,
    SYSTEM_FIRMWARE_NAMESPACE,
    SYSTEM_HARDWARE_NAMESPACE,
    SYSTEM_POSITION_NAMESPACE,
    SYSTEM_TIME_NAMESPACE
} from '../../src/protocol/codecs/system';
import { DIGEST_TIMERX_NAMESPACE } from '../../src/protocol/codecs/timerx';
import { TOGGLEX_NAMESPACE } from '../../src/protocol/codecs/togglex';
import { DIGEST_TRIGGERX_NAMESPACE } from '../../src/protocol/codecs/triggerx';
import {
    CONTROL_WATER_NAMESPACE,
    DEVICE_CFG_NAMESPACE,
    WATER_PLAN_NAMESPACE
} from '../../src/protocol/codecs/water';

const CHANNEL = 0;
const SUB_ID = '00000102';

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
    it('registers Electricity as smart fast and ConsumptionX as smart energy', () => {
        const endpoints: PollEndpoint[] = [{ channel: CHANNEL, traits: ['energy'] }];
        const jobs = buildPollJobs(
            ability(ELECTRICITY_NAMESPACE, CONSUMPTIONX_NAMESPACE),
            endpoints
        );
        assert.deepEqual(job(jobs, ELECTRICITY_NAMESPACE), {
            namespace: ELECTRICITY_NAMESPACE,
            strategy: 'smart',
            periodMs: SENSOR_FAST_PERIOD_MS,
            periodCloudMs: SENSOR_FAST_CLOUD_PERIOD_MS,
            payload: { electricity: { channel: CHANNEL } }
        });
        assert.deepEqual(job(jobs, CONSUMPTIONX_NAMESPACE), {
            namespace: CONSUMPTIONX_NAMESPACE,
            strategy: 'smart',
            periodMs: ENERGY_PERIOD_MS,
            periodCloudMs: ENERGY_CLOUD_PERIOD_MS,
            payload: {}
        });
    });

    it('registers ElectricityX and ConsumptionH when classic namespaces are absent', () => {
        const endpoints: PollEndpoint[] = [{ channel: CHANNEL, traits: ['energy'] }];
        const jobs = buildPollJobs(
            ability(ELECTRICITYX_NAMESPACE, CONSUMPTIONH_NAMESPACE),
            endpoints
        );
        assert.deepEqual(job(jobs, ELECTRICITYX_NAMESPACE), {
            namespace: ELECTRICITYX_NAMESPACE,
            strategy: 'smart',
            periodMs: SENSOR_FAST_PERIOD_MS,
            periodCloudMs: SENSOR_FAST_CLOUD_PERIOD_MS,
            payload: { electricity: { channel: 0xffff } }
        });
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

    it('registers ToggleX / Spray / Mp3 / DND / Alarm when advertised', () => {
        const endpoints: PollEndpoint[] = [
            { channel: CHANNEL, traits: ['switch', 'spray', 'media', 'dnd', 'alarm'] }
        ];
        const jobs = buildPollJobs(
            ability(
                TOGGLEX_NAMESPACE,
                SPRAY_NAMESPACE,
                MP3_NAMESPACE,
                DND_MODE_NAMESPACE,
                CONTROL_ALARM_NAMESPACE
            ),
            endpoints
        );
        assert.deepEqual(job(jobs, TOGGLEX_NAMESPACE), {
            namespace: TOGGLEX_NAMESPACE,
            strategy: 'default',
            periodMs: 0,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: { togglex: { channel: 0xffff } }
        });
        assert.deepEqual(job(jobs, SPRAY_NAMESPACE), {
            namespace: SPRAY_NAMESPACE,
            strategy: 'default',
            periodMs: 0,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: { spray: {} }
        });
        assert.deepEqual(job(jobs, MP3_NAMESPACE), {
            namespace: MP3_NAMESPACE,
            strategy: 'default',
            periodMs: 0,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: { mp3: {} }
        });
        assert.deepEqual(job(jobs, DND_MODE_NAMESPACE), {
            namespace: DND_MODE_NAMESPACE,
            strategy: 'smart',
            periodMs: SENSOR_SLOW_PERIOD_MS,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: {}
        });
        assert.deepEqual(job(jobs, CONTROL_ALARM_NAMESPACE), {
            namespace: CONTROL_ALARM_NAMESPACE,
            strategy: 'default',
            periodMs: 0,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: { alarm: [{ channel: CHANNEL }] }
        });
    });

    it('registers Diffuser light, spray, and sensor when advertised', () => {
        const jobs = buildPollJobs(
            ability(DIFFUSER_LIGHT_NAMESPACE, DIFFUSER_SPRAY_NAMESPACE, DIFFUSER_SENSOR_NAMESPACE),
            [{ channel: CHANNEL, traits: ['diffuser'] }]
        );
        assert.deepEqual(namespaces(jobs), [
            DIFFUSER_LIGHT_NAMESPACE,
            DIFFUSER_SPRAY_NAMESPACE,
            DIFFUSER_SENSOR_NAMESPACE
        ]);
        assert.equal(job(jobs, DIFFUSER_SENSOR_NAMESPACE)?.strategy, 'smart');
        assert.equal(job(jobs, DIFFUSER_SENSOR_NAMESPACE)?.periodMs, SENSOR_SLOW_PERIOD_MS);
    });

    it('skips Diffuser.Sensor when not advertised', () => {
        const jobs = buildPollJobs(
            ability(DIFFUSER_LIGHT_NAMESPACE, DIFFUSER_SPRAY_NAMESPACE),
            [{ channel: CHANNEL, traits: ['diffuser'] }]
        );
        assert.deepEqual(namespaces(jobs), [
            DIFFUSER_LIGHT_NAMESPACE,
            DIFFUSER_SPRAY_NAMESPACE
        ]);
    });

    it('registers Fan, Fan.Config, and FilterMaintenance as PUSH-query', () => {
        const endpoints: PollEndpoint[] = [{ channel: CHANNEL, traits: ['fan'] }];
        const jobs = buildPollJobs(
            ability(
                FAN_NAMESPACE,
                TOGGLEX_NAMESPACE,
                FAN_CONFIG_NAMESPACE,
                FILTER_MAINTENANCE_NAMESPACE,
                FAN_BTN_CONFIG_NAMESPACE
            ),
            endpoints
        );
        assert.deepEqual(job(jobs, FAN_NAMESPACE), {
            namespace: FAN_NAMESPACE,
            strategy: 'default',
            periodMs: 0,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: { fan: [{ channel: CHANNEL }] }
        });
        assert.ok(namespaces(jobs).includes(TOGGLEX_NAMESPACE));
        assert.deepEqual(job(jobs, FAN_CONFIG_NAMESPACE), {
            namespace: FAN_CONFIG_NAMESPACE,
            strategy: 'smart',
            periodMs: SENSOR_SLOW_PERIOD_MS,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: { config: [{ channel: CHANNEL }] }
        });
        const filter = jobs.find((entry) => entry.namespace === FILTER_MAINTENANCE_NAMESPACE);
        assert.deepEqual(filter, {
            namespace: FILTER_MAINTENANCE_NAMESPACE,
            strategy: 'smart',
            periodMs: CLOUDMQTT_PERIOD_MS,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: {},
            method: 'PUSH'
        });
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

    it('registers Hub.Sensor.All and skips family GETs when All is advertised', () => {
        const endpoints: PollEndpoint[] = [{ subDeviceId: SUB_ID, traits: ['sensor'] }];
        const jobs = buildPollJobs(
            ability(HUB_SENSOR_ALL_NAMESPACE, HUB_SENSOR_TEMPHUM_NAMESPACE, HUB_BATTERY_NAMESPACE),
            endpoints
        );
        assert.deepEqual(job(jobs, HUB_SENSOR_ALL_NAMESPACE), {
            namespace: HUB_SENSOR_ALL_NAMESPACE,
            strategy: 'smart',
            periodMs: SYSTEM_ALL_PERIOD_MS,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: { all: [{ id: SUB_ID }] }
        });
        assert.equal(namespaces(jobs).includes(HUB_SENSOR_TEMPHUM_NAMESPACE), false);
        assert.ok(namespaces(jobs).includes(HUB_BATTERY_NAMESPACE));
    });

    it('registers family TempHum and battery when Hub.Sensor.All is absent', () => {
        const endpoints: PollEndpoint[] = [{ subDeviceId: SUB_ID, traits: ['sensor'] }];
        const jobs = buildPollJobs(
            ability(HUB_SENSOR_TEMPHUM_NAMESPACE, HUB_BATTERY_NAMESPACE),
            endpoints
        );
        assert.deepEqual(job(jobs, HUB_SENSOR_TEMPHUM_NAMESPACE), {
            namespace: HUB_SENSOR_TEMPHUM_NAMESPACE,
            strategy: 'default',
            periodMs: 0,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: { tempHum: [{ id: SUB_ID }] }
        });
        assert.deepEqual(job(jobs, HUB_BATTERY_NAMESPACE), {
            namespace: HUB_BATTERY_NAMESPACE,
            strategy: 'smart',
            periodMs: HUB_BATTERY_PERIOD_MS,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: { battery: [{ id: SUB_ID }] }
        });
    });

    it('registers Hub.SubDevice.Version as once with idList', () => {
        const endpoints: PollEndpoint[] = [{ subDeviceId: SUB_ID, traits: ['sensor'] }];
        const jobs = buildPollJobs(
            ability(HUB_SUBDEVICE_VERSION_NAMESPACE),
            endpoints
        );
        assert.deepEqual(job(jobs, HUB_SUBDEVICE_VERSION_NAMESPACE), {
            namespace: HUB_SUBDEVICE_VERSION_NAMESPACE,
            strategy: 'once',
            periodMs: 0,
            periodCloudMs: 0,
            payload: { version: [{ id: SUB_ID }] }
        });
    });

    it('registers Hub.Sensor.Smoke and Smoke.Config when advertised', () => {
        const endpoints: PollEndpoint[] = [{ subDeviceId: SUB_ID, traits: ['sensor'] }];
        const jobs = buildPollJobs(
            ability(HUB_SENSOR_SMOKE_NAMESPACE, SMOKE_CONFIG_NAMESPACE),
            endpoints
        );
        assert.deepEqual(job(jobs, HUB_SENSOR_SMOKE_NAMESPACE), {
            namespace: HUB_SENSOR_SMOKE_NAMESPACE,
            strategy: 'default',
            periodMs: 0,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: { smokeAlarm: [{ id: SUB_ID }] }
        });
        assert.deepEqual(job(jobs, SMOKE_CONFIG_NAMESPACE), {
            namespace: SMOKE_CONFIG_NAMESPACE,
            strategy: 'smart',
            periodMs: SENSOR_SLOW_PERIOD_MS,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: { config: [{ channel: 0, subId: SUB_ID }] }
        });
    });

    it('registers Hub.Sensor.Motion as default and skips when All is advertised', () => {
        const endpoints: PollEndpoint[] = [{ subDeviceId: SUB_ID, traits: ['sensor'] }];
        const withoutAll = buildPollJobs(ability(HUB_SENSOR_MOTION_NAMESPACE), endpoints);
        assert.deepEqual(job(withoutAll, HUB_SENSOR_MOTION_NAMESPACE), {
            namespace: HUB_SENSOR_MOTION_NAMESPACE,
            strategy: 'default',
            periodMs: 0,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: { motion: [{ id: SUB_ID }] }
        });
        const withAll = buildPollJobs(
            ability(HUB_SENSOR_ALL_NAMESPACE, HUB_SENSOR_MOTION_NAMESPACE),
            endpoints
        );
        assert.equal(namespaces(withAll).includes(HUB_SENSOR_MOTION_NAMESPACE), false);
        assert.ok(namespaces(withAll).includes(HUB_SENSOR_ALL_NAMESPACE));
    });

    it('registers Digest.TimerX and Digest.TriggerX as once', () => {
        const jobs = buildPollJobs(
            ability(DIGEST_TIMERX_NAMESPACE, DIGEST_TRIGGERX_NAMESPACE),
            [{ channel: CHANNEL, traits: ['timer', 'trigger'] }]
        );
        assert.deepEqual(job(jobs, DIGEST_TIMERX_NAMESPACE), {
            namespace: DIGEST_TIMERX_NAMESPACE,
            strategy: 'once',
            periodMs: 0,
            periodCloudMs: 0,
            payload: {}
        });
        assert.deepEqual(job(jobs, DIGEST_TRIGGERX_NAMESPACE), {
            namespace: DIGEST_TRIGGERX_NAMESPACE,
            strategy: 'once',
            periodMs: 0,
            periodCloudMs: 0,
            payload: {}
        });
    });

    it('registers Presence LatestX and Config', () => {
        const endpoints: PollEndpoint[] = [{ channel: CHANNEL, traits: ['presence'] }];
        const jobs = buildPollJobs(
            ability(SENSOR_LATESTX_NAMESPACE, PRESENCE_CONFIG_NAMESPACE),
            endpoints
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

    it('registers Sprinkler Water and DeviceCfg but not WaterPlan', () => {
        const endpoints: PollEndpoint[] = [{ subDeviceId: SUB_ID, traits: ['sprinkler'] }];
        const jobs = buildPollJobs(
            ability(CONTROL_WATER_NAMESPACE, DEVICE_CFG_NAMESPACE, WATER_PLAN_NAMESPACE),
            endpoints
        );
        assert.deepEqual(job(jobs, CONTROL_WATER_NAMESPACE), {
            namespace: CONTROL_WATER_NAMESPACE,
            strategy: 'default',
            periodMs: 0,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: { control: [{ subId: SUB_ID, channel: 0 }] }
        });
        assert.deepEqual(job(jobs, DEVICE_CFG_NAMESPACE), {
            namespace: DEVICE_CFG_NAMESPACE,
            strategy: 'smart',
            periodMs: SENSOR_SLOW_PERIOD_MS,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: { config: [{ subId: SUB_ID, channel: 0 }] }
        });
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

    it('registers garage and shutter config extras when advertised', () => {
        const jobs = buildPollJobs(
            ability(
                GARAGE_CONFIG_NAMESPACE,
                GARAGE_MULTIPLE_CONFIG_NAMESPACE,
                SHUTTER_CONFIG_NAMESPACE,
                SHUTTER_ADJUST_NAMESPACE
            ),
            [{ channel: CHANNEL, traits: ['cover'] }]
        );
        assert.deepEqual(job(jobs, GARAGE_CONFIG_NAMESPACE), {
            namespace: GARAGE_CONFIG_NAMESPACE,
            strategy: 'smart',
            periodMs: SENSOR_SLOW_PERIOD_MS,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: {}
        });
        assert.deepEqual(job(jobs, GARAGE_MULTIPLE_CONFIG_NAMESPACE), {
            namespace: GARAGE_MULTIPLE_CONFIG_NAMESPACE,
            strategy: 'smart',
            periodMs: SENSOR_SLOW_PERIOD_MS,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: {}
        });
        assert.deepEqual(job(jobs, SHUTTER_CONFIG_NAMESPACE), {
            namespace: SHUTTER_CONFIG_NAMESPACE,
            strategy: 'smart',
            periodMs: SENSOR_SLOW_PERIOD_MS,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: {}
        });
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

    it('registers Runtime, OverTemp, and Sensor.Association as smart config', () => {
        const jobs = buildPollJobs(
            ability(
                'Appliance.System.Runtime',
                'Appliance.Config.OverTemp',
                'Appliance.Config.Sensor.Association'
            ),
            [{ channel: CHANNEL, traits: ['climate'] }]
        );
        assert.deepEqual(jobs.find((entry) => entry.namespace === 'Appliance.System.Runtime'), {
            namespace: 'Appliance.System.Runtime',
            strategy: 'smart',
            periodMs: SENSOR_SLOW_PERIOD_MS,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: {}
        });
        assert.deepEqual(jobs.find((entry) => entry.namespace === 'Appliance.Config.OverTemp'), {
            namespace: 'Appliance.Config.OverTemp',
            strategy: 'smart',
            periodMs: SENSOR_SLOW_PERIOD_MS,
            periodCloudMs: CLOUDMQTT_PERIOD_MS,
            payload: {}
        });
        assert.deepEqual(
            jobs.find((entry) => entry.namespace === 'Appliance.Config.Sensor.Association'),
            {
                namespace: 'Appliance.Config.Sensor.Association',
                strategy: 'smart',
                periodMs: SENSOR_SLOW_PERIOD_MS,
                periodCloudMs: CLOUDMQTT_PERIOD_MS,
                payload: { config: [] }
            }
        );
    });

    it('skips System.Time when System.All is advertised and registers Position/Debug as once', () => {
        const jobs = buildPollJobs(
            ability(
                SYSTEM_TIME_NAMESPACE,
                SYSTEM_POSITION_NAMESPACE,
                SYSTEM_DEBUG_NAMESPACE,
                SYSTEM_FIRMWARE_NAMESPACE,
                SYSTEM_HARDWARE_NAMESPACE,
                SYSTEM_ALL_NAMESPACE
            ),
            [{ channel: CHANNEL, traits: ['system'] }]
        );
        assert.equal(job(jobs, SYSTEM_TIME_NAMESPACE), undefined);
        assert.deepEqual(job(jobs, SYSTEM_POSITION_NAMESPACE), {
            namespace: SYSTEM_POSITION_NAMESPACE,
            strategy: 'once',
            periodMs: 0,
            periodCloudMs: 0,
            payload: {}
        });
        assert.deepEqual(job(jobs, SYSTEM_DEBUG_NAMESPACE), {
            namespace: SYSTEM_DEBUG_NAMESPACE,
            strategy: 'once',
            periodMs: 0,
            periodCloudMs: 0,
            payload: {}
        });
        assert.equal(job(jobs, SYSTEM_FIRMWARE_NAMESPACE), undefined);
        assert.equal(job(jobs, SYSTEM_HARDWARE_NAMESPACE), undefined);
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

    it('registers System.Firmware and Hardware once when System.All is absent', () => {
        const jobs = buildPollJobs(
            ability(SYSTEM_FIRMWARE_NAMESPACE, SYSTEM_HARDWARE_NAMESPACE),
            [{ channel: CHANNEL, traits: ['system'] }]
        );
        assert.deepEqual(job(jobs, SYSTEM_FIRMWARE_NAMESPACE), {
            namespace: SYSTEM_FIRMWARE_NAMESPACE,
            strategy: 'once',
            periodMs: 0,
            periodCloudMs: 0,
            payload: {}
        });
        assert.deepEqual(job(jobs, SYSTEM_HARDWARE_NAMESPACE), {
            namespace: SYSTEM_HARDWARE_NAMESPACE,
            strategy: 'once',
            periodMs: 0,
            periodCloudMs: 0,
            payload: {}
        });
    });
});
