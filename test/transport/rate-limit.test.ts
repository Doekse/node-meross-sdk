import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    RATE_LIMIT_MAX_PUBLISHES,
    RATE_LIMIT_WINDOW_MS,
    PublishRateLimiter
} from '../../src/transport/rate-limit';

const UUID_A = '00000000-0000-4000-8000-000000000001';
const UUID_B = '00000000-0000-4000-8000-000000000002';

describe('PublishRateLimiter', () => {
    it('allows RATE_LIMIT_MAX_PUBLISHES within the window then refuses', () => {
        const now = 1_000_000;
        const limiter = new PublishRateLimiter({ now: () => now });

        for (let i = 0; i < RATE_LIMIT_MAX_PUBLISHES; i += 1) {
            assert.equal(limiter.take(UUID_A), true);
        }

        assert.equal(limiter.take(UUID_A), false);
        assert.equal(limiter.droppedCount(UUID_A), 1);
    });

    it('prunes timestamps that fall outside the window', () => {
        let now = 1_000_000;
        const limiter = new PublishRateLimiter({ now: () => now });

        for (let i = 0; i < RATE_LIMIT_MAX_PUBLISHES; i += 1) {
            limiter.take(UUID_A);
        }

        now += RATE_LIMIT_WINDOW_MS + 1;
        assert.equal(limiter.take(UUID_A), true);
        assert.equal(limiter.droppedCount(UUID_A), 0);
    });

    it('isolates windows per uuid', () => {
        const now = 1_000_000;
        const limiter = new PublishRateLimiter({ now: () => now });

        for (let i = 0; i < RATE_LIMIT_MAX_PUBLISHES; i += 1) {
            limiter.take(UUID_A);
        }

        assert.equal(limiter.take(UUID_B), true);
        assert.equal(limiter.take(UUID_A), false);
        assert.equal(limiter.droppedCount(UUID_A), 1);
        assert.equal(limiter.droppedCount(UUID_B), 0);
    });

    it('returns zero dropped for an unknown uuid', () => {
        const limiter = new PublishRateLimiter({ now: () => 0 });
        assert.equal(limiter.droppedCount(UUID_A), 0);
    });
});
