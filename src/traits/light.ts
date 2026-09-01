import {
    LIGHT_CAPACITY_EFFECT,
    LIGHT_CAPACITY_LUMINANCE,
    LIGHT_CAPACITY_RGB,
    LIGHT_CAPACITY_TEMPERATURE,
    LIGHT_EFFECT_NAMESPACE,
    LIGHT_NAMESPACE,
    decodeLightEffectPush,
    decodeLightGetAck,
    decodeLightPush,
    encodeLightEffectSet,
    encodeLightSet,
    TOGGLEX_NAMESPACE,
    decodeToggleXPush,
    encodeToggleXSet,
    type LightChannelWireState,
    type LightEffectEntry,
    type MerossMessage
} from '../protocol';
import type { RoutedRequestOptions } from '../transport/router';

export interface LightRgb {
    r: number;
    g: number;
    b: number;
}

export interface LightValues {
    on?: boolean;
    /** Host range is `0..1`. */
    brightness?: number;
    /** Host range is `0..1`. */
    temperature?: number;
    rgb?: LightRgb;
    effect?: number;
}

/**
 * Transport + channel bind for one Control.Light endpoint.
 * Session supplies the request transport and ToggleX preference.
 */
export interface LightTraitBind {
    uuid: string;
    channel: number;
    /** ToggleX when advertised; classic Toggle only when ToggleX is absent. */
    hasToggleX: boolean;
    hasToggle: boolean;
    /** Light.Effect catalog SET needs this namespace. */
    hasLightEffect: boolean;
    /** Capacity bitmask from Ability; the trait updates it after the first GETACK. */
    lightCapacity: number;
    request: (options: Omit<RoutedRequestOptions, 'uuid' | 'ip' | 'encryptionKey'>) => Promise<MerossMessage>;
    emitChange: (values: LightValues) => void;
}

/**
 * Brightness, color, and power for one enrolled light endpoint. Power routes
 * through ToggleX/Toggle when the device has it; Control.Light handles the rest.
 */
export class LightTrait {
    private readonly bind: LightTraitBind;
    private lightCapacity: number;

    private on: boolean | undefined;
    private brightness: number | undefined;
    private temperature: number | undefined;
    private rgb: LightRgb | undefined;
    private effect: number | undefined;
    private effectCatalog: LightEffectEntry[] = [];

    constructor(bind: LightTraitBind) {
        this.bind = bind;
        this.lightCapacity = bind.lightCapacity;
    }

    /** Undefined until poller GETACK or PUSH fills it. */
    isOn(): boolean | undefined {
        return this.on;
    }

    /** Host range is `0..1`. Undefined until GETACK or PUSH fills it. */
    getBrightness(): number | undefined {
        return this.brightness;
    }

    /** Host range is `0..1`. Undefined until GETACK or PUSH fills it. */
    getTemperature(): number | undefined {
        return this.temperature;
    }

    getRgb(): LightRgb | undefined {
        return this.rgb && { ...this.rgb };
    }

    getEffect(): number | undefined {
        return this.effect;
    }

    /** Empty when Light.Effect is absent. */
    getEffectNames(): string[] {
        return this.effectCatalog.map((entry) => entry.effectName);
    }

    /**
     * Devices without Light.Effect still take an effect id on Control.Light.
     * MSL320 also needs that catalog row enabled on Light.Effect.
     */
    async setEffect(effect: number): Promise<{ effect: number }> {
        await this.bind.request({
            namespace: LIGHT_NAMESPACE,
            method: 'SET',
            payload: encodeLightSet({
                channel: this.bind.channel,
                capacity: LIGHT_CAPACITY_EFFECT,
                effect
            })
        });
        this.applyLight({ channel: this.bind.channel, capacity: 0, effect });

        if (this.bind.hasLightEffect) {
            const entry = this.effectCatalog[effect];
            await this.bind.request({
                namespace: LIGHT_EFFECT_NAMESPACE,
                method: 'SET',
                payload: encodeLightEffectSet([{ ...entry, enable: 1 }])
            });
        }

        return { effect };
    }

    async setOn(on: boolean): Promise<{ on: boolean }> {
        if (this.bind.hasToggleX) {
            await this.bind.request({
                namespace: TOGGLEX_NAMESPACE,
                method: 'SET',
                payload: encodeToggleXSet({ channel: this.bind.channel, on })
            });
        } else if (this.bind.hasToggle) {
            await this.bind.request({
                namespace: 'Appliance.Control.Toggle',
                method: 'SET',
                payload: { toggle: { onoff: on ? 1 : 0 } }
            });
        } else {
            await this.bind.request({
                namespace: LIGHT_NAMESPACE,
                method: 'SET',
                payload: encodeLightSet({ channel: this.bind.channel, capacity: this.lightCapacity, onoff: on })
            });
        }
        this.applyOn(on);
        return { on };
    }

    /**
     * Capacity 0x4 treats luminance 0 as off; the usual scale is 1–100.
     */
    async setBrightness(brightness: number): Promise<{ brightness: number }> {
        const luminance = brightness === 0 ? 0 : hostToWire01(brightness);
        const reply = await this.bind.request({
            namespace: LIGHT_NAMESPACE,
            method: 'SET',
            payload: encodeLightSet({ channel: this.bind.channel, capacity: LIGHT_CAPACITY_LUMINANCE, luminance })
        });
        this.applyLight(decodeLightGetAck(reply.payload));
        if (luminance === 0) {
            this.applyOn(false);
        }
        return { brightness: this.brightness ?? brightness };
    }

    async setTemperature(temperature: number): Promise<{ temperature: number }> {
        const wire = hostToWire01(temperature);
        const reply = await this.bind.request({
            namespace: LIGHT_NAMESPACE,
            method: 'SET',
            payload: encodeLightSet({ channel: this.bind.channel, capacity: LIGHT_CAPACITY_TEMPERATURE, temperature: wire })
        });
        this.applyLight(decodeLightGetAck(reply.payload));
        return { temperature: this.temperature ?? temperature };
    }

    async setRgb(rgb: LightRgb): Promise<{ rgb: LightRgb }> {
        const reply = await this.bind.request({
            namespace: LIGHT_NAMESPACE,
            method: 'SET',
            payload: encodeLightSet({ channel: this.bind.channel, capacity: LIGHT_CAPACITY_RGB, rgb: rgbToWire(rgb) })
        });
        this.applyLight(decodeLightGetAck(reply.payload));
        return { rgb: this.rgb ?? rgb };
    }

    handlePush(message: MerossMessage): void {

        if (message.header.namespace === TOGGLEX_NAMESPACE && this.bind.hasToggleX) {
            for (const entry of decodeToggleXPush(message.payload)) {
                if (entry.channel === this.bind.channel) {
                    this.applyOn(entry.on);
                    return;
                }
            }
            return;
        }

        if (message.header.namespace === 'Appliance.Control.Toggle' && this.bind.hasToggle) {
            if (this.bind.channel === 0) {
                const toggle = message.payload.toggle as { onoff?: unknown } | undefined;
                if (toggle && typeof toggle.onoff === 'number') {
                    this.applyOn(toggle.onoff === 1);
                }
            }
            return;
        }

        if (message.header.namespace === LIGHT_NAMESPACE) {
            const decoded = decodeLightPush(message.payload);
            if (decoded.channel === this.bind.channel) {
                this.applyLight(decoded, !this.bind.hasToggleX && !this.bind.hasToggle);
            }
            return;
        }

        if (message.header.namespace === LIGHT_EFFECT_NAMESPACE && this.bind.hasLightEffect) {
            this.effectCatalog = decodeLightEffectPush(message.payload);
        }
    }

    private applyOn(on: boolean): void {
        if (this.on === on) {
            return;
        }
        this.on = on;
        this.bind.emitChange({ on });
    }

    private applyLight(decoded: LightChannelWireState, applyOnoff = false): void {
        const patch: LightValues = {};

        if (decoded.capacity !== 0) {
            this.lightCapacity = decoded.capacity;
        }
        if (decoded.luminance !== undefined) {
            this.brightness = wireToHost01(decoded.luminance);
            patch.brightness = this.brightness;
        }
        if (decoded.temperature !== undefined) {
            this.temperature = wireToHost01(decoded.temperature);
            patch.temperature = this.temperature;
        }
        if (decoded.rgb !== undefined) {
            this.rgb = wireToRgb(decoded.rgb);
            patch.rgb = this.rgb;
        }
        if (decoded.effect !== undefined) {
            this.effect = decoded.effect;
            patch.effect = this.effect;
        }
        if (applyOnoff && typeof decoded.onoff === 'boolean') {
            this.on = decoded.onoff;
            patch.on = this.on;
        }

        if (Object.keys(patch).length > 0) {
            this.bind.emitChange(patch);
        }
    }
}

/**
 * Firmware packs RGB as 0xRRGGBB, not three payload fields.
 */
function wireToRgb(rgbWire: number): LightRgb {
    const r = (rgbWire >> 16) & 0xff;
    const g = (rgbWire >> 8) & 0xff;
    const b = rgbWire & 0xff;
    return { r, g, b };
}

/**
 * Inverse of {@link wireToRgb}.
 */
function rgbToWire(rgb: LightRgb): number {
    const r = clampInt(rgb.r, 0, 0xff);
    const g = clampInt(rgb.g, 0, 0xff);
    const b = clampInt(rgb.b, 0, 0xff);
    return (r << 16) | (g << 8) | b;
}

/**
 * Firmware luminance/temperature is 1–100; host APIs use 0..1. Zero stays zero
 * so capacity 0x4 can still mean off.
 */
function hostToWire01(value: number): number {
    const clamped = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
    return Math.round(clamped * 99) + 1;
}

/**
 * Inverse of {@link hostToWire01}. Firmware 0 (off) maps to host 0.
 */
function wireToHost01(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }
    if (value <= 0) {
        return 0;
    }
    return (value - 1) / 99;
}

function clampInt(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, Math.trunc(value)));
}

