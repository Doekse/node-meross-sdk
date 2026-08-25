import {
    CONSUMPTIONH_NAMESPACE,
    CONSUMPTIONX_NAMESPACE,
    CONSUMPTION_CONFIG_NAMESPACE,
    ELECTRICITY_NAMESPACE,
    ELECTRICITYX_NAMESPACE,
    decodeConsumptionConfigGetAck,
    decodeConsumptionHGetAck,
    decodeConsumptionXGetAck,
    decodeElectricityGetAck,
    decodeElectricityXGetAck,
    encodeConsumptionConfigGet,
    encodeConsumptionHGet,
    encodeConsumptionXDelete,
    encodeConsumptionXGet,
    encodeElectricityGet,
    encodeElectricityXGet,
    type ConsumptionHHour,
    type ConsumptionXDay,
    type ElectricityConfig,
    type ElectricitySample,
    type MerossMessage
} from '../protocol';
import type { RoutedRequestOptions } from '../transport/router';

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
    /** Ability keys; extras no-op when the namespace is absent. */
    namespaces?: ReadonlySet<string>;
    request: (options: Omit<RoutedRequestOptions, 'uuid' | 'ip' | 'encryptionKey'>) => Promise<MerossMessage>;
    emitChange: (values: EnergyValues) => void;
}

export type { ElectricityConfig };

/**
 * Power plus consumption samples for one enrolled endpoint. DevicePoller owns
 * the schedule; this trait applies GETACK/PUSH and exposes on-demand `poll()`.
 */
export class EnergyTrait {
    private readonly bind: EnergyTraitBind;
    private readonly namespaces: ReadonlySet<string>;
    private last: EnergyValues = {};

    constructor(bind: EnergyTraitBind) {
        this.bind = bind;
        this.namespaces = bind.namespaces ?? new Set();
    }

    private has(namespace: string): boolean {
        return this.namespaces.has(namespace);
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

    /**
     * Fetches plug calibration coefficients. On-demand only; returns
     * `undefined` when ConsumptionConfig is not advertised.
     */
    async getCalibration(): Promise<ElectricityConfig | undefined> {
        if (!this.has(CONSUMPTION_CONFIG_NAMESPACE)) {
            return undefined;
        }
        const reply = await this.bind.request({
            namespace: CONSUMPTION_CONFIG_NAMESPACE,
            method: 'GET',
            payload: encodeConsumptionConfigGet()
        });
        return decodeConsumptionConfigGetAck(reply.payload);
    }

    /**
     * Deletes every stored daily record. DELETE is all-or-nothing and does
     * not PUSH, so the local list updates here. No-op when ConsumptionX is
     * not advertised.
     */
    async deleteConsumption(): Promise<void> {
        if (!this.bind.hasConsumptionX) {
            return;
        }
        await this.bind.request({
            namespace: CONSUMPTIONX_NAMESPACE,
            method: 'DELETE',
            payload: encodeConsumptionXDelete()
        });
        this.applyConsumption([]);
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
            const sample = decodeElectricityXGetAck(reply.payload)
                .find((entry) => entry.channel === this.bind.channel);
            if (sample) {
                this.applyElectricity(sample);
            }
        } catch {
            // Next poller tick or on-demand poll retries.
        }
    }

    private async pollConsumption(): Promise<void> {
        try {
            const reply = await this.bind.request({
                namespace: CONSUMPTIONX_NAMESPACE,
                method: 'GET',
                payload: encodeConsumptionXGet()
            });
            this.applyConsumption(decodeConsumptionXGetAck(reply.payload));
        } catch {
            // Next poller tick or on-demand poll retries.
        }
    }

    private async pollHourlyConsumption(): Promise<void> {
        try {
            const reply = await this.bind.request({
                namespace: CONSUMPTIONH_NAMESPACE,
                method: 'GET',
                payload: encodeConsumptionHGet(this.bind.channel)
            });
            const sample = decodeConsumptionHGetAck(reply.payload)
                .find((entry) => entry.channel === this.bind.channel);
            if (sample) {
                this.applyHourlyConsumption(sample.hourly);
            }
        } catch {
            // Next poller tick or on-demand poll retries.
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
