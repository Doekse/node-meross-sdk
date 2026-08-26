import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Endpoint } from '../../src/endpoint';
import {
    SYSTEM_ALL_NAMESPACE,
    SYSTEM_CLOCK_NAMESPACE,
    SYSTEM_FIRMWARE_NAMESPACE,
    SYSTEM_TIME_NAMESPACE,
    encodeMessage,
    type MerossMessage
} from '../../src/protocol';
import { SystemTrait } from '../../src/traits/system';
import type { SystemTraitBind, SystemValues } from '../../src/traits/system';

const KEY = 'stub-key';
const UUID = '2206138957096651080248e1e99705a4';
const NOW_MS = 1_676_428_800_000;

function createHarness(options: {
    initialTime?: SystemTraitBind['initialTime'];
} = {}): {
    trait: SystemTrait;
    requests: MerossMessage[];
    changes: SystemValues[];
} {
    const requests: MerossMessage[] = [];
    const changes: SystemValues[] = [];
    const endpoint = new Endpoint({ id: `${UUID}:0`, traits: ['system'] });
    const bind: SystemTraitBind = {
        uuid: UUID,
        initialFirmware: { version: '7.3.13' },
        initialHardware: { type: 'mss110', uuid: UUID },
        initialTime: options.initialTime,
        now: () => NOW_MS,
        request: async (opts) => {
            const message = encodeMessage({
                namespace: opts.namespace,
                method: opts.method,
                key: KEY,
                from: '/app/test/subscribe',
                payload: opts.payload,
                uuid: UUID
            });
            requests.push(message);
            return encodeMessage({
                namespace: opts.namespace,
                method: 'SETACK',
                key: KEY,
                from: `/appliance/${UUID}/publish`,
                messageId: message.header.messageId,
                uuid: UUID,
                payload: {}
            });
        },
        emitChange: (values) => {
            changes.push(values);
            endpoint.emit('change', { trait: 'system', values: { ...values } });
        }
    };
    return { trait: new SystemTrait(bind), requests, changes };
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

describe('SystemTrait', () => {
    it('exposes System.All seed before any poll', () => {
        const { trait, changes } = createHarness({
            initialTime: {
                timestamp: 1_676_428_765,
                timezone: 'Asia/Shanghai',
                timeRule: [[684_860_400, 28_800, 0]]
            }
        });
        assert.equal(trait.getFirmware()?.version, '7.3.13');
        assert.equal(trait.getHardware()?.type, 'mss110');
        assert.equal(trait.getTime()?.timezone, 'Asia/Shanghai');
        assert.equal(trait.clockSkewSeconds(), 1_676_428_765 - Math.floor(NOW_MS / 1000));
        assert.equal(changes.length, 0);
    });

    it('setTimezone SETs time keeping the last timeRule', async () => {
        const { trait, requests } = createHarness({
            initialTime: {
                timestamp: 1_676_428_765,
                timezone: 'Asia/Shanghai',
                timeRule: [[684_860_400, 28_800, 0]]
            }
        });
        const result = await trait.setTimezone('Europe/Amsterdam');
        assert.equal(requests[0]?.header.method, 'SET');
        assert.deepEqual(requests[0]?.payload, {
            time: {
                timezone: 'Europe/Amsterdam',
                timeRule: [[684_860_400, 28_800, 0]]
            }
        });
        assert.equal(result.timezone, 'Europe/Amsterdam');
        assert.equal(trait.getTime()?.timezone, 'Europe/Amsterdam');
    });

    it('handlePush updates firmware and emits change', () => {
        const { trait, changes } = createHarness();
        trait.handlePush(pushMessage(SYSTEM_FIRMWARE_NAMESPACE, {
            firmware: { version: '7.4.0', wifiMac: 'aa:bb:cc:dd:ee:ff' }
        }));
        assert.equal(trait.getFirmware()?.version, '7.4.0');
        assert.deepEqual(changes, [{
            firmware: { version: '7.4.0', wifiMac: 'aa:bb:cc:dd:ee:ff' }
        }]);
    });

    it('handlePush updates time and clock skew', () => {
        const { trait, changes } = createHarness();
        trait.handlePush(pushMessage(SYSTEM_TIME_NAMESPACE, {
            time: {
                timestamp: 1_676_428_900,
                timezone: 'UTC',
                timeRule: []
            }
        }));
        assert.equal(trait.getTime()?.timestamp, 1_676_428_900);
        assert.equal(changes[0]?.clockSkewSeconds, 1_676_428_900 - Math.floor(NOW_MS / 1000));
    });

    it('applies firmware, hardware, and time from each System.All', () => {
        const { trait, changes } = createHarness({
            initialTime: {
                timestamp: 1_676_428_000,
                timezone: 'UTC',
                timeRule: []
            }
        });
        trait.handlePush(pushMessage(SYSTEM_ALL_NAMESPACE, {
            all: {
                system: {
                    hardware: { type: 'mss110', uuid: UUID, version: '7.0.0' },
                    firmware: { version: '7.4.1', innerIp: '10.0.0.9' },
                    time: {
                        timestamp: 1_676_428_900,
                        timezone: 'Europe/Amsterdam',
                        timeRule: [[684_860_400, 3600, 0]]
                    },
                    online: { status: 1 }
                },
                digest: { togglex: [] }
            }
        }));
        assert.equal(trait.getFirmware()?.version, '7.4.1');
        assert.equal(trait.getHardware()?.version, '7.0.0');
        assert.equal(trait.getTime()?.timezone, 'Europe/Amsterdam');
        assert.equal(changes.length, 1);
        assert.equal(changes[0]?.firmware?.version, '7.4.1');
        assert.equal(changes[0]?.time?.timezone, 'Europe/Amsterdam');
    });

    it('prefers System.Clock for skew when present', () => {
        const { trait } = createHarness({
            initialTime: {
                timestamp: 1_676_428_000,
                timezone: 'UTC',
                timeRule: []
            }
        });
        trait.handlePush(pushMessage(SYSTEM_CLOCK_NAMESPACE, {
            clock: { timestamp: 1_676_428_950 }
        }));
        assert.equal(trait.clockSkewSeconds(), 1_676_428_950 - Math.floor(NOW_MS / 1000));
    });

    it('ignores duplicate values and foreign uuid PUSH', () => {
        const { trait, changes } = createHarness();
        const payload = {
            firmware: { version: '7.4.0' }
        };
        trait.handlePush(pushMessage(SYSTEM_FIRMWARE_NAMESPACE, payload));
        trait.handlePush(pushMessage(SYSTEM_FIRMWARE_NAMESPACE, payload));
        assert.equal(changes.length, 1);
        trait.handlePush(encodeMessage({
            namespace: SYSTEM_FIRMWARE_NAMESPACE,
            method: 'PUSH',
            key: KEY,
            from: '/appliance/other/publish',
            uuid: 'other',
            payload: { firmware: { version: '9.0.0' } }
        }));
        assert.equal(changes.length, 1);
        assert.equal(trait.getFirmware()?.version, '7.4.0');
    });
});
