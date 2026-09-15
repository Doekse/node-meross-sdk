import type { MerossMessage, MerossPayload } from './protocol';

/**
 * Device-scoped request options (no transport fields).
 *
 * meross_lan's `AsyncRequestFunc` is positional `(namespace, method, payload)`.
 * This port omits `uuid` / `ip` / `encryptionKey` for the same reason; `priority`
 * stays because the SDK rate limiter shares one function for user SET and
 * background GET.
 */
export interface DeviceRequestOptions {
    namespace: string;
    method: string;
    payload?: MerossPayload;
    priority?: 'user' | 'background';
}

/**
 * Trait and attach bind for issuing a signed request against one already-bound
 * device. Session closes over uuid / ip / encryptionKey.
 */
export type DeviceRequest = (options: DeviceRequestOptions) => Promise<MerossMessage>;
