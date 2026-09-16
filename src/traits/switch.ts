import type { EnrollBoardContext, TraitAttachArgs } from '../device/enroll-context';
import type { GraphEndpoint } from '../device/index';
import {
    HUB_EXCEPTION_NAMESPACE,
    HUB_SUBDEVICE_VERSION_NAMESPACE,
    HUB_TOGGLEX_NAMESPACE,
    TOGGLEX_NAMESPACE,
    decodeHubExceptionPush,
    decodeHubSubDeviceVersionPush,
    decodeHubToggleXPush,
    decodeToggleXPush,
    encodeHubToggleXSet,
    encodeToggleXSet,
    type MerossMessage
} from '../protocol';
import {
    ALL_CHANNELS,
    DEFAULT,
    idList,
    ONCE,
    type PollSpec
} from '../poll/spec';
import type { DeviceRequest } from '../request';
import { applyPatch } from './patch';
import type { TraitDescriptor } from './descriptor';

export interface SwitchValues {
    on?: boolean;
    fault?: number;
    firmwareVersion?: string;
    hardwareVersion?: string;
}

/** Classic Toggle (not ToggleX). Shared so poll/jobs can key the same string. */
export const TOGGLE_NAMESPACE = 'Appliance.Control.Toggle';

/**
 * Board bind: one Toggle/ToggleX channel on the physical device.
 */
export interface SwitchTraitBoardBind {
    kind: 'board';
    uuid: string;
    channel: number;
    namespace: typeof TOGGLEX_NAMESPACE | typeof TOGGLE_NAMESPACE;
    request: DeviceRequest;
    emitChange: (values: SwitchValues) => void;
    /** System.All digest `onoff` so hosts can read on/off before the first PUSH. */
    initialOn?: boolean;
}

/**
 * Hub bind: one subdevice row driven by Hub.ToggleX (digest `onoff` without a known model).
 */
export interface SwitchTraitHubBind {
    kind: 'hub';
    uuid: string;
    subDeviceId: string;
    /** Ability keys; Exception / Version no-op when the namespace is absent. */
    namespaces?: ReadonlySet<string>;
    request: DeviceRequest;
    emitChange: (values: SwitchValues) => void;
    /** Hub digest `onoff` so hosts can read on/off before the first PUSH. */
    initialOn?: boolean;
}

export type SwitchTraitBind = SwitchTraitBoardBind | SwitchTraitHubBind;

/**
 * On/off control for one enrolled endpoint. Channel or subdevice id is bound at
 * enrollment so callers never pass it; Toggle vs ToggleX vs Hub.ToggleX stays in codecs.
 */
export class SwitchTrait {
    private readonly bind: SwitchTraitBind;
    private last: SwitchValues = {};

    constructor(bind: SwitchTraitBind) {
        this.bind = bind;
        if (bind.initialOn !== undefined) {
            this.last.on = bind.initialOn;
        }
    }

    /** Undefined until digest, SET, or PUSH fills it. */
    isOn(): boolean | undefined {
        return this.last.on;
    }

    async setOn(on: boolean): Promise<{ on: boolean }> {
        const payload = this.bind.kind === 'hub'
            ? encodeHubToggleXSet({ id: this.bind.subDeviceId, on })
            : this.bind.namespace === TOGGLEX_NAMESPACE
                ? encodeToggleXSet({ channel: this.bind.channel, on })
                : { toggle: { onoff: on ? 1 : 0 } };
        const namespace = this.bind.kind === 'hub'
            ? HUB_TOGGLEX_NAMESPACE
            : this.bind.namespace;
        await this.bind.request({
            namespace,
            method: 'SET',
            payload
        });
        this.applyChange({ on });
        return { on };
    }

    handlePush(message: MerossMessage): void {
        if (this.bind.kind === 'hub') {
            const ns = message.header.namespace;
            if (ns === HUB_EXCEPTION_NAMESPACE && this.has(ns)) {
                for (const entry of decodeHubExceptionPush(message.payload)) {
                    if (entry.id === this.bind.subDeviceId) {
                        this.applyChange({ fault: entry.code });
                    }
                }
                return;
            }
            if (ns === HUB_SUBDEVICE_VERSION_NAMESPACE && this.has(ns)) {
                for (const entry of decodeHubSubDeviceVersionPush(message.payload)) {
                    if (entry.id === this.bind.subDeviceId) {
                        const patch: SwitchValues = {};
                        if (entry.firmware !== undefined) {
                            patch.firmwareVersion = entry.firmware;
                        }
                        if (entry.hardware !== undefined) {
                            patch.hardwareVersion = entry.hardware;
                        }
                        this.applyChange(patch);
                    }
                }
                return;
            }
            if (ns !== HUB_TOGGLEX_NAMESPACE) {
                return;
            }
            for (const entry of decodeHubToggleXPush(message.payload)) {
                if (entry.id === this.bind.subDeviceId) {
                    this.applyChange({ on: entry.on });
                }
            }
            return;
        }
        if (message.header.namespace !== this.bind.namespace) {
            return;
        }
        if (this.bind.namespace === TOGGLEX_NAMESPACE) {
            for (const entry of decodeToggleXPush(message.payload)) {
                if (entry.channel === this.bind.channel) {
                    this.applyChange({ on: entry.on });
                }
            }
            return;
        }
        if (this.bind.channel === 0) {
            this.applyChange({ on: (message.payload.toggle as { onoff: number }).onoff === 1 });
        }
    }

    private applyChange(patch: SwitchValues): void {
        applyPatch(this.last, patch, this.bind.emitChange);
    }

    private has(namespace: string): boolean {
        return this.bind.kind === 'hub' && (this.bind.namespaces?.has(namespace) ?? false);
    }
}

/**
 * Leftover Toggle / ToggleX after light / cover / fan / … claimed theirs.
 * Cloud fallback is by array index (not channel fields); MSG200 drops
 * channel 0 when any garage door is non-zero; strip parentId is applied after
 * that filter. Taken-set skips already-claimed channels — do not subtract
 * light/fan/garage here or filter doorEnable (cover already claimed).
 */
export function enrollSwitchLeftover(ctx: EnrollBoardContext): void {
    let toggles = ctx.all.digest.togglex;
    if (toggles.length === 0 && ctx.cloud?.channels?.length) {
        toggles = ctx.cloud.channels.map((_, channel) => ({ channel }));
    }
    if (
        toggles.length === 0
        && (TOGGLEX_NAMESPACE in ctx.ability || TOGGLE_NAMESPACE in ctx.ability)
    ) {
        toggles = [{ channel: 0 }];
    }
    if (ctx.all.digest.garageDoor.some((door) => door.channel !== 0)) {
        toggles = toggles.filter((entry) => entry.channel !== 0);
    }
    const masterId = `${ctx.uuid}:0`;
    const isStrip = toggles.length >= 3 && toggles.some((entry) => entry.channel === 0);
    for (const entry of toggles) {
        ctx.add(
            entry.channel,
            'socket',
            ['switch'],
            entry.on,
            isStrip && entry.channel !== 0 ? masterId : undefined
        );
    }
}

/**
 * Unknown hub digest type with onoff — enroll as a switch. Builds the child
 * endpoint when classifyHubChild has no model; omit when onoff is absent.
 */
export function enrollHubUntypedOnoff(input: {
    readonly uuid: string;
    readonly subDeviceId: string;
    readonly name?: string;
    readonly model?: string;
    readonly online: boolean;
    readonly on?: boolean;
}): GraphEndpoint | undefined {
    if (input.on === undefined) {
        return undefined;
    }
    return {
        id: `${input.uuid}#${input.subDeviceId}`,
        uuid: input.uuid,
        subDeviceId: input.subDeviceId,
        parentId: input.uuid,
        name: input.name || input.subDeviceId,
        model: input.model || input.subDeviceId,
        classHint: 'socket',
        traits: ['switch'],
        online: input.online,
        on: input.on
    };
}

export const SwitchDescriptor: TraitDescriptor & {
    readonly name: 'switch';
    attach(args: TraitAttachArgs<SwitchValues>): SwitchTrait;
} = {
    name: 'switch',
    poll: {
        [TOGGLEX_NAMESPACE]: {
            ...DEFAULT,
            payload: ALL_CHANNELS
        },
        [TOGGLE_NAMESPACE]: {
            ...DEFAULT,
            payload: { dict: 'toggle' }
        },
        /**
         * Shared with climate hub setOn; keep unfiltered
         * `idList('togglex')` so MTS100 stays in the GET.
         */
        [HUB_TOGGLEX_NAMESPACE]: {
            ...DEFAULT,
            payload: idList('togglex')
        },
        /**
         * Shared with sensor, sprinkler, climate handlePush; keep unfiltered
         * `idList('version')` so mixed children stay in the GET.
         */
        [HUB_SUBDEVICE_VERSION_NAMESPACE]: {
            ...ONCE,
            payload: idList('version')
        }
    } satisfies Record<string, PollSpec>,
    attach(args: TraitAttachArgs<SwitchValues>): SwitchTrait {
        if (args.graphEndpoint.subDeviceId) {
            return new SwitchTrait({
                kind: 'hub',
                uuid: args.physical.uuid,
                subDeviceId: args.graphEndpoint.subDeviceId,
                namespaces: args.namespaces,
                request: args.request,
                emitChange: args.emitChange,
                initialOn: args.graphEndpoint.on
            });
        }
        // Classic Toggle only when Toggle is present and ToggleX is absent.
        const hasClassicToggle = TOGGLE_NAMESPACE in args.physical.ability
            && !(TOGGLEX_NAMESPACE in args.physical.ability);
        return new SwitchTrait({
            kind: 'board',
            uuid: args.physical.uuid,
            channel: args.channel,
            namespace: hasClassicToggle ? TOGGLE_NAMESPACE : TOGGLEX_NAMESPACE,
            request: args.request,
            emitChange: args.emitChange,
            initialOn: args.graphEndpoint.on
        });
    }
};
