import {
    THERMOSTAT_MODE_NAMESPACE,
    encodeThermostatModeSet
} from '../protocol/codecs/climate';
import { ClimateBoardBase } from './climate-board';
import type { ClimateModeMode, ClimateTraitBoardBind } from './climate-core';

/**
 * Thermostat.Mode (MTS200-class). Eco/manual slots exist here; workMode and
 * fanSpeed do not.
 */
export class ClimateModeTrait extends ClimateBoardBase {
    readonly generation = 'mode' as const;

    constructor(bind: ClimateTraitBoardBind) {
        super(bind);
    }

    /**
     * Writes onoff only. Mode.mode stays so auto/eco/manual survive a toggle;
     * `setMode('off')` is the SET that writes mode=0.
     */
    async setOn(on: boolean): Promise<{ on: boolean }> {
        await this.request({
            namespace: THERMOSTAT_MODE_NAMESPACE,
            method: 'SET',
            payload: encodeThermostatModeSet({ channel: this.channel, on })
        });
        this.applyChange({ on });
        return { on };
    }

    async setMode(mode: ClimateModeMode): Promise<{ mode: ClimateModeMode }> {
        await this.request({
            namespace: THERMOSTAT_MODE_NAMESPACE,
            method: 'SET',
            payload: encodeThermostatModeSet({ channel: this.channel, mode })
        });
        this.applyChange({ mode, on: mode !== 'off' });
        return { mode };
    }

    async setTargetTemperature(celsius: number): Promise<{ targetTemperature: number }> {
        await this.request({
            namespace: THERMOSTAT_MODE_NAMESPACE,
            method: 'SET',
            payload: encodeThermostatModeSet({ channel: this.channel, targetTemperature: celsius })
        });
        this.applyChange({ targetTemperature: celsius });
        return { targetTemperature: celsius };
    }

    async setHeatTemperature(celsius: number): Promise<{ heatTemperature: number }> {
        await this.request({
            namespace: THERMOSTAT_MODE_NAMESPACE,
            method: 'SET',
            payload: encodeThermostatModeSet({ channel: this.channel, heatTemperature: celsius })
        });
        this.applyChange({ heatTemperature: celsius });
        return { heatTemperature: celsius };
    }

    async setCoolTemperature(celsius: number): Promise<{ coolTemperature: number }> {
        await this.request({
            namespace: THERMOSTAT_MODE_NAMESPACE,
            method: 'SET',
            payload: encodeThermostatModeSet({ channel: this.channel, coolTemperature: celsius })
        });
        this.applyChange({ coolTemperature: celsius });
        return { coolTemperature: celsius };
    }

    async setEcoTemperature(celsius: number): Promise<{ ecoTemperature: number }> {
        await this.request({
            namespace: THERMOSTAT_MODE_NAMESPACE,
            method: 'SET',
            payload: encodeThermostatModeSet({ channel: this.channel, ecoTemperature: celsius })
        });
        this.applyChange({ ecoTemperature: celsius });
        return { ecoTemperature: celsius };
    }

    async setManualTemperature(celsius: number): Promise<{ manualTemperature: number }> {
        await this.request({
            namespace: THERMOSTAT_MODE_NAMESPACE,
            method: 'SET',
            payload: encodeThermostatModeSet({ channel: this.channel, manualTemperature: celsius })
        });
        this.applyChange({ manualTemperature: celsius });
        return { manualTemperature: celsius };
    }
}
