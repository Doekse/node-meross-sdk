import {
    CONFIG_OVERTEMP_NAMESPACE,
    CONFIG_STANDBY_KILLER_NAMESPACE,
    CONSUMPTIONH_NAMESPACE,
    CONSUMPTIONX_NAMESPACE,
    CONSUMPTION_CONFIG_NAMESPACE,
    CONTROL_ALERT_CONFIG_NAMESPACE,
    CONTROL_ALERT_REPORT_NAMESPACE,
    CONTROL_OVERTEMP_NAMESPACE,
    ELECTRICITY_NAMESPACE,
    ELECTRICITYX_NAMESPACE,
    decodeAlertConfigPush,
    decodeAlertReportPush,
    decodeConfigOverTempPush,
    decodeConsumptionConfigGetAck,
    decodeConsumptionHGetAck,
    decodeConsumptionXGetAck,
    decodeControlOverTempPush,
    decodeElectricityGetAck,
    decodeElectricityXGetAck,
    decodeStandbyKillerPush,
    encodeAlertConfigSet,
    encodeConfigOverTempSet,
    encodeConsumptionConfigGet,
    encodeConsumptionHGet,
    encodeConsumptionXDelete,
    encodeConsumptionXGet,
    encodeElectricityGet,
    encodeElectricityXGet,
    encodeStandbyKillerSet,
    type AlertConfigEntry,
    type AlertReportEntry,
    type ConfigOverTempState,
    type ConsumptionHHour,
    type ConsumptionXDay,
    type ControlOverTempState,
    type ElectricityConfig,
    type ElectricitySample,
    type MerossMessage,
    type StandbyKillerEntry
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
    overTempEnabled?: boolean;
    overTempType?: number;
    overTempActive?: boolean;
    overTempTimestamp?: number;
    alertConfigType?: number;
    alertConfig?: Record<string, unknown>;
    alertReport?: Record<string, unknown>;
    standbyKillerEnabled?: boolean;
    standbyKillerPower?: number;
    standbyKillerTime?: number;
    standbyKillerAlert?: boolean;
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

    /**
     * On-demand only. Returns `undefined` when ConsumptionH is not advertised.
     */
    async getHourlyConsumption(): Promise<ConsumptionHHour[] | undefined> {
        if (!this.bind.hasConsumptionH) {
            return undefined;
        }
        await this.pollHourlyConsumption();
        return this.last.hourly;
    }

    /**
     * On-demand only. Returns `undefined` when ConsumptionConfig is not advertised.
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
     * SET Config.OverTemp. No-op when the namespace is not advertised.
     */
    async setOverTemp(enabled: boolean, type?: number): Promise<void> {
        if (!this.has(CONFIG_OVERTEMP_NAMESPACE)) {
            return;
        }
        await this.bind.request({
            namespace: CONFIG_OVERTEMP_NAMESPACE,
            method: 'SET',
            payload: encodeConfigOverTempSet({ enabled, type })
        });
        this.applyConfigOverTemp({ enabled, ...(type !== undefined ? { type } : {}) });
    }

    /**
     * SET Control.AlertConfig for this channel. No-op when absent (EM06 / similar).
     */
    async setAlertConfig(options: {
        type?: number;
        value?: Record<string, unknown>;
    }): Promise<void> {
        if (!this.has(CONTROL_ALERT_CONFIG_NAMESPACE)) {
            return;
        }
        await this.bind.request({
            namespace: CONTROL_ALERT_CONFIG_NAMESPACE,
            method: 'SET',
            payload: encodeAlertConfigSet({
                channel: this.bind.channel,
                ...options
            })
        });
        this.applyAlertConfig({
            channel: this.bind.channel,
            ...(options.type !== undefined ? { type: options.type } : {}),
            ...(options.value !== undefined ? { value: options.value } : {})
        });
    }

    /**
     * SET Config.StandbyKiller for this channel (MSS305). No-op when absent.
     */
    async setStandbyKiller(options: {
        enabled?: boolean;
        power?: number;
        time?: number;
        alert?: boolean;
    }): Promise<void> {
        if (!this.has(CONFIG_STANDBY_KILLER_NAMESPACE)) {
            return;
        }
        await this.bind.request({
            namespace: CONFIG_STANDBY_KILLER_NAMESPACE,
            method: 'SET',
            payload: encodeStandbyKillerSet({
                channel: this.bind.channel,
                ...options
            })
        });
        this.applyStandbyKiller({
            channel: this.bind.channel,
            ...(options.enabled !== undefined ? { enabled: options.enabled } : {}),
            ...(options.power !== undefined ? { power: options.power } : {}),
            ...(options.time !== undefined ? { time: options.time } : {}),
            ...(options.alert !== undefined ? { alert: options.alert } : {})
        });
    }

    /**
     * DELETE is all-or-nothing and does not PUSH, so the local list updates here.
     * No-op when ConsumptionX is not advertised.
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
            return;
        }
        if (message.header.namespace === CONFIG_OVERTEMP_NAMESPACE && this.has(CONFIG_OVERTEMP_NAMESPACE)) {
            this.applyConfigOverTemp(decodeConfigOverTempPush(message.payload));
            return;
        }
        if (message.header.namespace === CONTROL_OVERTEMP_NAMESPACE && this.has(CONTROL_OVERTEMP_NAMESPACE)) {
            const entry = decodeControlOverTempPush(message.payload)
                .find((row) => row.channel === this.bind.channel);
            if (entry) {
                this.applyControlOverTemp(entry);
            }
            return;
        }
        if (message.header.namespace === CONTROL_ALERT_CONFIG_NAMESPACE && this.has(CONTROL_ALERT_CONFIG_NAMESPACE)) {
            const entry = decodeAlertConfigPush(message.payload)
                .find((row) => row.channel === this.bind.channel);
            if (entry) {
                this.applyAlertConfig(entry);
            }
            return;
        }
        if (message.header.namespace === CONTROL_ALERT_REPORT_NAMESPACE && this.has(CONTROL_ALERT_REPORT_NAMESPACE)) {
            const entry = decodeAlertReportPush(message.payload)
                .find((row) => row.channel === this.bind.channel);
            if (entry) {
                this.applyAlertReport(entry);
            }
            return;
        }
        if (message.header.namespace === CONFIG_STANDBY_KILLER_NAMESPACE && this.has(CONFIG_STANDBY_KILLER_NAMESPACE)) {
            const entry = decodeStandbyKillerPush(message.payload)
                .find((row) => row.channel === this.bind.channel);
            if (entry) {
                this.applyStandbyKiller(entry);
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

    private applyConfigOverTemp(state: ConfigOverTempState): void {
        const values: EnergyValues = { overTempEnabled: state.enabled };
        if (state.type !== undefined) {
            values.overTempType = state.type;
        }
        if (
            this.last.overTempEnabled === values.overTempEnabled
            && this.last.overTempType === values.overTempType
        ) {
            return;
        }
        this.last = { ...this.last, ...values };
        this.bind.emitChange(values);
    }

    private applyControlOverTemp(entry: ControlOverTempState): void {
        const values: EnergyValues = { overTempActive: entry.active };
        if (entry.timestamp !== undefined) {
            values.overTempTimestamp = entry.timestamp;
        }
        if (
            this.last.overTempActive === values.overTempActive
            && this.last.overTempTimestamp === values.overTempTimestamp
        ) {
            return;
        }
        this.last = { ...this.last, ...values };
        this.bind.emitChange(values);
    }

    private applyAlertConfig(entry: AlertConfigEntry): void {
        const values: EnergyValues = {};
        if (entry.type !== undefined) {
            values.alertConfigType = entry.type;
        }
        if (entry.value !== undefined) {
            values.alertConfig = entry.value;
        }
        if (
            this.last.alertConfigType === values.alertConfigType
            && JSON.stringify(this.last.alertConfig) === JSON.stringify(values.alertConfig)
        ) {
            return;
        }
        this.last = { ...this.last, ...values };
        this.bind.emitChange(values);
    }

    private applyAlertReport(entry: AlertReportEntry): void {
        const values: EnergyValues = { alertReport: entry.fields };
        if (JSON.stringify(this.last.alertReport) === JSON.stringify(values.alertReport)) {
            return;
        }
        this.last = { ...this.last, ...values };
        this.bind.emitChange(values);
    }

    private applyStandbyKiller(entry: StandbyKillerEntry): void {
        const values: EnergyValues = {};
        if (entry.enabled !== undefined) {
            values.standbyKillerEnabled = entry.enabled;
        }
        if (entry.power !== undefined) {
            values.standbyKillerPower = entry.power;
        }
        if (entry.time !== undefined) {
            values.standbyKillerTime = entry.time;
        }
        if (entry.alert !== undefined) {
            values.standbyKillerAlert = entry.alert;
        }
        if (
            this.last.standbyKillerEnabled === values.standbyKillerEnabled
            && this.last.standbyKillerPower === values.standbyKillerPower
            && this.last.standbyKillerTime === values.standbyKillerTime
            && this.last.standbyKillerAlert === values.standbyKillerAlert
        ) {
            return;
        }
        this.last = { ...this.last, ...values };
        this.bind.emitChange(values);
    }
}
