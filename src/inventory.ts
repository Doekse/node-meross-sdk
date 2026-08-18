import type { TraitName } from './endpoint';
import { NotImplementedError } from './errors';

export type ClassHint = 'socket' | 'light' | 'climate' | 'cover' | 'hub' | 'sensor';

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
    /**
     * Returns enrolled endpoints once login and discovery are implemented.
     */
    endpoints(): InventoryRow[] {
        throw new NotImplementedError('Inventory.endpoints');
    }
}
