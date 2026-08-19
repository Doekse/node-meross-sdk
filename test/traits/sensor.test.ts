import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Endpoint } from '../../src/endpoint';
import {
    HUB_BATTERY_NAMESPACE,
    HUB_SENSOR_ADJUST_NAMESPACE,
    HUB_SENSOR_ALERT_NAMESPACE,
    HUB_SENSOR_ALL_NAMESPACE,
    HUB_SENSOR_DOORWINDOW_NAMESPACE,
    HUB_SENSOR_SMOKE_NAMESPACE,
    HUB_SENSOR_TEMPHUM_NAMESPACE,
    HUB_SENSOR_WATERLEAK_NAMESPACE,
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
    HUB_SENSOR_SMOKE_NAMESPACE,
    HUB_SENSOR_ADJUST_NAMESPACE,
    HUB_SENSOR_ALERT_NAMESPACE,
    HUB_SENSOR_ALL_NAMESPACE,
    HUB_BATTERY_NAMESPACE,
    SENSOR_LATESTX_NAMESPACE
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

describe('SensorTrait — smoke PUSH', () => {
    it('applies smoke=true from status=25 (alarm-smoke)', () => {
        const { trait, changes } = createHarness('smoke');
        trait.handlePush(pushMessage(HUB_SENSOR_SMOKE_NAMESPACE, {
            smokeAlarm: [{ id: SUB_DEVICE_ID, status: 25, timestamp: 1000, interConn: 0 }]
        }));
        assert.equal(changes[0].smoke, true);
        assert.equal(changes[0].smokeStatus, 'alarm');
        assert.equal(changes[0].interConn, false);
    });

    it('treats status=170 as interconnect heartbeat, not an alarm', () => {
        const { trait, changes } = createHarness('smoke');
        trait.handlePush(pushMessage(HUB_SENSOR_SMOKE_NAMESPACE, {
            smokeAlarm: [{ id: SUB_DEVICE_ID, status: 170, timestamp: 1000, interConn: 1 }]
        }));
        assert.equal(changes[0].smoke, false);
        assert.equal(changes[0].smokeStatus, 'link');
        assert.equal(changes[0].interConn, true);
    });

    it('applies smoke=false from status=0', () => {
        const { trait, changes } = createHarness('smoke');
        trait.handlePush(pushMessage(HUB_SENSOR_SMOKE_NAMESPACE, {
            smokeAlarm: [{ id: SUB_DEVICE_ID, status: 0, timestamp: 1000, interConn: 0 }]
        }));
        assert.equal(changes[0].smoke, false);
        assert.equal(changes[0].smokeStatus, 'ok');
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

describe('SensorTrait — start() initial GET', () => {
    it('GETs Sensor.All when advertised', async () => {
        const { trait, requests, changes } = createHarness('tempHum', {
            all: [{
                id: SUB_DEVICE_ID,
                temperature: { latest: 250 },
                humidity: { latest: 700 }
            }]
        });
        trait.start();
        await new Promise((resolve) => setImmediate(resolve));
        await new Promise((resolve) => setImmediate(resolve));
        const namespaces = requests.map((r) => r.header.namespace);
        assert.ok(namespaces.includes(HUB_SENSOR_ALL_NAMESPACE));
        assert.ok(!namespaces.includes(HUB_SENSOR_TEMPHUM_NAMESPACE));
        assert.equal(changes.find((c) => c.temperature !== undefined)?.temperature, 25);
        assert.equal(changes.find((c) => c.humidity !== undefined)?.humidity, 70);
    });

    it('issues a GET for tempHum and battery when All is not advertised', async () => {
        const { trait, requests } = createHarness('tempHum', {
            tempHum: [{ id: SUB_DEVICE_ID, latestTemperature: 220, latestHumidity: 600 }]
        }, new Set([HUB_SENSOR_TEMPHUM_NAMESPACE, HUB_BATTERY_NAMESPACE]));
        trait.start();
        await new Promise((resolve) => setImmediate(resolve));
        await new Promise((resolve) => setImmediate(resolve));
        const namespaces = requests.map((r) => r.header.namespace);
        assert.ok(namespaces.includes(HUB_SENSOR_TEMPHUM_NAMESPACE), 'should GET TempHum');
        assert.ok(namespaces.includes(HUB_BATTERY_NAMESPACE), 'should GET Battery');
    });

    it('applies initial values from tempHum GETACK', async () => {
        const { trait, changes } = createHarness('tempHum', {
            tempHum: [{ id: SUB_DEVICE_ID, latestTemperature: 250, latestHumidity: 700 }]
        }, new Set([HUB_SENSOR_TEMPHUM_NAMESPACE]));
        trait.start();
        await new Promise((resolve) => setImmediate(resolve));
        await new Promise((resolve) => setImmediate(resolve));
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

    it('mute() SETs smoke status 27', async () => {
        const { trait, requests, changes } = createHarness('smoke');
        await trait.mute();
        assert.equal(requests[0].header.namespace, HUB_SENSOR_SMOKE_NAMESPACE);
        assert.equal(requests[0].header.method, 'SET');
        const entry = (requests[0].payload.smokeAlarm as Array<Record<string, number>>)[0];
        assert.equal(entry.status, 27);
        assert.equal(changes[0].smokeStatus, 'muted');
        assert.equal(changes[0].smoke, false);
    });

    it('test() SETs smoke status 23', async () => {
        const { trait, requests, changes } = createHarness('smoke');
        await trait.test();
        const entry = (requests[0].payload.smokeAlarm as Array<Record<string, number>>)[0];
        assert.equal(entry.status, 23);
        assert.equal(changes[0].smokeStatus, 'test');
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
