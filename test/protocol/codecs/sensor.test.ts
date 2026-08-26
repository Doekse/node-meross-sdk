import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ProtocolError } from '../../../src/errors';
import {
    decodeSensorHistoryGetAck,
    decodeSensorHistoryPush,
    decodeSensorHistoryXGetAck,
    decodeSensorHistoryXPush,
    decodeSensorLatestGetAck,
    decodeSensorLatestPush,
    encodeSensorHistoryGet,
    encodeSensorHistoryXGet,
    encodeSensorLatestGet,
    encodeLatestXGet,
    decodeSmokeConfigGetAck,
    decodeSmokeConfigPush,
    encodeSmokeConfigGet,
    encodeSmokeConfigSet,
    decodeHubExceptionPush,
    encodeHubSubDeviceVersionGet,
    decodeHubSubDeviceVersionGetAck,
    decodeHubSubDeviceVersionPush,
    encodeSensorMotionGet,
    decodeSensorMotionGetAck,
    decodeSensorMotionPush
} from '../../../src/protocol/codecs/sensor';

describe('Control.Sensor.Latest codec', () => {
    it('encodes GET with channel in a latest array', () => {
        assert.deepEqual(encodeSensorLatestGet(0), {
            latest: [{ channel: 0 }]
        });
    });

    it('decodes MTS200-shaped GETACK humidity', () => {
        const [entry] = decodeSensorLatestGetAck({
            latest: [{
                channel: 0,
                capacity: 2,
                value: [{ timestamp: 1718302939, humi: 596 }]
            }]
        }, 10);
        assert.equal(entry.channel, 0);
        assert.equal(entry.capacity, 2);
        assert.equal(entry.timestamp, 1718302939);
        assert.equal(entry.humidity, 59.6);
        assert.equal(entry.temperature, undefined);
    });

    it('decodes temperature with caller-supplied scale', () => {
        const [entry] = decodeSensorLatestGetAck({
            latest: [{
                channel: 0,
                value: [{ temp: 2397, humi: 450 }]
            }]
        }, 100);
        assert.equal(entry.temperature, 23.97);
        assert.equal(entry.humidity, 45);
    });

    it('uses PUSH decoder interchangeably with GETACK', () => {
        const payload = {
            latest: [{
                channel: 0,
                value: [{ humi: 607 }]
            }]
        };
        assert.deepEqual(
            decodeSensorLatestPush(payload, 10),
            decodeSensorLatestGetAck(payload, 10)
        );
    });

    it('rejects a non-array latest payload', () => {
        assert.throws(() => decodeSensorLatestGetAck({ latest: {} }, 10), ProtocolError);
    });
});

describe('Control.Sensor.LatestX codec', () => {
    it('encodes GET with empty data (all keys)', () => {
        assert.deepEqual(encodeLatestXGet({ channel: 0, keys: [] }), {
            latest: [{ channel: 0, data: [] }]
        });
        assert.deepEqual(encodeLatestXGet({ channel: 0, keys: ['presence', 'light'] }), {
            latest: [{ channel: 0, data: ['presence', 'light'] }]
        });
        assert.deepEqual(encodeLatestXGet({ channel: 0, subId: '00000101', keys: [] }), {
            latest: [{ channel: 0, subId: '00000101', data: [] }]
        });
    });
});

describe('Control.Sensor.History codec', () => {
    it('encodes GET with channel and optional capacity', () => {
        assert.deepEqual(encodeSensorHistoryGet({ channel: 0 }), {
            history: [{ channel: 0 }]
        });
        assert.deepEqual(encodeSensorHistoryGet({ channel: 0, capacity: 3 }), {
            history: [{ channel: 0, capacity: 3 }]
        });
    });

    it('decodes MTS200-shaped history samples', () => {
        const [entry] = decodeSensorHistoryGetAck({
            history: [{
                channel: 0,
                capacity: 3,
                value: [
                    { timestamp: 1718222159, temp: 166, humi: 607 },
                    { timestamp: 1718225759, temp: 172, humi: 616 }
                ]
            }]
        }, 10);
        assert.equal(entry.channel, 0);
        assert.equal(entry.capacity, 3);
        assert.equal(entry.samples.length, 2);
        assert.equal(entry.samples[0]?.timestamp, 1718222159);
        assert.equal(entry.samples[0]?.temperature, 16.6);
        assert.equal(entry.samples[0]?.humidity, 60.7);
        assert.equal(entry.samples[1]?.temperature, 17.2);
    });

    it('uses PUSH decoder interchangeably with GETACK', () => {
        const payload = {
            history: [{
                channel: 0,
                value: [{ timestamp: 1, temp: 166, humi: 607 }]
            }]
        };
        assert.deepEqual(
            decodeSensorHistoryPush(payload, 10),
            decodeSensorHistoryGetAck(payload, 10)
        );
    });

    it('rejects a non-array history payload', () => {
        assert.throws(() => decodeSensorHistoryGetAck({ history: {} }, 10), ProtocolError);
    });
});

describe('Control.Sensor.HistoryX codec', () => {
    it('encodes GET with channel and empty data (all keys)', () => {
        assert.deepEqual(encodeSensorHistoryXGet({ channel: 0, keys: [] }), {
            history: [{ channel: 0, data: [] }]
        });
        assert.deepEqual(encodeSensorHistoryXGet({ channel: 0, keys: ['temp', 'humi'] }), {
            history: [{ channel: 0, data: ['temp', 'humi'] }]
        });
        assert.deepEqual(encodeSensorHistoryXGet({ channel: 0, subId: '00000101', keys: ['temp'] }), {
            history: [{ channel: 0, subId: '00000101', data: ['temp'] }]
        });
    });

    it('decodes LatestX-shaped history series', () => {
        const [entry] = decodeSensorHistoryXGetAck({
            history: [{
                channel: 0,
                data: {
                    temp: [
                        { timestamp: 1718222159, value: 2397 },
                        { timestamp: 1718225759, value: 2405 }
                    ],
                    humi: [
                        { timestamp: 1718222159, value: 607 },
                        { timestamp: 1718225759, value: 616 }
                    ],
                    light: [{ timestamp: 1725907912, value: 24 }],
                    presence: [{
                        timestamp: 1725907895,
                        times: 0,
                        distance: 760,
                        value: 2
                    }]
                }
            }]
        }, 100);
        assert.equal(entry.channel, 0);
        assert.equal(entry.temperature?.length, 2);
        assert.equal(entry.temperature?.[0]?.timestamp, 1718222159);
        assert.equal(entry.temperature?.[0]?.temperature, 23.97);
        assert.equal(entry.humidity?.[1]?.humidity, 61.6);
        assert.equal(entry.light?.[0]?.light, 24);
        assert.equal(entry.presence?.[0]?.present, true);
        assert.equal(entry.presence?.[0]?.distance, 0.76);
    });

    it('uses PUSH decoder interchangeably with GETACK', () => {
        const payload = {
            history: [{
                channel: 0,
                data: {
                    temp: [{ timestamp: 1, value: 166 }]
                }
            }]
        };
        assert.deepEqual(
            decodeSensorHistoryXPush(payload, 10),
            decodeSensorHistoryXGetAck(payload, 10)
        );
    });

    it('rejects a non-array history payload', () => {
        assert.throws(() => decodeSensorHistoryXGetAck({ history: {} }, 10), ProtocolError);
    });
});

describe('Control.Smoke.Config codec', () => {
    it('encodes GET as a config array with channel and subId', () => {
        assert.deepEqual(encodeSmokeConfigGet({ channel: 0, subId: '123456' }), {
            config: [{ channel: 0, subId: '123456' }]
        });
    });

    it('omits subId from GET when not provided', () => {
        assert.deepEqual(encodeSmokeConfigGet({ channel: 0 }), {
            config: [{ channel: 0 }]
        });
    });

    it('encodes SET dnd and detect enable flags as 1/2', () => {
        assert.deepEqual(encodeSmokeConfigSet({
            channel: 0,
            subId: '123456',
            dndEnabled: true,
            detectEnabled: false
        }), {
            config: [{
                channel: 0,
                subId: '123456',
                dnd: { enable: 1 },
                detect: { enable: 2 }
            }]
        });
    });

    it('omits absent SET sub-keys', () => {
        const payload = encodeSmokeConfigSet({ channel: 0, subId: '123456', dndEnabled: true });
        const entry = (payload.config as Array<Record<string, unknown>>)[0];
        assert.equal('detect' in entry, false);
        assert.deepEqual(entry.dnd, { enable: 1 });
    });

    it('decodes firmware GETACK dnd and detect flags', () => {
        const [entry] = decodeSmokeConfigGetAck({
            config: [{
                channel: 0,
                subId: '123456',
                dnd: { enable: 1 },
                detect: { enable: 1 }
            }]
        });
        assert.equal(entry.channel, 0);
        assert.equal(entry.subId, '123456');
        assert.equal(entry.dndEnabled, true);
        assert.equal(entry.detectEnabled, true);
    });

    it('decodes PUSH with the same decoder as GETACK', () => {
        const [entry] = decodeSmokeConfigPush({
            config: [{ channel: 0, subId: '123456', dnd: { enable: 2 } }]
        });
        assert.equal(entry.channel, 0);
        assert.equal(entry.dndEnabled, false);
    });

    it('rejects a non-array config payload', () => {
        assert.throws(() => decodeSmokeConfigGetAck({ config: {} }), ProtocolError);
    });

    it('rejects an entry missing channel', () => {
        assert.throws(() => decodeSmokeConfigGetAck({ config: [{ subId: '123456' }] }), ProtocolError);
    });
});

describe('Hub.Exception codec', () => {
    it('decodes PUSH rows with id and code', () => {
        assert.deepEqual(decodeHubExceptionPush({
            exception: [
                { id: '120027D21C19', code: 5061 },
                { id: '00000102', code: 5062 }
            ]
        }), [
            { id: '120027D21C19', code: 5061 },
            { id: '00000102', code: 5062 }
        ]);
    });

    it('omits rows without a numeric code', () => {
        assert.deepEqual(decodeHubExceptionPush({
            exception: [{ id: '120027D21C19' }]
        }), []);
    });

    it('rejects a non-array exception payload', () => {
        assert.throws(() => decodeHubExceptionPush({ exception: {} }), ProtocolError);
    });
});

describe('Hub.SubDevice.Version codec', () => {
    it('encodes GET with id in a version array', () => {
        assert.deepEqual(encodeHubSubDeviceVersionGet('130012345678'), {
            version: [{ id: '130012345678' }]
        });
    });

    it('decodes GETACK firmware and hardware from the firmware fixture', () => {
        const [entry] = decodeHubSubDeviceVersionGetAck({
            version: [{
                id: '130012345678',
                hardware: '1.2.3',
                firmware: '1.2.3'
            }]
        });
        assert.deepEqual(entry, {
            id: '130012345678',
            firmware: '1.2.3',
            hardware: '1.2.3'
        });
    });

    it('skips exception-only rows that have no firmware or hardware', () => {
        assert.deepEqual(decodeHubSubDeviceVersionGetAck({
            version: [
                { id: 'ghost', exception: { code: 5062 } },
                { id: '130012345678', hardware: '1.2.3', firmware: '1.2.3' }
            ]
        }), [
            { id: '130012345678', firmware: '1.2.3', hardware: '1.2.3' }
        ]);
    });

    it('uses PUSH decoder interchangeably with GETACK', () => {
        const payload = {
            version: [{ id: '0300DAB1', hardware: '1.1.5', firmware: '5.1.8' }]
        };
        assert.deepEqual(
            decodeHubSubDeviceVersionPush(payload),
            decodeHubSubDeviceVersionGetAck(payload)
        );
    });

    it('rejects a non-array version payload', () => {
        assert.throws(() => decodeHubSubDeviceVersionGetAck({ version: {} }), ProtocolError);
    });
});

describe('Hub.Sensor.Motion codec', () => {
    it('encodes GET with id in a motion array', () => {
        assert.deepEqual(encodeSensorMotionGet('120012345678'), {
            motion: [{ id: '120012345678' }]
        });
    });

    it('decodes status=1 as motion detected', () => {
        const [entry] = decodeSensorMotionGetAck({
            motion: [{ id: '120012345678', status: 1, lmTime: 1615876120996 }]
        });
        assert.deepEqual(entry, { id: '120012345678', motion: true });
    });

    it('decodes status=0 as no motion', () => {
        const [entry] = decodeSensorMotionGetAck({
            motion: [{ id: '120012345678', status: 0, lmTime: 1615876120996 }]
        });
        assert.deepEqual(entry, { id: '120012345678', motion: false });
    });

    it('uses PUSH decoder interchangeably with GETACK', () => {
        const payload = {
            motion: [{ id: '120012345678', status: 1, lmTime: 1615876120996 }]
        };
        assert.deepEqual(
            decodeSensorMotionPush(payload),
            decodeSensorMotionGetAck(payload)
        );
    });

    it('rejects a non-array motion payload', () => {
        assert.throws(() => decodeSensorMotionGetAck({ motion: {} }), ProtocolError);
    });

    it('rejects an entry without status', () => {
        assert.throws(
            () => decodeSensorMotionGetAck({ motion: [{ id: '120012345678' }] }),
            ProtocolError
        );
    });
});
