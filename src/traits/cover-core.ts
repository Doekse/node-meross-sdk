import type { CoverTraitBind } from '../device/bindings';
import { MerossError } from '../errors';
import type { MerossMessage } from '../protocol/message';
import type { DeviceRequest } from '../request';
import { applyPatch } from './patch';

export interface CoverValues {
    open?: boolean;
    position?: number;
    moving?: boolean;
}

/** Bound at enroll. Hosts narrow the cover instance on this field. */
export type CoverKind = 'garage' | 'shutter';

/**
 * Shared cache. Garage and shutter commands live on the concrete classes
 * so a door does not expose `setPosition`.
 */
export abstract class CoverTraitBase {
    abstract readonly kind: CoverKind;

    protected readonly channel: number;
    protected readonly namespaces: ReadonlySet<string>;
    protected readonly request: DeviceRequest;
    protected readonly emitChange: (values: CoverValues) => void;
    protected last: CoverValues = {};

    /** @internal */
    protected constructor(bind: CoverTraitBind) {
        this.channel = bind.channel;
        this.namespaces = bind.namespaces ?? new Set();
        this.request = bind.request;
        this.emitChange = bind.emitChange;
        if (bind.initialOpen !== undefined) {
            this.last.open = bind.initialOpen;
        }
    }

    /**
     * Full cache, not the last diff. A subscriber that attaches after enroll
     * never saw the seeded fields, and an unchanged poll does not emit again.
     */
    values(): CoverValues {
        return { ...this.last };
    }

    /** Undefined until digest, SET, or PUSH fills it. */
    isOpen(): boolean | undefined {
        return this.last.open;
    }

    abstract open(): Promise<{ open: boolean }>;

    abstract close(): Promise<{ open: boolean }>;

    /**
     * PUSH/GETACK from DeviceRuntime. Hosts subscribe to Endpoint `change`.
     *
     * @internal
     * @package
     */
    abstract handlePush(message: MerossMessage): void;

    protected has(namespace: string): boolean {
        return this.namespaces.has(namespace);
    }

    /**
     * Ability-gated extras used to return success without a SET. Hosts
     * cannot tell a missing namespace from a write that landed.
     */
    protected requireNamespace(namespace: string): void {
        if (!this.has(namespace)) {
            throw new MerossError(
                `${namespace} is not advertised`,
                'NAMESPACE_NOT_ADVERTISED'
            );
        }
    }

    protected applyMoving(moving: boolean): void {
        this.applyChange({ moving });
    }

    protected applyChange(patch: CoverValues): void {
        applyPatch(this.last, patch, this.emitChange);
    }
}
