import {
    CONSUMPTIONH_NAMESPACE,
    CONSUMPTIONX_NAMESPACE,
    ELECTRICITY_NAMESPACE,
    ELECTRICITYX_NAMESPACE,
    decodeConsumptionHGetAck,
    decodeConsumptionXGetAck,
    decodeElectricityGetAck,
    decodeElectricityXGetAck,
    encodeConsumptionHGet,
    encodeConsumptionXGet,
    encodeElectricityGet,
    encodeElectricityXGet,
    type ConsumptionHHour,
    type ConsumptionXDay,
    type ElectricitySample,
    type MerossMessage
} from '../protocol';
import type { RoutedRequestOptions } from '../transport/router';

export const DEFAULT_ELECTRICITY_INTERVAL_MS = 30_000;
export const DEFAULT_CONSUMPTION_INTERVAL_MS = 60_000;

export interface EnergyValues {
    power?: number;
    current?: number;
    voltage?: number;
    consume?: number;
    powerFactor?: number;
    consumption?: ConsumptionXDay[];
    hourly?: ConsumptionHHour[];
}

/**
 * Transport + channel bind for one energy endpoint. Session supplies this;
 * trait tests inject a fake request/emit pair.
 */
export interface EnergyTraitBind {
    uuid: string;
    channel: number;
    hasElectricity: boolean;
    hasElectricityX: boolean;
    hasConsumptionX: boolean;
    hasConsumptionH: boolean;
    request: (options: Omit<RoutedRequestOptions, 'uuid' | 'ip' | 'encryptionKey'>) => Promise<MerossMessage>;
    emitChange: (values: EnergyValues) => void;
    electricityIntervalMs?: number;
    consumptionIntervalMs?: number;
}

/**
 * Power plus consumption samples for one enrolled endpoint. Electricity and
 * consumption namespaces are request/response, so this trait owns poll timers.
 */
export class EnergyTrait {
    private readonly bind: EnergyTraitBind;
    private readonly electricityIntervalMs: number;
    private readonly consumptionIntervalMs: number;
    private electricityTimer: ReturnType<typeof setInterval> | undefined;
    private consumptionTimer: ReturnType<typeof setInterval> | undefined;
    private stopped = false;
    private last: EnergyValues = {};

    constructor(bind: EnergyTraitBind) {
        this.bind = bind;
        this.electricityIntervalMs = bind.electricityIntervalMs ?? DEFAULT_ELECTRICITY_INTERVAL_MS;
        this.consumptionIntervalMs = bind.consumptionIntervalMs ?? DEFAULT_CONSUMPTION_INTERVAL_MS;
    }

    /** Starts trait-owned poll loops. Idempotent. */
    start(): void {
        this.stopped = false;
        if ((this.bind.hasElectricity || this.bind.hasElectricityX) && this.electricityTimer === undefined) {
            void this.pollElectricity();
            this.electricityTimer = setInterval(
                () => void this.pollElectricity(),
                this.electricityIntervalMs
            );
            this.electricityTimer.unref();
        }
        if (this.bind.hasConsumptionX && this.consumptionTimer === undefined) {
            void this.pollConsumption();
            this.consumptionTimer = setInterval(
                () => void this.pollConsumption(),
                this.consumptionIntervalMs
            );
            this.consumptionTimer.unref();
        } else if (this.bind.hasConsumptionH && this.consumptionTimer === undefined) {
            void this.pollHourlyConsumption();
            this.consumptionTimer = setInterval(
                () => void this.pollHourlyConsumption(),
                this.consumptionIntervalMs
            );
            this.consumptionTimer.unref();
        }
    }

    stop(): void {
        this.stopped = true;
        if (this.electricityTimer !== undefined) {
            clearInterval(this.electricityTimer);
            this.electricityTimer = undefined;
        }
        if (this.consumptionTimer !== undefined) {
            clearInterval(this.consumptionTimer);
            this.consumptionTimer = undefined;
        }
    }

    async poll(): Promise<EnergyValues> {
        if (this.bind.hasElectricity || this.bind.hasElectricityX) {
            await this.pollElectricity();
        }
        if (this.bind.hasConsumptionX) {
            await this.pollConsumption();
        }
        if (this.bind.hasConsumptionH) {
            await this.pollHourlyConsumption();
        }
        return { ...this.last };
    }

    /** Fetches hourly consumption samples when ConsumptionH is available. */
    async getHourlyConsumption(): Promise<ConsumptionHHour[] | undefined> {
        if (!this.bind.hasConsumptionH) {
            return undefined;
        }
        await this.pollHourlyConsumption();
        return this.last.hourly;
    }

    handlePush(message: MerossMessage): void {
        const uuid = message.header.uuid
            ?? /^\/appliance\/([^/]+)\//.exec(message.header.from)?.[1];
        if (!uuid || uuid !== this.bind.uuid) {
            return;
        }
        if (message.header.namespace === ELECTRICITY_NAMESPACE && this.bind.hasElectricity) {
            const sample = decodeElectricityGetAck(message.payload);
            if (sample.channel === this.bind.channel) {
                this.applyElectricity(sample);
            }
            return;
        }
        if (message.header.namespace === ELECTRICITYX_NAMESPACE && this.bind.hasElectricityX) {
            const sample = decodeElectricityXGetAck(message.payload)
                .find((entry) => entry.channel === this.bind.channel);
            if (sample) {
                this.applyElectricity(sample);
            }
            return;
        }
        if (message.header.namespace === CONSUMPTIONX_NAMESPACE && this.bind.hasConsumptionX) {
            this.applyConsumption(decodeConsumptionXGetAck(message.payload));
            return;
        }
        if (message.header.namespace === CONSUMPTIONH_NAMESPACE && this.bind.hasConsumptionH) {
            const sample = decodeConsumptionHGetAck(message.payload)
                .find((entry) => entry.channel === this.bind.channel);
            if (sample) {
                this.applyHourlyConsumption(sample.hourly);
            }
        }
    }

    private async pollElectricity(): Promise<void> {
        try {
            if (this.bind.hasElectricity) {
                const reply = await this.bind.request({
                    namespace: ELECTRICITY_NAMESPACE,
                    method: 'GET',
                    payload: encodeElectricityGet({ channel: this.bind.channel })
                });
                if (this.stopped) {
                    return;
                }
                const sample = decodeElectricityGetAck(reply.payload);
                if (sample.channel === this.bind.channel) {
                    this.applyElectricity(sample);
                }
                return;
            }
            const reply = await this.bind.request({
                namespace: ELECTRICITYX_NAMESPACE,
                method: 'GET',
                payload: encodeElectricityXGet()
            });
            if (this.stopped) {
                return;
            }
            const sample = decodeElectricityXGetAck(reply.payload)
                .find((entry) => entry.channel === this.bind.channel);
            if (sample) {
                this.applyElectricity(sample);
            }
        } catch {
            // Next interval retries.
        }
    }

    private async pollConsumption(): Promise<void> {
        try {
            const reply = await this.bind.request({
                namespace: CONSUMPTIONX_NAMESPACE,
                method: 'GET',
                payload: encodeConsumptionXGet()
            });
            if (this.stopped) {
                return;
            }
            this.applyConsumption(decodeConsumptionXGetAck(reply.payload));
        } catch {
            // Next interval retries.
        }
    }

    private async pollHourlyConsumption(): Promise<void> {
        try {
            const reply = await this.bind.request({
                namespace: CONSUMPTIONH_NAMESPACE,
                method: 'GET',
                payload: encodeConsumptionHGet(this.bind.channel)
            });
            if (this.stopped) {
                return;
            }
            const sample = decodeConsumptionHGetAck(reply.payload)
                .find((entry) => entry.channel === this.bind.channel);
            if (sample) {
                this.applyHourlyConsumption(sample.hourly);
            }
        } catch {
            // Next interval retries.
        }
    }

    private applyElectricity(sample: ElectricitySample): void {
        const values: EnergyValues = {
            power: sample.power,
            current: sample.current,
            voltage: sample.voltage
        };
        if (sample.consume !== undefined) {
            values.consume = sample.consume;
        }
        if (sample.powerFactor !== undefined) {
            values.powerFactor = sample.powerFactor;
        }
        if (
            this.last.power === values.power
            && this.last.current === values.current
            && this.last.voltage === values.voltage
            && this.last.consume === values.consume
            && this.last.powerFactor === values.powerFactor
        ) {
            return;
        }
        this.last = { ...this.last, ...values };
        this.bind.emitChange(values);
    }

    private applyConsumption(consumption: ConsumptionXDay[]): void {
        if (JSON.stringify(this.last.consumption) === JSON.stringify(consumption)) {
            return;
        }
        this.last = { ...this.last, consumption };
        this.bind.emitChange({ consumption });
    }

    private applyHourlyConsumption(hourly: ConsumptionHHour[]): void {
        if (JSON.stringify(this.last.hourly) === JSON.stringify(hourly)) {
            return;
        }
        this.last = { ...this.last, hourly };
        this.bind.emitChange({ hourly });
    }
}
