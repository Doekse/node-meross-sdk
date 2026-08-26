/**
 * Sliding window length matching meross_lan `_MQTTRateLimiter.DURATION`.
 * Meross caps devices near 200 messages/hour; 5 publishes / 91 s keeps the
 * long-run average under that without queueing (which some firmware rejects).
 */
export const RATE_LIMIT_WINDOW_MS = 91_000;

/** Max publishes per uuid inside {@link RATE_LIMIT_WINDOW_MS}. */
export const RATE_LIMIT_MAX_PUBLISHES = 5;

export interface PublishRateLimiterOptions {
    now?: () => number;
}

interface WindowEntry {
    /** Send timestamps still inside the sliding window, oldest first. */
    timestamps: number[];
    dropped: number;
}

/**
 * Per-device MQTT publish backstop. There is no queue — a refused caller
 * retries on its own schedule, matching meross_lan `rl_publish`.
 */
export class PublishRateLimiter {
    private readonly now: () => number;
    private readonly windows = new Map<string, WindowEntry>();

    constructor(options: PublishRateLimiterOptions = {}) {
        this.now = options.now ?? Date.now;
    }

    /**
     * Claims a publish slot for `uuid`. False means the window is full and
     * the caller must not publish.
     */
    take(uuid: string): boolean {
        const now = this.now();
        const window = this.windowEntry(uuid);
        const cutoff = now - RATE_LIMIT_WINDOW_MS;
        while (window.timestamps.length > 0 && window.timestamps[0]! <= cutoff) {
            window.timestamps.shift();
        }

        if (window.timestamps.length >= RATE_LIMIT_MAX_PUBLISHES) {
            window.dropped += 1;
            return false;
        }

        window.timestamps.push(now);
        return true;
    }

    /** Publishes refused for `uuid` since this limiter was created. */
    droppedCount(uuid: string): number {
        return this.windows.get(uuid)?.dropped ?? 0;
    }

    private windowEntry(uuid: string): WindowEntry {
        let window = this.windows.get(uuid);
        if (!window) {
            window = { timestamps: [], dropped: 0 };
            this.windows.set(uuid, window);
        }
        return window;
    }
}
