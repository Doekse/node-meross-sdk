import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import type { CloudDevice, CloudSubDevice } from '../../src/cloud';
import { ProtocolError } from '../../src/errors';
import { Inventory } from '../../src/inventory';
import {
    DeviceGraph,
    abilityMaxCmdNum,
    decodeAbilityGetAck,
    decodeSystemAllGetAck,
    enrollPhysicalDevice
} from '../../src/graph';
import { decodeMessage } from '../../src/protocol/message';
import type { MerossPayload } from '../../src/protocol/message';

const fixturesDir = join(process.cwd(), 'test/fixtures');
const UUID = '2206138957096651080248e1e99705a4';
const HUB_UUID = '9109182170548290880048b1a9522933';

function loadFixture(name: string) {
    return decodeMessage(
        JSON.parse(readFileSync(join(fixturesDir, name), 'utf8')) as unknown
    );
}

function payload(name: string): MerossPayload {
    return loadFixture(name).payload;
}

function socketAbility(extra: Record<string, Record<string, unknown>> = {}): MerossPayload {
    return {
        payloadVersion: 1,
        ability: {
            'Appliance.Control.ToggleX': {},
            'Appliance.Control.Multiple': { maxCmdNum: 5 },
            ...extra
        }
    };
}

function systemAllWithDigest(digest: Record<string, unknown>): MerossPayload {
    const all = payload('system-all-getack.json');
    const body = all.all as Record<string, unknown>;
    return {
        all: {
            ...body,
            digest
        }
    };
}

describe('Ability GETACK', () => {
    it('decodes the firmware ability map including Multiple.maxCmdNum', () => {
        const ability = decodeAbilityGetAck(payload('ability-getack.json'));
        assert.deepEqual(ability['Appliance.Control.Bind'], {});
        assert.equal(abilityMaxCmdNum(ability), 3);
        assert.throws(
            () => decodeAbilityGetAck({}),
            (err: unknown) => err instanceof ProtocolError
        );
    });
});

describe('System.All GETACK', () => {
    it('decodes firmware system, online, and digest.togglex channels', () => {
        const all = decodeSystemAllGetAck(payload('system-all-getack.json'));
        assert.equal(all.hardware.uuid, UUID);
        assert.equal(all.hardware.type, 'mss110');
        assert.equal(all.online.status, 1);
        assert.equal(all.firmware.innerIp, '192.168.201.190');
        assert.deepEqual(all.digest.togglex, [{ channel: 0, on: true }]);
        assert.throws(
            () => decodeSystemAllGetAck({}),
            (err: unknown) => err instanceof ProtocolError
        );
    });
});

describe('enrollPhysicalDevice', () => {
    it('binds a single-channel ToggleX board as one socket endpoint', () => {
        const device = enrollPhysicalDevice({
            abilityPayload: socketAbility({
                'Appliance.Control.Electricity': {},
                'Appliance.Control.ConsumptionX': {}
            }),
            allPayload: payload('system-all-getack.json'),
            cloud: {
                uuid: UUID,
                devName: 'Kitchen plug',
                deviceType: 'mss110',
                onlineStatus: 1,
                channels: [{ channel: 0, devName: 'Kitchen plug' }]
            }
        });

        assert.equal(device.uuid, UUID);
        assert.equal(device.maxCmdNum, 5);
        assert.equal(device.innerIp, '192.168.201.190');
        assert.equal(device.endpoints.length, 1);
        const [endpoint] = device.endpoints;
        assert.equal(endpoint?.id, `${UUID}:0`);
        assert.equal(endpoint?.channel, 0);
        assert.equal(endpoint?.name, 'Kitchen plug');
        assert.equal(endpoint?.model, 'mss110');
        assert.equal(endpoint?.classHint, 'socket');
        assert.deepEqual(endpoint?.traits, ['switch', 'energy']);
        assert.equal(endpoint?.online, true);
        assert.equal(endpoint?.on, true);
        assert.equal(endpoint?.parentId, undefined);
    });

    it('turns a 4-gang ToggleX digest into four switch endpoints and skips master 0', () => {
        const strip = loadFixture('togglex-getack-all.json');
        const device = enrollPhysicalDevice({
            abilityPayload: socketAbility(),
            allPayload: systemAllWithDigest({ togglex: strip.payload.togglex }),
            cloud: {
                uuid: UUID,
                devName: 'Strip',
                deviceType: 'mss425f',
                onlineStatus: 1,
                channels: [
                    { devName: 'Strip' },
                    { devName: 'Outlet 1', type: 'MSS425E' },
                    { devName: 'Outlet 2', type: 'MSS425E' },
                    { devName: 'Outlet 3', type: 'MSS425E' },
                    { devName: 'Outlet 4', type: 'MSS425E' }
                ]
            }
        });

        assert.deepEqual(
            device.endpoints.map((endpoint) => ({
                id: endpoint.id,
                channel: endpoint.channel,
                name: endpoint.name,
                classHint: endpoint.classHint,
                traits: [...endpoint.traits]
            })),
            [1, 2, 3, 4].map((channel) => ({
                id: `${UUID}:${channel}`,
                channel,
                name: `Outlet ${channel}`,
                classHint: 'socket',
                traits: ['switch']
            }))
        );
    });

    it('keeps both channels on a 2-gang wall switch', () => {
        const device = enrollPhysicalDevice({
            abilityPayload: socketAbility(),
            allPayload: systemAllWithDigest({
                togglex: [
                    { channel: 0, onoff: 1 },
                    { channel: 1, onoff: 0 }
                ]
            })
        });

        assert.deepEqual(
            device.endpoints.map((endpoint) => endpoint.id),
            [`${UUID}:0`, `${UUID}:1`]
        );
        assert.equal(device.endpoints[0]?.classHint, 'socket');
        assert.equal(device.endpoints[0]?.on, true);
        assert.equal(device.endpoints[1]?.on, false);
    });

    it('enrolls multi-channel roller shutter from digest.rollerShutter', () => {
        const device = enrollPhysicalDevice({
            abilityPayload: {
                ability: {
                    'Appliance.RollerShutter.Position': {},
                    'Appliance.RollerShutter.State': {},
                    'Appliance.Control.Multiple': { maxCmdNum: 5 }
                }
            },
            allPayload: systemAllWithDigest({
                rollerShutter: [{ channel: 0 }, { channel: 1 }]
            })
        });

        assert.equal(device.endpoints.length, 2);
        assert.equal(device.endpoints[0]?.classHint, 'cover');
        assert.deepEqual(device.endpoints[0]?.traits, ['cover']);
        assert.equal(device.endpoints[0]?.channel, 0);
        assert.equal(device.endpoints[1]?.channel, 1);
    });

    it('sets classHint light when Control.Light is in Ability', () => {
        const device = enrollPhysicalDevice({
            abilityPayload: {
                ability: {
                    'Appliance.Control.Light': {},
                    'Appliance.Control.ToggleX': {}
                }
            },
            allPayload: systemAllWithDigest({
                light: [{ channel: 0 }],
                togglex: [{ channel: 0, onoff: 1 }]
            })
        });

        assert.equal(device.endpoints.length, 1);
        assert.equal(device.endpoints[0]?.classHint, 'light');
        assert.deepEqual(device.endpoints[0]?.traits, ['light']);
        assert.equal(device.endpoints[0]?.id, `${UUID}:0`);
    });

    it('enrolls a presence board as classHint sensor with the presence trait', () => {
        const device = enrollPhysicalDevice({
            abilityPayload: {
                ability: {
                    'Appliance.Control.Presence.Config': {},
                    'Appliance.Control.Sensor.LatestX': {},
                    'Appliance.Control.Multiple': { maxCmdNum: 5 }
                }
            },
            allPayload: systemAllWithDigest({})
        });
        assert.equal(device.endpoints.length, 1);
        assert.equal(device.endpoints[0]?.classHint, 'sensor');
        assert.deepEqual(device.endpoints[0]?.traits, ['presence']);
    });

    it('enrolls hub children as uuid#subdevice with parentId metadata', () => {
        const cloud: CloudDevice = {
            uuid: HUB_UUID,
            devName: 'Hall hub',
            deviceType: 'msh300',
            onlineStatus: 1,
            channels: []
        };
        const subDevices: CloudSubDevice[] = [
            {
                subDeviceId: '01008C11',
                subDeviceType: 'mts100v3',
                subDeviceName: 'Radiator'
            },
            {
                subDeviceId: '120027D21C19',
                subDeviceType: 'ms130',
                subDeviceName: 'Hall sensor'
            }
        ];
        const device = enrollPhysicalDevice({
            abilityPayload: {
                ability: {
                    'Appliance.Hub.SubdeviceList': {},
                    'Appliance.Control.Multiple': { maxCmdNum: 5 }
                }
            },
            allPayload: {
                all: {
                    system: {
                        hardware: {
                            type: 'msh300',
                            uuid: HUB_UUID,
                            macAddress: 'aa:bb:cc:dd:ee:ff'
                        },
                        firmware: { innerIp: '10.0.0.1' },
                        online: { status: 1 }
                    },
                    digest: {
                        hub: {
                            hubId: -381895630,
                            mode: 0,
                            subdevice: [
                                { id: '120027D21C19', status: 2 },
                                {
                                    id: '01008C11',
                                    status: 1,
                                    scheduleBMode: 6,
                                    onoff: 1,
                                    lastActiveTime: 1638365524,
                                    mts100v3: { mode: 0 }
                                }
                            ]
                        }
                    }
                }
            },
            cloud,
            subDevices
        });

        assert.equal(device.endpoints.length, 3);
        const hub = device.endpoints[0];
        assert.equal(hub?.id, HUB_UUID);
        assert.equal(hub?.classHint, 'hub');
        assert.deepEqual(hub?.traits, []);
        assert.equal(hub?.name, 'Hall hub');

        const valve = device.endpoints.find((endpoint) => endpoint.subDeviceId === '01008C11');
        assert.equal(valve?.id, `${HUB_UUID}#01008C11`);
        assert.equal(valve?.parentId, HUB_UUID);
        assert.equal(valve?.classHint, 'climate');
        assert.deepEqual(valve?.traits, ['climate']);
        assert.equal(valve?.name, 'Radiator');
        assert.equal(valve?.online, true);

        const sensor = device.endpoints.find((endpoint) => endpoint.subDeviceId === '120027D21C19');
        assert.equal(sensor?.id, `${HUB_UUID}#120027D21C19`);
        assert.equal(sensor?.parentId, HUB_UUID);
        assert.equal(sensor?.classHint, 'sensor');
        assert.deepEqual(sensor?.traits, ['sensor']);
        assert.equal(sensor?.name, 'Hall sensor');
        assert.equal(sensor?.online, false);
    });

    it('enrolls mst100 sprinklers as unpaired sprinkler children', () => {
        const device = enrollPhysicalDevice({
            abilityPayload: {
                ability: { 'Appliance.Hub.SubdeviceList': {} }
            },
            allPayload: {
                all: {
                    system: {
                        hardware: { type: 'msh300', uuid: HUB_UUID },
                        firmware: {},
                        online: { status: 1 }
                    },
                    digest: {
                        hub: {
                            subdevice: [{ id: 'aabbcc', status: 1, type: 'mst100' }]
                        }
                    }
                }
            },
            subDevices: [{ subDeviceId: 'aabbcc', subDeviceType: 'mst100', subDeviceName: 'Garden' }]
        });
        const child = device.endpoints.find((endpoint) => endpoint.subDeviceId === 'aabbcc');
        assert.equal(child?.classHint, 'sprinkler');
        assert.deepEqual(child?.traits, []);
        assert.equal(child?.name, 'Garden');
    });
});

describe('DeviceGraph and Inventory', () => {
    it('projects pairing rows and keeps ids stable across re-enroll', () => {
        const graph = new DeviceGraph();
        const first = graph.enroll({
            abilityPayload: socketAbility(),
            allPayload: payload('system-all-getack.json')
        });
        const id = first.endpoints[0]?.id;
        assert.equal(graph.getEndpoint(id!)?.channel, 0);

        graph.enroll({
            abilityPayload: socketAbility({ 'Appliance.Control.Electricity': {} }),
            allPayload: payload('system-all-getack.json'),
            cloud: {
                uuid: UUID,
                devName: 'Kitchen plug',
                deviceType: 'mss110',
                onlineStatus: 1,
                channels: []
            }
        });

        const rows = graph.inventoryRows();
        assert.equal(rows.length, 1);
        assert.equal(rows[0]?.id, id);
        assert.equal(rows[0]?.name, 'Kitchen plug');
        assert.deepEqual(rows[0]?.traits, ['switch', 'energy']);

        const inventory = new Inventory(rows);
        const copy = inventory.endpoints();
        assert.deepEqual(copy, rows);
        (copy[0] as { name: string }).name = 'mutated';
        (copy[0]!.traits as string[]).push('light');
        assert.equal(inventory.endpoints()[0]?.name, 'Kitchen plug');
        assert.deepEqual(inventory.endpoints()[0]?.traits, ['switch', 'energy']);
    });

    it('starts empty so Session can exist before connect', () => {
        assert.deepEqual(new Inventory().endpoints(), []);
    });
});
