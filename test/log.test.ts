import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { logError, logTraffic } from '../src/log';
import type { LogLevel, LogRecord, SessionLogger } from '../src/log';

const REDACTED = '[REDACTED]';

function capture(): { seen: LogRecord[]; logger: SessionLogger } {
    const seen: LogRecord[] = [];
    const logger: SessionLogger = (record) => {
        seen.push(record);
    };
    return { seen, logger };
}

function traceBody(body: unknown): unknown {
    const { seen, logger } = capture();
    logTraffic(logger, 'trace', {
        channel: 'cloud',
        direction: 'tx',
        message: 'POST /v1/Auth/signIn',
        body
    });
    return JSON.parse(seen[0]!.data!);
}

describe('logTraffic', () => {
    it('is a no-op when the logger is omitted', () => {
        let called = false;
        logTraffic(undefined, 'trace', {
            channel: 'cloud',
            direction: 'tx',
            message: 'POST',
            body: () => {
                called = true;
                return {};
            }
        });
        assert.equal(called, false);
    });

    it('emits nothing and skips the body when the floor is error', () => {
        const { seen, logger } = capture();
        let called = false;
        logTraffic(logger, 'error', {
            channel: 'mqtt',
            direction: 'tx',
            method: 'GET',
            namespace: 'Appliance.System.All',
            body: () => {
                called = true;
                return '{}';
            }
        });
        assert.equal(called, false);
        assert.deepEqual(seen, []);
    });

    const floors: Array<{ floor: LogLevel | undefined; trace: boolean }> = [
        { floor: 'debug', trace: false },
        { floor: undefined, trace: false },
        { floor: 'trace', trace: true }
    ];

    for (const { floor, trace } of floors) {
        it(`${String(floor)} floor ${trace ? 'includes' : 'omits'} the body`, () => {
            const { seen, logger } = capture();
            let called = false;
            logTraffic(logger, floor, {
                channel: 'mqtt',
                direction: 'tx',
                method: 'GET',
                namespace: 'Appliance.Control.ToggleX',
                uuid: 'abc',
                messageId: 'deadbeef',
                body: () => {
                    called = true;
                    return '{"header":{"sign":"secret"}}';
                }
            });
            assert.equal(called, trace);
            assert.equal(seen.length, 1);
            assert.equal(seen[0]!.level, trace ? 'trace' : 'debug');
            assert.equal(
                seen[0]!.message,
                'tx(mqtt) GET Appliance.Control.ToggleX (uuid:abc messageId:deadbeef)'
            );
            if (trace) {
                assert.equal(JSON.parse(seen[0]!.data!).header.sign, REDACTED);
            } else {
                assert.equal(seen[0]!.data, undefined);
            }
        });
    }

    it('builds a receive line from the body and the topic', () => {
        const { seen, logger } = capture();
        const body = JSON.stringify({
            header: {
                method: 'PUSH',
                namespace: 'Appliance.Control.ToggleX',
                messageId: 'm1',
                from: '/appliance/from-id/publish'
            },
            payload: {}
        });
        logTraffic(logger, 'debug', {
            channel: 'mqtt',
            direction: 'rx',
            target: '/app/1/subscribe',
            fallback: 'MQTT message',
            body
        });
        assert.equal(
            seen[0]!.message,
            'rx(mqtt) PUSH Appliance.Control.ToggleX (uuid:from-id messageId:m1)'
        );
        assert.equal(seen[0]!.data, undefined);
    });

    it('uses the topic uuid when the header has none', () => {
        const { seen, logger } = capture();
        logTraffic(logger, 'debug', {
            channel: 'mqtt',
            direction: 'rx',
            target: '/appliance/topic-id/subscribe',
            fallback: 'MQTT message',
            body: JSON.stringify({
                header: { method: 'GETACK', namespace: 'Appliance.System.All', messageId: 'm2' },
                payload: {}
            })
        });
        assert.match(seen[0]!.message, /uuid:topic-id/);
    });

    it('prefers the caller uuid over the header', () => {
        const { seen, logger } = capture();
        logTraffic(logger, 'debug', {
            channel: 'lan',
            direction: 'rx',
            uuid: 'post-uuid',
            fallback: 'LAN HTTP 200',
            body: JSON.stringify({
                header: {
                    method: 'GETACK',
                    namespace: 'Appliance.System.All',
                    messageId: 'm3',
                    uuid: 'header-uuid'
                },
                payload: {}
            })
        });
        assert.match(seen[0]!.message, /uuid:post-uuid/);
        assert.equal(seen[0]!.message.includes('header-uuid'), false);
    });

    it('uses the fallback when the body is not a protocol frame', () => {
        const { seen, logger } = capture();
        logTraffic(logger, 'debug', {
            channel: 'mqtt',
            direction: 'rx',
            fallback: 'MQTT message',
            body: '{not json'
        });
        assert.equal(seen[0]!.message, 'MQTT message');
    });

    it('keeps a known summary when the body throws', () => {
        const { seen, logger } = capture();
        logTraffic(logger, 'trace', {
            channel: 'mqtt',
            direction: 'tx',
            method: 'GET',
            namespace: 'Appliance.System.All',
            body: () => {
                throw new Error('stringify failed');
            }
        });
        assert.equal(seen.length, 1);
        assert.equal(seen[0]!.data, undefined);
        assert.match(seen[0]!.message, /^tx\(mqtt\) GET Appliance\.System\.All$/);
    });

    it('swallows throws from the host sink', () => {
        const logger: SessionLogger = () => {
            throw new Error('host logger blew up');
        };
        assert.doesNotThrow(() => {
            logTraffic(logger, 'debug', {
                channel: 'cloud',
                direction: 'tx',
                message: 'POST /v1/Device/devList'
            });
        });
    });
});

describe('logError', () => {
    it('is a no-op when the logger is omitted', () => {
        let called = false;
        logError(undefined, {
            channel: 'mqtt',
            message: 'Malformed MQTT payload',
            data: () => {
                called = true;
                return '{not json';
            }
        });
        assert.equal(called, false);
    });

    it('emits the failure and omits a non-JSON dump', () => {
        const { seen, logger } = capture();
        logError(logger, {
            channel: 'mqtt',
            message: 'message is not valid JSON',
            target: '/app/1/subscribe',
            data: '{"header":{"sign":"abc123","from":"/app/3401786-1/subscribe"'
        });
        assert.deepEqual(seen, [{
            level: 'error',
            channel: 'mqtt',
            message: 'message is not valid JSON',
            target: '/app/1/subscribe'
        }]);
    });

    it('redacts JSON error dumps the same way as trace bodies', () => {
        const { seen, logger } = capture();
        logError(logger, {
            channel: 'mqtt',
            message: 'message signature is invalid',
            data: JSON.stringify({
                header: { sign: 'abc', uuid: 'device-1', method: 'GETACK' },
                payload: { key: 'secret', devName: 'Kitchen' }
            })
        });
        const data = JSON.parse(seen[0]!.data!) as {
            header: { sign: string; uuid: string; method: string };
            payload: { key: string; devName: string };
        };
        assert.equal(data.header.sign, '[REDACTED]');
        assert.equal(data.header.uuid, '[REDACTED]');
        assert.equal(data.header.method, 'GETACK');
        assert.equal(data.payload.key, '[REDACTED]');
        assert.equal(data.payload.devName, 'Kitchen');
        assert.equal(seen[0]!.data!.includes('secret'), false);
    });

    it('still emits when the body throws', () => {
        const { seen, logger } = capture();
        logError(logger, {
            channel: 'lan',
            message: 'LAN POST failed: down',
            data: () => {
                throw new Error('no body');
            }
        });
        assert.equal(seen[0]!.message, 'LAN POST failed: down');
        assert.equal(seen[0]!.data, undefined);
    });

    it('swallows throws from the host sink', () => {
        const logger: SessionLogger = () => {
            throw new Error('host logger blew up');
        };
        assert.doesNotThrow(() => {
            logError(logger, { channel: 'mqtt', message: 'socket error' });
        });
    });
});

describe('trace redaction', () => {
    it('redacts credential fields and keeps device names', () => {
        assert.deepEqual(
            traceBody({
                email: 'you@example.com',
                password: 'secret',
                token: 'tok',
                key: 'k',
                mfaCode: '123456',
                userid: '1',
                userId: 3401786,
                bindId: 'bind-token',
                devName: 'Server',
                domain: 'iot.example.com',
                position: { latitude: 1, longitude: 2 },
                nested: { items: [{ password: 'p', ok: true }] }
            }),
            {
                email: REDACTED,
                password: REDACTED,
                token: REDACTED,
                key: REDACTED,
                mfaCode: REDACTED,
                userid: REDACTED,
                userId: REDACTED,
                bindId: REDACTED,
                devName: 'Server',
                domain: REDACTED,
                position: { latitude: REDACTED, longitude: REDACTED },
                nested: { items: [{ password: REDACTED, ok: true }] }
            }
        );
    });

    it('does not mutate the input', () => {
        const input = { token: 'live', nested: { key: 'live-key' } };
        const copy = structuredClone(input);
        traceBody(input);
        assert.deepEqual(input, copy);
    });

    it('omits a non-JSON trace body', () => {
        const { seen, logger } = capture();
        logTraffic(logger, 'trace', {
            channel: 'cloud',
            direction: 'rx',
            message: 'HTTP 200 /v1/Auth/signIn',
            body: '{"token":"live-token","email":"you@example.com"'
        });
        assert.equal(seen[0]!.data, undefined);
        assert.equal(seen[0]!.message, 'HTTP 200 /v1/Auth/signIn');
    });
});
