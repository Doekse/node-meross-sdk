import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Endpoint } from '../../src/endpoint';
import {
    HUB_BATTERY_NAMESPACE,
    HUB_EXCEPTION_NAMESPACE,
    HUB_SENSOR_ADJUST_NAMESPACE,
    HUB_SENSOR_ALERT_NAMESPACE,
    HUB_SENSOR_ALL_NAMESPACE,
    HUB_SENSOR_DOORWINDOW_NAMESPACE,
    HUB_SENSOR_MOTION_NAMESPACE,
    HUB_SENSOR_SMOKE_NAMESPACE,
    HUB_SENSOR_TEMPHUM_NAMESPACE,
    HUB_SENSOR_WATERLEAK_NAMESPACE,
    HUB_SUBDEVICE_VERSION_NAMESPACE,
    SMOKE_CONFIG_NAMESPACE,
    SENSOR_LATESTX_NAMESPACE,
    encodeMessage,
    type MerossMessage
} from '../../src/protocol';
import { SENSOR_FAMILY_MAP, SensorTrait } from '../../src/traits/sensor';
import type { SensorFamily, SensorTraitBind } from '../../src/traits/sensor';

const KEY = 'stub-key';
const UUID = '2206138957096651080248e1e99705a4';
const SUB_DEVICE_ID = '00000102';

const HUB_SENSOR_NAMESPACES = new Set([
    HUB_SENSOR_TEMPHUM_NAMESPACE,
    HUB_SENSOR_DOORWINDOW_NAMESPACE,
    HUB_SENSOR_WATERLEAK_NAMESPACE,
    HUB_SENSOR_MOTION_NAMESPACE,
    HUB_SENSOR_SMOKE_NAMESPACE,
    HUB_SENSOR_ADJUST_NAMESPACE,
    HUB_SENSOR_ALERT_NAMESPACE,
    HUB_SENSOR_ALL_NAMESPACE,
    HUB_BATTERY_NAMESPACE,
    HUB_EXCEPTION_NAMESPACE,
    HUB_SUBDEVICE_VERSION_NAMESPACE,
    SENSOR_LATESTX_NAMESPACE,
    SMOKE_CONFIG_NAMESPACE
]);

function createHarness(
    family: SensorFamily,
    getAckPayload: Record<string, unknown> = {},
    namespaces: ReadonlySet<string> = HUB_SENSOR_NAMESPACES
): {
    endpoint: Endpoint;
    trait: SensorTrait;
    requests: MerossMessage[];
    changes: Record<string, unknown>[];
} {
    const requests: MerossMessage[] = [];
    const changes: Record<string, unknown>[] = [];
    const endpoint = new Endpoint({ id: `${UUID}#${SUB_DEVICE_ID}`, traits: ['sensor'] });
    const bind: SensorTraitBind = {
        uuid: UUID,
        subDeviceId: SUB_DEVICE_ID,
        family,
        namespaces,
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
                method: 'GETACK',
                key: KEY,
                from: `/appliance/${UUID}/publish`,
                messageId: message.header.messageId,
                uuid: UUID,
                payload: getAckPayload
            });
        },
        emitChange: (values) => {
            changes.push({ ...values });
            endpoint.emit('change', { trait: 'sensor', values: { ...values } });
        }
    };
    return { endpoint, trait: new SensorTrait(bind), requests, changes };
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

describe('SENSOR_FAMILY_MAP', () => {
    it('maps tempHum models correctly', () => {
        assert.equal(SENSOR_FAMILY_MAP.get('ms100'), 'tempHum');
        assert.equal(SENSOR_FAMILY_MAP.get('ms100f'), 'tempHum');
        assert.equal(SENSOR_FAMILY_MAP.get('ms130'), 'tempHum');
    });

    it('maps contact model correctly', () => {
        assert.equal(SENSOR_FAMILY_MAP.get('ms200'), 'contact');
    });

    it('maps leak models correctly', () => {
        assert.equal(SENSOR_FAMILY_MAP.get('ms400'), 'leak');
        assert.equal(SENSOR_FAMILY_MAP.get('ms405'), 'leak');
    });

    it('maps motion model correctly', () => {
        assert.equal(SENSOR_FAMILY_MAP.get('ms120'), 'motion');
    });

    it('maps smoke models correctly', () => {
        assert.equal(SENSOR_FAMILY_MAP.get('ma151'), 'smoke');
        assert.equal(SENSOR_FAMILY_MAP.get('gs559'), 'smoke');
    });

    it('returns undefined for unknown model', () => {
        assert.equal(SENSOR_FAMILY_MAP.get('unknown'), undefined);
    });
});

describe('SensorTrait — tempHum PUSH', () => {
    it('applies temperature and humidity from a PUSH for matching id', () => {
        const { trait, changes } = createHarness('tempHum');
        trait.handlePush(pushMessage(HUB_SENSOR_TEMPHUM_NAMESPACE, {
            tempHum: [{ id: SUB_DEVICE_ID, latestTemperature: 230, latestHumidity: 450 }]
        }));
        assert.equal(changes.length, 1);
        assert.equal(changes[0].temperature, 23);
        assert.equal(changes[0].humidity, 45);
    });

    it('ignores PUSH for a different sub-device id', () => {
        const { trait, changes } = createHarness('tempHum');
        trait.handlePush(pushMessage(HUB_SENSOR_TEMPHUM_NAMESPACE, {
            tempHum: [{ id: 'other-id', latestTemperature: 230, latestHumidity: 450 }]
        }));
        assert.equal(changes.length, 0);
    });

    it('ignores tempHum PUSH when family is contact', () => {
        const { trait, changes } = createHarness('contact');
        trait.handlePush(pushMessage(HUB_SENSOR_TEMPHUM_NAMESPACE, {
            tempHum: [{ id: SUB_DEVICE_ID, latestTemperature: 230, latestHumidity: 450 }]
        }));
        assert.equal(changes.length, 0);
    });
});

describe('SensorTrait — contact PUSH', () => {
    it('applies open=true from status=1', () => {
        const { trait, changes } = createHarness('contact');
        trait.handlePush(pushMessage(HUB_SENSOR_DOORWINDOW_NAMESPACE, {
            doorWindow: [{ id: SUB_DEVICE_ID, status: 1, lmTime: 1000 }]
        }));
        assert.equal(changes.length, 1);
        assert.equal(changes[0].open, true);
    });

    it('applies open=false from status=0', () => {
        const { trait, changes } = createHarness('contact');
        trait.handlePush(pushMessage(HUB_SENSOR_DOORWINDOW_NAMESPACE, {
            doorWindow: [{ id: SUB_DEVICE_ID, status: 0, lmTime: 1000 }]
        }));
        assert.equal(changes.length, 1);
        assert.equal(changes[0].open, false);
    });
});

describe('SensorTrait — leak PUSH', () => {
    it('applies leak=true from latestWaterLeak=1', () => {
        const { trait, changes } = createHarness('leak');
        trait.handlePush(pushMessage(HUB_SENSOR_WATERLEAK_NAMESPACE, {
            waterLeak: [{ id: SUB_DEVICE_ID, latestWaterLeak: 1, latestSampleTime: 1000 }]
        }));
        assert.equal(changes.length, 1);
        assert.equal(changes[0].leak, true);
    });

    it('applies leak=false from latestWaterLeak=0', () => {
        const { trait, changes } = createHarness('leak');
        trait.handlePush(pushMessage(HUB_SENSOR_WATERLEAK_NAMESPACE, {
            waterLeak: [{ id: SUB_DEVICE_ID, latestWaterLeak: 0, latestSampleTime: 1000 }]
        }));
        assert.equal(changes.length, 1);
        assert.equal(changes[0].leak, false);
    });
});

describe('SensorTrait — motion PUSH', () => {
    it('applies motion=true from status=1', () => {
        const { trait, changes } = createHarness('motion');
        trait.handlePush(pushMessage(HUB_SENSOR_MOTION_NAMESPACE, {
            motion: [{ id: SUB_DEVICE_ID, status: 1, lmTime: 1000 }]
        }));
        assert.equal(changes.length, 1);
        assert.equal(changes[0].motion, true);
    });

    it('applies motion=false from status=0', () => {
        const { trait, changes } = createHarness('motion');
        trait.handlePush(pushMessage(HUB_SENSOR_MOTION_NAMESPACE, {
            motion: [{ id: SUB_DEVICE_ID, status: 0, lmTime: 1000 }]
        }));
        assert.equal(changes.length, 1);
        assert.equal(changes[0].motion, false);
    });

    it('ignores PUSH for a different sub-device id', () => {
        const { trait, changes } = createHarness('motion');
        trait.handlePush(pushMessage(HUB_SENSOR_MOTION_NAMESPACE, {
            motion: [{ id: 'other-id', status: 1, lmTime: 1000 }]
        }));
        assert.equal(changes.length, 0);
    });

    it('ignores motion PUSH when family is contact', () => {
        const { trait, changes } = createHarness('contact');
        trait.handlePush(pushMessage(HUB_SENSOR_MOTION_NAMESPACE, {
            motion: [{ id: SUB_DEVICE_ID, status: 1, lmTime: 1000 }]
        }));
        assert.equal(changes.length, 0);
    });

    it('dedupes identical motion values', () => {
        const { trait, changes } = createHarness('motion');
        const payload = { motion: [{ id: SUB_DEVICE_ID, status: 1, lmTime: 1000 }] };
        trait.handlePush(pushMessage(HUB_SENSOR_MOTION_NAMESPACE, payload));
        trait.handlePush(pushMessage(HUB_SENSOR_MOTION_NAMESPACE, payload));
        assert.equal(changes.length, 1);
    });

    it('applies Sensor.All nested motion for motion family', () => {
        const { trait, changes } = createHarness('motion');
        trait.handlePush(pushMessage(HUB_SENSOR_ALL_NAMESPACE, {
            all: [{ id: SUB_DEVICE_ID, motion: { status: 1, lmTime: 1 } }]
        }));
        assert.equal(changes[0].motion, true);
    });
});

describe('SensorTrait — smoke PUSH', () => {
    it('applies smoke=true from status=25 (alarm-smoke)', () => {
        const { trait, changes } = createHarness('smoke');
        trait.handlePush(pushMessage(HUB_SENSOR_SMOKE_NAMESPACE, {
            smokeAlarm: [{ id: SUB_DEVICE_ID, status: 25, timestamp: 1000, interConn: 0 }]
        }));
        assert.equal(changes[0].smoke, true);
        assert.equal(changes[0].smokeStatus, 'alarmSmoke');
        assert.equal(changes[0].interConn, false);
    });

    it('treats status=170 as idle/ok; interconnect is interConn', () => {
        const { trait, changes } = createHarness('smoke');
        trait.handlePush(pushMessage(HUB_SENSOR_SMOKE_NAMESPACE, {
            smokeAlarm: [{ id: SUB_DEVICE_ID, status: 170, timestamp: 1000, interConn: 1 }]
        }));
        assert.equal(changes[0].smoke, false);
        assert.equal(changes[0].smokeStatus, 'ok');
        assert.equal(changes[0].interConn, true);
    });

    it('treats muted smoke alarm 27 as smoke + muted', () => {
        const { trait, changes } = createHarness('smoke');
        trait.handlePush(pushMessage(HUB_SENSOR_SMOKE_NAMESPACE, {
            smokeAlarm: [{ id: SUB_DEVICE_ID, status: 27, timestamp: 1000 }]
        }));
        assert.equal(changes[0].smoke, true);
        assert.equal(changes[0].smokeStatus, 'alarmSmoke');
        assert.equal(changes[0].smokeMuted, true);
        assert.equal(changes[0].smokeError, false);
    });

    it('treats test 23 as smoke with status test', () => {
        const { trait, changes } = createHarness('smoke');
        trait.handlePush(pushMessage(HUB_SENSOR_SMOKE_NAMESPACE, {
            smokeAlarm: [{ id: SUB_DEVICE_ID, status: 23, timestamp: 1000 }]
        }));
        assert.equal(changes[0].smoke, true);
        assert.equal(changes[0].smokeStatus, 'test');
    });

    it('treats muted fault 20 as error + muted, not an alarm', () => {
        const { trait, changes } = createHarness('smoke');
        trait.handlePush(pushMessage(HUB_SENSOR_SMOKE_NAMESPACE, {
            smokeAlarm: [{ id: SUB_DEVICE_ID, status: 20, timestamp: 1000 }]
        }));
        assert.equal(changes[0].smoke, false);
        assert.equal(changes[0].smokeStatus, 'errorTemperature');
        assert.equal(changes[0].smokeError, true);
        assert.equal(changes[0].smokeMuted, true);
    });

    it('surfaces unknown smoke status codes as unknown', () => {
        const { trait, changes } = createHarness('smoke');
        trait.handlePush(pushMessage(HUB_SENSOR_SMOKE_NAMESPACE, {
            smokeAlarm: [{ id: SUB_DEVICE_ID, status: 0, timestamp: 1000, interConn: 0 }]
        }));
        assert.equal(changes[0].smoke, false);
        assert.equal(changes[0].smokeStatus, 'unknown');
    });

    it('applies smoke DND and detect values from Smoke.Config PUSH', () => {
        const { trait, changes } = createHarness('smoke');
        trait.handlePush(pushMessage(SMOKE_CONFIG_NAMESPACE, {
            config: [{
                channel: 0,
                subId: SUB_DEVICE_ID,
                dnd: { enable: 1 },
                detect: { enable: 2 }
            }]
        }));
        assert.equal(changes[0].smokeDnd, true);
        assert.equal(changes[0].smokeDetect, false);
    });

    it('ignores Smoke.Config PUSH for a different sub-device id', () => {
        const { trait, changes } = createHarness('smoke');
        trait.handlePush(pushMessage(SMOKE_CONFIG_NAMESPACE, {
            config: [{
                channel: 0,
                subId: 'other-id',
                dnd: { enable: 1 }
            }]
        }));
        assert.equal(changes.length, 0);
    });
});

describe('SensorTrait — battery PUSH', () => {
    it('applies battery level from Hub.Battery PUSH', () => {
        const { trait, changes } = createHarness('tempHum');
        trait.handlePush(pushMessage(HUB_BATTERY_NAMESPACE, {
            battery: [{ id: SUB_DEVICE_ID, value: 80 }]
        }));
        assert.equal(changes.length, 1);
        assert.equal(changes[0].battery, 80);
    });

    it('skips battery when value is 0xFFFFFFFF (unsupported)', () => {
        const { trait, changes } = createHarness('tempHum');
        trait.handlePush(pushMessage(HUB_BATTERY_NAMESPACE, {
            battery: [{ id: SUB_DEVICE_ID, value: 0xFFFFFFFF }]
        }));
        assert.equal(changes.length, 0);
    });

    it('ignores battery PUSH for different id', () => {
        const { trait, changes } = createHarness('tempHum');
        trait.handlePush(pushMessage(HUB_BATTERY_NAMESPACE, {
            battery: [{ id: 'other-id', value: 60 }]
        }));
        assert.equal(changes.length, 0);
    });
});

describe('SensorTrait — exception and version', () => {
    it('applies fault from Hub.Exception PUSH for matching id', () => {
        const { trait, changes } = createHarness('tempHum');
        trait.handlePush(pushMessage(HUB_EXCEPTION_NAMESPACE, {
            exception: [{ id: SUB_DEVICE_ID, code: 5061 }]
        }));
        assert.equal(changes.length, 1);
        assert.equal(changes[0].fault, 5061);
    });

    it('dedupes identical Hub.Exception fault codes', () => {
        const { trait, changes } = createHarness('tempHum');
        const message = pushMessage(HUB_EXCEPTION_NAMESPACE, {
            exception: [{ id: SUB_DEVICE_ID, code: 5061 }]
        });
        trait.handlePush(message);
        trait.handlePush(message);
        assert.equal(changes.length, 1);
    });

    it('ignores Hub.Exception PUSH for a different sub-device id', () => {
        const { trait, changes } = createHarness('tempHum');
        trait.handlePush(pushMessage(HUB_EXCEPTION_NAMESPACE, {
            exception: [{ id: 'other-id', code: 5061 }]
        }));
        assert.equal(changes.length, 0);
    });

    it('ignores Hub.Exception PUSH when uuid does not match the bind', () => {
        const { trait, changes } = createHarness('tempHum');
        trait.handlePush(encodeMessage({
            namespace: HUB_EXCEPTION_NAMESPACE,
            method: 'PUSH',
            key: KEY,
            from: '/appliance/other/publish',
            uuid: 'other',
            payload: { exception: [{ id: SUB_DEVICE_ID, code: 5061 }] }
        }));
        assert.equal(changes.length, 0);
    });

    it('applies firmwareVersion from Hub.SubDevice.Version PUSH', () => {
        const { trait, changes } = createHarness('tempHum');
        trait.handlePush(pushMessage(HUB_SUBDEVICE_VERSION_NAMESPACE, {
            version: [{ id: SUB_DEVICE_ID, hardware: '1.1.5', firmware: '5.1.8' }]
        }));
        assert.equal(changes.length, 1);
        assert.equal(changes[0].firmwareVersion, '5.1.8');
        assert.equal(changes[0].hardwareVersion, '1.1.5');
    });

    it('ignores Version PUSH for a different sub-device id', () => {
        const { trait, changes } = createHarness('tempHum');
        trait.handlePush(pushMessage(HUB_SUBDEVICE_VERSION_NAMESPACE, {
            version: [{ id: 'other-id', firmware: '5.1.8' }]
        }));
        assert.equal(changes.length, 0);
    });

    it('applies firmwareVersion from Version GETACK via handlePush', () => {
        const { trait, changes } = createHarness('tempHum');
        trait.handlePush(encodeMessage({
            namespace: HUB_SUBDEVICE_VERSION_NAMESPACE,
            method: 'GETACK',
            key: KEY,
            from: `/appliance/${UUID}/publish`,
            uuid: UUID,
            payload: {
                version: [{ id: SUB_DEVICE_ID, hardware: '1.2.3', firmware: '6.1.9' }]
            }
        }));
        assert.equal(changes[0].firmwareVersion, '6.1.9');
    });

    it('dedupes identical firmwareVersion values', () => {
        const { trait, changes } = createHarness('tempHum');
        const message = pushMessage(HUB_SUBDEVICE_VERSION_NAMESPACE, {
            version: [{ id: SUB_DEVICE_ID, firmware: '5.1.8' }]
        });
        trait.handlePush(message);
        trait.handlePush(message);
        assert.equal(changes.length, 1);
    });

    it('ignores Version PUSH when uuid does not match the bind', () => {
        const { trait, changes } = createHarness('tempHum');
        trait.handlePush(encodeMessage({
            namespace: HUB_SUBDEVICE_VERSION_NAMESPACE,
            method: 'PUSH',
            key: KEY,
            from: '/appliance/other/publish',
            uuid: 'other',
            payload: {
                version: [{ id: SUB_DEVICE_ID, firmware: '5.1.8' }]
            }
        }));
        assert.equal(changes.length, 0);
    });
});

describe('SensorTrait — handlePush', () => {
    it('applies values from tempHum GETACK via handlePush', () => {
        const { trait, changes } = createHarness('tempHum', {}, new Set([HUB_SENSOR_TEMPHUM_NAMESPACE]));
        trait.handlePush(encodeMessage({
            namespace: HUB_SENSOR_TEMPHUM_NAMESPACE,
            method: 'GETACK',
            key: KEY,
            from: `/appliance/${UUID}/publish`,
            uuid: UUID,
            payload: { tempHum: [{ id: SUB_DEVICE_ID, latestTemperature: 250, latestHumidity: 700 }] }
        }));
        const tempChange = changes.find((c) => c.temperature !== undefined);
        assert.ok(tempChange, 'should emit temperature');
        assert.equal(tempChange!.temperature, 25);
        assert.equal(tempChange!.humidity, 70);
    });
});

describe('SensorTrait — extras', () => {
    it('scales TempHum readings over 1000 by 100', () => {
        const { trait, changes } = createHarness('tempHum');
        trait.handlePush(pushMessage(HUB_SENSOR_TEMPHUM_NAMESPACE, {
            tempHum: [{ id: SUB_DEVICE_ID, latestTemperature: 1772, latestHumidity: 711 }]
        }));
        assert.equal(changes[0].temperature, 17.72);
        assert.equal(changes[0].humidity, 71.1);
    });

    it('scales MS130 LatestX temperatures by 100 and reports lux', () => {
        const { trait, changes } = createHarness('tempHum');
        trait.handlePush(pushMessage(SENSOR_LATESTX_NAMESPACE, {
            latest: [{
                subId: SUB_DEVICE_ID,
                channel: 0,
                data: {
                    temp: [{ value: 2134, timestamp: 1 }],
                    humi: [{ value: 670, timestamp: 1 }],
                    light: [{ value: 220, timestamp: 1 }]
                }
            }]
        }));
        assert.equal(changes[0].temperature, 21.34);
        assert.equal(changes[0].humidity, 67);
        assert.equal(changes[0].light, 220);
    });

    it('applies Sensor.All nested door state for contact family', () => {
        const { trait, changes } = createHarness('contact');
        trait.handlePush(pushMessage(HUB_SENSOR_ALL_NAMESPACE, {
            all: [{ id: SUB_DEVICE_ID, doorWindow: { status: 1, lmTime: 1 } }]
        }));
        assert.equal(changes[0].open, true);
    });

    it('setCalibration SETs Hub.Sensor.Adjust in host °C', async () => {
        const { trait, requests, changes } = createHarness('tempHum');
        await trait.setCalibration({ temperature: -2, humidity: 3 });
        assert.equal(requests[0].header.namespace, HUB_SENSOR_ADJUST_NAMESPACE);
        assert.equal(requests[0].header.method, 'SET');
        const entry = (requests[0].payload.adjust as Array<Record<string, number>>)[0];
        assert.equal(entry.temperature, -20);
        assert.equal(entry.humidity, 30);
        assert.equal(changes[0].calibration, -2);
        assert.equal(changes[0].humidityCalibration, 3);
    });

    it('setAlerts SETs Hub.Sensor.Alert bands in host units', async () => {
        const { trait, requests } = createHarness('tempHum');
        await trait.setAlerts({
            temperature: [{ enabled: true, active: false, low: -10, high: 10 }]
        });
        assert.equal(requests[0].header.namespace, HUB_SENSOR_ALERT_NAMESPACE);
        const bands = (requests[0].payload.alert as Array<{ temperature: number[][] }>)[0].temperature;
        assert.deepEqual(bands[0], [1, -100, 100]);
    });

    it('mute() SETs 27 from a live smoke alarm (25)', async () => {
        const { trait, requests, changes } = createHarness('smoke');
        trait.handlePush(pushMessage(HUB_SENSOR_SMOKE_NAMESPACE, {
            smokeAlarm: [{ id: SUB_DEVICE_ID, status: 25, timestamp: 1000 }]
        }));
        requests.length = 0;
        await trait.mute();
        assert.equal(requests[0].header.namespace, HUB_SENSOR_SMOKE_NAMESPACE);
        assert.equal(requests[0].header.method, 'SET');
        const entry = (requests[0].payload.smokeAlarm as Array<Record<string, number>>)[0];
        assert.equal(entry.status, 27);
        assert.equal(changes.at(-1)?.smokeMuted, true);
    });

    it('mute() SETs 26 from a live temperature alarm (24)', async () => {
        const { trait, requests } = createHarness('smoke');
        trait.handlePush(pushMessage(HUB_SENSOR_SMOKE_NAMESPACE, {
            smokeAlarm: [{ id: SUB_DEVICE_ID, status: 24, timestamp: 1000 }]
        }));
        requests.length = 0;
        await trait.mute();
        const entry = (requests[0].payload.smokeAlarm as Array<Record<string, number>>)[0];
        assert.equal(entry.status, 26);
    });

    it('mute() SETs 21 from a live smoke fault (18)', async () => {
        const { trait, requests } = createHarness('smoke');
        trait.handlePush(pushMessage(HUB_SENSOR_SMOKE_NAMESPACE, {
            smokeAlarm: [{ id: SUB_DEVICE_ID, status: 18, timestamp: 1000 }]
        }));
        requests.length = 0;
        await trait.mute();
        const entry = (requests[0].payload.smokeAlarm as Array<Record<string, number>>)[0];
        assert.equal(entry.status, 21);
    });

    it('mute() is a no-op when status is not mutable', async () => {
        const { trait, requests } = createHarness('smoke');
        trait.handlePush(pushMessage(HUB_SENSOR_SMOKE_NAMESPACE, {
            smokeAlarm: [{ id: SUB_DEVICE_ID, status: 170, timestamp: 1000 }]
        }));
        requests.length = 0;
        const result = await trait.mute();
        assert.equal(requests.length, 0);
        assert.deepEqual(result, {});
    });

    it('test() SETs smoke status 23', async () => {
        const { trait, requests, changes } = createHarness('smoke');
        await trait.test();
        const entry = (requests[0].payload.smokeAlarm as Array<Record<string, number>>)[0];
        assert.equal(entry.status, 23);
        assert.equal(changes[0].smokeStatus, 'test');
    });

    it('setSmokeDnd() SETs Smoke.Config dnd enable', async () => {
        const { trait, requests, changes } = createHarness('smoke');
        await trait.setSmokeDnd(true);
        assert.equal(requests[0].header.namespace, SMOKE_CONFIG_NAMESPACE);
        assert.equal(requests[0].header.method, 'SET');
        const entry = (requests[0].payload.config as Array<Record<string, unknown>>)[0];
        assert.deepEqual(entry.dnd, { enable: 1 });
        assert.equal(changes[0].smokeDnd, true);
    });

    it('setSmokeDetect() SETs Smoke.Config detect enable', async () => {
        const { trait, requests, changes } = createHarness('smoke');
        await trait.setSmokeDetect(false);
        const entry = (requests[0].payload.config as Array<Record<string, unknown>>)[0];
        assert.deepEqual(entry.detect, { enable: 2 });
        assert.equal(changes[0].smokeDetect, false);
    });

    it('setCalibration is a no-op on contact sensors', async () => {
        const { trait, requests } = createHarness('contact');
        await trait.setCalibration({ temperature: 1 });
        assert.equal(requests.length, 0);
    });

    it('setCalibration is a no-op when Adjust is not advertised', async () => {
        const { trait, requests } = createHarness('tempHum', {}, new Set());
        await trait.setCalibration({ temperature: 1 });
        assert.equal(requests.length, 0);
    });

    it('setSmokeDnd is a no-op on contact sensors', async () => {
        const { trait, requests } = createHarness('contact');
        await trait.setSmokeDnd(true);
        assert.equal(requests.length, 0);
    });

    it('setSmokeDnd is a no-op when Smoke.Config is not advertised', async () => {
        const { trait, requests } = createHarness('smoke', {}, new Set([HUB_SENSOR_SMOKE_NAMESPACE]));
        await trait.setSmokeDnd(true);
        assert.equal(requests.length, 0);
    });

    it('ignores PUSH when uuid does not match the bind', () => {
        const { trait, changes } = createHarness('tempHum');
        trait.handlePush(encodeMessage({
            namespace: HUB_SENSOR_TEMPHUM_NAMESPACE,
            method: 'PUSH',
            key: KEY,
            from: '/appliance/other/publish',
            uuid: 'other',
            payload: { tempHum: [{ id: SUB_DEVICE_ID, latestTemperature: 230, latestHumidity: 450 }] }
        }));
        assert.equal(changes.length, 0);
    });
});
