import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { emitLog, emitTraffic, isLogEnabled, redactSecrets } from '../src/log';
import type { LogLevel, LogRecord, SessionLogger } from '../src/log';

const REDACTED = '[REDACTED]';

function capture(): { seen: LogRecord[]; logger: SessionLogger } {
    const seen: LogRecord[] = [];
    const logger: SessionLogger = (record) => {
        seen.push(record);
    };
    return { seen, logger };
}

describe('isLogEnabled', () => {
    const cases: Array<{ floor: LogLevel | undefined; level: LogLevel; enabled: boolean }> = [
        { floor: 'error', level: 'error', enabled: true },
        { floor: 'error', level: 'debug', enabled: false },
        { floor: 'error', level: 'trace', enabled: false },
        { floor: 'debug', level: 'error', enabled: true },
        { floor: 'debug', level: 'debug', enabled: true },
        { floor: 'debug', level: 'trace', enabled: false },
        { floor: 'trace', level: 'error', enabled: true },
        { floor: 'trace', level: 'debug', enabled: true },
        { floor: 'trace', level: 'trace', enabled: true },
        // Omitted floor resolves like debug — never lexicographic ('debug' < 'error').
        { floor: undefined, level: 'error', enabled: true },
        { floor: undefined, level: 'debug', enabled: true },
        { floor: undefined, level: 'trace', enabled: false }
    ];

    for (const { floor, level, enabled } of cases) {
        it(`${String(floor)} floor enables ${level}: ${enabled}`, () => {
            assert.equal(isLogEnabled(floor, level), enabled);
        });
    }
});

describe('emitLog', () => {
    it('is a no-op when the logger is omitted', () => {
        assert.doesNotThrow(() => {
            emitLog(undefined, {
                level: 'debug',
                channel: 'mqtt',
                message: 'silent'
            });
        });
    });

    it('forwards the record to the host sink', () => {
        const { seen, logger } = capture();
        const record: LogRecord = {
            level: 'debug',
            channel: 'lan',
            message: 'POST',
            direction: 'tx',
            target: 'http://192.0.2.1/config',
            data: '{"a":1}'
        };

        emitLog(logger, record);

        assert.deepEqual(seen, [record]);
    });

    it('swallows throws from the host sink', () => {
        const logger: SessionLogger = () => {
            throw new Error('host logger blew up');
        };

        assert.doesNotThrow(() => {
            emitLog(logger, {
                level: 'error',
                channel: 'mqtt',
                message: 'malformed payload'
            });
        });
    });
});

describe('emitTraffic', () => {
    it('is a no-op when the logger is omitted', () => {
        let called = false;
        emitTraffic(undefined, 'trace', {
            channel: 'cloud',
            message: 'POST',
            direction: 'tx',
            data: () => {
                called = true;
                return '{}';
            }
        });
        assert.equal(called, false);
    });

    it('skips data() when the floor is error', () => {
        const { seen, logger } = capture();
        let called = false;
        emitTraffic(logger, 'error', {
            channel: 'mqtt',
            message: 'MQTT publish',
            direction: 'tx',
            data: () => {
                called = true;
                return '{}';
            }
        });
        assert.equal(called, false);
        assert.deepEqual(seen, []);
    });

    it('default floor emits debug without calling data()', () => {
        const { seen, logger } = capture();
        let called = false;
        emitTraffic(logger, undefined, {
            channel: 'lan',
            message: 'LAN POST',
            direction: 'tx',
            target: 'http://192.0.2.1/config',
            data: () => {
                called = true;
                return '{"secret":true}';
            }
        });
        assert.equal(called, false);
        assert.equal(seen.length, 1);
        assert.equal(seen[0]!.level, 'debug');
        assert.equal(seen[0]!.data, undefined);
        assert.equal(seen[0]!.message, 'LAN POST');
    });

    it('trace floor calls data() and emits one trace record', () => {
        const { seen, logger } = capture();
        let calls = 0;
        emitTraffic(logger, 'trace', {
            channel: 'cloud',
            message: 'POST /v1/Auth/signIn',
            direction: 'rx',
            target: 'https://iotx.meross.com/v1/Auth/signIn',
            data: () => {
                calls += 1;
                return '{"ok":true}';
            }
        });
        assert.equal(calls, 1);
        assert.equal(seen.length, 1);
        assert.equal(seen[0]!.level, 'trace');
        assert.equal(seen[0]!.data, '{"ok":true}');
    });

    it('still emits the one-liner when data() throws', () => {
        const { seen, logger } = capture();
        emitTraffic(logger, 'trace', {
            channel: 'mqtt',
            message: 'MQTT message',
            direction: 'rx',
            data: () => {
                throw new Error('stringify failed');
            }
        });
        assert.equal(seen.length, 1);
        assert.equal(seen[0]!.level, 'trace');
        assert.equal(seen[0]!.data, undefined);
        assert.equal(seen[0]!.message, 'MQTT message');
    });
});

describe('redactSecrets', () => {
    it('redacts password, token, key, and mfaCode at the top level', () => {
        assert.deepEqual(
            redactSecrets({
                email: 'you@example.com',
                password: 'secret',
                token: 'tok',
                key: 'k',
                mfaCode: '123456',
                userid: '1'
            }),
            {
                email: 'you@example.com',
                password: REDACTED,
                token: REDACTED,
                key: REDACTED,
                mfaCode: REDACTED,
                userid: '1'
            }
        );
    });

    it('redacts nested objects and array entries', () => {
        assert.deepEqual(
            redactSecrets({
                outer: {
                    token: 'nested-tok',
                    items: [{ password: 'p', ok: true }, { key: 'nested-key' }]
                }
            }),
            {
                outer: {
                    token: REDACTED,
                    items: [
                        { password: REDACTED, ok: true },
                        { key: REDACTED }
                    ]
                }
            }
        );
    });

    it('leaves primitives and non-secret fields unchanged', () => {
        assert.equal(redactSecrets('plain'), 'plain');
        assert.equal(redactSecrets(42), 42);
        assert.equal(redactSecrets(null), null);
        assert.deepEqual(redactSecrets({ domain: 'iot.example.com' }), {
            domain: 'iot.example.com'
        });
    });

    it('does not mutate the input', () => {
        const input = { token: 'live', nested: { key: 'live-key' } };
        const copy = structuredClone(input);

        redactSecrets(input);

        assert.deepEqual(input, copy);
    });
});
