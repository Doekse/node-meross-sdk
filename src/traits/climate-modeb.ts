import {
    THERMOSTAT_MODEB_NAMESPACE,
    encodeThermostatModeBSet
} from '../protocol/codecs/climate';
import { ClimateBoardBase } from './climate-board';
import type {
    ClimateModeBMode,
    ClimateTraitBoardBind,
    ClimateWorkMode
} from './climate-core';

/**
 * Thermostat.ModeB. Working is heat/cool; workMode includes timer.
 */
export class ClimateModeBTrait extends ClimateBoardBase {
    readonly generation = 'modeB' as const;

    /** @internal */
    constructor(bind: ClimateTraitBoardBind) {
        super(bind);
    }

    async setOn(on: boolean): Promise<{ on: boolean }> {
        await this.request({
            namespace: THERMOSTAT_MODEB_NAMESPACE,
            method: 'SET',
            payload: encodeThermostatModeBSet({ channel: this.channel, on })
        });
        this.applyChange(on ? { on } : { on, mode: 'off' });
        return { on };
    }

    async setMode(mode: ClimateModeBMode): Promise<{ mode: ClimateModeBMode }> {
        await this.request({
            namespace: THERMOSTAT_MODEB_NAMESPACE,
            method: 'SET',
            payload: encodeThermostatModeBSet({
                channel: this.channel,
                on: mode !== 'off',
                ...(mode === 'heat' || mode === 'cool' ? { working: mode } : {})
            })
        });
        this.applyChange({ mode, on: mode !== 'off' });
        return { mode };
    }

    async setTargetTemperature(celsius: number): Promise<{ targetTemperature: number }> {
        await this.request({
            namespace: THERMOSTAT_MODEB_NAMESPACE,
            method: 'SET',
            payload: encodeThermostatModeBSet({ channel: this.channel, targetTemperature: celsius })
        });
        this.applyChange({ targetTemperature: celsius });
        return { targetTemperature: celsius };
    }

    /**
     * ModeB has one shared target slot.
     */
    async setHeatTemperature(celsius: number): Promise<{ heatTemperature: number }> {
        await this.request({
            namespace: THERMOSTAT_MODEB_NAMESPACE,
            method: 'SET',
            payload: encodeThermostatModeBSet({ channel: this.channel, targetTemperature: celsius })
        });
        this.applyChange({ heatTemperature: celsius, targetTemperature: celsius });
        return { heatTemperature: celsius };
    }

    async setCoolTemperature(celsius: number): Promise<{ coolTemperature: number }> {
        await this.request({
            namespace: THERMOSTAT_MODEB_NAMESPACE,
            method: 'SET',
            payload: encodeThermostatModeBSet({ channel: this.channel, targetTemperature: celsius })
        });
        this.applyChange({ coolTemperature: celsius, targetTemperature: celsius });
        return { coolTemperature: celsius };
    }

    async setWorkMode(workMode: ClimateWorkMode): Promise<{ workMode: ClimateWorkMode }> {
        await this.request({
            namespace: THERMOSTAT_MODEB_NAMESPACE,
            method: 'SET',
            payload: encodeThermostatModeBSet({ channel: this.channel, workMode })
        });
        this.applyChange({ workMode });
        return { workMode };
    }
}
