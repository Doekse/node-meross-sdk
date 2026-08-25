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

export const DEFAULT_MAX_ERRORS = 1;
export const DEFAULT_ERROR_BUDGET_WINDOW_MS = 60_000;

export interface RoutedRequestOptions {
    uuid: string;
    namespace: string;
    method: string;
    payload?: MerossPayload;
    ip?: string | null;
    encryptionKey?: Buffer;
}

export interface GetCommand {
    namespace: string;
    payload?: MerossPayload;
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
}

export interface TransportRouterOptions {
    mqtt: MqttTransport;
    lan: LanHttpTransport;
    maxErrors?: number;
    errorBudgetTimeWindowMs?: number;
    now?: () => number;
}

interface BudgetEntry {
    budget: number;
    windowStart: number;
}

/**
 * Always try LAN when an IP is known; MQTT is the fallback. There is no
 * public `transportMode` — Homey (and any host) should not choose a path.
 */
export class TransportRouter {
    readonly mqtt: MqttTransport;
    readonly lan: LanHttpTransport;

    private readonly maxErrors: number;
    private readonly windowMs: number;
    private readonly now: () => number;
    private readonly budgets = new Map<string, BudgetEntry>();

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
        this.budgets.clear();
        await this.mqtt.disconnect();
    }

    /**
     * True when {@link request} would skip LAN (no IP or error budget spent).
     * DevicePoller uses this for cloud smart/once caps.
     */
    isCloudPath(uuid: string, ip?: string | null): boolean {
        return !ip || this.budgetEntry(uuid).budget < 1;
    }

    /**
     * Prefer LAN when `ip` is set and the device still has error budget;
     * MQTT otherwise. A device ERROR method is a delivered command, not a
     * transport failure, so it does not failover.
     */
    async request(options: RoutedRequestOptions): Promise<MerossMessage> {
        const command = {
            uuid: options.uuid,
            namespace: options.namespace,
            method: options.method,
            payload: options.payload
        };

        if (options.ip && this.budgetEntry(options.uuid).budget >= 1) {
            try {
                return await this.lan.request({
                    ...command,
                    ip: options.ip,
                    encryptionKey: options.encryptionKey
                });
            } catch (error) {
                if (error instanceof CommandError) {
                    throw error;
                }
                if (error instanceof TransportError) {
                    this.budgetEntry(options.uuid).budget -= 1;
                }
            }
        }

        return this.mqtt.request(command);
    }

    /**
     * Pack GETs into `Appliance.Control.Multiple` batches of `maxCmdNum`.
     * Unpacks the SETACK so callers still see one GETACK (or ERROR) per GET.
     */
    async requestGets(options: RequestGetsOptions): Promise<MerossMessage[]> {
        const maxCmdNum = options.maxCmdNum ?? 0;
        if (maxCmdNum < 2) {
            return this.sendGets(options.gets, options);
        }

        const leading: GetCommand[] = [];
        const packable: GetCommand[] = [];
        for (const get of options.gets) {
            if (canPackInMultiple(get.namespace)) {
                packable.push(get);
            } else {
                leading.push(get);
            }
        }

        const results = await this.sendGets(leading, options);
        for (let index = 0; index < packable.length;) {
            const chunk = packable.slice(index, index + maxCmdNum);
            index += chunk.length;
            if (chunk.length === 1) {
                results.push(...await this.sendGets(chunk, options));
                continue;
            }

            const packed = await this.request({
                uuid: options.uuid,
                namespace: MULTIPLE_NAMESPACE,
                method: 'SET',
                payload: encodeMultipleSet(chunk.map((get) => ({
                    header: { method: 'GET', namespace: get.namespace },
                    payload: get.payload ?? {}
                }))),
                ip: options.ip,
                encryptionKey: options.encryptionKey
            });
            const subs = decodeMultipleAck(packed.payload);
            if (subs.length !== chunk.length) {
                throw new ProtocolError(
                    `Control.Multiple SETACK count ${subs.length} != ${chunk.length}`
                );
            }
            for (const sub of subs) {
                results.push({
                    header: {
                        ...packed.header,
                        namespace: sub.header.namespace,
                        method: sub.header.method
                    },
                    payload: sub.payload
                });
            }
        }
        return results;
    }

    private async sendGets(gets: GetCommand[], options: RequestGetsOptions): Promise<MerossMessage[]> {
        const results: MerossMessage[] = [];
        for (const get of gets) {
            results.push(await this.request({
                uuid: options.uuid,
                namespace: get.namespace,
                method: 'GET',
                payload: get.payload,
                ip: options.ip,
                encryptionKey: options.encryptionKey
            }));
        }
        return results;
    }

    private budgetEntry(uuid: string): BudgetEntry {
        const now = this.now();
        let entry = this.budgets.get(uuid);
        if (!entry || now > entry.windowStart + this.windowMs) {
            entry = { budget: this.maxErrors, windowStart: now };
            this.budgets.set(uuid, entry);
        }
        return entry;
    }
}
