import type { Endpoint } from '../endpoint';
import type { MerossMessage, MerossPayload } from '../protocol/message';
import {
    HUB_ONLINE_NAMESPACE,
    ONLINE_NAMESPACE,
    decodeHubOnline,
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
 * Board online is independent of hub children: a live hub can still have an
 * out-of-range sensor. `{uuid}#{subDeviceId}` rows follow Hub.Online and
 * System.All digest; a dead hub still forces every child offline.
 */
export class DeviceAvailability {
    private readonly uuid: string;
    private readonly board: Endpoint[] = [];
    private readonly children = new Map<string, Endpoint>();
    private readonly request: DeviceAvailabilityOptions['request'];
    private readonly onOnlineChange?: (online: boolean) => void;
    private readonly onInnerIp?: (innerIp: string | undefined) => void;
    private readonly heartbeat: Heartbeat;

    private online: boolean;

    constructor(options: DeviceAvailabilityOptions) {
        this.uuid = options.uuid;
        this.request = options.request;
        this.onOnlineChange = options.onOnlineChange;
        this.onInnerIp = options.onInnerIp;
        this.online = options.initialOnline;
        const prefix = `${options.uuid}#`;
        for (const endpoint of options.endpoints) {
            if (endpoint.id.startsWith(prefix)) {
                this.children.set(endpoint.id.slice(prefix.length), endpoint);
            } else {
                this.board.push(endpoint);
            }
        }
        this.heartbeat = new Heartbeat({
            intervalMs: options.heartbeatIntervalMs,
            isOnline: () => this.online,
            pollOnline: () => this.pollOnline(),
            onSilenceOffline: () => this.setOnline(false),
            now: options.now
        });
    }

    /**
     * Children start from digest online, ANDed with hub liveness, so they do
     * not inherit the board flag and cannot appear online while the hub is down.
     */
    start(): void {
        for (const endpoint of this.board) {
            endpoint.setAvailability(this.online, true);
        }
        for (const endpoint of this.children.values()) {
            endpoint.setAvailability(this.online && endpoint.isOnline(), true);
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
        this.heartbeat.recordResponse();

        const { namespace, method } = message.header;
        if (namespace === ONLINE_NAMESPACE && (method === 'PUSH' || method === 'GETACK')) {
            const status = decodeOnlineStatus(message.payload);
            if (status !== undefined) {
                this.setOnline(status === 1);
            }
            return;
        }

        if (namespace === HUB_ONLINE_NAMESPACE && (method === 'PUSH' || method === 'GETACK')) {
            try {
                for (const entry of decodeHubOnline(message.payload)) {
                    this.setChildOnline(entry.id, entry.online);
                }
            } catch {
                // A bad payload must not clear child state; digest and the next PUSH still apply.
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

    /**
     * LAN has no Hub.Online poll; child status rides the System.All digest.
     * Digest omits status when the hub has no recent child info; a missing
     * status is not treated as offline.
     */
    private applySystemAll(message: MerossMessage): void {
        try {
            const all = decodeSystemAllGetAck(message.payload);
            this.setOnline(all.online.status === 1);
            this.onInnerIp?.(all.firmware.innerIp);
            for (const sub of all.digest.hub?.subdevice ?? []) {
                if (sub.status !== undefined) {
                    this.setChildOnline(sub.id, sub.status === 1);
                }
            }
        } catch {
            // Malformed All is ignored; Heartbeat silence still marks offline.
        }
    }

    /**
     * Hub children are reachable only through the board, so they go offline
     * with it. Returning the board does not imply the children are back;
     * Hub.Online or digest must say so.
     */
    private setOnline(online: boolean): void {
        if (this.online === online) {
            return;
        }
        this.online = online;
        for (const endpoint of this.board) {
            endpoint.setAvailability(online);
        }
        if (!online) {
            for (const endpoint of this.children.values()) {
                endpoint.setAvailability(false);
            }
        }
        this.onOnlineChange?.(online);
    }

    /**
     * Hub.Online / digest child flags are still gated on board liveness.
     */
    private setChildOnline(subDeviceId: string, online: boolean): void {
        this.children.get(subDeviceId)?.setAvailability(this.online && online);
    }
}
