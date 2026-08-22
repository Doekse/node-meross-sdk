import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Endpoint } from '../../src/endpoint';
import { CONTROL_ALARM_NAMESPACE, encodeMessage, type MerossMessage } from '../../src/protocol';
import { AlarmTrait } from '../../src/traits/alarm';
import type { AlarmTraitBind } from '../../src/traits/alarm';

const KEY = 'stub-key';
const UUID = '1906017373338625184434298f1ed9bd';
const CHANNEL = 0;

function createHarness(): {
    trait: AlarmTrait;
    requests: MerossMessage[];
    changes: Record<string, unknown>[];
} {
    const requests: MerossMessage[] = [];
    const changes: Record<string, unknown>[] = [];
    const endpoint = new Endpoint({ id: UUID, traits: ['alarm'] });
    const bind: AlarmTraitBind = {
        uuid: UUID,
        channel: CHANNEL,
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
                payload: {
                    alarm: [{
                        channel: CHANNEL,
                        event: {
                            interConn: { value: 2, timestamp: 0 },
                            security: { value: 1, timestamp: 0 }
                        }
                    }]
                }
            });
        },
        emitChange: (values) => {
            changes.push({ ...values });
            endpoint.emit('change', { trait: 'alarm', values: { ...values } });
        }
    };
    return { trait: new AlarmTrait(bind), requests, changes };
}

function pushMessage(payload: Record<string, unknown>): MerossMessage {
    return encodeMessage({
        namespace: CONTROL_ALARM_NAMESPACE,
        method: 'PUSH',
        key: KEY,
        from: `/appliance/${UUID}/publish`,
        uuid: UUID,
        payload
    });
}

describe('AlarmTrait', () => {
    it('polls Control.Alarm on start', async () => {
        const { trait, requests, changes } = createHarness();
        trait.start();
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(requests[0]?.header.namespace, CONTROL_ALARM_NAMESPACE);
        assert.deepEqual(requests[0]?.payload, { alarm: [{ channel: CHANNEL }] });
        assert.equal(trait.isOn(), true);
        assert.deepEqual(changes[0], { on: true, linked: false });
    });

    it('setOn SETs event.security execute/normal with optional duration', async () => {
        const { trait, requests } = createHarness();
        await trait.setOn(true, 30);
        assert.equal(requests[0]?.header.method, 'SET');
        assert.deepEqual(requests[0]?.payload, {
            alarm: [{
                channel: CHANNEL,
                event: { security: { value: 1, time: 30 } }
            }]
        });
        assert.equal(trait.isOn(), true);
    });

    it('setLinked SETs event.interConn with local type', async () => {
        const { trait, requests, changes } = createHarness();
        await trait.setLinked(false);
        assert.deepEqual(requests[0]?.payload, {
            alarm: [{
                channel: CHANNEL,
                event: { interConn: { value: 2, type: 1 } }
            }]
        });
        assert.deepEqual(changes[0], { linked: false });
    });

    it('handlePush applies this channel only', () => {
        const { trait, changes } = createHarness();
        trait.handlePush(pushMessage({
            alarm: [
                { channel: CHANNEL, event: { security: { value: 1, timestamp: 10 } } },
                { channel: 1, event: { security: { value: 2, timestamp: 10 } } }
            ]
        }));
        assert.equal(trait.isOn(), true);
        assert.deepEqual(changes, [{ on: true }]);
    });

    it('ignores subdevice rows and PUSH when uuid does not match the bind', () => {
        const { trait, changes } = createHarness();
        trait.handlePush(pushMessage({
            alarm: [{
                channel: CHANNEL,
                subId: '123456',
                event: { security: { value: 1, timestamp: 10 } }
            }]
        }));
        assert.equal(changes.length, 0);

        trait.handlePush(encodeMessage({
            namespace: CONTROL_ALARM_NAMESPACE,
            method: 'PUSH',
            key: KEY,
            from: '/appliance/other/publish',
            uuid: 'other',
            payload: {
                alarm: [{
                    channel: CHANNEL,
                    event: { security: { value: 1, timestamp: 10 } }
                }]
            }
        }));
        assert.equal(changes.length, 0);
    });
});
