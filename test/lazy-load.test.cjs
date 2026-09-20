'use strict';

/**
 * Proves the public CJS entry does not load climate/sensor modules.
 * Runs in a child `node -e` process so sibling `--test` files cannot
 * poison `require.cache`.
 */

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const process = require('node:process');
const { describe, it } = require('node:test');

const repoRoot = path.join(__dirname, '..');

const HEAVY_MODULES = [
    'traits/climate.js',
    'protocol/codecs/climate.js',
    'traits/sensor.js',
    'protocol/codecs/sensor.js'
];

/**
 * Run `source` in a fresh Node process rooted at the package.
 *
 * @param {string} source
 * @returns {{ status: number | null, stdout: string, stderr: string }}
 */
function runChild(source) {
    const result = spawnSync(process.execPath, ['-e', source], {
        cwd: repoRoot,
        encoding: 'utf8'
    });
    return {
        status: result.status,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? ''
    };
}

describe('public entry load', () => {
    it('require(package) does not load climate or sensor modules', () => {
        const suffixes = JSON.stringify(HEAVY_MODULES);
        const source = `
require('.');
const path = require('node:path');
const suffixes = ${suffixes};
function cached(suffix) {
    const needle = path.sep + suffix.split('/').join(path.sep);
    return Object.keys(require.cache).some((key) => key.endsWith(needle));
}
const hits = suffixes.filter(cached);
if (hits.length > 0) {
    console.error('unexpected cached modules: ' + hits.join(', '));
    process.exit(1);
}
`;
        const result = runChild(source);
        assert.equal(result.status, 0, result.stderr || result.stdout);
    });
});
