import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ProtocolError } from '../../../src/errors';
import {
    decodeSystemClockPush,
    decodeSystemDebugGetAck,
    decodeSystemFirmwareGetAck,
    decodeSystemFirmwarePush,
    decodeSystemHardwareGetAck,
    decodeSystemPositionGetAck,
    decodeSystemTimeGetAck,
    decodeSystemTimePush,
    encodeSystemDebugGet,
    encodeSystemFirmwareGet,
    encodeSystemHardwareGet,
    encodeSystemPositionGet,
    encodeSystemPositionSet,
    encodeSystemTimeGet,
    encodeSystemTimeSet
} from '../../../src/protocol/codecs/system';

describe('System.Time codec', () => {
    it('encodes GET as an empty payload', () => {
        assert.deepEqual(encodeSystemTimeGet(), {});
    });

    it('encodes SET with optional timestamp', () => {
        assert.deepEqual(encodeSystemTimeSet({
            timezone: 'America/Los_Angeles',
            timeRule: [[1667725200, -28800, 0]],
            timestamp: 1674113577
        }), {
            time: {
                timezone: 'America/Los_Angeles',
                timeRule: [[1667725200, -28800, 0]],
                timestamp: 1674113577
            }
        });
        assert.deepEqual(encodeSystemTimeSet({
            timezone: 'UTC',
            timeRule: []
        }), {
            time: { timezone: 'UTC', timeRule: [] }
        });
    });

    it('decodes GETACK and PUSH from firmware fixtures', () => {
        assert.deepEqual(decodeSystemTimeGetAck({
            time: {
                timestamp: 1674115286,
                timezone: '',
                timeRule: [[1667725200, -28800, 0]]
            }
        }), {
            timestamp: 1674115286,
            timezone: '',
            timeRule: [[1667725200, -28800, 0]]
        });
        assert.deepEqual(decodeSystemTimePush({
            time: {
                timezone: 'America/Chicago',
                timestamp: 1674115756,
                timeRule: [[1667718000, -21600, 0]]
            }
        }), {
            timestamp: 1674115756,
            timezone: 'America/Chicago',
            timeRule: [[1667718000, -21600, 0]]
        });
    });

    it('rejects malformed time payloads', () => {
        assert.throws(() => decodeSystemTimeGetAck({}), ProtocolError);
        assert.throws(() => decodeSystemTimeGetAck({ time: { timezone: 'UTC' } }), ProtocolError);
        assert.throws(
            () => decodeSystemTimeGetAck({
                time: { timestamp: 1, timezone: 'UTC', timeRule: [[1, 2]] }
            }),
            ProtocolError
        );
    });
});

describe('System.Clock codec', () => {
    it('decodes PUSH timestamp for skew reporting', () => {
        assert.deepEqual(decodeSystemClockPush({
            clock: { timestamp: 1674112362 }
        }), { timestamp: 1674112362 });
    });

    it('rejects missing clock.timestamp', () => {
        assert.throws(() => decodeSystemClockPush({}), ProtocolError);
        assert.throws(() => decodeSystemClockPush({ clock: {} }), ProtocolError);
    });
});

describe('System.Firmware codec', () => {
    it('encodes GET as an empty payload', () => {
        assert.deepEqual(encodeSystemFirmwareGet(), {});
    });

    it('decodes GETACK with optional homekitVersion and encrypt', () => {
        assert.deepEqual(decodeSystemFirmwareGetAck({
            firmware: {
                version: '4.2.2',
                homekitVersion: '2.0.1',
                compileTime: 'Nov  1 2022 15:18:09',
                encrypt: 1,
                wifiMac: '50:d4:f7:70:2f:9c',
                innerIp: '192.168.1.102',
                server: 'mqtt-eu-2.meross.com',
                port: 443,
                userId: 112707
            }
        }), {
            version: '4.2.2',
            homekitVersion: '2.0.1',
            compileTime: 'Nov  1 2022 15:18:09',
            encrypt: 1,
            wifiMac: '50:d4:f7:70:2f:9c',
            innerIp: '192.168.1.102',
            server: 'mqtt-eu-2.meross.com',
            port: 443,
            userId: 112707
        });
    });

    it('decodes PUSH and tolerates omitted optional keys', () => {
        assert.deepEqual(decodeSystemFirmwarePush({
            firmware: {
                version: '7.2.15',
                compileTime: '2022/08/23-15:39:35',
                wifiMac: '14:ab:02:8c:da:3c',
                innerIp: '192.168.1.60',
                server: 'mqtt-eu-2.meross.com',
                port: 443,
                userId: 2346922
            }
        }), {
            version: '7.2.15',
            compileTime: '2022/08/23-15:39:35',
            wifiMac: '14:ab:02:8c:da:3c',
            innerIp: '192.168.1.60',
            server: 'mqtt-eu-2.meross.com',
            port: 443,
            userId: 2346922
        });
        assert.deepEqual(decodeSystemFirmwareGetAck({
            firmware: { version: '1.0.0' }
        }), { version: '1.0.0' });
    });

    it('rejects a missing firmware object', () => {
        assert.throws(() => decodeSystemFirmwareGetAck({}), ProtocolError);
    });
});

describe('System.Hardware codec', () => {
    it('encodes GET as an empty payload', () => {
        assert.deepEqual(encodeSystemHardwareGet(), {});
    });

    it('decodes GETACK from the firmware fixture', () => {
        assert.deepEqual(decodeSystemHardwareGetAck({
            hardware: {
                type: 'mss110',
                subType: 'un',
                version: '7.0.0',
                chipType: 'rtl8710cm',
                uuid: '2102018403567500014134298f1f2c48',
                macAddress: '34:29:8f:1f:2c:48'
            }
        }), {
            type: 'mss110',
            subType: 'un',
            version: '7.0.0',
            chipType: 'rtl8710cm',
            uuid: '2102018403567500014134298f1f2c48',
            macAddress: '34:29:8f:1f:2c:48'
        });
    });

    it('rejects missing type or uuid', () => {
        assert.throws(() => decodeSystemHardwareGetAck({}), ProtocolError);
        assert.throws(() => decodeSystemHardwareGetAck({
            hardware: { type: 'mss110' }
        }), ProtocolError);
        assert.deepEqual(decodeSystemHardwareGetAck({
            hardware: { type: 'mss110', uuid: 'abc' }
        }), { type: 'mss110', uuid: 'abc' });
    });
});

describe('System.Debug codec', () => {
    it('encodes GET as an empty payload', () => {
        assert.deepEqual(encodeSystemDebugGet(), {});
    });

    it('decodes system/network/cloud defensively and keeps homeKit', () => {
        const state = decodeSystemDebugGetAck({
            debug: {
                system: {
                    version: '7.3.13',
                    sysUpTime: '23h8m3s',
                    UTC: 1675320431
                },
                network: {
                    linkStatus: 'connected',
                    signal: 100,
                    rssi: -36,
                    ssid: 'meross_cloud',
                    innerIp: '192.168.201.190'
                },
                cloud: {
                    activeServer: 'mqtt-ap-2.meross.com',
                    mainPort: 443,
                    userId: 1767965
                },
                homeKit: {
                    homekitCreateCnt: 1
                }
            }
        });
        assert.equal(state.system?.version, '7.3.13');
        assert.equal(state.network?.ssid, 'meross_cloud');
        assert.equal(state.cloud?.activeServer, 'mqtt-ap-2.meross.com');
        assert.deepEqual(state.homeKit, { homekitCreateCnt: 1 });
    });

    it('tolerates missing subtrees', () => {
        assert.deepEqual(decodeSystemDebugGetAck({ debug: {} }), {});
        assert.deepEqual(decodeSystemDebugGetAck({
            debug: { system: { version: '1.0.0' }, network: 'broken' }
        }), {
            system: { version: '1.0.0' }
        });
    });

    it('rejects a missing debug object', () => {
        assert.throws(() => decodeSystemDebugGetAck({}), ProtocolError);
    });
});

describe('System.Position codec', () => {
    it('encodes GET as an empty payload', () => {
        assert.deepEqual(encodeSystemPositionGet(), {});
    });

    it('encodes SET latitude/longitude', () => {
        assert.deepEqual(encodeSystemPositionSet({
            latitude: 40641492,
            longitude: -74284488
        }), {
            position: {
                latitude: 40641492,
                longitude: -74284488
            }
        });
    });

    it('decodes GETACK from the firmware fixture', () => {
        assert.deepEqual(decodeSystemPositionGetAck({
            position: {
                longitude: -90806193,
                latitude: 38763267
            }
        }), {
            latitude: 38763267,
            longitude: -90806193
        });
    });

    it('rejects malformed position payloads', () => {
        assert.throws(() => decodeSystemPositionGetAck({}), ProtocolError);
        assert.throws(() => decodeSystemPositionGetAck({
            position: { latitude: 1 }
        }), ProtocolError);
    });
});
