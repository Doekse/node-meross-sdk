import type { TraitAttachContext } from '../device/enroll-context';
import type { SwitchTraitBind } from '../device/bindings';
import {
    decodeHubExceptionPush,
    decodeHubSubDeviceVersionPush,
    decodeHubToggleXPush,
    encodeHubToggleXSet
} from '../protocol/codecs/hub';
import {
    decodeToggleXPush,
    encodeToggleXSet
} from '../protocol/codecs/togglex';
import type { MerossMessage } from '../protocol/message';
import {
    HUB_EXCEPTION_NAMESPACE,
    HUB_SUBDEVICE_VERSION_NAMESPACE,
    HUB_TOGGLEX_NAMESPACE,
    TOGGLE_NAMESPACE,
    TOGGLEX_NAMESPACE
} from '../protocol/namespaces';
import { applyPatch } from './patch';
import type { TraitDescriptor } from './descriptor';
import { SwitchCatalog } from './switch.catalog';

export { TOGGLE_NAMESPACE };

export interface SwitchValues {
    on?: boolean;
    fault?: number;
    firmwareVersion?: string;
    hardwareVersion?: string;
}

/**
 * On/off control for one enrolled endpoint. Channel or subdevice id is bound at
 * enrollment so callers never pass it; Toggle vs ToggleX vs Hub.ToggleX stays in codecs.
 */
export class SwitchTrait {
    /** @internal */
    private readonly bind: SwitchTraitBind;
    private last: SwitchValues = {};

    /** @internal */
    constructor(bind: SwitchTraitBind) {
        this.bind = bind;
        if (bind.initialOn !== undefined) {
            this.last.on = bind.initialOn;
        }
    }

    /**
     * Full cache, not the last diff. A subscriber that attaches after enroll
     * never saw the seeded fields, and an unchanged poll does not emit again.
     */
    values(): SwitchValues {
        return { ...this.last };
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

    /**
     * PUSH/GETACK from DeviceRuntime. Hosts subscribe to Endpoint `change`.
     *
     * @internal
     * @package
     */
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

export const descriptor: TraitDescriptor<'switch', SwitchTrait> = {
    ...SwitchCatalog,
    attach(args: TraitAttachContext<'switch'>): SwitchTrait {
        if (args.graphEndpoint.subDeviceId) {
            return new SwitchTrait({
                kind: 'hub',
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
            channel: args.channel,
            namespace: hasClassicToggle ? TOGGLE_NAMESPACE : TOGGLEX_NAMESPACE,
            request: args.request,
            emitChange: args.emitChange,
            initialOn: args.graphEndpoint.on
        });
    }
};
