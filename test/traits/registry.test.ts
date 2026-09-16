import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { POLL } from '../../src/poll/jobs';
import { TRAIT_DESCRIPTORS } from '../../src/traits/registry';

describe('TRAIT_DESCRIPTORS', () => {
    it('covers every TraitName exactly once', () => {
        const entries = Object.entries(TRAIT_DESCRIPTORS);
        assert.equal(entries.length, 17);
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
