import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Endpoint } from '../../src/endpoint';
import { TOGGLEX_NAMESPACE } from '../../src/protocol';
import { DndTrait } from '../../src/traits/dnd';
import { EnergyTrait } from '../../src/traits/energy';
import { SwitchTrait } from '../../src/traits/switch';
import { SystemTrait } from '../../src/traits/system';
import { createRequestRecorder } from '../helpers/request';

const UUID = '2206138957096651080248e1e99705a4';

describe('Endpoint.snapshot', () => {
    it('returns seeded caches and skips traits that have not reported', () => {
        const { request } = createRequestRecorder({ uuid: UUID });
        const switchTrait = new SwitchTrait({
            kind: 'board',
            channel: 0,
            namespace: TOGGLEX_NAMESPACE,
            request,
            emitChange: () => undefined,
            initialOn: true
        });
        const energy = new EnergyTrait({
            channel: 0,
            hasElectricity: true,
            hasElectricityX: false,
            hasConsumptionX: false,
            hasConsumptionH: false,
            request,
            emitChange: () => undefined
        });
        const dnd = new DndTrait({
            request,
            emitChange: () => undefined
        });
        const firmware = { version: '7.3.13', innerIp: '192.168.1.20' };
        const system = new SystemTrait({
            request,
            emitChange: () => undefined,
            initialFirmware: firmware
        });
        const endpoint = new Endpoint({
            id: `${UUID}:0`,
            traits: ['switch', 'energy', 'dnd', 'system'],
            switch: switchTrait,
            energy,
            dnd,
            system
        });

        const changes = endpoint.snapshot();
        assert.deepEqual(changes, [
            { trait: 'switch', values: { on: true } },
            { trait: 'system', values: { firmware } }
        ]);

        const on = changes[0];
        assert.ok(on?.trait === 'switch');
        on.values.on = false;
        assert.equal(switchTrait.isOn(), true);
    });
});
