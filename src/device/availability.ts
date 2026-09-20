import type { Endpoint } from '../endpoint';
import type { MerossMessage, MerossPayload } from '../protocol/message';
import { HUB_ONLINE_NAMESPACE, decodeHubOnline } from '../protocol/codecs/online';
import { SYSTEM_ALL_NAMESPACE, decodeSystemAllGetAck } from '../protocol/codecs/system-all';
import { Heartbeat } from './heartbeat';

function isPushOrGetAck(method: string): boolean {
    return method === 'PUSH' || method === 'GETACK';
}

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
    /** Same identifier as DevicePoller.clearMqtt — All status !== 1 drops MQTT-active. */
    clearMqtt?: () => void;
    /** System.All `firmware.innerIp` can change after DHCP. */
    onInnerIp?: (innerIp: string | undefined) => void;
    /**
     * GETACK is a pending reply, not PUSH, so the dispatcher will not call
     * onPush. Runtime still applies the payload on this device.
     */
    onAck?: (message: MerossMessage) => void;
    heartbeatIntervalMs?: number;
    now?: () => number;
}

/**
 * Board online is heard-from-the-device, not firmware `online.status`. A live
 * hub can still have an out-of-range sensor. `{uuid}#{subDeviceId}` rows follow
 * Hub.Online and System.All digest; a dead hub still forces every child offline.
 */
export class DeviceAvailability {
    private readonly board: Endpoint[] = [];
    private readonly children = new Map<string, Endpoint>();
    private readonly request: DeviceAvailabilityOptions['request'];
    private readonly onOnlineChange?: (online: boolean) => void;
    private readonly clearMqtt?: () => void;
    private readonly onInnerIp?: (innerIp: string | undefined) => void;
    private readonly onAck?: (message: MerossMessage) => void;
    private readonly heartbeat: Heartbeat;

    private online: boolean;

    constructor(options: DeviceAvailabilityOptions) {
        this.request = options.request;
        this.onOnlineChange = options.onOnlineChange;
        this.clearMqtt = options.clearMqtt;
        this.onInnerIp = options.onInnerIp;
        this.onAck = options.onAck;
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
        // setOnline no-ops when already true; recordResponse first so an
        // inbound while offline still resets the probe backoff.
        this.setOnline(true);

        const { namespace, method } = message.header;
        if (namespace === HUB_ONLINE_NAMESPACE && isPushOrGetAck(method)) {
            try {
                for (const entry of decodeHubOnline(message.payload)) {
                    this.setChildOnline(entry.id, entry.online);
                }
            } catch {
                // A bad payload must not clear child state; digest and the next PUSH still apply.
            }
            return;
        }

        if (namespace === SYSTEM_ALL_NAMESPACE && isPushOrGetAck(method)) {
            try {
                this.applySystemAll(message);
            } catch {
                // A bad PUSH/GETACK must not drop board reachability; heartbeat
                // pollOnline still fails the probe when All cannot be decoded.
            }
        }
    }

    /**
     * Firmware liveness is System.All; System.Online is not used as the probe.
     * Decode errors reject so Heartbeat.perform marks offline.
     */
    private async pollOnline(): Promise<void> {
        const reply = await this.request(SYSTEM_ALL_NAMESPACE, 'GET', {});
        this.onAck?.(reply);
        this.applySystemAll(reply);
    }

    /**
     * LAN has no Hub.Online poll; child status rides the System.All digest.
     * Digest omits status when the hub has no recent child info; a missing
     * status is not treated as offline. Board reachability is not taken from
     * `online.status` — status !== 1 only clears MQTT-active.
     */
    private applySystemAll(message: MerossMessage): void {
        const all = decodeSystemAllGetAck(message.payload);
        if (all.online.status !== 1) {
            this.clearMqtt?.();
        }
        this.onInnerIp?.(all.firmware.innerIp);
        for (const sub of all.digest.hub?.subdevice ?? []) {
            if (sub.status !== undefined) {
                this.setChildOnline(sub.id, sub.status === 1);
            }
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
