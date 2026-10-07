import {
    THERMOSTAT_MODEC_NAMESPACE,
    encodeThermostatModeCSet
} from '../protocol/codecs/climate';
import { ClimateBoardBase } from './climate-board';
import type {
    ClimateFanSpeed,
    ClimateModeCMode,
    ClimateTraitBoardBind
} from './climate-core';

/**
 * Thermostat.ModeC (MTS300-class). Fan speed lives here; eco/manual slots do not.
 * ModeC `work` has no timer wire value.
 */
export class ClimateModeCTrait extends ClimateBoardBase {
    readonly generation = 'modeC' as const;

    constructor(bind: ClimateTraitBoardBind) {
        super(bind);
    }

    /**
     * Maps off onto mode rather than a separate toggle.
     */
    async setOn(on: boolean): Promise<{ on: boolean }> {
        await this.request({
            namespace: THERMOSTAT_MODEC_NAMESPACE,
            method: 'SET',
            payload: encodeThermostatModeCSet({
                channel: this.channel,
                mode: on
                    ? (this.last.mode === 'off' || this.last.mode === undefined ? 'heat' : this.last.mode)
                    : 'off'
            })
        });
        this.applyChange(on ? { on } : { on, mode: 'off' });
        return { on };
    }

    async setMode(mode: ClimateModeCMode): Promise<{ mode: ClimateModeCMode }> {
        await this.request({
            namespace: THERMOSTAT_MODEC_NAMESPACE,
            method: 'SET',
            payload: encodeThermostatModeCSet({ channel: this.channel, mode })
        });
        this.applyChange({ mode, on: mode !== 'off' });
        return { mode };
    }

    async setTargetTemperature(celsius: number): Promise<{ targetTemperature: number }> {
        await this.request({
            namespace: THERMOSTAT_MODEC_NAMESPACE,
            method: 'SET',
            payload: encodeThermostatModeCSet({
                channel: this.channel,
                targetTemperature: celsius,
                mode: this.last.mode
            })
        });
        this.applyChange({ targetTemperature: celsius });
        return { targetTemperature: celsius };
    }

    async setHeatTemperature(celsius: number): Promise<{ heatTemperature: number }> {
        await this.request({
            namespace: THERMOSTAT_MODEC_NAMESPACE,
            method: 'SET',
            payload: encodeThermostatModeCSet({ channel: this.channel, heatTemperature: celsius })
        });
        this.applyChange({ heatTemperature: celsius });
        return { heatTemperature: celsius };
    }

    async setCoolTemperature(celsius: number): Promise<{ coolTemperature: number }> {
        await this.request({
            namespace: THERMOSTAT_MODEC_NAMESPACE,
            method: 'SET',
            payload: encodeThermostatModeCSet({ channel: this.channel, coolTemperature: celsius })
        });
        this.applyChange({ coolTemperature: celsius });
        return { coolTemperature: celsius };
    }

    async setWorkMode(workMode: 'manual' | 'schedule'): Promise<{ workMode: 'manual' | 'schedule' }> {
        await this.request({
            namespace: THERMOSTAT_MODEC_NAMESPACE,
            method: 'SET',
            payload: encodeThermostatModeCSet({ channel: this.channel, workMode })
        });
        this.applyChange({ workMode });
        return { workMode };
    }

    async setFanSpeed(
        fanSpeed: ClimateFanSpeed,
        fanHoldMinutes?: number
    ): Promise<{ fanSpeed: ClimateFanSpeed }> {
        await this.request({
            namespace: THERMOSTAT_MODEC_NAMESPACE,
            method: 'SET',
            payload: encodeThermostatModeCSet({
                channel: this.channel,
                fanSpeed,
                ...(fanHoldMinutes !== undefined ? { fanHoldMinutes } : {})
            })
        });
        this.applyChange({
            fanSpeed,
            ...(fanHoldMinutes !== undefined ? { fanHoldMinutes } : {})
        });
        return { fanSpeed };
    }
}
