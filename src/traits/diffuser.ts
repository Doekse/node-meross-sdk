import type { TraitAttachContext } from '../device/enroll-context';
import type { DiffuserTraitBind } from '../device/bindings';
import {
    DIFFUSER_LIGHT_NAMESPACE,
    DIFFUSER_SENSOR_NAMESPACE,
    DIFFUSER_SPRAY_NAMESPACE,
    decodeDiffuserLightPush,
    decodeDiffuserSensorPush,
    decodeDiffuserSprayPush,
    encodeDiffuserLightSet,
    encodeDiffuserSpraySet,
    type DiffuserLightMode,
    type DiffuserLightState,
    type DiffuserSprayMode
} from '../protocol/codecs/diffuser';
import type { MerossMessage } from '../protocol/message';
import { applyPatch } from './patch';
import type { LightRgb } from './light';
import type { TraitDescriptor } from './descriptor';
import { DiffuserCatalog } from './diffuser.catalog';

export type { DiffuserLightMode, DiffuserSprayMode };

export interface DiffuserValues {
    on?: boolean;
    lightMode?: DiffuserLightMode;
    brightness?: number;
    rgb?: LightRgb;
    sprayMode?: DiffuserSprayMode;
    humidity?: number;
    temperature?: number;
}

/**
 * MOD100/MOD150 light, spray, and optional humidity/temperature on one endpoint.
 * Namespaces differ from Control.Light / Control.Spray.
 */
export class DiffuserTrait {
    /** @internal */
    private readonly bind: DiffuserTraitBind;
    private readonly namespaces: ReadonlySet<string>;
    private last: DiffuserValues = {};

    /** @internal */
    constructor(bind: DiffuserTraitBind) {
        this.bind = bind;
        this.namespaces = bind.namespaces ?? new Set();
        Object.assign(this.last, bind.initial);
    }

    /**
     * Full cache, not the last diff. A subscriber that attaches after enroll
     * never saw the seeded fields, and an unchanged poll does not emit again.
     */
    values(): DiffuserValues {
        return { ...this.last };
    }

    /** Undefined until poller GETACK or PUSH fills it. */
    isOn(): boolean | undefined {
        return this.last.on;
    }

    /** Host range is `0..1`. Undefined until GETACK or PUSH fills it. */
    getBrightness(): number | undefined {
        return this.last.brightness;
    }

    getRgb(): LightRgb | undefined {
        return this.last.rgb && { ...this.last.rgb };
    }

    getLightMode(): DiffuserLightMode | undefined {
        return this.last.lightMode;
    }

    getSprayMode(): DiffuserSprayMode | undefined {
        return this.last.sprayMode;
    }

    async setOn(on: boolean): Promise<{ on: boolean }> {
        await this.bind.request({
            namespace: DIFFUSER_LIGHT_NAMESPACE,
            method: 'SET',
            payload: encodeDiffuserLightSet({ channel: this.bind.channel, on })
        });
        this.applyChange({ on });
        return { on };
    }

    /**
     * rotating-colors, fixed-rgb, or fixed-luminance.
     */
    async setLightMode(lightMode: DiffuserLightMode): Promise<{ lightMode: DiffuserLightMode }> {
        await this.bind.request({
            namespace: DIFFUSER_LIGHT_NAMESPACE,
            method: 'SET',
            payload: encodeDiffuserLightSet({ channel: this.bind.channel, mode: lightMode })
        });
        this.applyChange({ lightMode });
        return { lightMode };
    }

    /**
     * Firmware luminance is 0–100; host range is `0..1`.
     */
    async setBrightness(brightness: number): Promise<{ brightness: number }> {
        const luminance = Math.round(clamp01(brightness) * 100);
        await this.bind.request({
            namespace: DIFFUSER_LIGHT_NAMESPACE,
            method: 'SET',
            payload: encodeDiffuserLightSet({ channel: this.bind.channel, luminance })
        });
        this.applyChange({ brightness: luminance / 100 });
        return { brightness: luminance / 100 };
    }

    /**
     * Also switches the light into fixed-rgb mode; firmware has no RGB without it.
     */
    async setRgb(rgb: LightRgb): Promise<{ rgb: LightRgb }> {
        await this.bind.request({
            namespace: DIFFUSER_LIGHT_NAMESPACE,
            method: 'SET',
            payload: encodeDiffuserLightSet({
                channel: this.bind.channel,
                mode: 'fixed-rgb',
                rgb: rgbToWire(rgb)
            })
        });
        this.applyChange({ rgb: { ...rgb }, lightMode: 'fixed-rgb' });
        return { rgb };
    }

    /**
     * Distinct from Control.Spray wire values.
     */
    async setSprayMode(sprayMode: DiffuserSprayMode): Promise<{ sprayMode: DiffuserSprayMode }> {
        await this.bind.request({
            namespace: DIFFUSER_SPRAY_NAMESPACE,
            method: 'SET',
            payload: encodeDiffuserSpraySet({ channel: this.bind.channel, mode: sprayMode })
        });
        this.applyChange({ sprayMode });
        return { sprayMode };
    }

    /**
     * PUSH/GETACK from Runtime. Hosts subscribe to Endpoint `change`.
     *
     * @internal
     * @package
     */
    handlePush(message: MerossMessage): void {
        const ns = message.header.namespace;
        if (ns === DIFFUSER_LIGHT_NAMESPACE) {
            for (const entry of decodeDiffuserLightPush(message.payload)) {
                if (entry.channel === this.bind.channel) {
                    this.applyChange(lightPatch(entry));
                }
            }
            return;
        }
        if (ns === DIFFUSER_SPRAY_NAMESPACE) {
            for (const entry of decodeDiffuserSprayPush(message.payload)) {
                if (entry.channel === this.bind.channel) {
                    this.applyChange({ sprayMode: entry.mode });
                }
            }
            return;
        }
        if (ns === DIFFUSER_SENSOR_NAMESPACE && this.has(ns)) {
            this.applyChange(decodeDiffuserSensorPush(message.payload));
        }
    }

    private has(namespace: string): boolean {
        return this.namespaces.has(namespace);
    }

    private applyChange(patch: DiffuserValues): void {
        applyPatch(this.last, patch, this.bind.emitChange);
    }
}

function lightPatch(entry: DiffuserLightState): DiffuserValues {
    const patch: DiffuserValues = {};
    if (entry.on !== undefined) {
        patch.on = entry.on;
    }
    if (entry.mode !== undefined) {
        patch.lightMode = entry.mode;
    }
    if (entry.luminance !== undefined) {
        patch.brightness = entry.luminance / 100;
    }
    if (entry.rgb !== undefined) {
        patch.rgb = wireToRgb(entry.rgb);
    }
    return patch;
}

function wireToRgb(rgbWire: number): LightRgb {
    return {
        r: (rgbWire >> 16) & 0xff,
        g: (rgbWire >> 8) & 0xff,
        b: rgbWire & 0xff
    };
}

function rgbToWire(rgb: LightRgb): number {
    const r = clampInt(rgb.r, 0, 0xff);
    const g = clampInt(rgb.g, 0, 0xff);
    const b = clampInt(rgb.b, 0, 0xff);
    return (r << 16) | (g << 8) | b;
}

function clampInt(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, Math.trunc(value)));
}

function clamp01(value: number): number {
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/**
 * Diffuser.Light wire 0/1/2 is rotating-colors/fixed-rgb/fixed-luminance.
 * Unknown values are omitted so a digest row cannot fail attach.
 */
function lightModeFromDigest(mode: number | undefined): DiffuserLightMode | undefined {
    switch (mode) {
        case 0:
            return 'rotating-colors';
        case 1:
            return 'fixed-rgb';
        case 2:
            return 'fixed-luminance';
        default:
            return undefined;
    }
}

/**
 * Diffuser.Spray wire 0/1/2 is light/strong/off, not Control.Spray's
 * off/continuous/intermittent. Unknown values are omitted so attach does
 * not throw the way PUSH decode does.
 */
function sprayModeFromDigest(mode: number | undefined): DiffuserSprayMode | undefined {
    switch (mode) {
        case 0:
            return 'light';
        case 1:
            return 'strong';
        case 2:
            return 'off';
        default:
            return undefined;
    }
}

export const descriptor: TraitDescriptor<'diffuser', DiffuserTrait> = {
    ...DiffuserCatalog,
    attach(args: TraitAttachContext<'diffuser'>): DiffuserTrait {
        const digest = args.physical.digest?.diffuser;
        const light = digest?.light.find((entry) => entry.channel === args.channel);
        const spray = digest?.spray.find((entry) => entry.channel === args.channel);
        const initial = lightPatch({
            channel: args.channel,
            on: light?.onoff,
            mode: lightModeFromDigest(light?.mode),
            luminance: light?.luminance,
            rgb: light?.rgb
        });
        const sprayMode = sprayModeFromDigest(spray?.mode);
        if (sprayMode !== undefined) {
            initial.sprayMode = sprayMode;
        }
        return new DiffuserTrait({
            channel: args.channel,
            namespaces: args.namespaces,
            initial,
            request: args.request,
            emitChange: args.emitChange
        });
    }
};
