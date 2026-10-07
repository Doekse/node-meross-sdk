import type { EnrollBoardContext, TraitAttachContext } from '../device/enroll-context';
import {
    GARAGE_STATE_NAMESPACE,
    SHUTTER_STATE_NAMESPACE
} from '../protocol/namespaces';
import type { TraitDescriptor } from './descriptor';
import { CoverCatalog } from './cover.catalog';
import { CoverGarageTrait } from './cover-garage';
import { CoverShutterTrait } from './cover-shutter';
import type { CoverTraitBind } from './cover-core';

export type { CoverKind, CoverTraitBind, CoverValues } from './cover-core';
export { CoverGarageTrait } from './cover-garage';
export { CoverShutterTrait } from './cover-shutter';

/**
 * One enrolled garage door or roller shutter. Narrow on `kind` before calling
 * shutter-only (`setPosition`, `stop`, `calibrate`) or garage-only (`setConfig`) methods.
 */
export type CoverTrait = CoverGarageTrait | CoverShutterTrait;

/**
 * Garage digest wins so unwired doors can be claimed without an endpoint
 * (ToggleX leftover would otherwise re-add them as sockets). Shutter digest
 * and Ability fallback only run when there is no garage digest.
 */
export function enrollCover(ctx: EnrollBoardContext): void {
    if (ctx.all.digest.garageDoor.length > 0) {
        // Seed open/closed from the digest so hosts have state before the first
        // PUSH or poll; on cloud MQTT that poll can be ~20 minutes away.
        // Channels the installer never wired report doorEnable 0 and are not
        // user-visible devices, so they are skipped (MSG200 ships three doors).
        for (const door of ctx.all.digest.garageDoor) {
            if (door.doorEnable === false) {
                // Claim the channel without creating an endpoint, so the
                // ToggleX leftover pass does not re-add the disabled door as a
                // plain socket.
                ctx.taken.add(door.channel);
                continue;
            }
            ctx.add(door.channel, 'cover', ['cover'], door.open);
        }
        return;
    }
    if (ctx.all.digest.rollerShutter.length > 0) {
        for (const channel of ctx.all.digest.rollerShutter) {
            ctx.add(channel, 'cover', ['cover']);
        }
        return;
    }
    if (GARAGE_STATE_NAMESPACE in ctx.ability || SHUTTER_STATE_NAMESPACE in ctx.ability) {
        ctx.add(0, 'cover', ['cover']);
    }
}

export const descriptor: TraitDescriptor<'cover', CoverTrait> = {
    ...CoverCatalog,
    attach(args: TraitAttachContext<'cover'>): CoverTrait {
        const bind: CoverTraitBind = {
            channel: args.channel,
            namespaces: args.namespaces,
            initialOpen: args.graphEndpoint.on,
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
