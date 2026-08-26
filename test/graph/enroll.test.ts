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
        assert.equal(all.hardware.subType, 'us');
        assert.equal(all.hardware.version, '7.0.0');
        assert.equal(all.hardware.chipType, 'rtl8710cm');
        assert.equal(all.online.status, 1);
        assert.equal(all.firmware.innerIp, '192.168.201.190');
        assert.equal(all.firmware.version, '7.3.13');
        assert.equal(all.firmware.compileTime, '2022/11/16-11:31:53');
        assert.equal(all.firmware.server, 'test-mqtt-ap-cluster2.meross.com');
        assert.equal(all.firmware.port, 443);
        assert.equal(all.firmware.wifiMac, 'fc:83:c6:80:7f:76');
        assert.equal(all.firmware.userId, 10500882);
        assert.equal(all.firmware.homekitVersion, '4.1');
        assert.equal(all.firmware.encrypt, 1);
        assert.deepEqual(all.time, {
            timestamp: 1676428765,
            timezone: 'Asia/Shanghai',
            timeRule: [[684860400, 28800, 0]]
        });
        assert.deepEqual(all.digest.togglex, [{ channel: 0, on: true }]);
        assert.throws(
            () => decodeSystemAllGetAck({}),
            (err: unknown) => err instanceof ProtocolError
        );
    });

    it('decodes spray, fan, and diffuser digest channel lists', () => {
        const all = decodeSystemAllGetAck(systemAllWithDigest({
            spray: [{ channel: 0, mode: 0 }],
            fan: [{ channel: 2, speed: 3 }],
            diffuser: {
                type: 'mod100',
                light: [{ channel: 0, onoff: 0 }],
                spray: [{ channel: 0, mode: 2 }]
            }
        }));
        assert.deepEqual(all.digest.spray, [0]);
        assert.deepEqual(all.digest.fan, [2]);
        assert.deepEqual(all.digest.diffuser, { light: [0], spray: [0] });
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
        assert.deepEqual(endpoint?.traits, ['switch', 'system', 'energy']);
        assert.equal(endpoint?.online, true);
        assert.equal(endpoint?.on, true);
        assert.equal(endpoint?.parentId, undefined);
    });

    it('adds the energy trait when only ConsumptionH is advertised', () => {
        const device = enrollPhysicalDevice({
            abilityPayload: socketAbility({
                'Appliance.Control.ConsumptionH': {}
            }),
            allPayload: payload('system-all-getack.json')
        });

        assert.deepEqual(device.endpoints[0]?.traits, ['switch', 'system', 'energy']);
    });

    it('adds the dnd trait on channel 0 when System.DNDMode is advertised', () => {
        const device = enrollPhysicalDevice({
            abilityPayload: socketAbility({
                'Appliance.Control.Electricity': {},
                'Appliance.Control.ConsumptionX': {},
                'Appliance.System.DNDMode': {}
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

        assert.deepEqual(device.endpoints[0]?.traits, ['switch', 'system', 'energy', 'dnd']);
    });

    it('seeds system board snapshot from System.All on channel 0', () => {
        const device = enrollPhysicalDevice({
            abilityPayload: socketAbility(),
            allPayload: payload('system-all-getack.json')
        });

        assert.ok(device.endpoints[0]?.traits.includes('system'));
        assert.equal(device.system.firmware.version, '7.3.13');
        assert.equal(device.system.hardware.type, 'mss110');
        assert.equal(device.system.time?.timezone, 'Asia/Shanghai');
    });

    it('keeps dnd on the strip master when System.DNDMode is advertised', () => {
        const strip = loadFixture('togglex-getack-all.json');
        const device = enrollPhysicalDevice({
            abilityPayload: socketAbility({
                'Appliance.System.DNDMode': {}
            }),
            allPayload: systemAllWithDigest({ togglex: strip.payload.togglex })
        });

        const master = device.endpoints.find((endpoint) => endpoint.channel === 0);
        assert.ok(master);
        assert.deepEqual(master?.traits, ['switch', 'system', 'dnd']);
        assert.equal(master?.classHint, 'socket');
        assert.equal(master?.parentId, undefined);
        assert.equal(
            device.endpoints.some((endpoint) => endpoint.channel !== 0 && endpoint.traits.includes('dnd')),
            false
        );
    });

    it('keeps the strip master as switch + energy and links extra outlets via parentId', () => {
        const strip = loadFixture('togglex-getack-all.json');
        const device = enrollPhysicalDevice({
            abilityPayload: socketAbility({
                'Appliance.Control.Electricity': {},
                'Appliance.Control.ConsumptionX': {}
            }),
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
                parentId: endpoint.parentId,
                name: endpoint.name,
                classHint: endpoint.classHint,
                traits: [...endpoint.traits]
            })),
            [
                {
                    id: `${UUID}:0`,
                    channel: 0,
                    parentId: undefined,
                    name: 'Strip',
                    classHint: 'socket',
                    traits: ['switch', 'system', 'energy']
                },
                ...[1, 2, 3, 4].map((channel) => ({
                    id: `${UUID}:${channel}`,
                    channel,
                    parentId: `${UUID}:0`,
                    name: `Outlet ${channel}`,
                    classHint: 'socket',
                    traits: ['switch']
                }))
            ]
        );
    });

    it('puts ElectricityX energy on every strip socket including children', () => {
        const strip = loadFixture('togglex-getack-all.json');
        const device = enrollPhysicalDevice({
            abilityPayload: socketAbility({
                'Appliance.Control.ElectricityX': {}
            }),
            allPayload: systemAllWithDigest({ togglex: strip.payload.togglex })
        });

        assert.deepEqual(
            device.endpoints.map((endpoint) => ({
                channel: endpoint.channel,
                parentId: endpoint.parentId,
                traits: [...endpoint.traits]
            })),
            [
                { channel: 0, parentId: undefined, traits: ['switch', 'system', 'energy'] },
                ...[1, 2, 3, 4].map((channel) => ({
                    channel,
                    parentId: `${UUID}:0`,
                    traits: ['switch', 'energy']
                }))
            ]
        );
    });

    it('appends timer to each strip socket when Control.TimerX is advertised', () => {
        const strip = loadFixture('togglex-getack-all.json');
        const device = enrollPhysicalDevice({
            abilityPayload: socketAbility({
                'Appliance.Control.TimerX': {}
            }),
            allPayload: systemAllWithDigest({ togglex: strip.payload.togglex })
        });

        assert.deepEqual(
            device.endpoints.map((endpoint) => ({
                channel: endpoint.channel,
                traits: [...endpoint.traits]
            })),
            [
                { channel: 0, traits: ['switch', 'system', 'timer'] },
                ...[1, 2, 3, 4].map((channel) => ({
                    channel,
                    traits: ['switch', 'timer']
                }))
            ]
        );
    });

    it('does not append timer to cover channels when Control.TimerX is advertised', () => {
        const device = enrollPhysicalDevice({
            abilityPayload: {
                ability: {
                    'Appliance.GarageDoor.State': {},
                    'Appliance.Control.TimerX': {},
                    'Appliance.Control.ToggleX': {}
                }
            },
            allPayload: systemAllWithDigest({
                garageDoor: [{ channel: 1 }, { channel: 2 }],
                togglex: [
                    { channel: 0, onoff: 0 },
                    { channel: 1, onoff: 0 },
                    { channel: 2, onoff: 0 }
                ]
            })
        });

        assert.equal(
            device.endpoints.some((endpoint) => endpoint.traits.includes('timer')),
            false
        );
        assert.deepEqual(
            device.endpoints.map((endpoint) => endpoint.classHint),
            ['cover', 'cover']
        );
    });

    it('appends timer to a light board when Control.TimerX is advertised', () => {
        const device = enrollPhysicalDevice({
            abilityPayload: {
                ability: {
                    'Appliance.Control.Light': {},
                    'Appliance.Control.ToggleX': {},
                    'Appliance.Control.TimerX': {}
                }
            },
            allPayload: systemAllWithDigest({
                light: [{ channel: 0 }],
                togglex: [{ channel: 0, onoff: 1 }]
            })
        });

        assert.deepEqual(device.endpoints[0]?.traits, ['light', 'system', 'timer']);
    });

    it('does not append timer when Control.Mp3 already takes the light endpoint', () => {
        const device = enrollPhysicalDevice({
            abilityPayload: {
                ability: {
                    'Appliance.Control.Light': {},
                    'Appliance.Control.Mp3': {},
                    'Appliance.Control.ToggleX': {},
                    'Appliance.Control.TimerX': {}
                }
            },
            allPayload: systemAllWithDigest({
                light: [{ channel: 0 }],
                togglex: [{ channel: 0, onoff: 1 }]
            })
        });

        assert.deepEqual(device.endpoints[0]?.traits, ['light', 'system', 'media']);
    });

    it('appends timer to leftover spray sockets, not the humidifier', () => {
        const device = enrollPhysicalDevice({
            abilityPayload: {
                ability: {
                    'Appliance.Control.Spray': {},
                    'Appliance.Control.ToggleX': {},
                    'Appliance.Control.TimerX': {}
                }
            },
            allPayload: systemAllWithDigest({
                spray: [{ channel: 0, mode: 0 }],
                togglex: [{ channel: 0, onoff: 1 }, { channel: 1, onoff: 0 }]
            })
        });

        const humidifier = device.endpoints.find((endpoint) => endpoint.classHint === 'humidifier');
        const socket = device.endpoints.find((endpoint) => endpoint.classHint === 'socket');
        assert.deepEqual(humidifier?.traits, ['spray', 'system']);
        assert.deepEqual(socket?.traits, ['switch', 'timer']);
    });

    it('does not append timer to hub parents or children when Control.TimerX is advertised', () => {
        const device = enrollPhysicalDevice({
            abilityPayload: {
                ability: {
                    'Appliance.Hub.SubdeviceList': {},
                    'Appliance.Control.TimerX': {},
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
                            subdevice: [{ id: '120027D21C19', status: 1 }]
                        }
                    }
                }
            },
            cloud: {
                uuid: HUB_UUID,
                devName: 'Hall hub',
                deviceType: 'msh300',
                onlineStatus: 1,
                channels: []
            },
            subDevices: [{
                subDeviceId: '120027D21C19',
                subDeviceType: 'ms130',
                subDeviceName: 'Hall sensor'
            }]
        });

        assert.equal(
            device.endpoints.some((endpoint) => endpoint.traits.includes('timer')),
            false
        );
    });

    it('appends trigger to each strip socket when Control.TriggerX is advertised', () => {
        const strip = loadFixture('togglex-getack-all.json');
        const device = enrollPhysicalDevice({
            abilityPayload: socketAbility({
                'Appliance.Control.TriggerX': {}
            }),
            allPayload: systemAllWithDigest({ togglex: strip.payload.togglex })
        });

        assert.deepEqual(
            device.endpoints.map((endpoint) => ({
                channel: endpoint.channel,
                traits: [...endpoint.traits]
            })),
            [
                { channel: 0, traits: ['switch', 'system', 'trigger'] },
                ...[1, 2, 3, 4].map((channel) => ({
                    channel,
                    traits: ['switch', 'trigger']
                }))
            ]
        );
    });

    it('appends both timer and trigger when both namespaces are advertised', () => {
        const device = enrollPhysicalDevice({
            abilityPayload: socketAbility({
                'Appliance.Control.TimerX': {},
                'Appliance.Control.TriggerX': {}
            }),
            allPayload: systemAllWithDigest({
                togglex: [{ channel: 0, onoff: 1 }]
            })
        });

        assert.deepEqual(device.endpoints[0]?.traits, ['switch', 'system', 'timer', 'trigger']);
    });

    it('does not append trigger to cover channels when Control.TriggerX is advertised', () => {
        const device = enrollPhysicalDevice({
            abilityPayload: {
                ability: {
                    'Appliance.GarageDoor.State': {},
                    'Appliance.Control.TriggerX': {},
                    'Appliance.Control.ToggleX': {}
                }
            },
            allPayload: systemAllWithDigest({
                garageDoor: [{ channel: 1 }, { channel: 2 }],
                togglex: [
                    { channel: 0, onoff: 0 },
                    { channel: 1, onoff: 0 },
                    { channel: 2, onoff: 0 }
                ]
            })
        });

        assert.equal(
            device.endpoints.some((endpoint) => endpoint.traits.includes('trigger')),
            false
        );
    });

    it('does not append trigger when Control.Mp3 already takes the light endpoint', () => {
        const device = enrollPhysicalDevice({
            abilityPayload: {
                ability: {
                    'Appliance.Control.Light': {},
                    'Appliance.Control.Mp3': {},
                    'Appliance.Control.ToggleX': {},
                    'Appliance.Control.TriggerX': {}
                }
            },
            allPayload: systemAllWithDigest({
                light: [{ channel: 0 }],
                togglex: [{ channel: 0, onoff: 1 }]
            })
        });

        assert.deepEqual(device.endpoints[0]?.traits, ['light', 'system', 'media']);
    });

    it('does not append trigger to hub parents or children when Control.TriggerX is advertised', () => {
        const device = enrollPhysicalDevice({
            abilityPayload: {
                ability: {
                    'Appliance.Hub.SubdeviceList': {},
                    'Appliance.Control.TriggerX': {},
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
                            subdevice: [{ id: '120027D21C19', status: 1 }]
                        }
                    }
                }
            },
            cloud: {
                uuid: HUB_UUID,
                devName: 'Hall hub',
                deviceType: 'msh300',
                onlineStatus: 1,
                channels: []
            },
            subDevices: [{
                subDeviceId: '120027D21C19',
                subDeviceType: 'ms130',
                subDeviceName: 'Hall sensor'
            }]
        });

        assert.equal(
            device.endpoints.some((endpoint) => endpoint.traits.includes('trigger')),
            false
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
        assert.equal(device.endpoints[0]?.parentId, undefined);
        assert.equal(device.endpoints[1]?.on, false);
        assert.equal(device.endpoints[1]?.parentId, undefined);
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
        assert.deepEqual(device.endpoints[0]?.traits, ['cover', 'system']);
        assert.equal(device.endpoints[0]?.channel, 0);
        assert.equal(device.endpoints[1]?.channel, 1);
    });

    it('omits ToggleX channel 0 when garage doors already occupy 1-n', () => {
        const device = enrollPhysicalDevice({
            abilityPayload: socketAbility({
                'Appliance.GarageDoor.State': {}
            }),
            allPayload: systemAllWithDigest({
                garageDoor: [{ channel: 1 }, { channel: 2 }, { channel: 3 }],
                togglex: [
                    { channel: 0, onoff: 0 },
                    { channel: 1, onoff: 0 },
                    { channel: 2, onoff: 0 },
                    { channel: 3, onoff: 0 }
                ]
            })
        });

        assert.deepEqual(
            device.endpoints.map((endpoint) => ({
                id: endpoint.id,
                channel: endpoint.channel,
                classHint: endpoint.classHint,
                traits: [...endpoint.traits]
            })),
            [
                ...[1, 2, 3].map((channel) => ({
                    id: `${UUID}:${channel}`,
                    channel,
                    classHint: 'cover',
                    traits: ['cover']
                }))
            ]
        );
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
        assert.deepEqual(device.endpoints[0]?.traits, ['light', 'system']);
        assert.equal(device.endpoints[0]?.id, `${UUID}:0`);
    });

    it('enrolls diffuser digest as humidifier with the diffuser trait', () => {
        const device = enrollPhysicalDevice({
            abilityPayload: {
                ability: {
                    'Appliance.Control.Diffuser.Light': {},
                    'Appliance.Control.Diffuser.Spray': {},
                    'Appliance.Control.ToggleX': {}
                }
            },
            allPayload: systemAllWithDigest({
                diffuser: {
                    type: 'mod100',
                    light: [{ channel: 0, onoff: 0 }],
                    spray: [{ channel: 0, mode: 2 }]
                },
                togglex: [{ channel: 0, onoff: 1 }]
            })
        });

        assert.equal(device.endpoints.length, 1);
        assert.equal(device.endpoints[0]?.classHint, 'humidifier');
        assert.deepEqual(device.endpoints[0]?.traits, ['diffuser', 'system']);
    });

    it('enrolls Fan ability without digest.fan as a fan (MAP100)', () => {
        const device = enrollPhysicalDevice({
            abilityPayload: {
                ability: {
                    'Appliance.Control.Fan': {},
                    'Appliance.Control.ToggleX': {}
                }
            },
            allPayload: systemAllWithDigest({
                togglex: [{ channel: 0, onoff: 1 }]
            }),
            cloud: {
                uuid: UUID,
                devName: 'Air purifier',
                deviceType: 'map100',
                onlineStatus: 1,
                channels: [{ channel: 0, devName: 'Air purifier' }]
            }
        });

        assert.equal(device.endpoints.length, 1);
        assert.equal(device.endpoints[0]?.classHint, 'fan');
        assert.deepEqual(device.endpoints[0]?.traits, ['fan', 'system']);
        assert.equal(device.endpoints[0]?.name, 'Air purifier');
    });

    it('enrolls spray digest as humidifier and leftover ToggleX as a socket', () => {
        const device = enrollPhysicalDevice({
            abilityPayload: {
                ability: {
                    'Appliance.Control.Spray': {},
                    'Appliance.Control.ToggleX': {}
                }
            },
            allPayload: systemAllWithDigest({
                spray: [{ channel: 0, mode: 0 }],
                togglex: [{ channel: 0, onoff: 1 }, { channel: 1, onoff: 0 }]
            })
        });

        assert.equal(device.endpoints.length, 2);
        assert.equal(device.endpoints[0]?.channel, 0);
        assert.equal(device.endpoints[0]?.classHint, 'humidifier');
        assert.deepEqual(device.endpoints[0]?.traits, ['spray', 'system']);
        assert.equal(device.endpoints[1]?.channel, 1);
        assert.equal(device.endpoints[1]?.classHint, 'socket');
    });

    it('appends media to a light board that also has Control.Mp3', () => {
        const device = enrollPhysicalDevice({
            abilityPayload: {
                ability: {
                    'Appliance.Control.Light': {},
                    'Appliance.Control.Mp3': {},
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
        assert.deepEqual(device.endpoints[0]?.traits, ['light', 'system', 'media']);
    });

    it('enrolls Control.Mp3 without light as a speaker', () => {
        const device = enrollPhysicalDevice({
            abilityPayload: {
                ability: {
                    'Appliance.Control.Mp3': {}
                }
            },
            allPayload: systemAllWithDigest({})
        });

        assert.equal(device.endpoints.length, 1);
        assert.equal(device.endpoints[0]?.classHint, 'speaker');
        assert.deepEqual(device.endpoints[0]?.traits, ['media', 'system']);
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
        assert.deepEqual(device.endpoints[0]?.traits, ['presence', 'system']);
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
        const graph = new DeviceGraph();
        const device = graph.enroll({
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
        assert.deepEqual(hub?.traits, ['system']);
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

        const rows = graph.inventoryRows();
        assert.equal(rows.length, 3);
        assert.deepEqual(rows.map((row) => row.id).sort(), [
            HUB_UUID,
            `${HUB_UUID}#01008C11`,
            `${HUB_UUID}#120027D21C19`
        ]);
        assert.equal(graph.getPhysical(HUB_UUID)?.endpoints.length, 3);
    });

    it('pairs the hub parent with dnd when System.DNDMode is advertised', () => {
        const graph = new DeviceGraph();
        const device = graph.enroll({
            abilityPayload: {
                ability: {
                    'Appliance.Hub.SubdeviceList': {},
                    'Appliance.System.DNDMode': {}
                }
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
                            subdevice: [
                                { id: '01008C11', status: 1, onoff: 1, mts100v3: { mode: 0 } }
                            ]
                        }
                    }
                }
            }
        });

        const hub = device.endpoints[0];
        assert.equal(hub?.classHint, 'hub');
        assert.deepEqual(hub?.traits, ['system', 'dnd']);
        assert.ok(graph.inventoryRows().some((row) => row.id === HUB_UUID && row.traits.includes('dnd')));
    });

    it('pairs the hub parent with alarm when Control.Alarm is advertised', () => {
        const graph = new DeviceGraph();
        const device = graph.enroll({
            abilityPayload: {
                ability: {
                    'Appliance.Hub.SubdeviceList': {},
                    'Appliance.Control.Alarm': {},
                    'Appliance.System.DNDMode': {}
                }
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
                            subdevice: [
                                { id: '01008C11', status: 1, onoff: 1, mts100v3: { mode: 0 } }
                            ]
                        }
                    }
                }
            }
        });

        const hub = device.endpoints[0];
        assert.equal(hub?.classHint, 'hub');
        assert.deepEqual(hub?.traits, ['system', 'alarm', 'dnd']);
        assert.ok(graph.inventoryRows().some(
            (row) => row.id === HUB_UUID && row.traits.includes('alarm')
        ));
        assert.equal(
            device.endpoints.find((endpoint) => endpoint.id === `${HUB_UUID}#01008C11`)?.traits.includes('alarm'),
            false
        );
    });

    it('enrolls MST100 sprinklers with sprinkler trait and omits unknown hub children without onoff', () => {
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
                            subdevice: [
                                { id: 'aabbcc', status: 1, type: 'mst100' },
                                { id: 'sprinkler1', status: 1, mst: { onoff: 1 } },
                                { id: 'deadbeef', status: 1, ms120: {} },
                                { id: 'mystery1', status: 1, onoff: 1, mystery: {} }
                            ]
                        }
                    }
                }
            },
            subDevices: [{ subDeviceId: 'aabbcc', subDeviceType: 'mst100', subDeviceName: 'Garden' }]
        });
        assert.equal(device.endpoints.length, 4);
        assert.equal(device.endpoints[0]?.classHint, 'hub');

        const sprinkler = device.endpoints.find((endpoint) => endpoint.subDeviceId === 'aabbcc');
        assert.ok(sprinkler);
        assert.equal(sprinkler?.parentId, HUB_UUID);
        assert.equal(sprinkler?.classHint, 'sprinkler');
        assert.deepEqual(sprinkler?.traits, ['sprinkler']);
        assert.equal(sprinkler?.name, 'Garden');
        assert.equal(sprinkler?.model, 'mst100');

        const aliasSprinkler = device.endpoints.find((endpoint) => endpoint.subDeviceId === 'sprinkler1');
        assert.ok(aliasSprinkler);
        assert.equal(aliasSprinkler?.classHint, 'sprinkler');
        assert.deepEqual(aliasSprinkler?.traits, ['sprinkler']);

        const hubSwitch = device.endpoints.find((endpoint) => endpoint.subDeviceId === 'mystery1');
        assert.ok(hubSwitch);
        assert.equal(hubSwitch?.parentId, HUB_UUID);
        assert.equal(hubSwitch?.classHint, 'socket');
        assert.deepEqual(hubSwitch?.traits, ['switch']);
        assert.equal(hubSwitch?.on, true);

        assert.equal(
            device.endpoints.some((endpoint) => endpoint.subDeviceId === 'deadbeef'),
            false
        );

        const graph = new DeviceGraph();
        graph.enroll({
            abilityPayload: { ability: { 'Appliance.Hub.SubdeviceList': {} } },
            allPayload: {
                all: {
                    system: {
                        hardware: { type: 'msh300', uuid: HUB_UUID },
                        firmware: {},
                        online: { status: 1 }
                    },
                    digest: {
                        hub: {
                            subdevice: [
                                { id: 'aabbcc', status: 1, type: 'mst100' },
                                { id: 'sprinkler1', status: 1, mst: { onoff: 1 } },
                                { id: 'deadbeef', status: 1, ms120: {} },
                                { id: 'mystery1', status: 1, onoff: 1, mystery: {} }
                            ]
                        }
                    }
                }
            },
            subDevices: [{ subDeviceId: 'aabbcc', subDeviceType: 'mst100', subDeviceName: 'Garden' }]
        });
        const rows = graph.inventoryRows();
        assert.equal(rows.length, 4);
        assert.deepEqual(rows.map((row) => row.id).sort(), [
            HUB_UUID,
            `${HUB_UUID}#aabbcc`,
            `${HUB_UUID}#mystery1`,
            `${HUB_UUID}#sprinkler1`
        ]);
    });
});

describe('DeviceGraph and Inventory', () => {
    it('projects inventory rows and keeps ids stable across re-enroll', () => {
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
        assert.deepEqual(rows[0]?.traits, ['switch', 'system', 'energy']);
        assert.equal('online' in (rows[0] ?? {}), false);

        const inventory = new Inventory(rows);
        const copy = inventory.endpoints();
        assert.deepEqual(copy, rows);
        (copy[0] as { name: string }).name = 'mutated';
        (copy[0]!.traits as string[]).push('light');
        assert.equal(inventory.endpoints()[0]?.name, 'Kitchen plug');
        assert.deepEqual(inventory.endpoints()[0]?.traits, ['switch', 'system', 'energy']);
    });

    it('starts empty so Session can exist before connect', () => {
        assert.deepEqual(new Inventory().endpoints(), []);
    });
});
