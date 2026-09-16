import type { CloudDevice } from '../cloud';
import type { TraitName } from '../endpoint';
import type { ClassHint } from '../inventory';
import type { AbilityMap } from '../protocol/codecs/ability';
import type { SystemAll } from '../protocol/codecs/system-all';
import type { DeviceRequest } from '../request';
import type { GraphEndpoint, PhysicalDevice } from './index';

/**
 * Board enroll surface shared by trait helpers. `add` stays implemented in
 * device/index so id / name / taken rules stay in one place.
 */
export interface EnrollBoardContext {
    readonly uuid: string;
    readonly name: string;
    readonly model: string;
    readonly online: boolean;
    readonly ability: AbilityMap;
    readonly all: SystemAll;
    readonly cloud: CloudDevice | undefined;
    /** Mutated as channels are claimed; shared across board-extra helpers. */
    taken: Set<number>;
    add(
        channel: number,
        classHint: ClassHint,
        traits: TraitName[],
        on?: boolean,
        parentId?: string
    ): void;
}

/**
 * Inputs for board-extra trait decisions (system / energy / media / …) so
 * helpers can mirror `add()`'s extra order without owning endpoint creation.
 */
export interface BoardExtraInput {
    readonly channel: number;
    readonly classHint: ClassHint;
    readonly traits: readonly TraitName[];
    readonly extra: readonly TraitName[];
    readonly parentId?: string;
    readonly ability: AbilityMap;
}

/**
 * Common attach arguments. Concrete descriptors narrow `V` to their values
 * snapshot; emit stays typed per trait in attach.ts.
 */
export interface TraitAttachArgs<V> {
    readonly graphEndpoint: GraphEndpoint;
    readonly physical: PhysicalDevice;
    readonly request: DeviceRequest;
    readonly channel: number;
    readonly namespaces: ReadonlySet<string>;
    readonly emitChange: (values: V) => void;
}
