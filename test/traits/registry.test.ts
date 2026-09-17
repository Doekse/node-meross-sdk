import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { POLL } from '../../src/poll/jobs';
import { CONTROL_ALERT_REPORT_NAMESPACE } from '../../src/protocol/codecs/alertconfig';
import { CONTROL_OVERTEMP_NAMESPACE } from '../../src/protocol/codecs/overtemp';
import { TRAIT_DESCRIPTORS } from '../../src/traits/registry';

describe('TRAIT_DESCRIPTORS', () => {
    it('covers every TraitName exactly once', () => {
        const entries = Object.entries(TRAIT_DESCRIPTORS);
        assert.equal(entries.length, 20);
        for (const [key, descriptor] of entries) {
            assert.equal(descriptor.name, key);
        }
    });

    it('owns pairwise-disjoint poll keys', () => {
        const seen = new Map<string, string>();
        for (const descriptor of Object.values(TRAIT_DESCRIPTORS)) {
            for (const namespace of Object.keys(descriptor.poll)) {
                const previous = seen.get(namespace);
                assert.equal(
                    previous,
                    undefined,
                    `${namespace} owned by both ${previous} and ${descriptor.name}`
                );
                seen.set(namespace, descriptor.name);
            }
        }
    });

    it('does not poll Control.OverTemp or AlertReport', () => {
        const pushOnly = [CONTROL_OVERTEMP_NAMESPACE, CONTROL_ALERT_REPORT_NAMESPACE];
        for (const namespace of pushOnly) {
            for (const descriptor of Object.values(TRAIT_DESCRIPTORS)) {
                assert.equal(
                    descriptor.poll[namespace],
                    undefined,
                    `${descriptor.name} must not poll ${namespace}`
                );
            }
            assert.equal(POLL[namespace], undefined);
        }
    });

    it('supplies every POLL entry by reference', () => {
        const owned = new Set<string>();
        for (const descriptor of Object.values(TRAIT_DESCRIPTORS)) {
            for (const [namespace, spec] of Object.entries(descriptor.poll)) {
                owned.add(namespace);
                assert.equal(
                    POLL[namespace],
                    spec,
                    `${namespace} must be the descriptor poll entry`
                );
            }
        }
        assert.equal(Object.keys(POLL).length, owned.size);
    });
});
