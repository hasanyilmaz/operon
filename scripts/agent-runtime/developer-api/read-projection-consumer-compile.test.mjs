import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const tscPath = require.resolve('typescript/bin/tsc');
const fixture = fileURLToPath(new URL('./read-projection-consumer-compile.ts', import.meta.url));
const repositoryRoot = path.resolve(path.dirname(fixture), '../../..');

test('a clean TypeScript consumer compiles against the public read-projection structural export', () => {
	const result = spawnSync(process.execPath, [
		tscPath,
		'--noEmit',
		'--pretty', 'false',
		'--skipLibCheck',
		'--strictNullChecks',
		'--noImplicitAny',
		'--resolveJsonModule',
		'--esModuleInterop',
		'--target', 'ES2020',
		'--module', 'ESNext',
		'--moduleResolution', 'node',
		fixture,
	], { cwd: repositoryRoot, encoding: 'utf8' });
	assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
