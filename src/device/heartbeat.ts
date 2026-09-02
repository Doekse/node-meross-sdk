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
 * Marks a device offline after extended silence instead of on a single failed
 * poll, matching Meross app behaviour and avoiding LAN blips as false offline.
 * The probe itself is System.All (see DeviceAvailability.pollOnline).
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
        this.intervalMs = options.intervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
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
        const wasOffline = !this.isOnline();
        this.lastResponseTime = this.now();
        if (wasOffline) {
            this.pollingDelay = Math.floor(this.intervalMs / 2);
        }
        if (this.running && this.shouldBeOffline() && this.isOnline()) {
            this.onSilenceOffline();
        }
    }

    private shouldBeOffline(): boolean {
        if (this.lastResponseTime === null || !this.isOnline()) {
            return false;
        }
        return this.now() - this.lastResponseTime >= this.intervalMs;
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
            const elapsed = this.now() - this.lastResponseTime;
            if (elapsed < this.intervalMs) {
                // A response landed since this timer was armed: recheck at the
                // true remaining silence, not a full interval from now.
                this.schedule(this.intervalMs - elapsed);
                return;
            }
        }

        if (this.shouldBeOffline() && this.isOnline()) {
            this.onSilenceOffline();
        }

        try {
            await this.pollOnline();
        } catch {
            if (!this.isOnline()) {
                this.pollingDelay = Math.min(this.pollingDelay * 2, this.intervalMs);
            }
        } finally {
            this.schedule();
        }
    }
}
