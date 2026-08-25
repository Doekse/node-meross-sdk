import type { TraitName } from './endpoint';

export type ClassHint =
    | 'socket' | 'light' | 'climate' | 'cover' | 'hub' | 'sensor'
    | 'sprinkler' | 'fan' | 'humidifier' | 'speaker';

export interface InventoryRow {
    id: string;
    name: string;
    model: string;
    classHint: ClassHint;
    traits: readonly TraitName[];
    online: boolean;
    parentId?: string;
}

/**
 * Cloud/LAN device list projected into user-visible endpoints (one row per
 * endpoint, not per physical board).
 */
export class Inventory {
    private rows: readonly InventoryRow[] = [];

    constructor(rows: readonly InventoryRow[] = []) {
        this.rows = rows;
    }

    /**
     * Replaces inventory rows after graph enrollment.
     */
    replace(rows: readonly InventoryRow[]): void {
        this.rows = rows;
    }

    /**
     * Returns copies so callers cannot mutate enrolled ids or traits.
     */
    endpoints(): InventoryRow[] {
        return this.rows.map((row) => ({ ...row, traits: [...row.traits] }));
    }
}
