import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { pollSpec } from '../../src/poll/jobs';
import { CONTROL_ALERT_REPORT_NAMESPACE, CONTROL_OVERTEMP_NAMESPACE } from '../../src/protocol/namespaces';
import { TRAIT_CATALOGS } from '../../src/traits/catalog';

describe('TRAIT_CATALOGS', () => {
    it('covers every TraitName exactly once', () => {
        const entries = Object.entries(TRAIT_CATALOGS);
        assert.equal(entries.length, 20);
        for (const [key, catalog] of entries) {
            assert.equal(catalog.name, key);
        }
    });

    it('owns pairwise-disjoint poll keys with unique order', () => {
        const seen = new Map<string, string>();
        const orders = new Map<number, string>();
        for (const catalog of Object.values(TRAIT_CATALOGS)) {
            for (const [namespace, spec] of Object.entries(catalog.poll)) {
                const previous = seen.get(namespace);
                assert.equal(
                    previous,
                    undefined,
                    `${namespace} owned by both ${previous} and ${catalog.name}`
                );
                seen.set(namespace, catalog.name);
                const other = orders.get(spec.order);
                assert.equal(
                    other,
                    undefined,
                    `order ${spec.order} used by ${other} and ${namespace}`
                );
                orders.set(spec.order, namespace);
            }
        }
    });

    it('does not poll Control.OverTemp or AlertReport', () => {
        const pushOnly = [CONTROL_OVERTEMP_NAMESPACE, CONTROL_ALERT_REPORT_NAMESPACE];
        for (const namespace of pushOnly) {
            for (const catalog of Object.values(TRAIT_CATALOGS)) {
                assert.equal(
                    catalog.poll[namespace],
                    undefined,
                    `${catalog.name} must not poll ${namespace}`
                );
            }
            assert.equal(pollSpec(namespace), undefined);
        }
    });

    it('lists a non-empty push array without intra-array duplicates', () => {
        for (const catalog of Object.values(TRAIT_CATALOGS)) {
            assert.ok(
                catalog.push.length > 0,
                `${catalog.name} push must be non-empty`
            );
            assert.equal(
                new Set(catalog.push).size,
                catalog.push.length,
                `${catalog.name} push must not repeat namespaces`
            );
        }
    });

    it('routes Alert.Report and Control.OverTemp on alert/overtemp push', () => {
        assert.ok(
            TRAIT_CATALOGS.alert.push.includes(CONTROL_ALERT_REPORT_NAMESPACE),
            'alert.push must include Alert.Report'
        );
        assert.ok(
            TRAIT_CATALOGS.overtemp.push.includes(CONTROL_OVERTEMP_NAMESPACE),
            'overtemp.push must include Control.OverTemp'
        );
    });

    it('exposes every poll row from pollSpec by reference', () => {
        let count = 0;
        for (const catalog of Object.values(TRAIT_CATALOGS)) {
            for (const [namespace, spec] of Object.entries(catalog.poll)) {
                count += 1;
                assert.equal(
                    pollSpec(namespace),
                    spec,
                    `${namespace} must be the catalog poll entry`
                );
            }
        }
        assert.ok(count > 0);
    });
});
