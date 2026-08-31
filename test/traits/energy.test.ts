import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { Endpoint } from '../../src/endpoint';
import {
    CONFIG_OVERTEMP_NAMESPACE,
    CONFIG_STANDBY_KILLER_NAMESPACE,
    CONSUMPTIONH_NAMESPACE,
    CONSUMPTIONX_NAMESPACE,
    CONSUMPTION_CONFIG_NAMESPACE,
    CONTROL_ALERT_CONFIG_NAMESPACE,
    CONTROL_ALERT_REPORT_NAMESPACE,
    CONTROL_OVERTEMP_NAMESPACE,
    ELECTRICITY_NAMESPACE,
    ELECTRICITYX_NAMESPACE,
    encodeAlertConfigSet,
    encodeConfigOverTempSet,
    encodeConsumptionConfigGet,
    encodeConsumptionHGet,
    decodeMessage,
    encodeConsumptionXDelete,
    encodeConsumptionXGet,
    encodeElectricityGet,
    encodeElectricityXGet,
    encodeMessage,
    encodeStandbyKillerSet,
    type MerossMessage
} from '../../src/protocol';
import {
    type EnergyValues,
    EnergyTrait
} from '../../src/traits/energy';

const fixturesDir = join(process.cwd(), 'test/fixtures');
const KEY = 'stub-key';
const UUID = '2206138957096651080248e1e99705a4';
const CHANNEL = 0;

function loadFixture(name: string): MerossMessage {
    return decodeMessage(JSON.parse(readFileSync(join(fixturesDir, name), 'utf8')) as unknown);
}

function electricityAck(channel = CHANNEL): MerossMessage {
    return encodeMessage({
        namespace: ELECTRICITY_NAMESPACE,
        method: 'GETACK',
        key: KEY,
        from: `/appliance/${UUID}/publish`,
        uuid: UUID,
        payload: {
            electricity: {
                channel,
                power: 11_000,
                current: 50,
                voltage: 2300,
                consume: 42
            }
        }
    });
}

function electricityXAck(channel = CHANNEL): MerossMessage {
    return encodeMessage({
        namespace: ELECTRICITYX_NAMESPACE,
        method: 'GETACK',
        key: KEY,
        from: `/appliance/${UUID}/publish`,
        uuid: UUID,
        payload: {
            electricity: [{
                channel,
                power: 1500,
                current: 2000,
                voltage: 230000,
                factor: 95,
                mConsume: 12345
            }]
        }
    });
}

function consumptionAck(): MerossMessage {
    return encodeMessage({
        namespace: CONSUMPTIONX_NAMESPACE,
        method: 'GETACK',
        key: KEY,
        from: `/appliance/${UUID}/publish`,
        uuid: UUID,
        payload: loadFixture('consumptionx-getack.json').payload
    });
}

function consumptionHAck(channel = CHANNEL): MerossMessage {
    return encodeMessage({
        namespace: CONSUMPTIONH_NAMESPACE,
        method: 'GETACK',
        key: KEY,
        from: `/appliance/${UUID}/publish`,
        uuid: UUID,
        payload: {
            consumptionH: [{
                channel,
                total: 958,
                data: [
                    { timestamp: 1_701_000_000, value: 12 },
                    { timestamp: 1_701_003_600, value: 15 }
                ]
            }]
        }
    });
}

function createEnergyHarness(options: {
    hasElectricity?: boolean;
    hasElectricityX?: boolean;
    hasConsumptionX?: boolean;
    hasConsumptionH?: boolean;
    namespaces?: ReadonlySet<string>;
} = {}): {
    endpoint: Endpoint;
    trait: EnergyTrait;
    requests: Array<{ namespace: string; method: string; payload: MerossMessage['payload'] }>;
} {
    const requests: Array<{ namespace: string; method: string; payload: MerossMessage['payload'] }> = [];
    const endpoint = new Endpoint({
        id: `${UUID}:${CHANNEL}`,
        traits: ['energy']
    });
    const trait = new EnergyTrait({
        uuid: UUID,
        channel: CHANNEL,
        hasElectricity: options.hasElectricity ?? true,
        hasElectricityX: options.hasElectricityX ?? false,
        hasConsumptionX: options.hasConsumptionX ?? true,
        hasConsumptionH: options.hasConsumptionH ?? false,
        namespaces: options.namespaces ?? new Set(),
        request: async (opts) => {
            requests.push({
                namespace: opts.namespace,
                method: opts.method,
                payload: opts.payload ?? {}
            });
            if (opts.namespace === ELECTRICITY_NAMESPACE) {
                return electricityAck();
            }
            if (opts.namespace === ELECTRICITYX_NAMESPACE) {
                return electricityXAck();
            }
            if (opts.namespace === CONSUMPTIONX_NAMESPACE) {
                if (opts.method === 'DELETE') {
                    return encodeMessage({
                        namespace: CONSUMPTIONX_NAMESPACE,
                        method: 'DELETEACK',
                        key: KEY,
                        from: `/appliance/${UUID}/publish`,
                        uuid: UUID,
                        payload: {}
                    });
                }
                return consumptionAck();
            }
            if (opts.namespace === CONSUMPTIONH_NAMESPACE) {
                return consumptionHAck();
            }
            if (opts.namespace === CONSUMPTION_CONFIG_NAMESPACE) {
                return encodeMessage({
                    namespace: CONSUMPTION_CONFIG_NAMESPACE,
                    method: opts.method === 'SET' ? 'SETACK' : 'GETACK',
                    key: KEY,
                    from: `/appliance/${UUID}/publish`,
                    uuid: UUID,
                    payload: {
                        config: {
                            voltageRatio: 186,
                            electricityRatio: 121,
                            maxElectricityCurrent: 16_000
                        }
                    }
                });
            }
            if (opts.namespace === CONFIG_OVERTEMP_NAMESPACE) {
                return encodeMessage({
                    namespace: CONFIG_OVERTEMP_NAMESPACE,
                    method: opts.method === 'SET' ? 'SETACK' : 'GETACK',
                    key: KEY,
                    from: `/appliance/${UUID}/publish`,
                    uuid: UUID,
                    payload: {}
                });
            }
            if (opts.namespace === CONTROL_ALERT_CONFIG_NAMESPACE) {
                return encodeMessage({
                    namespace: CONTROL_ALERT_CONFIG_NAMESPACE,
                    method: opts.method === 'SET' ? 'SETACK' : 'GETACK',
                    key: KEY,
                    from: `/appliance/${UUID}/publish`,
                    uuid: UUID,
                    payload: {}
                });
            }
            if (opts.namespace === CONFIG_STANDBY_KILLER_NAMESPACE) {
                return encodeMessage({
                    namespace: CONFIG_STANDBY_KILLER_NAMESPACE,
                    method: opts.method === 'SET' ? 'SETACK' : 'GETACK',
                    key: KEY,
                    from: `/appliance/${UUID}/publish`,
                    uuid: UUID,
                    payload: {}
                });
            }
            throw new Error(`unexpected namespace ${opts.namespace}`);
        },
        emitChange: (values) => endpoint.emit('change', { trait: 'energy', values: { ...values } })
    });
    return { endpoint, trait, requests };
}

describe('EnergyTrait.poll', () => {
    it('GETs Electricity for the bound channel and ConsumptionX empty payload', async () => {
        const { trait, requests } = createEnergyHarness();

        const snapshot = await trait.poll();

        assert.deepEqual(requests, [
            {
                namespace: ELECTRICITY_NAMESPACE,
                method: 'GET',
                payload: encodeElectricityGet({ channel: CHANNEL })
            },
            {
                namespace: CONSUMPTIONX_NAMESPACE,
                method: 'GET',
                payload: encodeConsumptionXGet()
            }
        ]);
        assert.deepEqual(snapshot, {
            power: 11,
            current: 0.05,
            voltage: 230,
            consume: 42,
            consumption: [
                { date: '2018-03-05', value: 1000, time: 1673855028 },
                { date: '2018-03-06', value: 1000, time: 1673855028 }
            ]
        });
    });

    it('emits change patches for electricity and consumption', async () => {
        const { endpoint, trait } = createEnergyHarness();
        const changes: Array<{ trait: string; values: EnergyValues }> = [];
        endpoint.on('change', (change) => changes.push(change));

        await trait.poll();

        assert.deepEqual(changes, [
            {
                trait: 'energy',
                values: { power: 11, current: 0.05, voltage: 230, consume: 42 }
            },
            {
                trait: 'energy',
                values: {
                    consumption: [
                        { date: '2018-03-05', value: 1000, time: 1673855028 },
                        { date: '2018-03-06', value: 1000, time: 1673855028 }
                    ]
                }
            }
        ]);
    });

    it('does not emit when a second poll repeats the same readings', async () => {
        const { endpoint, trait } = createEnergyHarness();
        const changes: unknown[] = [];
        endpoint.on('change', (change) => changes.push(change));

        await trait.poll();
        await trait.poll();

        assert.equal(changes.length, 2);
    });

    it('skips namespaces the bind does not advertise', async () => {
        const { trait, requests } = createEnergyHarness({
            hasElectricity: true,
            hasConsumptionX: false
        });

        await trait.poll();

        assert.equal(requests.length, 1);
        assert.equal(requests[0]?.namespace, ELECTRICITY_NAMESPACE);
    });

    it('GETs ElectricityX when classic Electricity is absent', async () => {
        const { trait, requests } = createEnergyHarness({
            hasElectricity: false,
            hasElectricityX: true,
            hasConsumptionX: false
        });

        const snapshot = await trait.poll();

        assert.deepEqual(requests, [{
            namespace: ELECTRICITYX_NAMESPACE,
            method: 'GET',
            payload: encodeElectricityXGet()
        }]);
        assert.deepEqual(snapshot, {
            power: 1.5,
            current: 2,
            voltage: 230,
            consume: 12345,
            powerFactor: 0.95
        });
    });

    it('GETs ConsumptionH and stores hourly samples when available', async () => {
        const { trait, requests } = createEnergyHarness({
            hasConsumptionX: false,
            hasConsumptionH: true
        });

        const snapshot = await trait.poll();

        assert.deepEqual(requests[1], {
            namespace: CONSUMPTIONH_NAMESPACE,
            method: 'GET',
            payload: encodeConsumptionHGet(CHANNEL)
        });
        assert.deepEqual(snapshot.hourly, [
            { timestamp: 1_701_000_000, value: 12 },
            { timestamp: 1_701_003_600, value: 15 }
        ]);
    });

    it('supports on-demand hourly polling for ConsumptionH-only devices', async () => {
        const { trait, requests } = createEnergyHarness({
            hasElectricity: false,
            hasElectricityX: false,
            hasConsumptionX: false,
            hasConsumptionH: true
        });

        const hourly = await trait.getHourlyConsumption();

        assert.deepEqual(requests, [{
            namespace: CONSUMPTIONH_NAMESPACE,
            method: 'GET',
            payload: encodeConsumptionHGet(CHANNEL)
        }]);
        assert.deepEqual(hourly, [
            { timestamp: 1_701_000_000, value: 12 },
            { timestamp: 1_701_003_600, value: 15 }
        ]);
    });
});

describe('EnergyTrait PUSH', () => {
    it('applies Electricity PUSH for the bound channel', () => {
        const { endpoint, trait } = createEnergyHarness({ hasConsumptionX: false });
        const changes: unknown[] = [];
        endpoint.on('change', (change) => changes.push(change));

        const push = electricityAck();
        push.header.method = 'PUSH';
        trait.handlePush(push);

        assert.deepEqual(changes, [
            { trait: 'energy', values: { power: 11, current: 0.05, voltage: 230, consume: 42 } }
        ]);
    });

    it('ignores Electricity PUSH for other channels', () => {
        const { endpoint, trait } = createEnergyHarness({ hasConsumptionX: false });
        const changes: unknown[] = [];
        endpoint.on('change', (change) => changes.push(change));

        const push = electricityAck(1);
        push.header.method = 'PUSH';
        trait.handlePush(push);

        assert.deepEqual(changes, []);
    });

    it('applies ConsumptionH PUSH when advertised', () => {
        const { endpoint, trait } = createEnergyHarness({
            hasConsumptionX: false,
            hasConsumptionH: true
        });
        const changes: unknown[] = [];
        endpoint.on('change', (change) => changes.push(change));

        const push = consumptionHAck();
        push.header.method = 'PUSH';
        trait.handlePush(push);

        assert.deepEqual(changes, [{
            trait: 'energy',
            values: {
                hourly: [
                    { timestamp: 1_701_000_000, value: 12 },
                    { timestamp: 1_701_003_600, value: 15 }
                ]
            }
        }]);
    });
});

describe('EnergyTrait calibration', () => {
    const configNamespaces = new Set([CONSUMPTION_CONFIG_NAMESPACE]);

    it('GETs ConsumptionConfig on demand when advertised', async () => {
        const { trait, requests } = createEnergyHarness({
            hasConsumptionX: false,
            namespaces: configNamespaces
        });

        const calibration = await trait.getCalibration();

        assert.deepEqual(requests, [{
            namespace: CONSUMPTION_CONFIG_NAMESPACE,
            method: 'GET',
            payload: encodeConsumptionConfigGet()
        }]);
        assert.deepEqual(calibration, {
            voltageRatio: 186,
            electricityRatio: 121,
            maxElectricityCurrent: 16_000
        });
    });

    it('returns undefined from getCalibration when ConsumptionConfig is absent', async () => {
        const { trait, requests } = createEnergyHarness({
            hasConsumptionX: false
        });

        const calibration = await trait.getCalibration();

        assert.equal(calibration, undefined);
        assert.equal(requests.length, 0);
    });

    it('does not emit energy values for ConsumptionConfig PUSH', () => {
        const { endpoint, trait } = createEnergyHarness({
            hasConsumptionX: false,
            namespaces: configNamespaces
        });
        const changes: unknown[] = [];
        endpoint.on('change', (change) => changes.push(change));

        const push = encodeMessage({
            namespace: CONSUMPTION_CONFIG_NAMESPACE,
            method: 'PUSH',
            key: KEY,
            from: `/appliance/${UUID}/publish`,
            uuid: UUID,
            payload: {
                config: {
                    voltageRatio: 188,
                    electricityRatio: 102,
                    maxElectricityCurrent: 11_000
                }
            }
        });
        trait.handlePush(push);

        assert.deepEqual(changes, []);
    });
});

describe('EnergyTrait over-temp', () => {
    const overTempNamespaces = new Set([
        CONFIG_OVERTEMP_NAMESPACE,
        CONTROL_OVERTEMP_NAMESPACE
    ]);

    it('SETs Config.OverTemp and emits change', async () => {
        const { endpoint, trait, requests } = createEnergyHarness({
            hasConsumptionX: false,
            namespaces: overTempNamespaces
        });
        const changes: unknown[] = [];
        endpoint.on('change', (change) => changes.push(change));

        await trait.setOverTemp(false, 2);

        assert.deepEqual(requests, [{
            namespace: CONFIG_OVERTEMP_NAMESPACE,
            method: 'SET',
            payload: encodeConfigOverTempSet({ enabled: false, type: 2 })
        }]);
        assert.deepEqual(changes, [{
            trait: 'energy',
            values: { overTempEnabled: false, overTempType: 2 }
        }]);
    });

    it('no-ops setOverTemp when Config.OverTemp is absent', async () => {
        const { trait, requests } = createEnergyHarness({ hasConsumptionX: false });

        await trait.setOverTemp(true);

        assert.equal(requests.length, 0);
    });

    it('applies Config.OverTemp GETACK/PUSH and dedupes repeats', () => {
        const { endpoint, trait } = createEnergyHarness({
            hasConsumptionX: false,
            namespaces: overTempNamespaces
        });
        const changes: unknown[] = [];
        endpoint.on('change', (change) => changes.push(change));

        const push = encodeMessage({
            namespace: CONFIG_OVERTEMP_NAMESPACE,
            method: 'PUSH',
            key: KEY,
            from: `/appliance/${UUID}/publish`,
            uuid: UUID,
            payload: { overTemp: { enable: 1, type: 1 } }
        });
        trait.handlePush(push);
        trait.handlePush(push);

        assert.deepEqual(changes, [{
            trait: 'energy',
            values: { overTempEnabled: true, overTempType: 1 }
        }]);
    });

    it('applies Control.OverTemp PUSH for the bound channel only', () => {
        const { endpoint, trait } = createEnergyHarness({
            hasConsumptionX: false,
            namespaces: overTempNamespaces
        });
        const changes: unknown[] = [];
        endpoint.on('change', (change) => changes.push(change));

        trait.handlePush(encodeMessage({
            namespace: CONTROL_OVERTEMP_NAMESPACE,
            method: 'PUSH',
            key: KEY,
            from: `/appliance/${UUID}/publish`,
            uuid: UUID,
            payload: {
                overTemp: [{
                    channel: 1,
                    value: 1,
                    timestamp: 99,
                    type: 1
                }]
            }
        }));
        assert.deepEqual(changes, []);

        trait.handlePush(encodeMessage({
            namespace: CONTROL_OVERTEMP_NAMESPACE,
            method: 'SET',
            key: KEY,
            from: `/appliance/${UUID}/publish`,
            uuid: UUID,
            payload: {
                overTemp: {
                    value: 1,
                    timestamp: 42,
                    type: 1
                }
            }
        }));
        assert.deepEqual(changes, [{
            trait: 'energy',
            values: { overTempActive: true, overTempTimestamp: 42 }
        }]);
    });

    it('ignores OverTemp PUSH when uuid does not match', () => {
        const { endpoint, trait } = createEnergyHarness({
            hasConsumptionX: false,
            namespaces: overTempNamespaces
        });
        const changes: unknown[] = [];
        endpoint.on('change', (change) => changes.push(change));

        trait.handlePush(encodeMessage({
            namespace: CONFIG_OVERTEMP_NAMESPACE,
            method: 'PUSH',
            key: KEY,
            from: '/appliance/other/publish',
            uuid: 'other',
            payload: { overTemp: { enable: 1, type: 1 } }
        }));

        assert.deepEqual(changes, []);
    });
});

describe('EnergyTrait alert config', () => {
    const alertNamespaces = new Set([
        CONTROL_ALERT_CONFIG_NAMESPACE,
        CONTROL_ALERT_REPORT_NAMESPACE
    ]);

    it('SETs AlertConfig and emits change', async () => {
        const { endpoint, trait, requests } = createEnergyHarness({
            hasConsumptionX: false,
            namespaces: alertNamespaces
        });
        const changes: unknown[] = [];
        endpoint.on('change', (change) => changes.push(change));

        const value = { em06: { threshold: 10 } };
        await trait.setAlertConfig({ type: 1, value });

        assert.deepEqual(requests, [{
            namespace: CONTROL_ALERT_CONFIG_NAMESPACE,
            method: 'SET',
            payload: encodeAlertConfigSet({ channel: CHANNEL, type: 1, value })
        }]);
        assert.deepEqual(changes, [{
            trait: 'energy',
            values: { alertConfigType: 1, alertConfig: value }
        }]);
    });

    it('no-ops setAlertConfig when AlertConfig is absent', async () => {
        const { trait, requests } = createEnergyHarness({ hasConsumptionX: false });
        await trait.setAlertConfig({ type: 1 });
        assert.equal(requests.length, 0);
    });

    it('applies AlertConfig PUSH for the bound channel and dedupes', () => {
        const { endpoint, trait } = createEnergyHarness({
            hasConsumptionX: false,
            namespaces: alertNamespaces
        });
        const changes: unknown[] = [];
        endpoint.on('change', (change) => changes.push(change));

        const push = encodeMessage({
            namespace: CONTROL_ALERT_CONFIG_NAMESPACE,
            method: 'PUSH',
            key: KEY,
            from: `/appliance/${UUID}/publish`,
            uuid: UUID,
            payload: {
                config: [{ channel: CHANNEL, type: 3, value: { em06: { a: 1 } } }]
            }
        });
        trait.handlePush(push);
        trait.handlePush(push);

        assert.deepEqual(changes, [{
            trait: 'energy',
            values: { alertConfigType: 3, alertConfig: { em06: { a: 1 } } }
        }]);
    });

    it('applies AlertReport PUSH and ignores malformed payloads', () => {
        const { endpoint, trait } = createEnergyHarness({
            hasConsumptionX: false,
            namespaces: alertNamespaces
        });
        const changes: unknown[] = [];
        endpoint.on('change', (change) => changes.push(change));

        trait.handlePush(encodeMessage({
            namespace: CONTROL_ALERT_REPORT_NAMESPACE,
            method: 'PUSH',
            key: KEY,
            from: `/appliance/${UUID}/publish`,
            uuid: UUID,
            payload: { alert: { not: 'a list' } }
        }));
        assert.deepEqual(changes, []);

        trait.handlePush(encodeMessage({
            namespace: CONTROL_ALERT_REPORT_NAMESPACE,
            method: 'PUSH',
            key: KEY,
            from: `/appliance/${UUID}/publish`,
            uuid: UUID,
            payload: { alert: [{ channel: CHANNEL, code: 4 }] }
        }));
        assert.deepEqual(changes, [{
            trait: 'energy',
            values: { alertReport: { code: 4 } }
        }]);
    });
});

describe('EnergyTrait consumption delete', () => {
    it('DELETEs ConsumptionX records and clears local consumption', async () => {
        const { endpoint, trait, requests } = createEnergyHarness();
        const changes: Array<{ trait: string; values: EnergyValues }> = [];
        endpoint.on('change', (change) => changes.push(change));
        await trait.poll();
        requests.length = 0;
        changes.length = 0;

        await trait.deleteConsumption();

        assert.deepEqual(requests, [{
            namespace: CONSUMPTIONX_NAMESPACE,
            method: 'DELETE',
            payload: encodeConsumptionXDelete()
        }]);
        assert.deepEqual(changes, [{
            trait: 'energy',
            values: { consumption: [] }
        }]);
    });

    it('no-ops deleteConsumption when ConsumptionX is absent', async () => {
        const { trait, requests } = createEnergyHarness({
            hasElectricity: false,
            hasConsumptionX: false
        });

        await trait.deleteConsumption();

        assert.equal(requests.length, 0);
    });
});

describe('EnergyTrait standby killer', () => {
    const namespaces = new Set([CONFIG_STANDBY_KILLER_NAMESPACE]);

    it('SETs StandbyKiller thresholds and emits change', async () => {
        const { endpoint, trait, requests } = createEnergyHarness({
            hasConsumptionX: false,
            namespaces
        });
        const changes: unknown[] = [];
        endpoint.on('change', (change) => changes.push(change));

        await trait.setStandbyKiller({
            enabled: true,
            power: 5,
            time: 300,
            alert: false
        });

        assert.deepEqual(requests, [{
            namespace: CONFIG_STANDBY_KILLER_NAMESPACE,
            method: 'SET',
            payload: encodeStandbyKillerSet({
                channel: CHANNEL,
                enabled: true,
                power: 5,
                time: 300,
                alert: false
            })
        }]);
        assert.deepEqual(changes, [{
            trait: 'energy',
            values: {
                standbyKillerEnabled: true,
                standbyKillerPower: 5,
                standbyKillerTime: 300,
                standbyKillerAlert: false
            }
        }]);
    });

    it('no-ops setStandbyKiller when StandbyKiller is absent', async () => {
        const { trait, requests } = createEnergyHarness({ hasConsumptionX: false });
        await trait.setStandbyKiller({ enabled: true, power: 1 });
        assert.equal(requests.length, 0);
    });

    it('applies StandbyKiller PUSH for the bound channel and dedupes', () => {
        const { endpoint, trait } = createEnergyHarness({
            hasConsumptionX: false,
            namespaces
        });
        const changes: unknown[] = [];
        endpoint.on('change', (change) => changes.push(change));

        const push = encodeMessage({
            namespace: CONFIG_STANDBY_KILLER_NAMESPACE,
            method: 'PUSH',
            key: KEY,
            from: `/appliance/${UUID}/publish`,
            uuid: UUID,
            payload: {
                config: [{
                    channel: CHANNEL,
                    power: 0,
                    time: 300,
                    enable: 2,
                    alert: 2
                }]
            }
        });
        trait.handlePush(push);
        trait.handlePush(push);

        assert.deepEqual(changes, [{
            trait: 'energy',
            values: {
                standbyKillerEnabled: false,
                standbyKillerPower: 0,
                standbyKillerTime: 300,
                standbyKillerAlert: false
            }
        }]);
    });

    it('applies StandbyKiller PUSH for the bound channel only', () => {
        const { endpoint, trait } = createEnergyHarness({
            hasConsumptionX: false,
            namespaces
        });
        const changes: unknown[] = [];
        endpoint.on('change', (change) => changes.push(change));

        trait.handlePush(encodeMessage({
            namespace: CONFIG_STANDBY_KILLER_NAMESPACE,
            method: 'PUSH',
            key: KEY,
            from: `/appliance/${UUID}/publish`,
            uuid: UUID,
            payload: {
                config: [{
                    channel: 1,
                    power: 1000,
                    time: 60,
                    enable: 1,
                    alert: 1
                }]
            }
        }));
        assert.deepEqual(changes, []);
    });

    it('ignores StandbyKiller PUSH when uuid does not match', () => {
        const { endpoint, trait } = createEnergyHarness({
            hasConsumptionX: false,
            namespaces
        });
        const changes: unknown[] = [];
        endpoint.on('change', (change) => changes.push(change));

        trait.handlePush(encodeMessage({
            namespace: CONFIG_STANDBY_KILLER_NAMESPACE,
            method: 'PUSH',
            key: KEY,
            from: '/appliance/other/publish',
            uuid: 'other',
            payload: {
                config: [{
                    channel: CHANNEL,
                    power: 1000,
                    time: 60,
                    enable: 1,
                    alert: 1
                }]
            }
        }));

        assert.deepEqual(changes, []);
    });
});
