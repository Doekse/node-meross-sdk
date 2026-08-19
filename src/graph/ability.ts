import { ProtocolError } from '../errors';
import { MULTIPLE_NAMESPACE } from '../protocol/codecs/multiple';
import type { MerossPayload } from '../protocol/message';

export const ABILITY_NAMESPACE = 'Appliance.System.Ability';

/**
 * Ability GETACK is a map of namespace → capability object (`maxCmdNum`, empty
 * `{}`, …). Enrollment looks up keys here instead of guessing from model strings.
 */
export type AbilityMap = Record<string, Record<string, unknown>>;

/**
 * Firmware GETACK: `ability` is required and is an object whose keys are
 * namespace names.
 */
export function decodeAbilityGetAck(payload: MerossPayload): AbilityMap {
    const ability = payload.ability;
    if (typeof ability !== 'object' || ability === null || Array.isArray(ability)) {
        throw new ProtocolError('Ability GETACK ability must be an object');
    }
    return ability as AbilityMap;
}

/**
 * Control.Multiple packing size from Ability. Below 2, the router sends GETs
 * one at a time.
 */
export function abilityMaxCmdNum(ability: AbilityMap): number {
    const maxCmdNum = ability[MULTIPLE_NAMESPACE]?.maxCmdNum;
    return typeof maxCmdNum === 'number' ? maxCmdNum : 1;
}
