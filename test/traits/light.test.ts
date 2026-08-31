import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Endpoint } from '../../src/endpoint';
import {
    LIGHT_CAPACITY_EFFECT,
    LIGHT_CAPACITY_LUMINANCE,
    LIGHT_CAPACITY_RGB,
    LIGHT_CAPACITY_TEMPERATURE,
    LIGHT_NAMESPACE,
    LIGHT_EFFECT_NAMESPACE,
    TOGGLEX_NAMESPACE,
    encodeMessage,
    encodeLightEffectSet,
    encodeLightSet,
    encodeToggleXSet
} from '../../src/protocol';
import { LightTrait } from '../../src/traits/light';
import type { MerossMessage } from '../../src/protocol';
import { createRequestRecorder, traitAck } from '../helpers/request';

const KEY = 'stub-key';
const UUID = '2206138957096651080248e1e99705a4';
const CHANNEL = 0;
const TOGGLE_NAMESPACE = 'Appliance.Control.Toggle';

function lightPush(options: {
    capacity: number;
    channel?: number;
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
                channel: options.channel ?? CHANNEL,
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

function togglePush(on: boolean) {
    return encodeMessage({
        namespace: TOGGLE_NAMESPACE,
        method: 'PUSH',
        key: KEY,
        from: `/appliance/${UUID}/publish`,
        uuid: UUID,
        payload: {
            toggle: { onoff: on ? 1 : 0 }
        }
    });
}

function createLightHarness(options: {
    hasToggleX?: boolean;
    hasToggle?: boolean;
    lightCapacity?: number;
    hasLightEffect?: boolean;
    lightEffectCatalog?: Array<{ Id: string; effectName: string; enable?: number }>;
} = {}): {
    endpoint: Endpoint;
    trait: LightTrait;
    requests: MerossMessage[];
} {
    const endpoint = new Endpoint({
        id: `${UUID}:${CHANNEL}`,
        traits: ['light']
    });
    const { requests, request } = createRequestRecorder({
        uuid: UUID,
        key: KEY,
        ack: (opts, sent) => {
            if (opts.namespace === LIGHT_NAMESPACE) {
                if (opts.method === 'GET') {
                    return traitAck(sent, {
                        key: KEY,
                        method: 'GETACK',
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
                return traitAck(sent, { key: KEY, payload: opts.payload });
            }
            if (opts.namespace === LIGHT_EFFECT_NAMESPACE) {
                if (opts.method === 'GET') {
                    return traitAck(sent, {
                        key: KEY,
                        method: 'GETACK',
                        payload: { effect: options.lightEffectCatalog ?? [] }
                    });
                }
                return traitAck(sent, { key: KEY });
            }
            if (opts.namespace === TOGGLEX_NAMESPACE) {
                if (opts.method === 'GET') {
                    return traitAck(sent, {
                        key: KEY,
                        method: 'GETACK',
                        payload: {
                            togglex: { channel: CHANNEL, onoff: 1, entity: 1, lmTime: 1 }
                        }
                    });
                }
                return traitAck(sent, { key: KEY });
            }
            return traitAck(sent, { key: KEY });
        }
    });

    const trait = new LightTrait({
        uuid: UUID,
        channel: CHANNEL,
        hasToggleX: options.hasToggleX ?? false,
        hasToggle: options.hasToggle ?? false,
        lightCapacity: options.lightCapacity ?? 0,
        hasLightEffect: options.hasLightEffect ?? false,
        request,
        emitChange: (values) => endpoint.emit('change', {
            trait: 'light',
            values: values as Record<string, unknown>
        })
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

    it('routes device-level on/off through Toggle SET when ToggleX is absent', async () => {
        const { endpoint, trait, requests } = createLightHarness({ hasToggle: true });
        const changes: unknown[] = [];
        endpoint.on('change', (change) => changes.push(change));

        await trait.setOn(true);

        assert.equal(requests.length, 1);
        assert.equal(requests[0]?.header.namespace, TOGGLE_NAMESPACE);
        assert.equal(requests[0]?.header.method, 'SET');
        assert.deepEqual(requests[0]?.payload, { toggle: { onoff: 1 } });
        assert.deepEqual(changes, [{ trait: 'light', values: { on: true } }]);
    });

    it('routes on/off through Control.Light when ToggleX and Toggle are absent', async () => {
        const { endpoint, trait, requests } = createLightHarness({
            lightCapacity: LIGHT_CAPACITY_RGB | LIGHT_CAPACITY_LUMINANCE
        });
        const changes: unknown[] = [];
        endpoint.on('change', (change) => changes.push(change));

        await trait.setOn(true);

        assert.equal(requests.length, 1);
        assert.equal(requests[0]?.header.namespace, LIGHT_NAMESPACE);
        assert.equal(requests[0]?.header.method, 'SET');
        assert.deepEqual(
            requests[0]?.payload,
            encodeLightSet({
                channel: CHANNEL,
                capacity: LIGHT_CAPACITY_RGB | LIGHT_CAPACITY_LUMINANCE,
                onoff: true
            })
        );
        assert.deepEqual(changes, [{ trait: 'light', values: { on: true } }]);
    });
});

describe('LightTrait.setBrightness', () => {
    it('maps host 0 to wire luminance 0 and treats the SET as off', async () => {
        const { trait, requests } = createLightHarness();
        const result = await trait.setBrightness(0);
        assert.deepEqual(
            requests[0]?.payload,
            encodeLightSet({ channel: CHANNEL, capacity: LIGHT_CAPACITY_LUMINANCE, luminance: 0 })
        );
        assert.equal(trait.isOn(), false);
        assert.equal(result.brightness, 0);
    });

    it('maps non-zero host brightness onto the 1–100 luminance scale', async () => {
        const { trait, requests } = createLightHarness();
        await trait.setBrightness(1);
        assert.deepEqual(
            requests[0]?.payload,
            encodeLightSet({ channel: CHANNEL, capacity: LIGHT_CAPACITY_LUMINANCE, luminance: 100 })
        );
    });
});

describe('LightTrait.setTemperature', () => {
    it('maps host temperature onto the 1–100 wire scale', async () => {
        const { trait, requests } = createLightHarness();

        const result = await trait.setTemperature(1);

        assert.equal(requests.length, 1);
        assert.equal(requests[0]?.header.namespace, LIGHT_NAMESPACE);
        assert.equal(requests[0]?.header.method, 'SET');
        assert.deepEqual(
            requests[0]?.payload,
            encodeLightSet({ channel: CHANNEL, capacity: LIGHT_CAPACITY_TEMPERATURE, temperature: 100 })
        );
        assert.equal(result.temperature, 1);
        assert.equal(trait.getTemperature(), 1);
    });
});

describe('LightTrait.setRgb', () => {
    it('packs RGB as 0xRRGGBB on Control.Light SET', async () => {
        const { trait, requests } = createLightHarness();
        const rgb = { r: 0x11, g: 0x22, b: 0x33 };

        const result = await trait.setRgb(rgb);

        assert.equal(requests.length, 1);
        assert.equal(requests[0]?.header.namespace, LIGHT_NAMESPACE);
        assert.equal(requests[0]?.header.method, 'SET');
        assert.deepEqual(
            requests[0]?.payload,
            encodeLightSet({ channel: CHANNEL, capacity: LIGHT_CAPACITY_RGB, rgb: 0x112233 })
        );
        assert.deepEqual(result.rgb, rgb);
        assert.deepEqual(trait.getRgb(), rgb);
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

    it('applies Toggle PUSH to on/off when Toggle-backed', () => {
        const { endpoint, trait } = createLightHarness({ hasToggle: true });
        const changes: unknown[] = [];
        endpoint.on('change', (change) => changes.push(change));

        trait.handlePush(togglePush(true));

        assert.deepEqual(changes, [{ trait: 'light', values: { on: true } }]);
    });

    it('applies Control.Light onoff when the light is not Toggle-backed', () => {
        const { endpoint, trait } = createLightHarness({
            lightCapacity: LIGHT_CAPACITY_LUMINANCE
        });
        const changes: unknown[] = [];
        endpoint.on('change', (change) => changes.push(change));

        trait.handlePush(lightPush({
            capacity: LIGHT_CAPACITY_LUMINANCE,
            luminance: 50,
            onoff: true
        }));

        assert.deepEqual(changes, [{
            trait: 'light',
            values: {
                brightness: (50 - 1) / 99,
                on: true
            }
        }]);
    });

    it('ignores Control.Light PUSH for other channels', () => {
        const { endpoint, trait } = createLightHarness({
            lightCapacity: LIGHT_CAPACITY_LUMINANCE
        });
        const changes: unknown[] = [];
        endpoint.on('change', (change) => changes.push(change));

        trait.handlePush(lightPush({
            channel: 1,
            capacity: LIGHT_CAPACITY_LUMINANCE,
            luminance: 80
        }));

        assert.deepEqual(changes, []);
    });
});

describe('LightTrait.setEffect', () => {
    it('selects effects via Control.Light capacity 0x8 when no catalog is available', async () => {
        const { endpoint, trait, requests } = createLightHarness({ hasLightEffect: false });
        const changes: unknown[] = [];
        endpoint.on('change', (change) => changes.push(change));

        await trait.setEffect(2);

        assert.equal(requests.length, 1);
        assert.equal(requests[0].header.namespace, LIGHT_NAMESPACE);
        assert.equal(requests[0].header.method, 'SET');
        assert.deepEqual(
            requests[0].payload,
            encodeLightSet({ channel: CHANNEL, capacity: LIGHT_CAPACITY_EFFECT, effect: 2 })
        );
        assert.deepEqual(changes, [{ trait: 'light', values: { effect: 2 } }]);
    });

    it('loads effect names from Light.Effect GETACK when advertised', () => {
        const catalog = [
            { Id: '1', effectName: 'Night', enable: 0 },
            { Id: '2', effectName: 'Day', enable: 0 }
        ];
        const { trait } = createLightHarness({
            hasLightEffect: true,
            lightEffectCatalog: catalog
        });

        trait.handlePush(encodeMessage({
            namespace: LIGHT_EFFECT_NAMESPACE,
            method: 'GETACK',
            key: KEY,
            from: `/appliance/${UUID}/publish`,
            uuid: UUID,
            payload: { effect: catalog }
        }));

        assert.deepEqual(trait.getEffectNames(), ['Night', 'Day']);
    });

    it('reports no effect names when Light.Effect is not advertised', () => {
        const { trait } = createLightHarness({ hasLightEffect: false });

        assert.deepEqual(trait.getEffectNames(), []);
    });

    it('setEffect enables the selected Light.Effect entry only when advertised', async () => {
        const catalog = [
            { Id: '1', effectName: 'Night', enable: 0, member: [] },
            { Id: '2', effectName: 'Day', enable: 0, member: [] }
        ];

        const { endpoint, trait, requests } = createLightHarness({
            hasLightEffect: true,
            lightEffectCatalog: catalog
        });
        trait.handlePush(encodeMessage({
            namespace: LIGHT_EFFECT_NAMESPACE,
            method: 'GETACK',
            key: KEY,
            from: `/appliance/${UUID}/publish`,
            uuid: UUID,
            payload: { effect: catalog }
        }));
        requests.length = 0;

        const changes: unknown[] = [];
        endpoint.on('change', (change) => changes.push(change));

        await trait.setEffect(1);

        assert.equal(requests.length, 2);
        assert.equal(requests[0].header.namespace, LIGHT_NAMESPACE);
        assert.equal(requests[0].header.method, 'SET');
        assert.deepEqual(
            requests[0].payload,
            encodeLightSet({ channel: CHANNEL, capacity: LIGHT_CAPACITY_EFFECT, effect: 1 })
        );

        assert.equal(requests[1].header.namespace, LIGHT_EFFECT_NAMESPACE);
        assert.equal(requests[1].header.method, 'SET');
        assert.deepEqual(requests[1].payload, encodeLightEffectSet([{ ...catalog[1], enable: 1 }]));

        assert.deepEqual(changes, [{ trait: 'light', values: { effect: 1 } }]);
    });
});

