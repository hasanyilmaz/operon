import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
	checkProductionProcessLaunchPolicy,
	inspectProductionBundleText,
	inspectProductionSourceText,
} from './process-launch-policy.mjs';

const rejectedSources = [
	`import { spawn } from 'node:child_process';`,
	`const cp = require('child_process');`,
	`const cp = window.require('node:child_process');`,
	`const cp = runtimeRequire('node:' + 'child_' + 'process');`,
	`const cp = import(\`child_${'process'}\`);`,
	`const cp = process.getBuiltinModule('node:child_process');`,
	`const cp = process['getBuiltinModule']('node:child_process');`,
	`const binding = process.binding('process_wrap');`,
	`const binding = process['binding']('process_wrap');`,
	`const binding = process.binding('spawn_sync');`,
	`import { createRequire } from 'node:module'; const req = createRequire(import.meta.url); const cp = req('node:child_process');`,
	`import { createRequire as makeRequire } from 'node:module'; const cp = makeRequire(import.meta.url)('child_process');`,
	`import module from 'node:module'; const req = module.createRequire(import.meta.url); const cp = req('child_process');`,
	`import { utilityProcess } from 'electron';`,
	`const childProcess = adapter;`,
	`import cluster from 'node:cluster'; cluster.fork();`,
	`const cluster = require('cluster'); cluster.fork();`,
	`electron.shell.openPath('/tmp/tool');`,
	`electron.shell.openExternal('https://example.com');`,
	`electron.shell.showItemInFolder('/tmp/tool');`,
	`electron.app.relaunch();`,
];

test('production source rejects process-launch modules, indirection, bindings, and wrappers', () => {
	for (const [index, source] of rejectedSources.entries()) {
		assert.notEqual(inspectProductionSourceText(source, `fixture-${index}.ts`).length, 0, source);
	}
});

test('production source allows non-launch builtins and unrelated method names', () => {
	const source = `
		import fs from 'node:fs';
		import net from 'node:net';
		const executor = { spawn: () => undefined, exec: () => undefined };
		executor.spawn();
		executor.exec();
	`;
	assert.deepEqual(inspectProductionSourceText(source), []);
});

test('production bundle rejects minified and transitive process-launch evidence', () => {
	for (const bundle of [
		`var x=require("node:child_process")`,
		`var x=require("child_process")`,
		`electron.utilityProcess.fork(x)`,
		`process.binding("spawn_sync")`,
		`const childProcess={spawnSync(){}}`,
		`require("node:cluster").fork()`,
		`electron.shell.openExternal("https://example.com")`,
		`electron.shell.showItemInFolder("/tmp/tool")`,
		`electron.app.relaunch()`,
	]) {
		assert.notEqual(inspectProductionBundleText(bundle).length, 0, bundle);
	}
	assert.deepEqual(
		inspectProductionBundleText(`const labels=["cluster","operon-editor-quick-cluster"]`),
		[],
	);
});

test('package topology keeps the focused policy in Plugin validation and final in production build', () => {
	const packageManifest = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
	assert.equal(
		packageManifest.scripts['release:process-launch:check'],
		'node scripts/check-process-launch-policy.mjs',
	);
	assert.equal(
		packageManifest.scripts['release:process-launch:test'],
		'node --test scripts/release/process-launch-policy.test.mjs',
	);
	assert.equal(
		packageManifest.scripts['check:plugin'].includes('npm run release:process-launch:test'),
		true,
	);
	assert.equal(
		packageManifest.scripts.build.trim().endsWith('npm run release:process-launch:check'),
		true,
	);
});

test('root policy scans production entrypoints and bundle but excludes scripts and tests', () => {
	const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'operon-process-launch-policy-'));
	try {
		fs.mkdirSync(path.join(rootDir, 'src'));
		fs.mkdirSync(path.join(rootDir, 'scripts'));
		fs.writeFileSync(path.join(rootDir, 'main.ts'), `import fs from 'node:fs';`);
		fs.writeFileSync(path.join(rootDir, 'src', 'feature.ts'), `import net from 'node:net';`);
		fs.writeFileSync(path.join(rootDir, 'src', 'feature.test.ts'), `import cp from 'child_process';`);
		fs.writeFileSync(path.join(rootDir, 'scripts', 'tool.mjs'), `import cp from 'node:child_process';`);
		fs.writeFileSync(path.join(rootDir, 'main.js'), `require("node:net")`);
		assert.deepEqual(checkProductionProcessLaunchPolicy(rootDir), []);

		fs.writeFileSync(path.join(rootDir, 'src', 'feature.ts'), `const cp = runtimeRequire('node:child_process');`);
		assert.equal(checkProductionProcessLaunchPolicy(rootDir).some(finding => finding.file === 'src/feature.ts'), true);
	} finally {
		fs.rmSync(rootDir, { recursive: true, force: true });
	}
});
