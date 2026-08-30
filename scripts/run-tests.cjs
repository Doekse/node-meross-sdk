'use strict';

/**
 * Walks `test/` so TypeScript files go through tsx and the CJS surface
 * test stays on `node --test`. An explicit list also avoids glob quoting
 * turning into a literal path.
 */

const { spawnSync } = require('node:child_process');
const { readdirSync } = require('node:fs');
const { dirname, join } = require('node:path');
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
 * Resolve tsx's CLI entry point so it can be run with the current `node`
 * binary instead of through `npx`.
 *
 * On Windows npm installs `npx` as `npx.cmd`, which spawnSync cannot find
 * (it does not consult PATHEXT), and naming `npx.cmd` explicitly fails too:
 * since the fix for CVE-2024-27980, Node refuses to spawn `.cmd`/`.bat`
 * without `shell: true`, with EINVAL. Using a shell would in turn mean
 * quoting every one of the ~55 absolute test paths.
 *
 * Spawning tsx's own entry point avoids the shim entirely, keeps
 * `shell: false`, and runs the same CLI npx would have run.
 *
 * @returns {string}
 */
function resolveTsxCli() {
    const manifestPath = require.resolve('tsx/package.json');
    const { bin } = require(manifestPath);
    const relative = typeof bin === 'string' ? bin : bin.tsx;
    return join(dirname(manifestPath), relative);
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
    run(process.execPath, [resolveTsxCli(), '--test', ...tsFiles]);
}

if (cjsFiles.length > 0) {
    run(process.execPath, ['--test', ...cjsFiles]);
}
