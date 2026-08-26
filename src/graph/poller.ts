import type { MerossMessage, MerossPayload } from '../protocol/message';
import type { GetCommand } from '../transport/router';
import { SYSTEM_ALL_NAMESPACE } from './system-all';

/** One shared tick so traits do not each run their own timer. */
export const DEFAULT_POLL_INTERVAL_MS = 30_000;

/** HTTP-only System.All; sits near the firmware heartbeat window. */
export const SYSTEM_ALL_PERIOD_MS = 295_000;

/** Watt-hour totals do not need the instantaneous electricity cadence. */
export const ENERGY_PERIOD_MS = 55_000;

/** Consumption over cloud MQTT so daily totals do not fill the broker budget. */
export const ENERGY_CLOUD_PERIOD_MS = 600_000;

/** Live power / presence: due on every LAN tick. */
export const SENSOR_FAST_PERIOD_MS = 0;

/** Live sensors when the request rides cloud MQTT. */
export const SENSOR_FAST_CLOUD_PERIOD_MS = 180_000;

/** Config and slowly changing sensors on LAN. */
export const SENSOR_SLOW_PERIOD_MS = 300_000;

/** Slowly changing sensors over cloud MQTT. */
export const SENSOR_SLOW_CLOUD_PERIOD_MS = 600_000;

/**
 * Config GETs over cloud MQTT. Longer than sensor-slow so those jobs do not
 * starve electricity on the broker path.
 */
export const CLOUDMQTT_PERIOD_MS = 1_195_000;

/** Hub battery percent barely moves; about once an hour is enough. */
export const HUB_BATTERY_PERIOD_MS = 3_600_000;

/**
 * How a namespace is scheduled. Traits register jobs; the poller owns the
 * timer so each trait does not run its own interval.
 */
export type PollStrategy = 'default' | 'smart' | 'once' | 'all';

/**
 * One namespace GET for a physical board. Deduplicated by `namespace` so a
 * multi-gang strip does not issue the same Electricity GET four times.
 */
export interface PollJob {
    namespace: string;
    strategy: PollStrategy;
    periodMs: number;
    periodCloudMs: number;
    payload?: MerossPayload;
    /** FilterMaintenance (and other PUSHQ ns) must not GET. */
    method?: 'GET' | 'PUSH';
}

export interface DevicePollerOptions {
    uuid: string;
    isOnline: () => boolean;
    /**
     * True when the next batch will go over cloud MQTT (no LAN IP or the
     * router error budget is spent). Caps due jobs to one per cycle within
     * each job's periodCloudMs.
     */
    isCloudPath: () => boolean;
    maxCmdNum: () => number;
    requestGets: (gets: GetCommand[], maxCmdNum: number) => Promise<MerossMessage[]>;
    /** Fan out GETACKs the same way Session fans out PUSH. */
    onAck: (message: MerossMessage) => void;
    jobs?: readonly PollJob[];
    intervalMs?: number;
    now?: () => number;
}

interface JobState {
    namespace: string;
    strategy: PollStrategy;
    periodMs: number;
    periodCloudMs: number;
    payload: MerossPayload;
    method: 'GET' | 'PUSH';
    /** `null` means cold start / re-online — must poll even under MQTT skip. */
    nextMs: number | null;
    lastRequestMs: number;
}

/**
 * One loop per physical board: MQTT skip, cloud rate limit, and leftover
 * Multiple slots for jobs that can wait.
 */
export class DevicePoller {
    private readonly uuid: string;
    private readonly isOnline: () => boolean;
    private readonly isCloudPath: () => boolean;
    private readonly maxCmdNum: () => number;
    private readonly requestGets: DevicePollerOptions['requestGets'];
    private readonly onAck: (message: MerossMessage) => void;
    private readonly intervalMs: number;
    private readonly now: () => number;

    private readonly jobs = new Map<string, JobState>();
    private lastPushMs: number | null = null;
    private offlineDelayMs: number;
    private timer: ReturnType<typeof setTimeout> | undefined;
    private running = false;

    constructor(options: DevicePollerOptions) {
        this.uuid = options.uuid;
        this.isOnline = options.isOnline;
        this.isCloudPath = options.isCloudPath;
        this.maxCmdNum = options.maxCmdNum;
        this.requestGets = options.requestGets;
        this.onAck = options.onAck;
        this.intervalMs = options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
        this.now = options.now ?? Date.now;
        this.offlineDelayMs = this.intervalMs;
        if (options.jobs) {
            this.setJobs(options.jobs);
        }
    }

    /**
     * Replaces the job table, preserving schedule state for namespaces that
     * stay registered so a re-materialize does not storm the device.
     */
    setJobs(jobs: readonly PollJob[]): void {
        const previous = new Map(this.jobs);
        this.jobs.clear();
        for (const job of jobs) {
            if (this.jobs.has(job.namespace)) {
                continue;
            }
            const prior = previous.get(job.namespace);
            this.jobs.set(job.namespace, {
                namespace: job.namespace,
                strategy: job.strategy,
                periodMs: job.periodMs,
                periodCloudMs: job.periodCloudMs,
                payload: job.payload ?? {},
                method: job.method ?? 'GET',
                nextMs: prior?.nextMs ?? null,
                lastRequestMs: prior?.lastRequestMs ?? 0
            });
        }
    }

    start(): void {
        if (this.running) {
            return;
        }
        this.running = true;
        this.schedule(0);
    }

    stop(): void {
        this.running = false;
        if (this.timer !== undefined) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
    }

    /**
     * Cloud MQTT is this SDK's only broker. A recent PUSH means default/all
     * state can ride PUSH instead of GET. The flag expires after the heartbeat
     * window so a leftover cloud PUSH does not leave HTTP-only boards stale.
     */
    recordPush(message: MerossMessage): void {
        if (message.header.method !== 'PUSH') {
            return;
        }
        const uuid = message.header.uuid
            ?? /^\/appliance\/([^/]+)\//.exec(message.header.from)?.[1];
        if (uuid === this.uuid) {
            this.lastPushMs = this.now();
        }
    }

    /**
     * Online: cold-start so MQTT skip does not leave digest state stale.
     * Offline: drop MQTT-active so the next online cycle re-probes.
     */
    setOnline(online: boolean): void {
        if (online) {
            this.offlineDelayMs = this.intervalMs;
            for (const job of this.jobs.values()) {
                job.nextMs = null;
            }
            return;
        }
        this.lastPushMs = null;
    }

    /**
     * True while a PUSH arrived inside the firmware heartbeat window.
     */
    private mqttActive(): boolean {
        return this.lastPushMs !== null
            && this.now() - this.lastPushMs < SYSTEM_ALL_PERIOD_MS;
    }

    private schedule(delayMs: number): void {
        if (!this.running) {
            return;
        }
        if (this.timer !== undefined) {
            clearTimeout(this.timer);
        }
        this.timer = setTimeout(() => {
            void this.perform();
        }, delayMs);
        this.timer.unref?.();
    }

    private async perform(): Promise<void> {
        if (!this.running) {
            return;
        }
        try {
            if (this.isOnline()) {
                await this.tickOnline();
            } else {
                await this.tickOffline();
            }
        } finally {
            this.schedule(this.isOnline() ? this.intervalMs : this.offlineDelayMs);
        }
    }

    private async tickOffline(): Promise<void> {
        try {
            const replies = await this.requestGets(
                [{ namespace: SYSTEM_ALL_NAMESPACE, payload: {} }],
                1
            );
            for (const reply of replies) {
                this.onAck(reply);
            }
            this.offlineDelayMs = this.intervalMs;
        } catch {
            this.offlineDelayMs = Math.min(
                this.offlineDelayMs + this.intervalMs,
                SYSTEM_ALL_PERIOD_MS
            );
        }
    }

    private async tickOnline(): Promise<void> {
        const epoch = this.now();
        const cloudPath = this.isCloudPath();
        const maxCmdNum = this.maxCmdNum();
        let cloudQueued = 0;
        const pending: JobState[] = [];
        const lazy: JobState[] = [];

        /**
         * Cloud publishes count against the device's hourly Meross budget, so a
         * job that can still wait yields the one slot this cycle.
         */
        const enqueue = (job: JobState): void => {
            if (
                cloudPath
                && cloudQueued >= 1
                && epoch - job.lastRequestMs < job.periodCloudMs
            ) {
                return;
            }
            pending.push(job);
            if (cloudPath) {
                cloudQueued += 1;
            }
        };

        const mqttActive = this.mqttActive();
        let pollAll = false;
        for (const job of this.jobs.values()) {
            if (job.strategy !== 'all') {
                continue;
            }
            pollAll = job.nextMs === null || (!mqttActive && epoch >= job.nextMs);
            if (pollAll) {
                enqueue(job);
            }
            break;
        }

        for (const job of this.jobs.values()) {
            switch (job.strategy) {
                case 'all':
                    break;
                case 'default':
                    if (mqttActive && job.nextMs !== null) {
                        break;
                    }
                    if (pollAll && !mqttActive) {
                        break;
                    }
                    enqueue(job);
                    break;
                case 'smart':
                    if (job.nextMs === null || epoch >= job.nextMs) {
                        enqueue(job);
                    } else {
                        lazy.push(job);
                    }
                    break;
                case 'once':
                    if (job.nextMs === null) {
                        enqueue(job);
                    }
                    break;
            }
        }

        lazy.sort((a, b) => a.lastRequestMs - b.lastRequestMs);
        if (maxCmdNum >= 2) {
            for (const job of lazy) {
                if (pending.length % maxCmdNum === 0) {
                    break;
                }
                enqueue(job);
            }
        }

        if (pending.length === 0) {
            return;
        }

        // Advance before awaiting so a failed or rate-limited batch still waits
        // for its next period instead of spinning on every tick.
        for (const job of pending) {
            job.lastRequestMs = epoch;
            job.nextMs = epoch + job.periodMs;
        }

        let replies: MerossMessage[];
        try {
            replies = await this.requestGets(
                pending.map((job) => ({
                    namespace: job.namespace,
                    payload: job.payload,
                    method: job.method
                })),
                maxCmdNum
            );
        } catch {
            // A `once` job has no period to fall back on, so leave it cold
            // rather than let one failed batch retire it for good.
            for (const job of pending) {
                if (job.strategy === 'once') {
                    job.nextMs = null;
                }
            }
            return;
        }

        for (const reply of replies) {
            this.onAck(reply);
        }
    }
}
