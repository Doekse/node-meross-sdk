import type { Endpoint, TraitName } from '../endpoint';
import { DevicePoller, type PollJob } from '../poll';
import { SYSTEM_ALL_NAMESPACE } from '../protocol/codecs/system-all';
import type { MerossMessage } from '../protocol/message';
import { loadTraitDescriptor } from '../traits/load';
import type { GetCommand } from '../transport/router';
import { DeviceAvailability, type DeviceAvailabilityOptions } from './availability';

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
    private readonly isCloudPath: () => boolean;
    private readonly availability: DeviceAvailability;
    private readonly poller: DevicePoller;
    /**
     * Namespace → (endpoint, trait) lists. Built once from
     * {@link loadTraitDescriptor} `push` so each frame is an O(1) lookup
     * instead of walking every trait on every endpoint. Shared namespaces
     * (ToggleX on switch+light+fan) stay lists, not 1:1.
     */
    private readonly handlers = new Map<string, { endpoint: Endpoint; trait: TraitName }[]>();

    constructor(options: DeviceRuntimeOptions) {
        this.endpoints = options.endpoints;
        this.isCloudPath = options.isCloudPath;

        for (const endpoint of this.endpoints) {
            for (const name of endpoint.traits) {
                // Names can be listed without a constructed instance (sensor family).
                if (endpoint[name] === undefined) {
                    continue;
                }
                for (const namespace of loadTraitDescriptor(name).push) {
                    const list = this.handlers.get(namespace) ?? [];
                    list.push({ endpoint, trait: name });
                    this.handlers.set(namespace, list);
                }
            }
        }

        const availability = new DeviceAvailability({
            uuid: options.uuid,
            initialOnline: options.initialOnline,
            endpoints: options.endpoints,
            request: options.request,
            onOnlineChange: (online) => poller.setOnline(online),
            clearMqtt: () => poller.clearMqtt(),
            onInnerIp: (innerIp) => {
                options.onInnerIp?.(innerIp);
                this.publishProtocol();
            },
            onAck: (message) => this.handlePush(message),
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
            ).finally(() => {
                this.publishProtocol();
            }),
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
        this.publishProtocol(true);
    }

    stop(): void {
        this.poller.stop();
        this.availability.stop();
        this.handlers.clear();
    }

    /** LAN GETACK/PUSH liveness, distinct from {@link handleMessage}'s availability decode. */
    recordPush(): void {
        this.poller.recordPush();
    }

    /**
     * ERROR and SETACK are skipped so poller onAck and dispatcher onPush share
     * one gate. Unknown namespaces are a no-op.
     *
     * Packed Control.Multiple inbound is not System.All; poller onAck delivers
     * the unpacked GETACK here so {@link handleMessage} still sees innerIp,
     * clearMqtt, and hub digest. Decode errors stay swallowed so a bad All
     * cannot fail the rest of the batch.
     */
    handlePush(message: MerossMessage): void {
        const { method, namespace } = message.header;
        if (method === 'ERROR' || method === 'SETACK') {
            return;
        }
        if (namespace === SYSTEM_ALL_NAMESPACE) {
            this.handleMessage(message);
        }
        const list = this.handlers.get(namespace);
        if (!list) {
            return;
        }
        for (const { endpoint, trait } of list) {
            endpoint.handlePush(message, trait);
        }
    }

    handleMessage(message: MerossMessage): void {
        this.availability.handleMessage(message);
    }

    clearMqtt(): void {
        this.poller.clearMqtt();
    }

    /**
     * Endpoint does not choose a path; this copies the router's current LAN vs
     * MQTT decision after that decision may have changed.
     */
    publishProtocol(force = false): void {
        const protocol = this.isCloudPath() ? 'mqtt' : 'http';
        for (const endpoint of this.endpoints) {
            endpoint.setProtocol(protocol, force);
        }
    }
}
