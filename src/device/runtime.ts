import type { Endpoint } from '../endpoint';
import type { MerossMessage } from '../protocol/message';
import type { GetCommand } from '../transport/router';
import { DeviceAvailability, type DeviceAvailabilityOptions } from './availability';
import { DevicePoller, type PollJob } from '../poll';

export interface DeviceRuntimeOptions {
    uuid: string;
    initialOnline: boolean;
    endpoints: readonly Endpoint[];
    request: DeviceAvailabilityOptions['request'];
    /** System.All `firmware.innerIp` can change after DHCP. */
    onInnerIp?: (innerIp: string | undefined) => void;
    heartbeatIntervalMs?: number;
    isCloudPath: () => boolean;
    httpDown?: () => boolean;
    maxCmdNum: () => number;
    /**
     * One extra parameter versus {@link DevicePoller}'s own `requestGets`:
     * the caller routes the request (it owns the transport), so
     * DeviceRuntime hands back its poller's own `shrinkResponseBudget` for
     * the caller to wire into that request instead of reaching into the
     * poller itself.
     */
    requestGets: (gets: GetCommand[], maxCmdNum: number, onPackedFallback: () => void) => Promise<MerossMessage[]>;
    /**
     * GETACK is a pending reply, not PUSH, so the dispatcher will not call
     * onPush. The caller still applies the payload on this device.
     */
    onAck: (message: MerossMessage) => void;
    jobs?: readonly PollJob[];
    pollIntervalMs?: number;
    /** Delay before the first poll tick; see DevicePoller's POLL_START_STAGGER_MS. */
    startDelayMs?: number;
    now?: () => number;
}

/**
 * A device's availability tracking and poll scheduling, combined into one
 * lifecycle. The two are mutually referential — the poller reads the
 * availability's online state, the availability tells the poller when that
 * state changes — so they are constructed and wired here, in one place with
 * its own tests, rather than by every caller.
 */
export class DeviceRuntime {
    readonly endpoints: readonly Endpoint[];
    private readonly availability: DeviceAvailability;
    private readonly poller: DevicePoller;

    constructor(options: DeviceRuntimeOptions) {
        this.endpoints = options.endpoints;

        const availability = new DeviceAvailability({
            uuid: options.uuid,
            initialOnline: options.initialOnline,
            endpoints: options.endpoints,
            request: options.request,
            onOnlineChange: (online) => poller.setOnline(online),
            onInnerIp: options.onInnerIp,
            heartbeatIntervalMs: options.heartbeatIntervalMs,
            now: options.now
        });
        // Mutually referential with `availability`; both only read each
        // other from callbacks, so declaration order is safe.
        const poller: DevicePoller = new DevicePoller({
            isOnline: () => availability.isOnline(),
            isCloudPath: options.isCloudPath,
            httpDown: options.httpDown,
            maxCmdNum: options.maxCmdNum,
            requestGets: (gets, maxCmdNum) => options.requestGets(
                gets,
                maxCmdNum,
                () => poller.shrinkResponseBudget()
            ),
            onAck: options.onAck,
            jobs: options.jobs,
            intervalMs: options.pollIntervalMs,
            startDelayMs: options.startDelayMs,
            now: options.now
        });

        this.availability = availability;
        this.poller = poller;
    }

    start(): void {
        this.availability.start();
        this.poller.start();
    }

    stop(): void {
        this.poller.stop();
        this.availability.stop();
    }

    /** LAN GETACK/PUSH liveness, distinct from {@link handleMessage}'s availability decode. */
    recordPush(): void {
        this.poller.recordPush();
    }

    handleMessage(message: MerossMessage): void {
        this.availability.handleMessage(message);
    }

    clearMqtt(): void {
        this.poller.clearMqtt();
    }
}
