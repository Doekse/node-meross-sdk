import type { Endpoint, TraitName } from './endpoint';
import { Poller, type PollJob } from '../poll';
import type { MerossMessage } from '../protocol/message';
import { TRAIT_CATALOGS } from '../traits/catalog';
import type { GetCommand } from '../transport/router';
import { Availability, type AvailabilityOptions } from './availability';

export interface RuntimeOptions {
    uuid: string;
    initialOnline: boolean;
    endpoints: readonly Endpoint[];
    request: AvailabilityOptions['request'];
    /** System.All `firmware.innerIp` can change after DHCP. */
    onInnerIp?: (innerIp: string | undefined) => void;
    heartbeatIntervalMs?: number;
    isCloudPath: () => boolean;
    httpDown?: () => boolean;
    maxCmdNum: () => number;
    /**
     * One extra parameter versus {@link Poller}'s own `requestGets`:
     * the caller routes the request (it owns the transport), so
     * Runtime hands back its poller's own `shrinkResponseBudget` for
     * the caller to wire into that request instead of reaching into the
     * poller itself.
     */
    requestGets: (gets: GetCommand[], maxCmdNum: number, onPackedFallback: () => void) => Promise<MerossMessage[]>;
    jobs?: readonly PollJob[];
    pollIntervalMs?: number;
    /** Delay before the first poll tick; see Poller's POLL_START_STAGGER_MS. */
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
export class Runtime {
    readonly endpoints: readonly Endpoint[];
    private readonly isCloudPath: () => boolean;
    private readonly availability: Availability;
    private readonly poller: Poller;
    /**
     * Namespace → (endpoint, trait) lists. Built once from catalog `push`
     * so each frame is an O(1) lookup instead of walking every trait on
     * every endpoint. Shared namespaces (ToggleX on switch+light+fan) stay
     * lists, not 1:1.
     */
    private readonly handlers = new Map<string, { endpoint: Endpoint; trait: TraitName }[]>();

    constructor(options: RuntimeOptions) {
        this.endpoints = options.endpoints;
        this.isCloudPath = options.isCloudPath;

        for (const endpoint of this.endpoints) {
            for (const name of endpoint.traits) {
                // Names can be listed without a constructed instance (sensor family).
                if (endpoint[name] === undefined) {
                    continue;
                }
                for (const namespace of TRAIT_CATALOGS[name].push) {
                    const list = this.handlers.get(namespace) ?? [];
                    list.push({ endpoint, trait: name });
                    this.handlers.set(namespace, list);
                }
            }
        }

        const availability = new Availability({
            uuid: options.uuid,
            initialOnline: options.initialOnline,
            endpoints: options.endpoints,
            request: options.request,
            onOnlineChange: (online) => poller.setOnline(online),
            clearMqttActive: () => poller.clearMqttActive(),
            onInnerIp: (innerIp) => {
                options.onInnerIp?.(innerIp);
                this.refreshProtocol();
            },
            onAck: (message) => this.applyUpdate(message),
            heartbeatIntervalMs: options.heartbeatIntervalMs,
            now: options.now
        });
        // Mutually referential with `availability`; both only read each
        // other from callbacks, so declaration order is safe.
        const poller: Poller = new Poller({
            isOnline: () => availability.isOnline(),
            isCloudPath: options.isCloudPath,
            httpDown: options.httpDown,
            maxCmdNum: options.maxCmdNum,
            requestGets: (gets, maxCmdNum) => options.requestGets(
                gets,
                maxCmdNum,
                () => poller.shrinkResponseBudget()
            ).finally(() => {
                this.refreshProtocol();
            }),
            onAck: (message) => this.applyUpdate(message),
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
        this.refreshProtocol(true);
    }

    stop(): void {
        this.poller.stop();
        this.availability.stop();
        this.handlers.clear();
    }

    /** LAN GETACK/PUSH liveness, distinct from {@link observeInbound}'s availability decode. */
    markMqttActive(): void {
        this.poller.markMqttActive();
    }

    /** Heartbeat/liveness only; payload state is {@link applyUpdate}. */
    observeInbound(message: MerossMessage): void {
        this.availability.observeInbound(message);
    }

    /**
     * ERROR and SETACK are skipped so poller onAck and dispatcher onPush share
     * one gate. Unknown namespaces are a no-op for traits.
     *
     * Availability payload (System.All, Hub.Online) and trait handlers each
     * run once. Packed Control.Multiple inbound is not System.All; poller
     * onAck delivers each unpacked GETACK here.
     */
    applyUpdate(message: MerossMessage): void {
        const { method, namespace } = message.header;
        if (method === 'ERROR' || method === 'SETACK') {
            return;
        }
        this.availability.applyUpdate(message);
        const list = this.handlers.get(namespace);
        if (!list) {
            return;
        }
        for (const { endpoint, trait } of list) {
            endpoint.handlePush(message, trait);
        }
    }

    clearMqttActive(): void {
        this.poller.clearMqttActive();
    }

    /**
     * Endpoint does not choose a path; this copies the router's current LAN vs
     * MQTT decision after that decision may have changed.
     */
    refreshProtocol(force = false): void {
        const protocol = this.isCloudPath() ? 'mqtt' : 'http';
        for (const endpoint of this.endpoints) {
            endpoint.setProtocol(protocol, force);
        }
    }
}
