import { EventEmitter } from 'node:events';

import type { EnergyTrait } from './traits/energy';
import type { SwitchTrait } from './traits/switch';

export type TraitName = 'switch' | 'energy' | 'light' | 'climate' | 'cover';

export interface EndpointChange {
    trait: TraitName;
    values: Record<string, unknown>;
}

export interface EndpointOptions {
    id: string;
    traits?: readonly TraitName[];
    switch?: SwitchTrait;
    energy?: EnergyTrait;
    initialOnline?: boolean;
}

interface EndpointEvents {
    change: [change: EndpointChange];
    availability: [online: boolean];
}

/**
 * One Homey-facing device. A multi-gang strip is several endpoints; hub
 * children use this same type with `parentId` kept as inventory metadata.
 */
export class Endpoint extends EventEmitter<EndpointEvents> {
    readonly id: string;
    readonly traits: readonly TraitName[];
    readonly switch?: SwitchTrait;
    readonly energy?: EnergyTrait;

    private online: boolean;

    constructor(options: EndpointOptions) {
        super();
        this.id = options.id;
        this.traits = options.traits ?? [];
        this.switch = options.switch;
        this.energy = options.energy;
        this.online = options.initialOnline ?? true;
    }

    setAvailability(online: boolean, force = false): void {
        if (!force && this.online === online) {
            return;
        }
        this.online = online;
        this.emit('availability', online);
    }
}
