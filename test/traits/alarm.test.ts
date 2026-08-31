import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Endpoint } from '../../src/endpoint';
import {
    CONTROL_ALARM_NAMESPACE,
    CONTROL_BEEP_NAMESPACE,
    encodeMessage,
    type MerossMessage
} from '../../src/protocol';
import { AlarmTrait } from '../../src/traits/alarm';
import type { AlarmTraitBind } from '../../src/traits/alarm';
import { createRequestRecorder, traitAck } from '../helpers/request';

const KEY = 'stub-key';
const UUID = '1906017373338625184434298f1ed9bd';
const CHANNEL = 0;

function createHarness(options: {
    event?: Record<string, unknown>;
    namespaces?: ReadonlySet<string>;
} = {}): {
    trait: AlarmTrait;
    requests: MerossMessage[];
    changes: Record<string, unknown>[];
} {
    const event = options.event ?? {
        interConn: { value: 2, timestamp: 0 },
        security: { value: 1, timestamp: 0 }
    };
    const changes: Record<string, unknown>[] = [];
    const endpoint = new Endpoint({ id: UUID, traits: ['alarm'] });
    const { requests, request } = createRequestRecorder({
        uuid: UUID,
        key: KEY,
        ack: (_requestOptions, sent) => traitAck(sent, {
            key: KEY,
            method: 'GETACK',
            payload: {
                alarm: [{
                    channel: CHANNEL,
                    event
                }]
            }
        })
    });
    const bind: AlarmTraitBind = {
        uuid: UUID,
        channel: CHANNEL,
        namespaces: options.namespaces ?? new Set([CONTROL_ALARM_NAMESPACE, CONTROL_BEEP_NAMESPACE]),
        request,
        emitChange: (values) => {
            changes.push({ ...values });
            endpoint.emit('change', { trait: 'alarm', values: { ...values } });
        }
    };
    return { trait: new AlarmTrait(bind), requests, changes };
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

function getAck(namespace: string, payload: Record<string, unknown>): MerossMessage {
    return encodeMessage({
        namespace,
        method: 'GETACK',
        key: KEY,
        from: `/appliance/${UUID}/publish`,
        uuid: UUID,
        payload
    });
}

describe('AlarmTrait', () => {
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

    it('setBeep SETs Control.Beep onoff under the alarm key', async () => {
        const { trait, requests, changes } = createHarness();
        await trait.setBeep(true);
        assert.equal(requests[0]?.header.namespace, CONTROL_BEEP_NAMESPACE);
        assert.deepEqual(requests[0]?.payload, {
            alarm: [{ channel: CHANNEL, onoff: 1 }]
        });
        assert.equal(trait.isBeepOn(), true);
        assert.deepEqual(changes[0], { beep: true });
    });

    it('no-ops setBeep when Control.Beep is absent', async () => {
        const { trait, requests, changes } = createHarness({
            namespaces: new Set([CONTROL_ALARM_NAMESPACE])
        });
        const result = await trait.setBeep(true);
        assert.equal(result, undefined);
        assert.equal(requests.length, 0);
        assert.equal(changes.length, 0);
        assert.equal(trait.isBeepOn(), undefined);
    });

    it('no-ops setOn when Control.Alarm is absent', async () => {
        const { trait, requests, changes } = createHarness({
            namespaces: new Set([CONTROL_BEEP_NAMESPACE])
        });

        assert.equal(await trait.setOn(true), undefined);

        assert.equal(requests.length, 0);
        assert.equal(changes.length, 0);
        assert.equal(trait.isOn(), undefined);
    });

    it('no-ops setLinked when Control.Alarm is absent', async () => {
        const { trait, requests, changes } = createHarness({
            namespaces: new Set([CONTROL_BEEP_NAMESPACE])
        });

        assert.equal(await trait.setLinked(true), undefined);

        assert.equal(requests.length, 0);
        assert.equal(changes.length, 0);
    });

    it('handlePush applies this channel only', () => {
        const { trait, changes } = createHarness();
        trait.handlePush(pushMessage(CONTROL_ALARM_NAMESPACE, {
            alarm: [
                { channel: CHANNEL, event: { security: { value: 1, timestamp: 10 } } },
                { channel: 1, event: { security: { value: 2, timestamp: 10 } } }
            ]
        }));
        assert.equal(trait.isOn(), true);
        assert.deepEqual(changes, [{ on: true }]);
    });

    it('applies Beep PUSH for this channel', () => {
        const { trait, changes } = createHarness();

        trait.handlePush(pushMessage(CONTROL_BEEP_NAMESPACE, {
            alarm: [
                { channel: CHANNEL, onoff: 1 },
                { channel: 1, onoff: 0 }
            ]
        }));

        assert.equal(trait.isBeepOn(), true);
        assert.deepEqual(changes, [{ beep: true }]);
    });

    it('does not emit change when Beep PUSH repeats', () => {
        const { trait, changes } = createHarness();
        const payload = {
            alarm: [
                { channel: CHANNEL, onoff: 1 },
                { channel: 1, onoff: 0 }
            ]
        };

        trait.handlePush(pushMessage(CONTROL_BEEP_NAMESPACE, payload));
        trait.handlePush(pushMessage(CONTROL_BEEP_NAMESPACE, payload));

        assert.equal(changes.length, 1);
    });

    it('ignores Beep PUSH when Control.Beep is not advertised', () => {
        const { trait, changes } = createHarness({
            namespaces: new Set([CONTROL_ALARM_NAMESPACE])
        });

        trait.handlePush(pushMessage(CONTROL_BEEP_NAMESPACE, {
            alarm: [{ channel: CHANNEL, onoff: 1 }]
        }));

        assert.equal(changes.length, 0);
        assert.equal(trait.isBeepOn(), undefined);
    });

    it('ignores Alarm PUSH when Control.Alarm is not advertised', () => {
        const { trait, changes } = createHarness({
            namespaces: new Set([CONTROL_BEEP_NAMESPACE])
        });

        trait.handlePush(pushMessage(CONTROL_ALARM_NAMESPACE, {
            alarm: [{ channel: CHANNEL, event: { security: { value: 1, timestamp: 10 } } }]
        }));

        assert.equal(changes.length, 0);
        assert.equal(trait.isOn(), undefined);
    });

    it('ignores Alarm rows that carry a subdevice id', () => {
        const { trait, changes } = createHarness();

        trait.handlePush(pushMessage(CONTROL_ALARM_NAMESPACE, {
            alarm: [{
                channel: CHANNEL,
                subId: '123456',
                event: { security: { value: 1, timestamp: 10 } }
            }]
        }));

        assert.equal(changes.length, 0);
    });

    it('ignores Alarm PUSH from another device', () => {
        const { trait, changes } = createHarness();

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

    it('applies maSecurity PUSH as the hub-wide siren', () => {
        const { trait, changes } = createHarness();
        trait.handlePush(pushMessage(CONTROL_ALARM_NAMESPACE, {
            alarm: [{
                channel: CHANNEL,
                event: { maSecurity: { value: 1, timestamp: 10 } }
            }]
        }));
        assert.equal(trait.isOn(), true);
        assert.deepEqual(changes, [{ on: true }]);
    });

    it('setOn uses maSecurity after a maSecurity GETACK', async () => {
        const { trait, requests } = createHarness({
            event: { maSecurity: { value: 2, timestamp: 0 } }
        });
        trait.handlePush(getAck(CONTROL_ALARM_NAMESPACE, {
            alarm: [{
                channel: CHANNEL,
                event: { maSecurity: { value: 2, timestamp: 0 } }
            }]
        }));
        requests.length = 0;

        await trait.setOn(true, 15);

        assert.deepEqual(requests[0]?.payload, {
            alarm: [{
                channel: CHANNEL,
                event: { maSecurity: { value: 1, time: 15 } }
            }]
        });
    });
});
