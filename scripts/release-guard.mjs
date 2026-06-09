import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

function readText(relativePath) {
	return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function readJson(relativePath) {
	return JSON.parse(readText(relativePath));
}

function fail(message) {
	failures.push(message);
}

function flattenStringLeaves(value, prefix = '') {
	const leaves = new Map();
	if (typeof value === 'string') {
		leaves.set(prefix, value);
		return leaves;
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return leaves;
	}
	for (const [key, child] of Object.entries(value)) {
		const nextPrefix = prefix ? `${prefix}.${key}` : key;
		for (const [leafKey, leafValue] of flattenStringLeaves(child, nextPrefix)) {
			leaves.set(leafKey, leafValue);
		}
	}
	return leaves;
}

function placeholders(text) {
	return [...text.matchAll(/\{\{([A-Za-z0-9_]+)\}\}/g)]
		.map(match => match[1])
		.sort();
}

function assertEqual(label, left, right) {
	if (left !== right) {
		fail(`${label}: expected ${right}, got ${left}`);
	}
}

function assertFileExists(relativePath) {
	if (!fs.existsSync(path.join(rootDir, relativePath))) {
		fail(`Missing release asset: ${relativePath}`);
	}
}

function assertNoMatch(relativePath, pattern, label) {
	const text = readText(relativePath);
	if (pattern.test(text)) {
		fail(`${relativePath}: ${label}`);
	}
}

function assertIncludes(relativePath, needle, label) {
	const text = readText(relativePath);
	if (!text.includes(needle)) {
		fail(`${relativePath}: ${label}`);
	}
}

function preserveLineCount(text) {
	return text.replace(/[^\n]/g, '');
}

function stripCssComments(text) {
	return text.replace(/\/\*[\s\S]*?\*\//g, preserveLineCount);
}

function lineNumberAt(text, index) {
	return text.slice(0, index).split('\n').length;
}

function cssRules(relativePath) {
	const text = stripCssComments(readText(relativePath));
	return [...text.matchAll(/([^{}]+)\{([^{}]+)\}/g)].map(([, selectorText, body]) => ({
		selectors: selectorText.split(',').map(selector => selector.trim()),
		body,
	}));
}

function assertCssRuleContains(relativePath, selector, requiredDeclarations, label) {
	const matchingRules = cssRules(relativePath).filter(candidate => candidate.selectors.includes(selector));
	if (matchingRules.length === 0) {
		fail(`${relativePath}: ${label}: missing rule for ${selector}`);
		return;
	}

	if (matchingRules.some(rule => requiredDeclarations.every(declaration => rule.body.includes(declaration)))) {
		return;
	}

	for (const declaration of requiredDeclarations) {
		if (!matchingRules.some(rule => rule.body.includes(declaration))) {
			fail(`${relativePath}: ${label}: ${selector} must include ${declaration}`);
		}
	}
}

function assertNoDuplicateCssDeclarations(relativePath) {
	const text = stripCssComments(readText(relativePath));
	for (const rule of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
		const selectorText = rule[1].trim().replace(/\s+/g, ' ');
		const body = rule[2];
		const ruleBodyStart = (rule.index ?? 0) + rule[0].indexOf('{') + 1;
		const declarations = new Map();

		for (const declaration of body.matchAll(/(^|;)\s*([-\w]+)\s*:/g)) {
			const property = declaration[2].toLowerCase();
			if (property.startsWith('--')) continue;

			const declarationIndex = ruleBodyStart + declaration.index + declaration[0].indexOf(property);
			const lineNumber = lineNumberAt(text, declarationIndex);
			const firstLineNumber = declarations.get(property);
			if (firstLineNumber !== undefined) {
				fail(`${relativePath}:${lineNumber}: duplicate CSS declaration "${property}" in ${selectorText}; first declared on line ${firstLineNumber}`);
				continue;
			}

			declarations.set(property, lineNumber);
		}
	}
}

function compareLocaleFiles() {
	const en = flattenStringLeaves(readJson('i18n/locales/en.json'));
	const enKeys = [...en.keys()].sort();

	// Each translated locale must have full key parity and matching placeholders against English.
	const translations = {
		Turkish: flattenStringLeaves(readJson('i18n/locales/tr.json')),
		German: flattenStringLeaves(readJson('i18n/locales/de.json')),
		French: flattenStringLeaves(readJson('i18n/locales/fr.json')),
	};

	for (const [label, locale] of Object.entries(translations)) {
		const localeKeys = [...locale.keys()].sort();
		for (const key of enKeys) {
			if (!locale.has(key)) fail(`Missing ${label} locale key: ${key}`);
		}
		for (const key of localeKeys) {
			if (!en.has(key)) fail(`Missing English locale key (present in ${label}): ${key}`);
		}
		for (const key of enKeys) {
			if (!locale.has(key)) continue;
			const enPlaceholders = placeholders(en.get(key)).join(',');
			const localePlaceholders = placeholders(locale.get(key)).join(',');
			if (enPlaceholders !== localePlaceholders) {
				fail(`Locale placeholder mismatch for ${key}: en=[${enPlaceholders}] ${label.toLowerCase()}=[${localePlaceholders}]`);
			}
		}
	}
}

function checkVersionAndAssets() {
	const pkg = readJson('package.json');
	const manifest = readJson('manifest.json');
	const versions = readJson('versions.json');
	const lock = readJson('package-lock.json');
	const lockRoot = lock.packages?.[''];

	assertEqual('package.json and manifest.json version', pkg.version, manifest.version);
	assertEqual('versions.json min app version', versions[pkg.version], manifest.minAppVersion);
	assertEqual('package-lock root name', lockRoot?.name, pkg.name);
	assertEqual('package-lock root version', lockRoot?.version, pkg.version);

	for (const asset of ['main.js', 'manifest.json', 'styles.css']) {
		assertFileExists(asset);
	}
}

function checkReleaseWorkflow() {
	const workflow = '.github/workflows/release.yml';

	assertIncludes(workflow, 'id-token: write', 'release workflow must grant OIDC token permission for artifact attestations');
	assertIncludes(workflow, 'attestations: write', 'release workflow must grant artifact attestation permission');
	assertIncludes(workflow, 'uses: actions/attest@v4', 'release workflow must attest release assets');

	for (const asset of ['manifest.json', 'main.js', 'styles.css']) {
		assertIncludes(workflow, `subject-path: ${asset}`, `release workflow must attest ${asset}`);
	}
}

function checkCssScorecard() {
	const bannedCssPatterns = [
		[/!important\b/, 'future CSS changes must avoid !important'],
		[/\ball\s*:\s*unset\b/, 'use explicit scoped resets instead of all: unset'],
		[/\bdisplay\s*:\s*contents\b/, 'avoid display: contents because Obsidian compatibility checks flag it'],
		[/\bcolumn-gap\s*:/, 'use gap shorthand instead of column-gap for Obsidian CSS compatibility'],
		[/\brow-gap\s*:/, 'use gap shorthand instead of row-gap for Obsidian CSS compatibility'],
		[/\btext-decoration-(line|color)\s*:/, 'avoid text-decoration subproperties flagged by Obsidian CSS lint'],
	];

	for (const [pattern, label] of bannedCssPatterns) {
		assertNoMatch('styles.css', pattern, label);
	}

	assertNoDuplicateCssDeclarations('styles.css');

	for (const selector of ['.operon-chip', '.operon-live-preview-chip', '.operon-live-preview-edit', '.operon-task-wikilink-action']) {
		assertCssRuleContains(
			'styles.css',
			selector,
			['box-sizing: border-box;', 'min-height: 0;', 'height: auto;', 'background-image: none;'],
			'inline chip and action controls must reset Obsidian button defaults',
		);
	}

	assertCssRuleContains(
		'styles.css',
		'.operon-inline-compact-chip',
		[
			'height: var(--operon-compact-chip-height, 18px);',
			'min-height: var(--operon-compact-chip-height, 18px);',
			'line-height: var(--operon-compact-chip-line-height, 1.25);',
		],
		'inline compact chips must keep a stable visual height',
	);
}

function checkDocs() {
	for (const doc of ['PHASE5-ACCEPTANCE.md', 'PHASE7-ACCEPTANCE.md']) {
		if (!readText(doc).includes('npm run check:local')) {
			fail(`${doc}: automated validation must reference npm run check:local`);
		}
	}
}

function checkAuditedRawStrings() {
	assertNoMatch('main.ts', /name:\s*['"]Create or edit inline task['"]/, 'command label bypasses i18n');
	assertNoMatch('main.ts', /name:\s*['"]Convert tasks emoji line to inline task['"]/i, 'Tasks emoji command label bypasses i18n');
	assertNoMatch('main.ts', /name:\s*['"]Create file task['"]/, 'file task command label bypasses i18n');
	assertNoMatch('main.ts', /name:\s*['"]Open calendar view['"]/, 'calendar command label bypasses i18n');

	assertNoMatch('src/ui/kanban/kanban-cell-action-modal.ts', /Status:\s*\$\{/, 'Kanban status label bypasses i18n');
	assertNoMatch('src/ui/kanban/kanban-cell-action-modal.ts', /return\s+['"](Priority|Tags|Contexts|Assignees|Due|Scheduled|Lane)['"]/, 'Kanban swimlane label bypasses i18n');

	assertNoMatch('src/ui/time-session-history-view.ts', /['"]\(untitled\)['"]/, 'time history untitled label bypasses i18n');
	assertNoMatch('src/ui/time-session-history-view.ts', /['"]Jump to source['"]/, 'time history source action label bypasses i18n');
	assertNoMatch('src/ui/time-session-history-view.ts', /['"]Open task editor['"]/, 'time history editor action label bypasses i18n');
}

compareLocaleFiles();
checkVersionAndAssets();
checkReleaseWorkflow();
checkCssScorecard();
checkDocs();
checkAuditedRawStrings();

if (failures.length > 0) {
	console.error('Operon release guard failed:');
	for (const failure of failures) {
		console.error(`- ${failure}`);
	}
	process.exit(1);
}

console.log('Operon release guard passed.');
