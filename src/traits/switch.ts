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
import type { RoutedRequestOptions } from '../transport/router';

export interface SwitchValues {
    on?: boolean;
    fault?: number;
    firmwareVersion?: string;
    hardwareVersion?: string;
}

/**
 * Board bind: one Toggle/ToggleX channel on the physical device.
 */
export interface SwitchTraitBoardBind {
    kind: 'board';
    uuid: string;
    channel: number;
    namespace: typeof TOGGLEX_NAMESPACE | 'Appliance.Control.Toggle';
    request: (options: Omit<RoutedRequestOptions, 'uuid' | 'ip' | 'encryptionKey'>) => Promise<MerossMessage>;
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
    request: (options: Omit<RoutedRequestOptions, 'uuid' | 'ip' | 'encryptionKey'>) => Promise<MerossMessage>;
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
        const next: SwitchValues = {};
        for (const key of Object.keys(patch) as Array<keyof SwitchValues>) {
            const value = patch[key];
            if (value === undefined || this.last[key] === value) {
                continue;
            }
            (this.last as Record<string, unknown>)[key] = value;
            (next as Record<string, unknown>)[key] = value;
        }
        if (Object.keys(next).length > 0) {
            this.bind.emitChange(next);
        }
    }

    private has(namespace: string): boolean {
        return this.bind.kind === 'hub' && (this.bind.namespaces?.has(namespace) ?? false);
    }
}
