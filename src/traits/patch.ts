/**
 * Hosts subscribe to decoded diffs, not poll ticks. Mutates `last` in place
 * and emits only changed keys so snapshot traits share one skip-on-equal merge.
 */
export function applyPatch<T extends object>(
    last: T,
    patch: T,
    emit: (changed: T) => void
): void {
    const next = {} as T;
    const lastFields = last as Record<PropertyKey, unknown>;
    const nextFields = next as Record<PropertyKey, unknown>;
    for (const key of Object.keys(patch) as Array<keyof T>) {
        const value = patch[key];
        if (value === undefined) {
            continue;
        }
        if (sameValue(last[key], value)) {
            continue;
        }
        lastFields[key] = value;
        nextFields[key] = value;
    }
    if (Object.keys(next).length > 0) {
        emit(next);
    }
}

/**
 * Each decode allocates new objects and arrays. JSON equality treats a
 * replacement with the same payload as unchanged; scalars use `===`.
 */
function sameValue(a: unknown, b: unknown): boolean {
    if (typeof b === 'object') {
        return JSON.stringify(a) === JSON.stringify(b);
    }
    return a === b;
}
