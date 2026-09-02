import { CommandError, ProtocolError } from '../errors';
import {
    MULTIPLE_NAMESPACE,
    SYSTEM_ALL_NAMESPACE,
    canPackInMultiple,
    decodeMultipleAck,
    encodeMultipleSet
} from '../protocol';
import type { MerossMessage, MerossPayload } from '../protocol';
import type { LanHttpTransport } from './lan-http';
import type { MqttTransport } from './mqtt';
import type { PublishPriority } from './rate-limit';

export interface RoutedRequestOptions {
    uuid: string;
    namespace: string;
    method: string;
    payload?: MerossPayload;
    ip?: string | null;
    encryptionKey?: Buffer;
    /**
     * Only reaches the MQTT rate limiter; LAN HTTP has no publish window.
     * Defaults to `user`, so scheduled work must opt in to `background`.
     */
    priority?: PublishPriority;
}

export interface GetCommand {
    namespace: string;
    payload?: MerossPayload;
    method?: 'GET' | 'PUSH';
}

export interface RequestGetsOptions {
    uuid: string;
    gets: GetCommand[];
    ip?: string | null;
    encryptionKey?: Buffer;
    /**
     * Ability `Appliance.Control.Multiple.maxCmdNum`. Below 2, GETs go out
     * one at a time.
     */
    maxCmdNum?: number;
    /**
     * Called after a truncated Multiple so DevicePoller can shrink the HTTP
     * packing budget for the next cycle.
     */
    onPackedFallback?: () => void;
    priority?: PublishPriority;
}

export interface TransportRouterOptions {
    mqtt: MqttTransport;
    lan: LanHttpTransport;
}

/**
 * Prefer LAN when an IP is known; MQTT is the fallback for that request.
 * There is no public `transportMode` — hosts should not choose a path.
 */
export class TransportRouter {
    readonly mqtt: MqttTransport;
    readonly lan: LanHttpTransport;

    /** Prefer MQTT until a later System.All succeeds; other LAN failures do not set this. */
    private readonly httpDown = new Set<string>();

    constructor(options: TransportRouterOptions) {
        this.mqtt = options.mqtt;
        this.lan = options.lan;
    }

    async connect(): Promise<void> {
        await this.mqtt.connect();
    }

    async disconnect(): Promise<void> {
        this.httpDown.clear();
        await this.mqtt.disconnect();
    }

    /**
     * DevicePoller uses this for cloud smart/once caps: no IP, or HTTP marked
     * down.
     */
    isCloudPath(uuid: string, ip?: string | null): boolean {
        return !ip || this.httpDown.has(uuid);
    }

    /**
     * The poller probes System.All on this, not on cloud-only devices that
     * never had a host.
     */
    isHttpDown(uuid: string): boolean {
        return this.httpDown.has(uuid);
    }

    /**
     * Device ERROR and an unusable LAN body are delivered commands, not
     * transport failures, so they do not failover or mark HTTP down.
     */
    async request(options: RoutedRequestOptions): Promise<MerossMessage> {
        const command = {
            uuid: options.uuid,
            namespace: options.namespace,
            method: options.method,
            payload: options.payload,
            priority: options.priority
        };

        const tryLan = Boolean(options.ip)
            && (!this.httpDown.has(options.uuid) || options.namespace === SYSTEM_ALL_NAMESPACE);

        if (tryLan) {
            try {
                const reply = await this.lan.request({
                    ...command,
                    ip: options.ip!,
                    encryptionKey: options.encryptionKey
                });
                this.httpDown.delete(options.uuid);
                return reply;
            } catch (error) {
                if (error instanceof CommandError || error instanceof ProtocolError) {
                    throw error;
                }
                // Mark HTTP down only on Appliance.System.All failure; other
                // namespaces still retry LAN next cycle.
                if (options.namespace === SYSTEM_ALL_NAMESPACE) {
                    this.httpDown.add(options.uuid);
                }
            }
        }

        return this.mqtt.request(command);
    }

    /**
     * Pack GETs into `Appliance.Control.Multiple` batches of `maxCmdNum`.
     * Unpacks the SETACK so callers still see one GETACK (or ERROR) per GET.
     * PUSH-query stays unscoped: Control.Multiple sub-commands are always
     * method GET. A packed Multiple that fails is retried as singles so HTTP
     * truncation cannot drop the rest of the chunk.
     */
    async requestGets(options: RequestGetsOptions): Promise<MerossMessage[]> {
        const maxCmdNum = options.maxCmdNum ?? 0;
        if (maxCmdNum < 2) {
            return this.sendGets(options.gets, options);
        }

        const leading: GetCommand[] = [];
        const packable: GetCommand[] = [];
        for (const get of options.gets) {
            if ((get.method ?? 'GET') === 'GET' && canPackInMultiple(get.namespace)) {
                packable.push(get);
            } else {
                leading.push(get);
            }
        }

        const results = await this.sendGets(leading, options);
        for (let i = 0; i < packable.length; i += maxCmdNum) {
            const chunk = packable.slice(i, i + maxCmdNum);
            if (chunk.length === 1) {
                results.push(...await this.sendGets(chunk, options));
                continue;
            }
            results.push(...await this.sendPacked(chunk, options));
        }
        return results;
    }

    private async sendPacked(
        chunk: GetCommand[],
        options: RequestGetsOptions
    ): Promise<MerossMessage[]> {
        try {
            const packed = await this.request({
                uuid: options.uuid,
                namespace: MULTIPLE_NAMESPACE,
                method: 'SET',
                payload: encodeMultipleSet(chunk.map((get) => ({
                    header: { method: 'GET', namespace: get.namespace },
                    payload: get.payload ?? {}
                }))),
                ip: options.ip,
                encryptionKey: options.encryptionKey,
                priority: options.priority
            });
            const subs = decodeMultipleAck(packed.payload);
            if (subs.length !== chunk.length) {
                throw new ProtocolError(
                    `Control.Multiple SETACK count ${subs.length} != ${chunk.length}`
                );
            }
            return subs.map((sub) => ({
                header: {
                    ...packed.header,
                    namespace: sub.header.namespace,
                    method: sub.header.method
                },
                payload: sub.payload
            }));
        } catch {
            options.onPackedFallback?.();
            // Retry a failed Multiple as singles, then continue when one of
            // those also fails so later namespaces in the chunk still run.
            const results: MerossMessage[] = [];
            for (const get of chunk) {
                try {
                    results.push(await this.sendGet(get, options));
                } catch {
                    // Remaining namespaces in this chunk still run.
                }
            }
            return results;
        }
    }

    private sendGet(get: GetCommand, options: RequestGetsOptions): Promise<MerossMessage> {
        return this.request({
            uuid: options.uuid,
            namespace: get.namespace,
            method: get.method ?? 'GET',
            payload: get.payload,
            ip: options.ip,
            encryptionKey: options.encryptionKey,
            priority: options.priority
        });
    }

    private async sendGets(gets: GetCommand[], options: RequestGetsOptions): Promise<MerossMessage[]> {
        const results: MerossMessage[] = [];
        for (const get of gets) {
            results.push(await this.sendGet(get, options));
        }
        return results;
    }
}
