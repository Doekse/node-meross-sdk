import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, type TestContext } from 'node:test';

import { Endpoint } from '../../src/endpoint';
import {
    CONSUMPTIONH_NAMESPACE,
    CONSUMPTIONX_NAMESPACE,
    ELECTRICITY_NAMESPACE,
    ELECTRICITYX_NAMESPACE,
    encodeConsumptionHGet,
    decodeMessage,
    encodeConsumptionXGet,
    encodeElectricityGet,
    encodeElectricityXGet,
    encodeMessage,
    type MerossMessage
} from '../../src/protocol';
import {
    DEFAULT_CONSUMPTION_INTERVAL_MS,
    DEFAULT_ELECTRICITY_INTERVAL_MS,
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
    electricityIntervalMs?: number;
    consumptionIntervalMs?: number;
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
        electricityIntervalMs: options.electricityIntervalMs ?? DEFAULT_ELECTRICITY_INTERVAL_MS,
        consumptionIntervalMs: options.consumptionIntervalMs ?? DEFAULT_CONSUMPTION_INTERVAL_MS,
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
                return consumptionAck();
            }
            if (opts.namespace === CONSUMPTIONH_NAMESPACE) {
                return consumptionHAck();
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

    it('supports on-demand hourly polling for ConsumptionH-only boards', async () => {
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

describe('EnergyTrait polling timers', () => {
    it('polls electricity on start and again after each interval', async (t: TestContext) => {
        t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
        const { trait, requests } = createEnergyHarness({
            hasConsumptionX: false,
            electricityIntervalMs: 1_000
        });
        t.after(() => trait.stop());

        trait.start();
        await Promise.resolve();
        await Promise.resolve();

        assert.equal(
            requests.filter((r) => r.namespace === ELECTRICITY_NAMESPACE).length,
            1
        );

        t.mock.timers.tick(1_000);
        await Promise.resolve();
        await Promise.resolve();
        assert.equal(
            requests.filter((r) => r.namespace === ELECTRICITY_NAMESPACE).length,
            2
        );

        t.mock.timers.tick(1_000);
        await Promise.resolve();
        await Promise.resolve();
        assert.equal(
            requests.filter((r) => r.namespace === ELECTRICITY_NAMESPACE).length,
            3
        );

        trait.stop();
        t.mock.timers.tick(5_000);
        await Promise.resolve();
        assert.equal(
            requests.filter((r) => r.namespace === ELECTRICITY_NAMESPACE).length,
            3
        );
    });

    it('polls ConsumptionX on interval when advertised', async (t: TestContext) => {
        t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
        const { trait, requests } = createEnergyHarness({
            hasElectricity: false,
            hasElectricityX: false,
            consumptionIntervalMs: 1_000
        });
        t.after(() => trait.stop());

        trait.start();
        await Promise.resolve();
        await Promise.resolve();

        assert.equal(
            requests.filter((r) => r.namespace === CONSUMPTIONX_NAMESPACE).length,
            1
        );

        t.mock.timers.tick(1_000);
        await Promise.resolve();
        await Promise.resolve();

        assert.equal(
            requests.filter((r) => r.namespace === CONSUMPTIONX_NAMESPACE).length,
            2
        );
    });

    it('polls ConsumptionH on interval when ConsumptionX is absent', async (t: TestContext) => {
        t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
        const { trait, requests } = createEnergyHarness({
            hasElectricity: false,
            hasElectricityX: false,
            hasConsumptionX: false,
            hasConsumptionH: true,
            consumptionIntervalMs: 1_000
        });
        t.after(() => trait.stop());

        trait.start();
        await Promise.resolve();
        await Promise.resolve();

        assert.equal(
            requests.filter((r) => r.namespace === CONSUMPTIONH_NAMESPACE).length,
            1
        );

        t.mock.timers.tick(1_000);
        await Promise.resolve();
        await Promise.resolve();

        assert.equal(
            requests.filter((r) => r.namespace === CONSUMPTIONH_NAMESPACE).length,
            2
        );
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
