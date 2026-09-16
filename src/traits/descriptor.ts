import type { ClassHint } from '../inventory';
import type { TraitName } from '../endpoint';
import type { PollSpec } from '../poll/spec';

/**
 * Colocated catalog record for one trait. Poll ownership lives here; enroll
 * and attach stay as named helpers / concrete methods so attach can keep
 * typed emit closures.
 */
export interface TraitDescriptor {
    readonly name: TraitName;
    readonly poll: Readonly<Record<string, PollSpec>>;
}

/**
 * Hub child classification for climate / sensor / sprinkler. Lives beside
 * {@link TraitDescriptor}, not on it — only those three concrete objects
 * carry `hubChild`.
 */
export interface HubChildRule {
    readonly models: ReadonlySet<string>;
    readonly aliases: Readonly<Record<string, string>>;
    readonly classHint: ClassHint;
}
