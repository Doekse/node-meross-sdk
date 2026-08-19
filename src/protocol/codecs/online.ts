import type { MerossPayload } from '../message';

export const ONLINE_NAMESPACE = 'Appliance.System.Online';

/** Firmware `online.status`: 0 connecting, 1 online, 2 offline, 3 upgrading. */
export function decodeOnlineStatus(payload: MerossPayload): number | undefined {
    const online = payload.online;
    if (typeof online !== 'object' || online === null || Array.isArray(online)) {
        return undefined;
    }
    const status = (online as { status?: unknown }).status;
    return typeof status === 'number' ? status : undefined;
}
