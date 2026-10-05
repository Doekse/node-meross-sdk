import {
    Endpoint,
    reportChange,
    type EndpointChange,
    type TraitInstances,
    type TraitName,
    type TraitValues
} from '../endpoint';
import type { DeviceRequest } from '../request';
import { loadTrait } from '../traits/load';
import type { TraitAttachContext } from './enroll-context';
import type { GraphEndpoint, PhysicalDevice } from './index';

/**
 * Constructs trait instances for one enrolled endpoint.
 *
 * meross_lan analog is `Device.async_init`, not a handler registry. Ability
 * extras (Toggle vs ToggleX, climate Mode/ModeB/ModeC, timer/trigger
 * generation) read `physical.ability`. Channel stealing for light/fan/garage
 * is enroll, not attach — do not "fix" attach to meross_lan's digest-key
 * Toggle test. Trait class modules load only when `graphEndpoint.traits`
 * lists them.
 *
 * Callers own `namespaces` (typically ability keys). Attach does not derive
 * the Set from `physical.ability`, so a caller can reuse one Set across
 * endpoints instead of copying ability keys here.
 */
export function attachEndpoint(
    graphEndpoint: GraphEndpoint,
    request: DeviceRequest,
    physical: PhysicalDevice,
    namespaces: ReadonlySet<string>
): Endpoint {
    const channel = graphEndpoint.channel ?? 0;
    // Assigned after traits so emit closures can capture the binding.
    // eslint-disable-next-line prefer-const -- definite assignment; constructed below
    let endpoint!: Endpoint;
    const slots: Partial<TraitInstances> = {};
    const shared = {
        graphEndpoint,
        physical,
        request,
        channel,
        namespaces
    };
    for (const name of graphEndpoint.traits) {
        attachNamed(slots, name, shared, (change) => {
            endpoint.emit('change', change);
        });
    }
    endpoint = new Endpoint({
        id: graphEndpoint.id,
        traits: graphEndpoint.traits,
        initialOnline: graphEndpoint.online,
        ...slots
    });
    return endpoint;
}

/**
 * The type parameter ties the instance to `slots[name]` and `emitChange` to
 * {@link TraitValues}[K]. The loop variable is the full {@link TraitName}
 * union, so this call is what keeps both checked.
 */
function attachNamed<K extends TraitName>(
    slots: Partial<TraitInstances>,
    name: K,
    shared: Omit<TraitAttachContext<K>, 'emitChange'>,
    emit: (change: EndpointChange) => void
): void {
    const instance = loadTrait(name).descriptor.attach({
        ...shared,
        emitChange(values: TraitValues[K]): void {
            reportChange(emit, name, copyValues(values));
        }
    });
    if (instance !== undefined) {
        slots[name] = instance;
    }
}

/**
 * Shallow copy so a host that mutates a `change` payload cannot write the
 * trait cache. The return type keeps the copy on {@link TraitValues}[K].
 */
function copyValues<T extends object>(values: T): T {
    return { ...values };
}
