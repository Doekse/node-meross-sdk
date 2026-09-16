import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { applyPatch } from '../../src/traits/patch';

interface Sample {
    on?: boolean;
    power?: number;
    rgb?: { r: number; g: number; b: number };
    consumption?: Array<{ date: string; value: number }>;
}

describe('applyPatch', () => {
    it('does not emit for an empty patch and leaves last unchanged', () => {
        const last: Sample = { on: true };
        const emitted: Sample[] = [];

        applyPatch(last, {}, (changed) => emitted.push(changed));

        assert.deepEqual(emitted, []);
        assert.deepEqual(last, { on: true });
    });

    it('skips undefined keys so existing last keys are not cleared', () => {
        const last: Sample = { on: true, power: 11 };
        const emitted: Sample[] = [];

        applyPatch(last, { on: undefined, power: 12 }, (changed) => emitted.push(changed));

        assert.deepEqual(emitted, [{ power: 12 }]);
        assert.deepEqual(last, { on: true, power: 12 });
    });

    it('emits only the scalar key that changed and writes last', () => {
        const last: Sample = { on: true, power: 11 };
        const emitted: Sample[] = [];

        applyPatch(last, { on: true, power: 12 }, (changed) => emitted.push(changed));

        assert.deepEqual(emitted, [{ power: 12 }]);
        assert.deepEqual(last, { on: true, power: 12 });
    });

    it('does not emit when every scalar equals last', () => {
        const last: Sample = { on: true, power: 11 };
        const emitted: Sample[] = [];

        applyPatch(last, { on: true, power: 11 }, (changed) => emitted.push(changed));

        assert.deepEqual(emitted, []);
        assert.deepEqual(last, { on: true, power: 11 });
    });

    it('emits when JSON.stringify of an object key differs', () => {
        const last: Sample = { rgb: { r: 1, g: 2, b: 3 } };
        const emitted: Sample[] = [];

        applyPatch(last, { rgb: { r: 4, g: 5, b: 6 } }, (changed) => emitted.push(changed));

        assert.deepEqual(emitted, [{ rgb: { r: 4, g: 5, b: 6 } }]);
        assert.deepEqual(last.rgb, { r: 4, g: 5, b: 6 });
    });

    it('does not emit when a new object has the same JSON as last', () => {
        const rgb = { r: 1, g: 2, b: 3 };
        const last: Sample = { rgb };
        const emitted: Sample[] = [];

        applyPatch(last, { rgb: { r: 1, g: 2, b: 3 } }, (changed) => emitted.push(changed));

        assert.deepEqual(emitted, []);
        assert.equal(last.rgb, rgb);
    });

    it('emits only the changed key in a mixed patch', () => {
        const last: Sample = { on: true, power: 11, rgb: { r: 1, g: 2, b: 3 } };
        const emitted: Sample[] = [];

        applyPatch(
            last,
            { on: true, power: 12, rgb: { r: 1, g: 2, b: 3 } },
            (changed) => emitted.push(changed)
        );

        assert.deepEqual(emitted, [{ power: 12 }]);
        assert.deepEqual(last, { on: true, power: 12, rgb: { r: 1, g: 2, b: 3 } });
    });

    it('treats equal consumption arrays as unchanged', () => {
        const last: Sample = { consumption: [{ date: '2018-03-05', value: 1000 }] };
        const emitted: Sample[] = [];

        applyPatch(
            last,
            { consumption: [{ date: '2018-03-05', value: 1000 }] },
            (changed) => emitted.push(changed)
        );

        assert.deepEqual(emitted, []);
    });

    it('emits when a consumption array changes', () => {
        const last: Sample = { consumption: [{ date: '2018-03-05', value: 1000 }] };
        const emitted: Sample[] = [];
        const next = [{ date: '2018-03-06', value: 500 }];

        applyPatch(last, { consumption: next }, (changed) => emitted.push(changed));

        assert.deepEqual(emitted, [{ consumption: next }]);
        assert.equal(last.consumption, next);
    });
});
