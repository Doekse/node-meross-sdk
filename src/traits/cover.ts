import type { TraitAttachContext } from '../device/enroll-context';
import type { CoverTraitBind } from '../device/bindings';
import { SHUTTER_STATE_NAMESPACE } from '../protocol/namespaces';
import type { TraitDescriptor } from './descriptor';
import { CoverCatalog } from './cover.catalog';
import { CoverGarageTrait } from './cover-garage';
import { CoverShutterTrait } from './cover-shutter';

export type { CoverKind, CoverValues } from './cover-core';
export { CoverGarageTrait } from './cover-garage';
export { CoverShutterTrait } from './cover-shutter';

/**
 * One enrolled garage door or roller shutter. Narrow on `kind` before calling
 * shutter-only (`setPosition`, `stop`, `calibrate`) or garage-only (`setConfig`) methods.
 */
export type CoverTrait = CoverGarageTrait | CoverShutterTrait;

export const descriptor: TraitDescriptor<'cover', CoverTrait> = {
    ...CoverCatalog,
    attach(args: TraitAttachContext<'cover'>): CoverTrait {
        const bind: CoverTraitBind = {
            channel: args.channel,
            namespaces: args.namespaces,
            initialOpen: args.graphEndpoint.on
                ?? args.physical.digest?.garageDoor.find((entry) => entry.channel === args.channel)?.open,
            request: args.request,
            emitChange: args.emitChange
        };
        // Position/Config can exist without a shutter; State is the discriminator.
        if (SHUTTER_STATE_NAMESPACE in args.physical.ability) {
            return new CoverShutterTrait(bind);
        }
        return new CoverGarageTrait(bind);
    }
};
