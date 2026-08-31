import { CommandError, ProtocolError, TransportError } from '../errors';
import {
    MULTIPLE_NAMESPACE,
    canPackInMultiple,
    decodeMultipleAck,
    encodeMultipleSet
} from '../protocol';
import type { MerossMessage, MerossPayload } from '../protocol';
import type { LanHttpTransport } from './lan-http';
import type { MqttTransport } from './mqtt';
import type { PublishPriority } from './rate-limit';

export const DEFAULT_MAX_ERRORS = 1;
export const DEFAULT_ERROR_BUDGET_WINDOW_MS = 60_000;

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
    priority?: PublishPriority;
}

export interface TransportRouterOptions {
    mqtt: MqttTransport;
    lan: LanHttpTransport;
    maxErrors?: number;
    errorBudgetTimeWindowMs?: number;
    now?: () => number;
}

/** Remaining LAN failures allowed for one device before the window resets. */
interface ErrorBudget {
    remaining: number;
    windowStart: number;
}

/**
 * Always try LAN when an IP is known; MQTT is the fallback. There is no
 * public `transportMode` — hosts should not choose a path.
 */
export class TransportRouter {
    readonly mqtt: MqttTransport;
    readonly lan: LanHttpTransport;

    private readonly maxErrors: number;
    private readonly windowMs: number;
    private readonly now: () => number;
    private readonly errorBudgets = new Map<string, ErrorBudget>();

    constructor(options: TransportRouterOptions) {
        this.mqtt = options.mqtt;
        this.lan = options.lan;
        this.maxErrors = options.maxErrors ?? DEFAULT_MAX_ERRORS;
        this.windowMs = options.errorBudgetTimeWindowMs ?? DEFAULT_ERROR_BUDGET_WINDOW_MS;
        this.now = options.now ?? Date.now;
    }

    async connect(): Promise<void> {
        await this.mqtt.connect();
    }

    async disconnect(): Promise<void> {
        this.errorBudgets.clear();
        await this.mqtt.disconnect();
    }

    /**
     * True when {@link request} would skip LAN (no IP or error budget spent).
     * DevicePoller uses this for cloud smart/once caps.
     */
    isCloudPath(uuid: string, ip?: string | null): boolean {
        return !ip || this.errorBudget(uuid).remaining < 1;
    }

    /**
     * Device ERROR and an unusable LAN body are delivered commands, not
     * transport failures, so they do not failover.
     */
    async request(options: RoutedRequestOptions): Promise<MerossMessage> {
        const command = {
            uuid: options.uuid,
            namespace: options.namespace,
            method: options.method,
            payload: options.payload,
            priority: options.priority
        };

        if (options.ip && this.errorBudget(options.uuid).remaining >= 1) {
            try {
                return await this.lan.request({
                    ...command,
                    ip: options.ip,
                    encryptionKey: options.encryptionKey
                });
            } catch (error) {
                if (error instanceof CommandError || error instanceof ProtocolError) {
                    throw error;
                }
                if (error instanceof TransportError) {
                    this.errorBudget(options.uuid).remaining -= 1;
                }
            }
        }

        return this.mqtt.request(command);
    }

    /**
     * Pack GETs into `Appliance.Control.Multiple` batches of `maxCmdNum`.
     * Unpacks the SETACK so callers still see one GETACK (or ERROR) per GET.
     * PUSH-query and System.All / Hub.ToggleX stay unscoped. When a packed
     * Multiple fails, the chunk is retried as singles (HTTP truncation).
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
        } catch (error) {
            if (error instanceof CommandError) {
                throw error;
            }
            return this.sendGets(chunk, options);
        }
    }

    private async sendGets(gets: GetCommand[], options: RequestGetsOptions): Promise<MerossMessage[]> {
        const results: MerossMessage[] = [];
        for (const get of gets) {
            results.push(await this.request({
                uuid: options.uuid,
                namespace: get.namespace,
                method: get.method ?? 'GET',
                payload: get.payload,
                ip: options.ip,
                encryptionKey: options.encryptionKey,
                priority: options.priority
            }));
        }
        return results;
    }

    private errorBudget(uuid: string): ErrorBudget {
        const now = this.now();
        let entry = this.errorBudgets.get(uuid);
        if (!entry || now > entry.windowStart + this.windowMs) {
            entry = { remaining: this.maxErrors, windowStart: now };
            this.errorBudgets.set(uuid, entry);
        }
        return entry;
    }
}
