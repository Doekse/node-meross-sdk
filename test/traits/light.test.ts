import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Endpoint } from '../../src/endpoint';
import {
    LIGHT_CAPACITY_LUMINANCE,
    LIGHT_CAPACITY_RGB,
    LIGHT_CAPACITY_TEMPERATURE,
    LIGHT_NAMESPACE,
    TOGGLEX_NAMESPACE,
    encodeMessage,
    encodeToggleXSet
} from '../../src/protocol';
import { LightTrait } from '../../src/traits/light';
import type { MerossMessage } from '../../src/protocol';

const KEY = 'stub-key';
const UUID = '2206138957096651080248e1e99705a4';
const CHANNEL = 0;

function lightPush(options: {
    capacity: number;
    rgb?: number;
    temperature?: number;
    luminance?: number;
    effect?: number;
    onoff?: boolean;
}) {
    return encodeMessage({
        namespace: LIGHT_NAMESPACE,
        method: 'PUSH',
        key: KEY,
        from: `/appliance/${UUID}/publish`,
        uuid: UUID,
        payload: {
            light: {
                channel: CHANNEL,
                capacity: options.capacity,
                ...(options.rgb !== undefined ? { rgb: options.rgb } : {}),
                ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
                ...(options.luminance !== undefined ? { luminance: options.luminance } : {}),
                ...(options.effect !== undefined ? { effect: options.effect } : {}),
                ...(options.onoff !== undefined ? { onoff: options.onoff ? 1 : 0 } : {})
            }
        }
    });
}

function togglexPush(on: boolean) {
    return encodeMessage({
        namespace: TOGGLEX_NAMESPACE,
        method: 'PUSH',
        key: KEY,
        from: `/appliance/${UUID}/publish`,
        uuid: UUID,
        payload: {
            togglex: [{ channel: CHANNEL, onoff: on ? 1 : 0, entity: 1, lmTime: 1 }]
        }
    });
}

function createLightHarness(options: {
    hasToggleX?: boolean;
    hasToggle?: boolean;
    lightCapacity?: number;
} = {}): {
    endpoint: Endpoint;
    trait: LightTrait;
    requests: MerossMessage[];
} {
    const requests: MerossMessage[] = [];
    const endpoint = new Endpoint({
        id: `${UUID}:${CHANNEL}`,
        traits: ['light']
    });

    const trait = new LightTrait({
        uuid: UUID,
        channel: CHANNEL,
        hasToggleX: options.hasToggleX ?? false,
        hasToggle: options.hasToggle ?? false,
        lightCapacity: options.lightCapacity ?? 0,
        request: async (opts) => {
            const sent = encodeMessage({
                namespace: opts.namespace,
                method: opts.method,
                key: KEY,
                from: '/app/test/publish',
                uuid: UUID,
                payload: opts.payload
            });
            requests.push(sent);

            if (opts.namespace === LIGHT_NAMESPACE) {
                if (opts.method === 'GET') {
                    return encodeMessage({
                        namespace: LIGHT_NAMESPACE,
                        method: 'GETACK',
                        key: KEY,
                        from: `/appliance/${UUID}/publish`,
                        uuid: UUID,
                        payload: {
                            light: {
                                channel: CHANNEL,
                                capacity: options.lightCapacity ?? 0,
                                luminance: 50,
                                temperature: 10,
                                rgb: 0x112233
                            }
                        }
                    });
                }
                return encodeMessage({
                    namespace: LIGHT_NAMESPACE,
                    method: 'SETACK',
                    key: KEY,
                    from: `/appliance/${UUID}/publish`,
                    uuid: UUID,
                    payload: {}
                });
            }

            if (opts.namespace === TOGGLEX_NAMESPACE) {
                if (opts.method === 'GET') {
                    return encodeMessage({
                        namespace: TOGGLEX_NAMESPACE,
                        method: 'GETACK',
                        key: KEY,
                        from: `/appliance/${UUID}/publish`,
                        uuid: UUID,
                        payload: {
                            togglex: { channel: CHANNEL, onoff: 1, entity: 1, lmTime: 1 }
                        }
                    });
                }
                return encodeMessage({
                    namespace: TOGGLEX_NAMESPACE,
                    method: 'SETACK',
                    key: KEY,
                    from: `/appliance/${UUID}/publish`,
                    uuid: UUID,
                    payload: {}
                });
            }

            return encodeMessage({
                namespace: opts.namespace,
                method: 'SETACK',
                key: KEY,
                from: `/appliance/${UUID}/publish`,
                uuid: UUID,
                payload: {}
            });
        },
        emitChange: (values) => endpoint.emit('change', { trait: 'light', values })
    });

    return { endpoint, trait, requests };
}

describe('LightTrait.setOn', () => {
    it('routes device-level on/off through ToggleX SET when available', async () => {
        const { endpoint, trait, requests } = createLightHarness({ hasToggleX: true, lightCapacity: 0 });
        const changes: unknown[] = [];
        endpoint.on('change', (change) => changes.push(change));

        await trait.setOn(false);

        assert.equal(requests.length, 1);
        assert.equal(requests[0]?.header.namespace, TOGGLEX_NAMESPACE);
        assert.equal(requests[0]?.header.method, 'SET');
        assert.deepEqual(requests[0]?.payload, encodeToggleXSet({ channel: CHANNEL, on: false }));
        assert.deepEqual(changes, [{ trait: 'light', values: { on: false } }]);
    });
});

describe('LightTrait PUSH', () => {
    it('applies Control.Light brightness/temperature/RGB and ignores onoff when ToggleX-backed', () => {
        const { endpoint, trait } = createLightHarness({
            hasToggleX: true,
            lightCapacity: LIGHT_CAPACITY_LUMINANCE | LIGHT_CAPACITY_TEMPERATURE | LIGHT_CAPACITY_RGB
        });

        const changes: unknown[] = [];
        endpoint.on('change', (change) => changes.push(change));

        const push = lightPush({
            capacity: LIGHT_CAPACITY_LUMINANCE | LIGHT_CAPACITY_TEMPERATURE | LIGHT_CAPACITY_RGB,
            rgb: 0x112233,
            temperature: 10,
            luminance: 50,
            onoff: true
        });

        trait.handlePush(push);

        assert.deepEqual(changes, [
            {
                trait: 'light',
                values: {
                    brightness: (50 - 1) / 99,
                    temperature: (10 - 1) / 99,
                    rgb: { r: 0x11, g: 0x22, b: 0x33 }
                }
            }
        ]);
    });

    it('applies ToggleX PUSH to on/off and emits a patch', () => {
        const { endpoint, trait } = createLightHarness({ hasToggleX: true });
        const changes: unknown[] = [];
        endpoint.on('change', (change) => changes.push(change));

        trait.handlePush(togglexPush(true));

        assert.deepEqual(changes, [{ trait: 'light', values: { on: true } }]);
    });
});

