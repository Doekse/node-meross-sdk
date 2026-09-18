import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { emitLog, redactSecrets } from '../src/log';
import type { LogRecord, SessionLogger } from '../src/log';

const REDACTED = '[REDACTED]';

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
        const seen: LogRecord[] = [];
        const logger: SessionLogger = (record) => {
            seen.push(record);
        };
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
