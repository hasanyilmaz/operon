import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
	assertCanonicalWindowsPluginContext,
	runWindowsPluginValidationSteps,
} from './validate-windows-plugin.mjs';

const validContext = {
	platform: 'win32',
	nodeVersion: 'v24.18.0',
	npmVersion: '11.12.1',
	headSha: 'a'.repeat(40),
};

test('Windows Plugin validation keeps the exact host and toolchain boundary', () => {
	assert.doesNotThrow(() => assertCanonicalWindowsPluginContext(validContext));
	assert.throws(() => assertCanonicalWindowsPluginContext({ ...validContext, platform: 'darwin' }));
	assert.throws(() => assertCanonicalWindowsPluginContext({ ...validContext, nodeVersion: 'v24.19.0' }));
});

test('Windows Plugin validation omits the broad Plugin suite and preserves clean postflight', () => {
	const calls = [];
	runWindowsPluginValidationSteps({
		assertTrackedClean: phase => calls.push(`clean:${phase}`),
		installDependencies: () => calls.push('npm-ci'),
		assertUrlPortable: () => calls.push('url-portable'),
		runRequiredNativeTransport: () => calls.push('native-transport'),
	});
	assert.deepEqual(calls, [
		'clean:preflight',
		'npm-ci',
		'clean:post-install',
		'url-portable',
		'native-transport',
		'clean:postflight',
	]);
});

test('Windows CI runs one platform validator instead of the broad Plugin suite', () => {
	const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
	assert.match(
		workflow,
		/- name: Run canonical Windows Plugin validation\s+run: npm run validate:windows:plugin/u,
	);
	assert.doesNotMatch(
		workflow,
		/- name: Run canonical Windows Plugin validation[\s\S]*?npm run check:plugin/u,
	);
	assert.doesNotMatch(
		workflow,
		/- name: Run validation\s+[\s\S]*?run: npm run check(?:\s|$)/u,
	);
	assert.doesNotMatch(workflow, /- name: Run required native transport validation/u);
});
