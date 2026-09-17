/** Meross devices typically push or respond within ~295 s when healthy. */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 295_000;

export interface HeartbeatOptions {
    intervalMs?: number;
    isOnline: () => boolean;
    pollOnline: () => Promise<void>;
    onSilenceOffline: () => void;
    now?: () => number;
}

/**
 * After {@link DEFAULT_HEARTBEAT_INTERVAL_MS} without inbound traffic, GET
 * System.All. Offline only if that probe throws — meross_lan inquires first
 * so a quiet but reachable board is not a false unavailable blip.
 */
export class Heartbeat {
    private readonly intervalMs: number;
    private readonly isOnline: () => boolean;
    private readonly pollOnline: () => Promise<void>;
    private readonly onSilenceOffline: () => void;
    private readonly now: () => number;

    /** Wall time of the last inbound sample. `null` until the first one; `0` is a valid clock origin. */
    private lastResponseTime: number | null = null;
    private timer: ReturnType<typeof setTimeout> | undefined;
    private running = false;
    private pollingDelay: number;

    constructor(options: HeartbeatOptions) {
        const intervalMs = options.intervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
        if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
            throw new RangeError(
                `Heartbeat intervalMs must be a positive finite number, got ${options.intervalMs}`
            );
        }
        this.intervalMs = intervalMs;
        this.isOnline = options.isOnline;
        this.pollOnline = options.pollOnline;
        this.onSilenceOffline = options.onSilenceOffline;
        this.now = options.now ?? Date.now;
        this.pollingDelay = Math.floor(this.intervalMs / 2);
    }

    start(): void {
        if (this.running) {
            return;
        }
        this.running = true;
        this.schedule();
    }

    stop(): void {
        this.running = false;
        if (this.timer !== undefined) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
    }

    recordResponse(): void {
        this.lastResponseTime = this.now();
        if (!this.isOnline()) {
            this.pollingDelay = Math.floor(this.intervalMs / 2);
        }
    }

    private schedule(delayMs?: number): void {
        if (!this.running) {
            return;
        }
        if (this.timer !== undefined) {
            clearTimeout(this.timer);
        }
        const delay = delayMs ?? (this.isOnline() ? this.intervalMs : this.pollingDelay);
        // Do not unref: see DevicePoller.schedule — hosts like Homey can drop
        // unref'd timers while the app process remains alive.
        this.timer = setTimeout(() => {
            void this.perform();
        }, delay);
    }

    private async perform(): Promise<void> {
        if (!this.running) {
            return;
        }
        // Clear the timer before awaiting, like DevicePoller.perform: a
        // stop()+start() mid-check then arms its own timer instead of this
        // call's eventual finally racing (and duplicating) it.
        this.timer = undefined;

        if (this.lastResponseTime !== null) {
            const remainingMs = this.intervalMs - (this.now() - this.lastResponseTime);
            if (remainingMs > 0) {
                // A response landed since this timer was armed: recheck at the
                // true remaining silence, not a full interval from now.
                this.schedule(remainingMs);
                return;
            }
        }

        try {
            await this.pollOnline();
        } catch {
            if (this.lastResponseTime !== null) {
                this.onSilenceOffline();
            }
            if (!this.isOnline()) {
                this.pollingDelay = Math.min(this.pollingDelay * 2, this.intervalMs);
            }
        } finally {
            this.schedule();
        }
    }
}
