import { ProtocolError } from '../../errors';
import type { MerossPayload } from '../message';

export const ONLINE_NAMESPACE = 'Appliance.System.Online';
export const HUB_ONLINE_NAMESPACE = 'Appliance.Hub.Online';

export interface HubOnlineEntry {
    id: string;
    online: boolean;
}

/**
 * Board status is an object; Hub.Online uses an array under the same key, so
 * arrays are ignored. Firmware `online.status`: 0 connecting, 1 online, 2
 * offline, 3 upgrading.
 */
export function decodeOnlineStatus(payload: MerossPayload): number | undefined {
    const online = payload.online;
    if (typeof online !== 'object' || online === null || Array.isArray(online)) {
        return undefined;
    }
    const status = (online as { status?: unknown }).status;
    return typeof status === 'number' ? status : undefined;
}

/**
 * Hub.Online GETACK can include a row with `exception.code` 5062 and no
 * `status` when the id is unknown to the hub. Those rows are omitted so they
 * are not treated as offline.
 */
export function decodeHubOnline(payload: MerossPayload): HubOnlineEntry[] {
    const raw = payload.online;
    if (!Array.isArray(raw)) {
        throw new ProtocolError('Hub.Online online must be an array');
    }
    const entries: HubOnlineEntry[] = [];
    for (const item of raw) {
        if (typeof item !== 'object' || item === null) {
            throw new ProtocolError('Hub.Online entry must be an object');
        }
        const { id, status } = item as Record<string, unknown>;
        if (typeof id !== 'string' || !id) {
            throw new ProtocolError('Hub.Online id is required');
        }
        if (typeof status === 'number') {
            entries.push({ id, online: status === 1 });
        }
    }
    return entries;
}
