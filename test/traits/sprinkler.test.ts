import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CommandError } from '../../src/errors';
import { Endpoint } from '../../src/endpoint';
import {
    CONTROL_WATER_EVENT_NAMESPACE,
    CONTROL_WATER_NAMESPACE,
    DEVICE_CFG_NAMESPACE,
    HUB_EXCEPTION_NAMESPACE,
    HUB_SUBDEVICE_VERSION_NAMESPACE,
    HUB_TOGGLEX_NAMESPACE,
    WATER_PLAN_NAMESPACE,
    encodeMessage,
    type MerossMessage
} from '../../src/protocol';
import { SprinklerTrait } from '../../src/traits/sprinkler';
import type { SprinklerTraitBind } from '../../src/traits/sprinkler';

const KEY = 'stub-key';
const UUID = '2206138957096651080248e1e99705a4';
const SUB_DEVICE_ID = 'aabbcc';

const SPRINKLER_NAMESPACES = new Set([
    CONTROL_WATER_NAMESPACE,
    DEVICE_CFG_NAMESPACE,
    WATER_PLAN_NAMESPACE
]);

function createHarness(
    getAckByNamespace: Record<string, Record<string, unknown>> = {},
    namespaces: ReadonlySet<string> = SPRINKLER_NAMESPACES,
    harnessOptions: {
        errorByNamespace?: Record<string, CommandError>;
    } = {}
): {
    endpoint: Endpoint;
    trait: SprinklerTrait;
    requests: MerossMessage[];
    changes: Record<string, unknown>[];
} {
    const requests: MerossMessage[] = [];
    const changes: Record<string, unknown>[] = [];
    const endpoint = new Endpoint({ id: `${UUID}#${SUB_DEVICE_ID}`, traits: ['sprinkler'] });
    const bind: SprinklerTraitBind = {
        uuid: UUID,
        subDeviceId: SUB_DEVICE_ID,
        namespaces,
        request: async (requestOptions) => {
            const message = encodeMessage({
                namespace: requestOptions.namespace,
                method: requestOptions.method,
                key: KEY,
                from: '/app/test/subscribe',
                payload: requestOptions.payload,
                uuid: UUID
            });
            requests.push(message);
            const error = harnessOptions.errorByNamespace?.[requestOptions.namespace];
            if (error) {
                throw error;
            }
            return encodeMessage({
                namespace: requestOptions.namespace,
                method: 'GETACK',
                key: KEY,
                from: `/appliance/${UUID}/publish`,
                messageId: message.header.messageId,
                uuid: UUID,
                payload: getAckByNamespace[requestOptions.namespace] ?? {}
            });
        },
        emitChange: (values) => {
            changes.push({ ...values });
            endpoint.emit('change', { trait: 'sprinkler', values: { ...values } });
        }
    };
    return { endpoint, trait: new SprinklerTrait(bind), requests, changes };
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

describe('SprinklerTrait', () => {
    it('setOn uses Control.Water onoff 1/2 and never Hub.ToggleX', async () => {
        const { trait, requests } = createHarness();
        await trait.setOn(true);
        await trait.setOn(false);

        assert.equal(requests.length, 2);
        for (const message of requests) {
            assert.equal(message.header.namespace, CONTROL_WATER_NAMESPACE);
            assert.equal(message.header.method, 'SET');
            assert.notEqual(message.header.namespace, HUB_TOGGLEX_NAMESPACE);
        }
        assert.deepEqual(
            (requests[0]?.payload as { control: Array<{ onoff: number }> }).control[0]?.onoff,
            1
        );
        assert.deepEqual(
            (requests[1]?.payload as { control: Array<{ onoff: number }> }).control[0]?.onoff,
            2
        );
        assert.equal(trait.isOn(), false);
    });

    it('setDuration writes DeviceCfg mstCfg.dura in seconds', async () => {
        const { trait, requests } = createHarness();
        await trait.setDuration(5400);

        assert.equal(requests.length, 1);
        assert.equal(requests[0]?.header.namespace, DEVICE_CFG_NAMESPACE);
        assert.deepEqual(requests[0]?.payload, {
            config: [{ subId: SUB_DEVICE_ID, channel: 0, mstCfg: { dura: 5400 } }]
        });
        assert.equal(trait.getDuration(), 5400);
    });

    it('handlePush applies Control.Water for this subId only', () => {
        const { trait, changes } = createHarness();
        trait.handlePush(pushMessage(CONTROL_WATER_NAMESPACE, {
            control: [
                { channel: 0, subId: SUB_DEVICE_ID, onoff: 1, dura: 900 },
                { channel: 0, subId: 'other-id', onoff: 2 }
            ]
        }));

        assert.equal(trait.isOn(), true);
        assert.deepEqual(changes, [{ on: true, duration: 900 }]);
    });

    it('getSchedule returns rows for this subId via Config.WaterPlan', async () => {
        const { trait, requests } = createHarness({
            [WATER_PLAN_NAMESPACE]: {
                config: [
                    {
                        channel: 0,
                        subId: SUB_DEVICE_ID,
                        enable: 1,
                        week: 127,
                        time: 360,
                        dura: 900
                    },
                    {
                        channel: 0,
                        subId: 'other-id',
                        enable: 0
                    }
                ]
            }
        });

        const schedule = await trait.getSchedule();
        assert.equal(requests.length, 1);
        assert.equal(requests[0]?.header.namespace, WATER_PLAN_NAMESPACE);
        assert.equal(requests[0]?.header.method, 'GET');
        assert.deepEqual(requests[0]?.payload, {
            config: [{ subId: SUB_DEVICE_ID, channel: 0 }]
        });
        assert.deepEqual(schedule, [{
            subId: SUB_DEVICE_ID,
            channel: 0,
            schedule: { enable: 1, week: 127, time: 360, dura: 900 }
        }]);
    });

    it('getSchedule returns undefined when Ability lacks Config.WaterPlan', async () => {
        const { trait, requests } = createHarness({}, new Set([CONTROL_WATER_NAMESPACE]));
        assert.equal(await trait.getSchedule(), undefined);
        assert.equal(requests.length, 0);
    });

    it('getSchedule treats device error 5000 as unsupported', async () => {
        const { trait } = createHarness({}, SPRINKLER_NAMESPACES, {
            errorByNamespace: {
                [WATER_PLAN_NAMESPACE]: new CommandError(
                    'Device returned error: {"error":{"code":5000}}',
                    'COMMAND_FAILED',
                    5000
                )
            }
        });
        assert.equal(await trait.getSchedule(), undefined);
    });

    it('setSchedule writes Config.WaterPlan and no-ops without Ability', async () => {
        const entries = [{
            subId: SUB_DEVICE_ID,
            channel: 0,
            schedule: { enable: 1, week: 1, time: 0, dura: 600 }
        }];
        const withAbility = createHarness();
        assert.deepEqual(await withAbility.trait.setSchedule(entries), entries);
        assert.equal(withAbility.requests[0]?.header.namespace, WATER_PLAN_NAMESPACE);
        assert.equal(withAbility.requests[0]?.header.method, 'SET');
        assert.deepEqual(withAbility.requests[0]?.payload, {
            config: [{
                subId: SUB_DEVICE_ID,
                channel: 0,
                enable: 1,
                week: 1,
                time: 0,
                dura: 600
            }]
        });

        const without = createHarness({}, new Set([CONTROL_WATER_NAMESPACE]));
        assert.equal(await without.trait.setSchedule(entries), undefined);
        assert.equal(without.requests.length, 0);
    });

    it('applies fault and firmware/hardware versions from hub diagnostics PUSH', () => {
        const { trait, changes } = createHarness({}, new Set([
            ...SPRINKLER_NAMESPACES,
            HUB_EXCEPTION_NAMESPACE,
            HUB_SUBDEVICE_VERSION_NAMESPACE
        ]));
        trait.handlePush(pushMessage(HUB_EXCEPTION_NAMESPACE, {
            exception: [{ id: SUB_DEVICE_ID, code: 5061 }]
        }));
        trait.handlePush(pushMessage(HUB_SUBDEVICE_VERSION_NAMESPACE, {
            version: [{ id: SUB_DEVICE_ID, hardware: '1.1.5', firmware: '5.1.8' }]
        }));
        assert.equal(changes[0].fault, 5061);
        assert.equal(changes[1].firmwareVersion, '5.1.8');
        assert.equal(changes[1].hardwareVersion, '1.1.5');
    });

    it('handlePush emits lastCycle from Control.WaterEvent for this subId only', () => {
        const { trait, changes } = createHarness({}, new Set([
            ...SPRINKLER_NAMESPACES,
            CONTROL_WATER_EVENT_NAMESPACE
        ]));
        trait.handlePush(pushMessage(CONTROL_WATER_EVENT_NAMESPACE, {
            control: [
                {
                    channel: 0,
                    subId: SUB_DEVICE_ID,
                    dura: 900,
                    waCon: 12,
                    timestamp: 1_724_000_000
                },
                {
                    channel: 0,
                    subId: 'other-id',
                    dura: 60,
                    timestamp: 1_724_000_100
                }
            ]
        }));

        assert.deepEqual(changes, [{
            lastCycle: {
                duration: 900,
                waterConsumption: 12,
                timestamp: 1_724_000_000
            }
        }]);
    });

    it('dedupes identical Control.WaterEvent cycle summaries', () => {
        const { trait, changes } = createHarness({}, new Set([
            ...SPRINKLER_NAMESPACES,
            CONTROL_WATER_EVENT_NAMESPACE
        ]));
        const payload = {
            control: [{
                channel: 0,
                subId: SUB_DEVICE_ID,
                dura: 600,
                timestamp: 1_724_000_000
            }]
        };
        trait.handlePush(pushMessage(CONTROL_WATER_EVENT_NAMESPACE, payload));
        trait.handlePush(pushMessage(CONTROL_WATER_EVENT_NAMESPACE, payload));
        assert.equal(changes.length, 1);
    });

    it('ignores Control.WaterEvent PUSH when uuid does not match the bind', () => {
        const { trait, changes } = createHarness({}, new Set([
            ...SPRINKLER_NAMESPACES,
            CONTROL_WATER_EVENT_NAMESPACE
        ]));
        trait.handlePush(encodeMessage({
            namespace: CONTROL_WATER_EVENT_NAMESPACE,
            method: 'PUSH',
            key: KEY,
            from: '/appliance/other/publish',
            uuid: 'other',
            payload: { control: [{ subId: SUB_DEVICE_ID, dura: 60, timestamp: 1 }] }
        }));
        assert.equal(changes.length, 0);
    });

    it('ignores Control.WaterEvent when Ability lacks the namespace', () => {
        const { trait, changes } = createHarness({}, SPRINKLER_NAMESPACES);
        trait.handlePush(pushMessage(CONTROL_WATER_EVENT_NAMESPACE, {
            control: [{ subId: SUB_DEVICE_ID, dura: 60, timestamp: 1 }]
        }));
        assert.equal(changes.length, 0);
    });
});
