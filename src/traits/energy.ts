import {
    CONSUMPTIONX_NAMESPACE,
    ELECTRICITY_NAMESPACE,
    ELECTRICITYX_NAMESPACE,
    decodeConsumptionXGetAck,
    decodeElectricityGetAck,
    decodeElectricityXGetAck,
    encodeConsumptionXGet,
    encodeElectricityGet,
    encodeElectricityXGet,
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
    request: (options: Omit<RoutedRequestOptions, 'uuid' | 'ip' | 'encryptionKey'>) => Promise<MerossMessage>;
    emitChange: (values: EnergyValues) => void;
    electricityIntervalMs?: number;
    consumptionIntervalMs?: number;
}

/**
 * Power and daily consumption for one enrolled endpoint. Electricity and
 * ConsumptionX are request/response, so this trait owns its poll timers.
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
        return { ...this.last };
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
}
