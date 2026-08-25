import type { Endpoint } from '../endpoint';
import type { MerossMessage, MerossPayload } from '../protocol/message';
import {
    ONLINE_NAMESPACE,
    decodeOnlineStatus
} from '../protocol/codecs/online';
import { Heartbeat } from './heartbeat';
import { SYSTEM_ALL_NAMESPACE, decodeSystemAllGetAck } from './system-all';

export interface DeviceAvailabilityOptions {
    uuid: string;
    initialOnline: boolean;
    endpoints: readonly Endpoint[];
    request: (
        namespace: string,
        method: 'GET',
        payload?: MerossPayload
    ) => Promise<MerossMessage>;
    /** Notifies DevicePoller so cold-start / MQTT-active reset stay in sync. */
    onOnlineChange?: (online: boolean) => void;
    /** System.All `firmware.innerIp` can change after DHCP. */
    onInnerIp?: (innerIp: string | undefined) => void;
    heartbeatIntervalMs?: number;
    now?: () => number;
}

/**
 * Tracks one physical board and fans out `availability` to its endpoints.
 */
export class DeviceAvailability {
    private readonly uuid: string;
    private readonly endpoints: readonly Endpoint[];
    private readonly request: DeviceAvailabilityOptions['request'];
    private readonly onOnlineChange?: (online: boolean) => void;
    private readonly onInnerIp?: (innerIp: string | undefined) => void;
    private readonly heartbeat: Heartbeat;

    private online: boolean;

    constructor(options: DeviceAvailabilityOptions) {
        this.uuid = options.uuid;
        this.endpoints = options.endpoints;
        this.request = options.request;
        this.onOnlineChange = options.onOnlineChange;
        this.onInnerIp = options.onInnerIp;
        this.online = options.initialOnline;
        this.heartbeat = new Heartbeat({
            intervalMs: options.heartbeatIntervalMs,
            isOnline: () => this.online,
            pollOnline: () => this.pollOnline(),
            onSilenceOffline: () => this.setOnline(false),
            now: options.now
        });
    }

    start(): void {
        for (const endpoint of this.endpoints) {
            endpoint.setAvailability(this.online, true);
        }
        this.heartbeat.start();
    }

    stop(): void {
        this.heartbeat.stop();
    }

    isOnline(): boolean {
        return this.online;
    }

    handleMessage(message: MerossMessage): void {
        const uuid = message.header.uuid
            ?? /^\/appliance\/([^/]+)\//.exec(message.header.from)?.[1];
        if (uuid !== this.uuid) {
            return;
        }

        this.heartbeat.recordResponse();

        const { namespace, method } = message.header;
        if (namespace === ONLINE_NAMESPACE && (method === 'PUSH' || method === 'GETACK')) {
            const status = decodeOnlineStatus(message.payload);
            if (status !== undefined) {
                this.setOnline(status === 1);
            }
            return;
        }

        if (namespace === SYSTEM_ALL_NAMESPACE && (method === 'PUSH' || method === 'GETACK')) {
            this.applySystemAll(message);
            return;
        }

        if (namespace === 'Appliance.System.Runtime' && method === 'GETACK') {
            const runtime = message.payload.runtime;
            if (runtime && typeof runtime === 'object' && !Array.isArray(runtime)) {
                const iotStatus = (runtime as { iotStatus?: unknown }).iotStatus;
                if (iotStatus === 2) {
                    this.setOnline(false);
                }
            }
        }
    }

    /**
     * Firmware liveness is System.All; System.Online is not used as the probe.
     */
    private async pollOnline(): Promise<void> {
        const reply = await this.request(SYSTEM_ALL_NAMESPACE, 'GET', {});
        this.applySystemAll(reply);
    }

    private applySystemAll(message: MerossMessage): void {
        try {
            const all = decodeSystemAllGetAck(message.payload);
            this.setOnline(all.online.status === 1);
            this.onInnerIp?.(all.firmware.innerIp);
        } catch {
            // Malformed All is ignored; Heartbeat silence still marks offline.
        }
    }

    private setOnline(online: boolean): void {
        if (this.online === online) {
            return;
        }
        this.online = online;
        for (const endpoint of this.endpoints) {
            endpoint.setAvailability(online);
        }
        this.onOnlineChange?.(online);
    }
}
