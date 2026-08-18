import { NotImplementedError } from '../errors';

/**
 * On/off control for one enrolled endpoint. Channel is bound at enrollment so
 * callers never pass it; Toggle vs ToggleX stays in codecs.
 */
export class SwitchTrait {
    /**
     * Turns the bound channel on or off.
     */
    async setOn(_on: boolean): Promise<{ on: boolean }> {
        throw new NotImplementedError('SwitchTrait.setOn');
    }
}
