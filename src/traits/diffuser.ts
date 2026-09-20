import type { EnrollBoardContext, TraitAttachArgs } from '../device/enroll-context';
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
import {
    DEFAULT,
    SMART_SLOW,
    type PollSpec
} from '../poll/spec';
import type { DeviceRequest } from '../request';
import { applyPatch } from './patch';
import type { TraitDescriptor } from './descriptor';
import type { LightRgb } from './light';

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
 * Transport + channel bind for one Diffuser device. Session supplies this;
 * trait tests inject a fake request/emit pair.
 */
export interface DiffuserTraitBind {
    channel: number;
    /** Ability keys; extra methods no-op when the namespace is absent. */
    namespaces?: ReadonlySet<string>;
    request: DeviceRequest;
    emitChange: (values: DiffuserValues) => void;
}

/**
 * MOD100/MOD150 light, spray, and optional humidity/temperature on one endpoint.
 * Namespaces differ from Control.Light / Control.Spray.
 */
export class DiffuserTrait {
    private readonly bind: DiffuserTraitBind;
    private readonly namespaces: ReadonlySet<string>;
    private last: DiffuserValues = {};

    constructor(bind: DiffuserTraitBind) {
        this.bind = bind;
        this.namespaces = bind.namespaces ?? new Set();
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
 * Light and spray digest arrays may name different channels on one board.
 * Ability without digest rows still claims channel 0 so leftover ToggleX
 * does not enroll the diffuser as a socket.
 */
export function enrollDiffuser(ctx: EnrollBoardContext): void {
    const digest = ctx.all.digest.diffuser;
    const channels = new Set<number>([
        ...(digest?.light ?? []),
        ...(digest?.spray ?? [])
    ]);
    const advertised = DIFFUSER_LIGHT_NAMESPACE in ctx.ability
        || DIFFUSER_SPRAY_NAMESPACE in ctx.ability;
    if (channels.size === 0 && advertised) {
        channels.add(0);
    }
    for (const channel of channels) {
        ctx.add(channel, 'humidifier', ['diffuser']);
    }
}

export const DiffuserDescriptor: TraitDescriptor & {
    readonly name: 'diffuser';
    attach(args: TraitAttachArgs<DiffuserValues>): DiffuserTrait;
} = {
    name: 'diffuser',
    push: [
        DIFFUSER_LIGHT_NAMESPACE,
        DIFFUSER_SPRAY_NAMESPACE,
        DIFFUSER_SENSOR_NAMESPACE
    ],
    poll: {
        [DIFFUSER_LIGHT_NAMESPACE]: DEFAULT,
        [DIFFUSER_SPRAY_NAMESPACE]: DEFAULT,
        [DIFFUSER_SENSOR_NAMESPACE]: { ...SMART_SLOW, item: 100 }
    } satisfies Record<string, PollSpec>,
    attach(args: TraitAttachArgs<DiffuserValues>): DiffuserTrait {
        return new DiffuserTrait({
            channel: args.channel,
            namespaces: args.namespaces,
            request: args.request,
            emitChange: args.emitChange
        });
    }
};
