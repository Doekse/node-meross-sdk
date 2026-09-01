'use strict';

/**
 * Walks `test/` so TypeScript files go through tsx and the CJS surface
 * test stays on `node --test`. An explicit list also avoids glob quoting
 * turning into a literal path.
 */

const { spawnSync } = require('node:child_process');
const { readdirSync } = require('node:fs');
const { join } = require('node:path');
const process = require('node:process');

const testRoot = join(__dirname, '..', 'test');

/**
 * Recursively collect `*.test.ts` and `*.test.cjs` under `dir`.
 *
 * @param {string} dir
 * @param {string[]} tsFiles
 * @param {string[]} cjsFiles
 */
function collectTestFiles(dir, tsFiles, cjsFiles) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            collectTestFiles(fullPath, tsFiles, cjsFiles);
            continue;
        }
        if (!entry.isFile()) {
            continue;
        }
        if (entry.name.endsWith('.test.ts')) {
            tsFiles.push(fullPath);
        } else if (entry.name.endsWith('.test.cjs')) {
            cjsFiles.push(fullPath);
        }
    }
}

/**
 * Run a command with inherited stdio and exit if it fails.
 *
 * @param {string} command
 * @param {string[]} args
 */
function run(command, args) {
    const result = spawnSync(command, args, { stdio: 'inherit' });
    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        process.exit(result.status === null ? 1 : result.status);
    }
}

const tsFiles = [];
const cjsFiles = [];
collectTestFiles(testRoot, tsFiles, cjsFiles);
tsFiles.sort();
cjsFiles.sort();

if (tsFiles.length === 0 && cjsFiles.length === 0) {
    process.stderr.write('No test files found under test/\n');
    process.exit(1);
}

if (tsFiles.length > 0) {
    // Run tsx's own CLI with this node binary. Spawning `npx` fails on Windows.
    run(process.execPath, [require.resolve('tsx/cli'), '--test', ...tsFiles]);
}

if (cjsFiles.length > 0) {
    run(process.execPath, ['--test', ...cjsFiles]);
}
