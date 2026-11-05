import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	analyzeLocaleUsage,
	formatLocaleUsageDetails,
	parseLocaleAuditArguments,
	runLocaleUsageAudit,
} from './check-unused-locale-keys.mjs';

function createFixture(t, options = {}) {
	const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'operon-locale-audit-'));
	t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
	fs.mkdirSync(path.join(rootDir, 'i18n/locales'), { recursive: true });
	fs.mkdirSync(path.join(rootDir, 'src/core'), { recursive: true });

	fs.writeFileSync(
		path.join(rootDir, 'i18n/locales/en.json'),
		options.englishLocale ?? JSON.stringify({
			settings: {
				alias: 'Alias',
				coreSibling: 'Core sibling',
				dynamicIdentifier: 'Dynamic identifier',
				dynamicMap: 'Dynamic map',
				dynamicTemplate: 'Dynamic template',
				literal: 'Literal',
				noSubstitutionTemplate: 'Template',
				ternaryFalse: 'False',
				ternaryTrue: 'True',
				shadowed: 'Shadowed',
				unused: 'Unused',
			},
		}),
		'utf8',
	);

	fs.writeFileSync(
		path.join(rootDir, 'main.ts'),
		options.mainSource ?? `
import { getTranslations as translateMany, t as translate } from './src/core/i18n';
const condition = true;
const dynamicKey = 'dynamicIdentifier';
const suffix = 'Template';
const keys = { selected: 'dynamicMap' };
translate('settings', 'literal');
translate('settings', \`noSubstitutionTemplate\`);
translate('settings', condition ? 'ternaryTrue' : 'ternaryFalse');
translateMany('settings', 'alias');
translate('settings', dynamicKey);
translate('settings', \`dynamic\${suffix}\`);
translate('settings', keys.selected);
translate('settings', 'missing');
function t(category: string, key: string): string { return category + key; }
t('settings', 'unused');
`,
		'utf8',
	);
	fs.writeFileSync(
		path.join(rootDir, 'src/core/core-usage.ts'),
		options.coreSource ?? `
import { t } from './i18n';
t('settings', 'coreSibling');
function invokeLocal(t: (category: string, key: string) => string): string {
	return t('settings', 'shadowed');
}
void invokeLocal;
`,
		'utf8',
	);
	return rootDir;
}

test('locale audit resolves safe references and preserves dynamic callsites', t => {
	const rootDir = createFixture(t);
	const report = analyzeLocaleUsage({ rootDir });

	assert.deepEqual(report.confirmedReferences, [
		'settings.alias',
		'settings.coreSibling',
		'settings.literal',
		'settings.noSubstitutionTemplate',
		'settings.ternaryFalse',
		'settings.ternaryTrue',
	]);
	assert.deepEqual(report.referencedMissing, ['settings.missing']);
	assert.deepEqual(report.candidateUnused, [
		'settings.dynamicIdentifier',
		'settings.dynamicMap',
		'settings.dynamicTemplate',
		'settings.shadowed',
		'settings.unused',
	]);
	assert.equal(report.unresolvedDynamicCallsiteCount, 3);
	assert.deepEqual(
		report.unresolvedDynamicCallsites.map(callsite => callsite.keyExpression),
		['dynamicKey', '\`dynamic\${suffix}\`', 'keys.selected'],
	);
});

test('locale audit output is deterministic and findings remain report-only', t => {
	const rootDir = createFixture(t);
	const first = analyzeLocaleUsage({ rootDir });
	const second = analyzeLocaleUsage({ rootDir });
	assert.deepEqual(second, first);
	assert.equal(formatLocaleUsageDetails(second), formatLocaleUsageDetails(first));

	const output = [];
	const errors = [];
	const exitCode = runLocaleUsageAudit(['--summary'], {
		rootDir,
		logger: { log: message => output.push(message), error: message => errors.push(message) },
	});
	assert.equal(exitCode, 0);
	assert.equal(errors.length, 0);
	assert.match(output.join('\n'), /5 candidate unused/u);
	assert.match(output.join('\n'), /1 referenced missing/u);
	assert.match(output.join('\n'), /3 unresolved dynamic callsites/u);
});

test('locale audit JSON mode is deterministic and machine-readable', t => {
	const rootDir = createFixture(t);
	const output = [];
	const exitCode = runLocaleUsageAudit(['--json'], {
		rootDir,
		logger: { log: message => output.push(message), error() {} },
	});
	assert.equal(exitCode, 0);
	const parsed = JSON.parse(output.join('\n'));
	assert.equal(parsed.mode, 'report-only');
	assert.equal(parsed.candidateUnusedCount, 5);
	assert.equal(parsed.unresolvedDynamicCallsiteCount, 3);
});

test('locale audit uses ICU-independent code-point ordering', t => {
	const rootDir = createFixture(t, {
		englishLocale: JSON.stringify({
			settings: {
				alpha: 'Alpha',
				Zebra: 'Zebra',
				_underscore: 'Underscore',
				äkey: 'Unicode',
			},
		}),
		mainSource: 'export {};\n',
		coreSource: 'export {};\n',
	});
	const report = analyzeLocaleUsage({ rootDir });
	assert.deepEqual(report.candidateUnused, [
		'settings.Zebra',
		'settings._underscore',
		'settings.alpha',
		'settings.äkey',
	]);
});

test('locale audit rejects invalid arguments and parse failures with exit code 2', t => {
	assert.throws(() => parseLocaleAuditArguments(['--unknown']), /Unknown argument/u);
	assert.throws(() => parseLocaleAuditArguments(['--summary', '--json']), /Choose only one output mode/u);

	const rootDir = createFixture(t, { mainSource: "import { t } from './src/core/i18n';\nconst broken = ;\n" });
	const errors = [];
	const exitCode = runLocaleUsageAudit([], {
		rootDir,
		logger: { log() {}, error: message => errors.push(message) },
	});
	assert.equal(exitCode, 2);
	assert.match(errors.join('\n'), /locale usage audit failed/u);
});

test('locale audit reports locale I/O and JSON failures with exit code 2', t => {
	const rootDir = createFixture(t, { englishLocale: '{' });
	const errors = [];
	const exitCode = runLocaleUsageAudit([], {
		rootDir,
		logger: { log() {}, error: message => errors.push(message) },
	});
	assert.equal(exitCode, 2);
	assert.match(errors.join('\n'), /Could not read English locale/u);
});

test('production translation calls resolve to existing source keys', () => {
	const rootDir = fileURLToPath(new URL('..', import.meta.url));
	const report = analyzeLocaleUsage({ rootDir });
	assert.deepEqual(report.referencedMissing, []);
});
