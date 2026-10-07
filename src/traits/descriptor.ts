import type { TraitAttachContext } from '../device/enroll-context';
import type { TraitName } from '../device/endpoint';
import type { ClassHint } from '../inventory';
import type { PollSpec } from '../poll/spec';

/**
 * Poll/PUSH data for one trait. Lives in `*.catalog.ts` so jobs and runtime
 * can iterate it without `require()`ing the trait class (climate, sensor).
 */
export interface TraitCatalog {
    readonly name: TraitName;
    readonly poll: Readonly<Record<string, PollSpec>>;
    readonly push: readonly string[];
}

/**
 * Class-module export for every trait. `Instance` is the class attach stores
 * on the endpoint; catalog fields stay the poll/PUSH data.
 */
export interface TraitDescriptor<K extends TraitName, Instance> extends TraitCatalog {
    readonly name: K;
    attach(args: TraitAttachContext<K>): Instance | undefined;
}

/**
 * Hub child classification for climate, sensor, and sprinkler.
 * The tables live in device/hub-child.ts so enroll does not load those
 * trait class modules.
 */
export interface HubChildRule {
    readonly models: ReadonlySet<string>;
    readonly aliases: Readonly<Record<string, string>>;
    readonly classHint: ClassHint;
}
