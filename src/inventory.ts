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
 * Cloud/LAN device list projected into Homey-facing endpoints (one row per
 * user-visible device, not per physical board).
 */
export class Inventory {
    private rows: readonly InventoryRow[] = [];

    constructor(rows: readonly InventoryRow[] = []) {
        this.rows = rows;
    }

    /**
     * Replaces pairing rows after graph enrollment. Session wiring will call
     * this once Ability/System.All have been applied.
     */
    replace(rows: readonly InventoryRow[]): void {
        this.rows = rows;
    }

    /**
     * Copies rows so Homey pairing cannot mutate enrolled ids or traits.
     */
    endpoints(): InventoryRow[] {
        return this.rows.map((row) => ({ ...row, traits: [...row.traits] }));
    }
}
