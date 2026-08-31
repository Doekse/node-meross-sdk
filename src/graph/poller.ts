import type { MerossMessage, MerossPayload } from '../protocol/message';
import type { GetCommand } from '../transport/router';
import { SYSTEM_ALL_NAMESPACE } from './system-all';

/** One shared tick so traits do not each run their own timer. */
export const DEFAULT_POLL_INTERVAL_MS = 30_000;

/**
 * Per-device offset Session multiplies by enrollment order. Without it every
 * device would fire its first tick in the same event loop turn and then stay in
 * lockstep, bunching LAN POSTs and cloud publishes on one instant.
 */
export const POLL_START_STAGGER_MS = 250;

/** HTTP-only System.All; sits near the firmware heartbeat window. */
export const SYSTEM_ALL_PERIOD_MS = 295_000;

/** Watt-hour totals do not need the instantaneous electricity period. */
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

/** Config GETs over cloud MQTT; the slowest period, as they rarely change. */
export const CLOUDMQTT_PERIOD_MS = 1_195_000;

/** Hub battery percent barely moves; about once an hour is enough. */
export const HUB_BATTERY_PERIOD_MS = 3_600_000;

/**
 * How a namespace is scheduled. Traits register jobs; the poller owns the
 * timer so each trait does not run its own interval.
 */
export type PollStrategy = 'default' | 'smart' | 'once' | 'all';

/**
 * One namespace GET for a physical device. Deduplicated by `namespace` so a
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
     * router error budget is spent), which limits the cycle to a single
     * publish rather than one request per due job.
     */
    isCloudPath: () => boolean;
    maxCmdNum: () => number;
    requestGets: (gets: GetCommand[], maxCmdNum: number) => Promise<MerossMessage[]>;
    /** Fan out GETACKs the same way Session fans out PUSH. */
    onAck: (message: MerossMessage) => void;
    jobs?: readonly PollJob[];
    intervalMs?: number;
    /** Delay before the first tick; see {@link POLL_START_STAGGER_MS}. */
    startDelayMs?: number;
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
    /** `null` until the first request, so epoch 0 cannot read as "long ago". */
    lastRequestMs: number | null;
}

/**
 * Infinity for a job that has never run, so it sorts ahead of every job that
 * has regardless of where the clock started.
 */
function staleness(job: JobState, epoch: number): number {
    return job.lastRequestMs === null ? Number.POSITIVE_INFINITY : epoch - job.lastRequestMs;
}

/** Longest-waiting first, so no namespace can be starved by a busier one. */
function byStalest(jobs: readonly JobState[], epoch: number): JobState[] {
    return [...jobs].sort((a, b) => staleness(b, epoch) - staleness(a, epoch));
}

/**
 * Whether a job has waited past its own cloud period. A job that has never run
 * does not qualify: it already sorts first, and letting it also claim a second
 * publish is what turns a cold start into a burst.
 */
function cloudOverdue(job: JobState, epoch: number): boolean {
    return job.lastRequestMs !== null && epoch - job.lastRequestMs >= job.periodCloudMs;
}

/**
 * Publishes, not requests, are what count against the device's hourly Meross
 * budget, so a cloud cycle spends one. Control.Multiple carries `maxCmdNum`
 * namespaces in that publish; without it each GET costs its own, leaving a job
 * past its cloud period as the only reason to spend a second.
 */
function selectForCloud(due: readonly JobState[], epoch: number, maxCmdNum: number): JobState[] {
    const batchSize = maxCmdNum >= 2 ? maxCmdNum : 1;
    return byStalest(due, epoch)
        .filter((job, index) => index < batchSize || cloudOverdue(job, epoch));
}

/**
 * One loop per physical device: MQTT skip, cloud rate limit, and leftover
 * Multiple batch room for jobs that can wait.
 */
export class DevicePoller {
    private readonly uuid: string;
    private readonly isOnline: () => boolean;
    private readonly isCloudPath: () => boolean;
    private readonly maxCmdNum: () => number;
    private readonly requestGets: DevicePollerOptions['requestGets'];
    private readonly onAck: (message: MerossMessage) => void;
    private readonly intervalMs: number;
    private readonly startDelayMs: number;
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
        this.startDelayMs = options.startDelayMs ?? 0;
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
                lastRequestMs: prior?.lastRequestMs ?? null
            });
        }
    }

    start(): void {
        if (this.running) {
            return;
        }
        this.running = true;
        this.schedule(this.startDelayMs);
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
     * window so a leftover cloud PUSH does not leave HTTP-only devices stale.
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
        const due: JobState[] = [];
        const lazy: JobState[] = [];

        const mqttActive = this.mqttActive();
        let pollAll = false;
        for (const job of this.jobs.values()) {
            if (job.strategy !== 'all') {
                continue;
            }
            pollAll = job.nextMs === null || (!mqttActive && epoch >= job.nextMs);
            if (pollAll) {
                due.push(job);
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
                    due.push(job);
                    break;
                case 'smart':
                    if (job.nextMs === null || epoch >= job.nextMs) {
                        due.push(job);
                    } else {
                        lazy.push(job);
                    }
                    break;
                case 'once':
                    if (job.nextMs === null) {
                        due.push(job);
                    }
                    break;
            }
        }

        const pending = cloudPath ? selectForCloud(due, epoch, maxCmdNum) : due;

        // Top up the batch with jobs that could still wait: the publish is
        // already being spent, and spare batch room costs nothing.
        if (maxCmdNum >= 2) {
            for (const job of byStalest(lazy, epoch)) {
                if (pending.length % maxCmdNum === 0) {
                    break;
                }
                pending.push(job);
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
