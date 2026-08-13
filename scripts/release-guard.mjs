import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

import { classifyPullRequestValidationSurface } from './ci/classify-pr-validation-surface.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const guardScope = parseGuardScope(process.argv.slice(2));

function parseGuardScope(argv) {
	if (argv.length === 0) return 'plugin';
	if (argv.length === 2 && argv[0] === '--scope' && ['plugin', 'cli-compat'].includes(argv[1])) {
		return argv[1];
	}
	throw new Error('OPERON_RELEASE_GUARD_SCOPE_INVALID');
}

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

function isGitIgnored(relativePath) {
	try {
		execFileSync('git', ['check-ignore', '--quiet', '--no-index', '--', relativePath], {
			cwd: rootDir,
			stdio: 'ignore',
		});
		return true;
	} catch (error) {
		if (error?.status === 1) return false;
		throw error;
	}
}

assertNoMatch(
	'main.js',
	/operon:transport-probe/u,
	'development-only Agent Runtime transport probe must not ship in the production bundle',
);

function listFiles(relativeDir, predicate) {
	const absoluteDir = path.join(rootDir, relativeDir);
	return fs.readdirSync(absoluteDir)
		.filter(predicate)
		.map(file => `${relativeDir}/${file}`);
}

function assertIncludes(relativePath, needle, label) {
	const text = readText(relativePath);
	if (!text.includes(needle)) {
		fail(`${relativePath}: ${label}`);
	}
}

function assertCssAtRuleContains(relativePath, atRule, requiredNeedles, forbiddenNeedles, label) {
	const text = stripCssComments(readText(relativePath));
	const blocks = [];
	let searchIndex = 0;
	while (searchIndex < text.length) {
		const atRuleIndex = text.indexOf(atRule, searchIndex);
		if (atRuleIndex < 0) break;
		const bodyStart = text.indexOf('{', atRuleIndex + atRule.length);
		if (bodyStart < 0) break;
		let depth = 1;
		let cursor = bodyStart + 1;
		while (cursor < text.length && depth > 0) {
			if (text[cursor] === '{') depth += 1;
			if (text[cursor] === '}') depth -= 1;
			cursor += 1;
		}
		if (depth === 0) blocks.push(text.slice(bodyStart + 1, cursor - 1));
		searchIndex = cursor;
	}

	const matchingBlock = blocks.find(block => requiredNeedles.every(needle => block.includes(needle)));
	if (!matchingBlock) {
		fail(`${relativePath}: ${label}: ${atRule} must contain the required scoped rules`);
		return;
	}
	for (const needle of forbiddenNeedles) {
		if (matchingBlock.includes(needle)) {
			fail(`${relativePath}: ${label}: ${atRule} must not contain ${needle}`);
		}
	}
}

function readWorkflow(relativePath) {
	return parseYaml(readText(relativePath));
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

function assertNoCssPropertyDeclarations(relativePath, propertyNames, label) {
	const text = stripCssComments(readText(relativePath));
	const forbiddenProperties = new Set(propertyNames.map(property => property.toLowerCase()));
	for (const rule of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
		const body = rule[2];
		const ruleBodyStart = (rule.index ?? 0) + rule[0].indexOf('{') + 1;
		for (const declaration of body.matchAll(/(^|;)\s*([-\w]+)\s*:/g)) {
			const rawProperty = declaration[2];
			const property = rawProperty.toLowerCase();
			if (!forbiddenProperties.has(property)) continue;

			const declarationIndex = ruleBodyStart + declaration.index + declaration[0].indexOf(rawProperty);
			fail(`${relativePath}:${lineNumberAt(text, declarationIndex)}: ${label}: found ${property}`);
		}
	}
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

function escapeRegExp(text) {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function selectorMatchesTarget(selectorText, targetSelector) {
	if (!targetSelector.startsWith('.')) {
		return selectorText === targetSelector;
	}
	const className = escapeRegExp(targetSelector.slice(1));
	return new RegExp(`(^|[^-_a-zA-Z0-9])\\.${className}($|[^-_a-zA-Z0-9])`).test(selectorText);
}

function assertCssRuleExcludes(relativePath, selector, forbiddenPatterns, label) {
	const matchingRules = cssRules(relativePath).filter(candidate =>
		candidate.selectors.some(selectorText => selectorMatchesTarget(selectorText, selector)));
	if (matchingRules.length === 0) {
		fail(`${relativePath}: ${label}: missing rule for ${selector}`);
		return;
	}

	for (const pattern of forbiddenPatterns) {
		const hasForbiddenPattern = matchingRules.some(rule => (
			typeof pattern === 'string'
				? rule.body.includes(pattern)
				: pattern.test(rule.body)
		));
		if (hasForbiddenPattern) {
			fail(`${relativePath}: ${label}: ${selector} must not include ${pattern}`);
		}
	}
}

function assertCssScopedRuleExcludes(relativePath, scopeSelector, targetSelector, forbiddenPatterns, label, ignoreSelector) {
	const matchingRules = cssRules(relativePath).filter(candidate =>
		candidate.selectors.some(selectorText =>
			selectorMatchesTarget(selectorText, scopeSelector)
			&& selectorMatchesTarget(selectorText, targetSelector)
			&& (!ignoreSelector || !ignoreSelector(selectorText))));

	for (const pattern of forbiddenPatterns) {
		const hasForbiddenPattern = matchingRules.some(rule => (
			typeof pattern === 'string'
				? rule.body.includes(pattern)
				: pattern.test(rule.body)
		));
		if (hasForbiddenPattern) {
			fail(`${relativePath}: ${label}: ${targetSelector} must not include ${pattern}`);
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
		Spanish: flattenStringLeaves(readJson('i18n/locales/es.json')),
		'Chinese Simplified': flattenStringLeaves(readJson('i18n/locales/zh-CN.json')),
		'Chinese Traditional': flattenStringLeaves(readJson('i18n/locales/zh-TW.json')),
		Japanese: flattenStringLeaves(readJson('i18n/locales/ja.json')),
		Russian: flattenStringLeaves(readJson('i18n/locales/ru.json')),
		Italian: flattenStringLeaves(readJson('i18n/locales/it.json')),
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

	assertFileExists('src/generated/locale-pack-catalog.json');
	assertFileExists('src/generated/locale-compatibility-aliases.json');
	const catalog = readJson('src/generated/locale-pack-catalog.json');
	const expectedLocales = ['tr', 'de', 'fr', 'es', 'zh-CN', 'zh-TW', 'ja', 'ru', 'it'];
	assertEqual('locale catalog source version', catalog.sourceVersion, manifest.version);
	if (JSON.stringify(catalog.languageOrder) !== JSON.stringify(expectedLocales)) {
		fail(`locale catalog language order: expected ${expectedLocales.join(',')}`);
	}
	const expectedAssets = new Set();
	for (const locale of expectedLocales) {
		const entry = catalog.locales?.[locale];
		if (!entry) {
			fail(`locale catalog missing language: ${locale}`);
			continue;
		}
		const relativePath = `release-assets/locales/${entry.assetName}`;
		assertFileExists(relativePath);
		assertEqual(
			`${locale} locale repository tag URL`,
			entry.url,
			`https://raw.githubusercontent.com/hasanyilmaz/operon/${manifest.version}/release-assets/locales/${entry.assetName}`,
		);
		if (!fs.existsSync(path.join(rootDir, relativePath))) continue;
		const contents = fs.readFileSync(path.join(rootDir, relativePath));
		const digest = createHash('sha256').update(contents).digest('hex');
		assertEqual(`${locale} locale asset SHA-256`, digest, entry.sha256);
		assertEqual(`${locale} locale asset size`, contents.byteLength, entry.sizeBytes);
		const pack = JSON.parse(contents.toString('utf8'));
		assertEqual(`${locale} locale asset source version`, pack.sourceVersion, entry.sourceVersion);
		expectedAssets.add(entry.assetName);
	}
	if (fs.existsSync(path.join(rootDir, 'release-assets/locales'))) {
		const actualAssets = fs.readdirSync(path.join(rootDir, 'release-assets/locales'))
			.filter(file => file.endsWith('.json'));
		if (actualAssets.length !== expectedAssets.size || actualAssets.some(file => !expectedAssets.has(file))) {
			fail('locale release asset inventory must exactly match the embedded catalog');
		}
	}

	assertFileExists('src/generated/reminder-sound-pack-catalog.json');
	const soundCatalog = readJson('src/generated/reminder-sound-pack-catalog.json');
	const expectedSoundAssets = new Set();
	for (const entry of soundCatalog.files ?? []) {
		const relativePath = `release-assets/reminder-sounds/${entry.assetName}`;
		assertFileExists(relativePath);
		assertEqual(
			`${entry.id} reminder sound repository URL`,
			entry.url,
			`https://raw.githubusercontent.com/hasanyilmaz/operon/main/release-assets/reminder-sounds/${entry.assetName}`,
		);
		if (!fs.existsSync(path.join(rootDir, relativePath))) continue;
		const contents = fs.readFileSync(path.join(rootDir, relativePath));
		const digest = createHash('sha256').update(contents).digest('hex');
		assertEqual(`${entry.id} reminder sound asset SHA-256`, digest, entry.sha256);
		assertEqual(`${entry.id} reminder sound asset size`, contents.byteLength, entry.sizeBytes);
		expectedSoundAssets.add(entry.assetName);
	}
	const reminderSoundDirectory = path.join(rootDir, 'release-assets/reminder-sounds');
	if (fs.existsSync(reminderSoundDirectory)) {
		const actualSoundAssets = fs.readdirSync(reminderSoundDirectory)
			.filter(file => file.endsWith('.mp3'));
		if (actualSoundAssets.length !== expectedSoundAssets.size || actualSoundAssets.some(file => !expectedSoundAssets.has(file))) {
			fail('reminder sound release asset inventory must exactly match the embedded catalog');
		}
	}
}

function checkContinuousIntegrationWorkflow() {
	const workflow = '.github/workflows/ci.yml';
	const workflowText = readText(workflow);
	const document = readWorkflow(workflow);
	const validation = document.jobs?.validate;
	const windows = document.jobs?.['windows-native'];
	assertEqual('CI validation gate name', validation?.name, 'Validation gate');
	const validationSteps = new Map((validation?.steps ?? []).map(step => [step.name, step]));
	assertEqual('CI validation checkout history depth', validationSteps.get('Check out repository')?.with?.['fetch-depth'], 0);
	assertEqual('CI PR surface classifier condition', validationSteps.get('Classify pull-request validation surface')?.if, "github.event_name == 'pull_request'");
	assertEqual('CI Runtime baseline boundary condition', validationSteps.get('Require immutable Runtime V1 baseline')?.if, "github.event_name == 'pull_request' && steps.pr-surface.outputs.runtime_baseline_mutation == 'true'");
	assertEqual('CI CLI compatibility review condition', validationSteps.get('Require explicit CLI compatibility review')?.if, "github.event_name == 'pull_request' && steps.pr-surface.outputs.cli_compat_review == 'true'");
	assertEqual('CI main validation condition', validationSteps.get('Run main validation')?.if, "github.event_name == 'push'");
	assertEqual('CI main validation command', validationSteps.get('Run main validation')?.run, 'npm run check:main');
	assertEqual('CI main validation base identity', validationSteps.get('Run main validation')?.env?.OPERON_PUSH_BASE_SHA, '${{ github.event.before }}');
	assertEqual('CI main validation head identity', validationSteps.get('Run main validation')?.env?.OPERON_PUSH_HEAD_SHA, '${{ github.sha }}');
	assertEqual('CI PR validation condition', validationSteps.get('Run Plugin candidate validation')?.if, "github.event_name == 'pull_request'");
	assertEqual('CI PR validation command', validationSteps.get('Run Plugin candidate validation')?.run, 'npm run check:plugin');
	assertEqual('CI CLI impact command', validationSteps.get('Report non-blocking CLI impact')?.shell, 'bash');
	if (!validationSteps.get('Report non-blocking CLI impact')?.run?.includes('npm run --silent agent-runtime:cli-impact')) {
		fail('CI must write the non-blocking CLI impact summary.');
	}
	if (!validationSteps.get('Classify pull-request validation surface')?.run?.includes('scripts/ci/classify-pr-validation-surface.mjs')) {
		fail('CI must classify the pull-request validation surface without invoking CLI compatibility checks.');
	}
	const directReleaseGuardSteps = (validation?.steps ?? []).filter(step => (
		step.run === 'npm run release:guard -- --scope plugin'
	));
	if (directReleaseGuardSteps.length !== 1) {
		fail('CI must contain exactly one direct Plugin release guard step for release-sensitive pull requests.');
	} else {
		assertEqual(
			'CI release-sensitive Plugin guard condition',
			directReleaseGuardSteps[0].if,
			"github.event_name == 'pull_request' && steps.pr-surface.outputs.plugin_release_guard == 'true'",
		);
	}
	const windowsSteps = new Map((windows?.steps ?? []).map(step => [step.name, step]));
	assertEqual('CI Windows checkout history depth', windowsSteps.get('Check out repository')?.with?.['fetch-depth'], 2);
	assertEqual('Windows Plugin validation condition', windowsSteps.get('Run canonical Windows Plugin validation')?.if, undefined);
	assertEqual('Windows Plugin validation command', windowsSteps.get('Run canonical Windows Plugin validation')?.run, 'npm run validate:windows:plugin');
	if (windowsSteps.has('Run validation') || windowsSteps.has('Run required native transport validation')) {
		fail('Windows CI must use the single canonical platform validator instead of a broad or duplicate validation step.');
	}
	const installIndex = workflowText.indexOf('run: npm ci');
	const auditPolicyIndex = workflowText.indexOf('run: npm run release:audit-policy');
	const validationIndex = workflowText.indexOf('run: npm run check:main');

	assertIncludes(workflow, 'node-version: "24.18.0"', 'CI must use the exact canonical Node release baseline');
	assertIncludes(workflow, 'npm install --global npm@11.12.1', 'CI must pin the canonical npm version');
	assertIncludes(
		workflow,
		'uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7',
		'CI must use the approved immutable checkout revision',
	);
	assertIncludes(
		workflow,
		'uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7',
		'CI must use the approved immutable setup-node revision',
	);
	assertNoMatch(
		workflow,
		/uses:\s+actions\/[^@\s]+@v[0-9]+/u,
		'CI must not use floating action revisions',
	);
	assertIncludes(
		workflow,
		'run: npm run release:audit-policy',
		'CI must enforce the canonical dependency audit policy',
	);
	assertNoMatch(
		workflow,
		/run:\s+npm audit(?:\s|$)/u,
		'CI must not bypass the canonical dependency audit policy with raw npm audit',
	);
	if (!/- name: Run Plugin candidate validation\s+if: github\.event_name == 'pull_request'\s+env:\s+OPERON_TASK_FINDER_PERFORMANCE_MODE: diagnostic\s+run: npm run check:plugin/u.test(workflowText)) {
		fail('CI must keep shared-runner Task Finder timings diagnostic while reference runs enforce performance gates');
	}
	assertNoMatch(workflow, /evidence-seal|hosted-evidence|candidate:freeze:check/u, 'CI must use one normal validation lane per commit');
	assertNoMatch(
		workflow,
		/OPERON_PLUGIN_RELEASE_VALIDATION/u,
		'CI must not enable plugin-release tag validation',
	);
	if (
		installIndex < 0
		|| validationIndex < installIndex
		|| auditPolicyIndex < validationIndex
	) {
		fail('CI must run install, validation, and production audit in order');
	}
}

function checkCodeqlWorkflow() {
	const workflow = '.github/workflows/codeql.yml';
	const document = readWorkflow(workflow);
	const analyze = document.jobs?.analyze;
	assertEqual('CodeQL gate name', analyze?.name, 'CodeQL gate');
	const steps = new Map((analyze?.steps ?? []).map(step => [step.name, step]));
	if (!steps.has('Check out repository') || !steps.has('Initialize CodeQL') || !steps.has('Perform CodeQL analysis')) {
		fail('CodeQL gate must check out, initialize, and analyze every target commit');
	}
	assertNoMatch(workflow, /evidence-seal|classify release evidence/u, 'CodeQL must analyze every release commit without a seal bypass');
}

function checkReleaseWorkflow() {
	const workflow = '.github/workflows/release.yml';
	const workflowText = readText(workflow);
	const document = readWorkflow(workflow);
	const steps = document.jobs?.['build-release']?.steps ?? [];
	const stepNames = steps.map(step => step.name);
	const requiredOrder = [
		'Verify exact release tag target',
		'Verify release commit eligibility',
		'Refuse an existing GitHub release',
		'Install dependencies',
		'Build exact release artifacts',
		'Verify release dependency audit policy',
		'Verify release guard',
		'Verify tag and manifest metadata',
		'Verify release assets',
		'Attest manifest',
		'Attest plugin bundle',
		'Attest styles',
		'Attest locale packs',
		'Build GitHub release notes from changelog',
		'Create GitHub release',
		'Verify published release asset allowlist',
	];
	let previous = -1;
	for (const name of requiredOrder) {
		const index = stepNames.indexOf(name);
		if (index <= previous) fail(`release workflow parsed step order invalid at ${name}`);
		previous = index;
	}
	const releaseSteps = new Map(steps.map(step => [step.name, step]));
	const releaseAssetStep = releaseSteps.get('Verify release assets')?.run ?? '';
	if (!releaseAssetStep.includes('test -f main.js && test -f manifest.json && test -f styles.css')) {
		fail('release workflow must verify the three attested plugin artifacts exist');
	}
	if (/createHash|SHA-256|sha256|reminder-sound-pack-catalog/u.test(releaseAssetStep)) {
		fail('release workflow must not repeat release-guard asset integrity checks');
	}
	assertEqual('release checkout history depth', releaseSteps.get('Check out repository')?.with?.['fetch-depth'], 0);
	const installIndex = workflowText.indexOf('run: npm ci');
	const buildIndex = workflowText.indexOf('run: npm run build');
	const auditPolicyIndex = workflowText.indexOf('run: npm run release:audit-policy');
	const releaseGuardIndex = workflowText.indexOf('run: npm run release:guard');
	const exactTagIndex = workflowText.indexOf('name: Verify exact release tag target');
	const existingReleaseIndex = workflowText.indexOf('name: Refuse an existing GitHub release');
	const attestationIndex = workflowText.indexOf('uses: actions/attest@');
	const releaseCreateIndex = workflowText.indexOf('gh release create');

	assertIncludes(workflow, 'id-token: write', 'release workflow must grant OIDC token permission for artifact attestations');
	assertIncludes(workflow, 'attestations: write', 'release workflow must grant artifact attestation permission');
	assertIncludes(workflow, 'checks: read', 'release workflow must read exact-SHA hosted check results');
	assertIncludes(workflow, 'node-version: "24.18.0"', 'release workflow must use the exact canonical Node release baseline');
	assertIncludes(workflow, 'npm install --global npm@11.12.1', 'release workflow must pin the canonical npm version');
	assertIncludes(
		workflow,
		'run: npm run release:audit-policy',
		'release workflow must enforce the canonical dependency audit policy',
	);
	assertNoMatch(workflow, /evidence-seal|hosted-evidence|release:freeze:check|external-cli:public-proof/u, 'release workflow must tag the validated release commit directly');
	assertNoMatch(workflow, /run:\s+npm run check(?:\s|$)/u, 'release workflow must not replay the broad product suite');
	if (
		exactTagIndex < 0
		|| existingReleaseIndex < exactTagIndex
		|| installIndex < existingReleaseIndex
		|| buildIndex < installIndex
		|| auditPolicyIndex < buildIndex
		|| releaseGuardIndex < auditPolicyIndex
		|| attestationIndex < releaseGuardIndex
		|| releaseCreateIndex < attestationIndex
	) {
		fail('release workflow must preserve exact-tag, immutable-release, validation, attestation, and publish ordering');
	}
	assertIncludes(
		workflow,
		'uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7',
		'release workflow must use the approved immutable checkout revision',
	);
	assertIncludes(
		workflow,
		'uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7',
		'release workflow must use the approved immutable setup-node revision',
	);
	assertIncludes(
		workflow,
		'persist-credentials: false',
		'release checkout must not persist a write-capable credential during validation',
	);
	assertIncludes(
		workflow,
		'fetch-depth: 0',
		'release checkout must fetch tag history for exact target verification',
	);
	assertIncludes(
		workflow,
		'git rev-parse "refs/tags/$GITHUB_REF_NAME^{commit}"',
		'release workflow must bind the peeled release tag to the trigger commit',
	);
	assertIncludes(
		workflow,
		'git rev-parse "$GITHUB_SHA^{commit}"',
		'release workflow must resolve the triggering commit before release creation',
	);
	assertIncludes(
		workflow,
		'git rev-parse "HEAD^{commit}"',
		'release workflow must bind the checked-out commit to the trigger commit',
	);
	assertIncludes(
		workflow,
		'git ls-remote --tags origin "refs/tags/$GITHUB_REF_NAME^{}"',
		'release workflow must recheck the live peeled tag before release creation',
	);
	assertIncludes(
		workflow,
		'git merge-base --is-ancestor "$TRIGGER_COMMIT" refs/remotes/origin/main',
		'release workflow must require the tag target to be on main',
	);
	assertIncludes(
		workflow,
		'commits/$TRIGGER_COMMIT/check-runs?per_page=100',
		'release workflow must read checks for the exact tag target',
	);
	for (const requiredCheck of ['Validation gate', 'windows-native', 'CodeQL gate']) {
		assertIncludes(workflow, `"${requiredCheck}"`, `release workflow must require ${requiredCheck}`);
	}
	assertIncludes(
		workflow,
		'uses: actions/attest@508db95dd578ae2727ebd6217d5ba78e4fbda05d # v4',
		'release workflow must attest release assets with the approved immutable action revision',
	);
	assertNoMatch(
		workflow,
		/uses:\s+actions\/[^@\s]+@v[0-9]+/u,
		'release workflow must not use floating release-critical action revisions',
	);

	for (const asset of ['manifest.json', 'main.js', 'styles.css']) {
		assertIncludes(workflow, `subject-path: ${asset}`, `release workflow must attest ${asset}`);
	}
	assertIncludes(
		workflow,
		'subject-path: release-assets/locales/*.json',
		'release workflow must attest downloadable locale packs',
	);
	assertNoMatch(
		workflow,
		/gh release (?:upload|create)[^\n]*release-assets\//u,
		'repository-managed assets must not be attached to GitHub Releases',
	);
	for (const file of [
		'scripts/release/extract-changelog-release-notes.mjs',
		'scripts/release/extract-changelog-release-notes.test.mjs',
	]) {
		if (!fs.existsSync(path.join(rootDir, file))) {
			fail(`${file}: required changelog release-note artifact is missing`);
		}
	}
	assertIncludes(
		workflow,
		'node scripts/release/extract-changelog-release-notes.mjs',
		'release workflow must derive GitHub release notes from CHANGELOG.md',
	);
	assertIncludes(
		workflow,
		'--version "$GITHUB_REF_NAME"',
		'release workflow must bind changelog notes to the exact release tag',
	);
	assertIncludes(
		workflow,
		'--out "$RUNNER_TEMP/operon-release-notes.md"',
		'release workflow must write changelog-derived notes to a temporary file',
	);
	const releaseCommands = workflowText.split(/\r?\n/u)
		.map(line => line.trim())
		.filter(line => /^gh release (?:upload|create)\b/u.test(line));
	const expectedReleaseCommands = [
		'gh release create "$GITHUB_REF_NAME" main.js manifest.json styles.css --verify-tag --title "Operon $GITHUB_REF_NAME" --notes-file "$RUNNER_TEMP/operon-release-notes.md"',
	];
	if (JSON.stringify(releaseCommands) !== JSON.stringify(expectedReleaseCommands)) {
		fail('release workflow must immutably create exactly main.js, manifest.json, and styles.css');
	}
	assertNoMatch(
		workflow,
		/\bgh release upload\b|--clobber\b|--notes\s/u,
		'release workflow must never replace or mutate existing release assets',
	);
	assertIncludes(
		workflow,
		'if gh release view "$GITHUB_REF_NAME" >/dev/null 2>&1; then',
		'release workflow must refuse an already-published release before validation or attestation',
	);
	assertIncludes(
		workflow,
		'release assets are immutable.',
		'release workflow must explain that existing release assets are immutable',
	);
	assertIncludes(
		workflow,
		'name: Verify published release asset allowlist',
		'release workflow must verify the final GitHub Release asset set',
	);
	assertIncludes(
		workflow,
		'actual_assets="$(gh release view "$GITHUB_REF_NAME" --json assets',
		'release workflow must read back published GitHub Release assets',
	);
	assertIncludes(
		workflow,
		'expected_assets="$(printf \'%s\\n\' main.js manifest.json styles.css)"',
		'release workflow asset allowlist must contain exactly the three plugin files',
	);
}

function checkWorkflowSecurityPolicy(scope = guardScope) {
	const workflowRoot = path.join(rootDir, '.github/workflows');
	const allWorkflows = fs.readdirSync(workflowRoot)
		.filter(file => file.endsWith('.yml') || file.endsWith('.yaml'))
		.sort();
	const exactCodeqlRevision = 'bce182f857edf1feab116e9795a3393d21977282';
	const exactCheckoutRevision = '3d3c42e5aac5ba805825da76410c181273ba90b1';
	const exactSetupNodeRevision = '820762786026740c76f36085b0efc47a31fe5020';
	const exactWorkflowPermissions = new Map([
		['ci.yml', ['contents: read']],
		['cli-external-compatibility.yml', ['contents: read']],
		['codeql.yml', ['contents: read', 'security-events: write']],
		['release.yml', ['contents: write', 'checks: read', 'id-token: write', 'attestations: write']],
	]);
	const workflows = allWorkflows.filter(file => (
		scope === 'cli-compat'
			? file === 'cli-external-compatibility.yml'
			: file !== 'cli-external-compatibility.yml'
	));

	for (const file of workflows) {
		const relativePath = `.github/workflows/${file}`;
		const workflowText = readText(relativePath);
		const expectedPermissions = exactWorkflowPermissions.get(file);
		if (!expectedPermissions) {
			fail(`${relativePath}: workflow lacks an approved permission policy`);
		}
		const permissionsMatch = workflowText.match(
			/^permissions:\s*\n((?:  [a-z-]+:\s+(?:read|write)\s*\n)+)/mu,
		);
		const actualPermissions = permissionsMatch?.[1]
			.trim()
			.split(/\r?\n/u)
			.map(line => line.trim());
		if (JSON.stringify(actualPermissions) !== JSON.stringify(expectedPermissions)) {
			fail(`${relativePath}: workflow permissions drifted from the least-privilege allowlist`);
		}
		const lines = workflowText.split(/\r?\n/u);
		for (let index = 0; index < lines.length; index += 1) {
			const line = lines[index];
			const actionMatch = line.match(/uses:\s+([^@\s]+)@([^\s#]+)/u);
			if (!actionMatch) continue;
			const [, action, revision] = actionMatch;
			if (!/^[a-f0-9]{40}$/u.test(revision)) {
				fail(`${relativePath}:${index + 1}: action ${action} must use an immutable 40-character revision`);
			}
			if (action === 'actions/checkout' && revision !== exactCheckoutRevision) {
				fail(`${relativePath}:${index + 1}: checkout must use the approved immutable revision`);
			}
			if (action === 'actions/setup-node' && revision !== exactSetupNodeRevision) {
				fail(`${relativePath}:${index + 1}: setup-node must use the approved immutable revision`);
			}
			if (action.startsWith('github/codeql-action/') && revision !== exactCodeqlRevision) {
				fail(`${relativePath}:${index + 1}: CodeQL must use the approved immutable revision`);
			}
			if (action !== 'actions/checkout') continue;
			const usesIndent = line.length - line.trimStart().length;
			const stepIndent = line.trimStart().startsWith('- uses:')
				? usesIndent
				: Math.max(0, usesIndent - 2);
			const block = [line];
			for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
				const candidate = lines[cursor];
				const indent = candidate.length - candidate.trimStart().length;
				if (indent <= stepIndent && candidate.trimStart().startsWith('- ')) break;
				block.push(candidate);
			}
			if (!block.some(candidate => (
				/^\s+persist-credentials:\s+false\s*(?:#.*)?$/u.test(candidate)
			))) {
				fail(`${relativePath}:${index + 1}: checkout must set persist-credentials: false`);
			}
		}
	}
	const expectedWorkflowCount = [...exactWorkflowPermissions.keys()]
		.filter(file => workflows.includes(file)).length;
	if (expectedWorkflowCount !== workflows.length) {
		fail('workflow permission policy must cover every checked-in workflow');
	}

	const retiredCliPaths = [
		'.github/workflows/cli-ci.yml',
		'.github/workflows/cli-live-acceptance.yml',
		'.github/workflows/cli-native-candidate.yml',
		'.github/workflows/cli-publish.yml',
		'.github/workflows/cli-release-ready.yml',
		'packages/operon-cli',
	];
	if (scope === 'cli-compat') {
		for (const relativePath of retiredCliPaths) {
			if (fs.existsSync(path.join(rootDir, relativePath))) {
				fail(`${relativePath}: retired embedded CLI path must remain absent`);
			}
		}
	}
}

function checkPublicSourceHygiene() {
	const output = execFileSync(
		'git',
		['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
		{ cwd: rootDir, encoding: 'utf8' },
	);
	const files = output.split('\0').filter(Boolean).sort();
	const trackedFiles = new Set(
		execFileSync('git', ['ls-files', '--cached', '-z'], {
			cwd: rootDir,
			encoding: 'utf8',
		}).split('\0').filter(Boolean),
	);
	const forbiddenPaths = [
		/^(?:data(?:$|[./ (])|state\/|runtime\/|cache\/|build\/|node_modules\/)/u,
		/^packages\/operon-cli\/(?:dist|freeze|release|release-archive)\//u,
		/^(?:PHASE5-ACCEPTANCE\.md|PHASE7-ACCEPTANCE\.md)$/u,
		/^scripts\/(?:phase5-regression\.ts|run-phase5-regression\.mjs|test-stubs\/)/u,
		/\.(?:tgz|zip|bak|orig|rej)$/iu,
		/(?:^|\/)(?:data )?\(conflict [^)]+\)(?:\.[^/]+)?$/iu,
		/(?:^|\/)[^/]+\.invalid-backup$/iu,
	];
	for (const file of files) {
		if (forbiddenPaths.some(pattern => pattern.test(file))) {
			fail(`${file}: private, local-only, or generated artifact must not enter public source`);
			continue;
		}
		const surfaces = [];
		if (trackedFiles.has(file)) {
			surfaces.push(['index', execFileSync('git', ['show', `:${file}`], {
				cwd: rootDir,
				encoding: 'buffer',
				maxBuffer: 12_000_000,
			})]);
		}
		const absolute = path.join(rootDir, file);
		try {
			const stat = fs.statSync(absolute);
			if (stat.isFile()) surfaces.push(['worktree', fs.readFileSync(absolute)]);
		} catch {
			// Deleted tracked files are represented only by the index surface.
		}
		for (const [surface, bytes] of surfaces) {
			if (bytes.byteLength > 10_000_000) continue;
			const text = bytes.toString('utf8');
		for (const [pattern, label] of [
			[/\/Users\/hasanyilmaz\b/u, 'personal absolute path'],
			[/Dropbox\/Obsidion_drop\b/u, 'private vault path'],
			[/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u, 'private key'],
			[/\bgh[pousr]_[A-Za-z0-9_]{30,}\b/u, 'GitHub token'],
			[/\bgithub_pat_[A-Za-z0-9_]{40,}\b/u, 'GitHub fine-grained token'],
			[/\bnpm_[A-Za-z0-9]{30,}\b/u, 'npm token'],
			[/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/u, 'AWS access key'],
		]) {
				if (pattern.test(text)) {
					fail(`${file}: public ${surface} source contains ${label}`);
				}
			}
		}
	}
}

function checkRepositoryIgnorePolicy() {
	const visibleRuntimeSources = [
		'src/agent-runtime/runtime/index.ts',
		'scripts/agent-runtime/runtime/graph-transaction-executor.test.ts',
		'scripts/agent-runtime/runtime/run-graph-transaction-executor-tests.mjs',
		'scripts/agent-runtime/runtime/run-runtime-tests.mjs',
		'scripts/agent-runtime/runtime/runtime-core.test.ts',
		'scripts/agent-runtime/runtime/runtime-integration.test.mjs',
		'scripts/test-support/obsidian.ts',
	];
	for (const relativePath of visibleRuntimeSources) {
		if (isGitIgnored(relativePath)) {
			fail(`${relativePath}: public Runtime source or tests must not be ignored`);
		}
	}
	const privateArtifacts = [
		'runtime/private.json',
		'data.json.invalid-backup',
		'data (conflict 2026-07-31).json',
		'state/private.json',
		'cache/private.json',
		'build/agent-runtime-cas-baseline/private.mjs',
		'build/release/main-metafile.json',
		'build/stage51/private.mjs',
	];
	for (const relativePath of privateArtifacts) {
		if (!isGitIgnored(relativePath)) {
			fail(`${relativePath}: private or generated release artifact must remain ignored`);
		}
	}
	assertIncludes(
		'package.json',
		'"agent-runtime:runtime": "node scripts/agent-runtime/runtime/run-graph-transaction-executor-tests.mjs &&',
		'normal Runtime validation must execute graph transaction recovery tests',
	);
}

function checkPluginReleasePolicy() {
	const packageManifest = readJson('package.json');
	const scripts = packageManifest.scripts ?? {};
	assertEqual('check alias', scripts.check, 'npm run check:plugin');
	assertEqual('candidate check alias', scripts['check:candidate'], 'npm run check:plugin');
	const pluginCheck = scripts['check:plugin'] ?? '';
	const pluginCommands = pluginCheck.split('&&').map(command => command.trim());
	if (pluginCommands.filter(command => command === 'npm run build').length !== 1) {
		fail('check:plugin must build production artifacts exactly once');
	}
	for (const command of [
		'npm run ci:pr-surface:test',
		'npm run lint:strict',
		'npm run lint:scorecard:strict',
		'npm run agent-runtime:contracts:plugin',
	]) {
		if (!pluginCommands.includes(command)) fail(`check:plugin must run ${command}`);
	}
	for (const forbidden of [
		'external-cli',
		'cli-contracts',
		'historical-freeze',
		'cli-schemas',
		'release:external-live',
		'docs:public-v1',
		'check:cli-compat',
	]) {
		if (pluginCheck.includes(forbidden)) {
			fail(`check:plugin must not enter CLI compatibility work: ${forbidden}`);
		}
	}
	const mainCheck = scripts['check:main'] ?? '';
	for (const command of [
		'npm run agent-runtime:schemas:check',
		'npm run agent-runtime:runtime-baseline:check',
		'npm run build',
		'npm run release:guard -- --scope plugin',
		'npm run agent-runtime:cli-impact',
	]) {
		if (!mainCheck.includes(command)) fail(`check:main must run ${command}`);
	}
	if (mainCheck.split('&&').filter(command => command.trim() === 'npm run build').length !== 1) {
		fail('check:main must build production artifacts exactly once');
	}
	if (
		scripts['lint:scorecard:strict']
		!== 'eslint --config eslint.scorecard.config.mjs main.ts src --max-warnings 0'
	) fail('strict scorecard lint must preserve the isolated type-aware source boundary');
	if (!readText('package.json').includes('"release:audit-policy": "node scripts/check-release-audit-policy.mjs"')) {
		fail('package scripts must expose the canonical release audit-policy check');
	}
	assertIncludes(
		'scripts/check-release-audit-policy.mjs',
		"['audit', '--omit=dev', '--json']",
		'release audit policy must inspect production dependencies only',
	);
	assertIncludes(
		'esbuild.config.mjs',
		'build/release/main-metafile.json',
		'production build must emit dependency evidence for the release audit',
	);
	assertIncludes(
		'scripts/check-release-audit-policy.mjs',
		"readJson('build/release/main-metafile.json')",
		'release audit policy must inspect the exact production build dependency evidence',
	);
	assertNoMatch(
		'scripts/check-release-audit-policy.mjs',
		/spawnSync\('npm', \['audit', '--json'\]/u,
		'release audit policy must not make development-only findings release blockers',
	);
	assertIncludes(
		'package.json',
		'"agent-runtime:runtime": "node scripts/agent-runtime/runtime/run-graph-transaction-executor-tests.mjs &&',
		'normal Runtime validation must execute graph transaction recovery tests',
	);
	checkRuntimeProviderBaselineWasNotChanged();
	checkHistoricalCliEvidenceWasNotChanged();
}

function checkHistoricalCliEvidenceWasNotChanged() {
	for (const file of changedPathsForPolicy()) {
		if (classifyPullRequestValidationSurface([file]).cliCompatReview) {
			fail(`${file}: historical CLI evidence requires release:guard --scope cli-compat.`);
		}
	}
}

function checkRuntimeProviderBaselineWasNotChanged() {
	for (const file of changedPathsForPolicy()) {
		if (classifyPullRequestValidationSurface([file]).runtimeBaselineMutation) {
			fail(`${file}: Runtime V1 baseline is immutable outside an explicit release or Runtime-major boundary.`);
		}
	}
}

let cachedPolicyChangedPaths;

function changedPathsForPolicy() {
	if (cachedPolicyChangedPaths) return cachedPolicyChangedPaths;
	const changed = new Set();
	const pushBase = process.env.OPERON_PUSH_BASE_SHA;
	const pushHead = process.env.OPERON_PUSH_HEAD_SHA;
	const hasPushRange = /^[0-9a-f]{40}$/u.test(pushBase ?? '')
		&& /^[0-9a-f]{40}$/u.test(pushHead ?? '')
		&& !/^0{40}$/u.test(pushBase);
	const ranges = [
		['diff', '--name-only'],
		hasPushRange
			? ['diff', '--name-only', pushBase, pushHead]
			: ['diff', '--name-only', 'HEAD^', 'HEAD'],
	];
	for (const arguments_ of ranges) {
		try {
			for (const file of execFileSync('git', arguments_, { cwd: rootDir, encoding: 'utf8' })
				.split(/\r?\n/u).filter(Boolean)) changed.add(file);
		} catch {
			// A shallow first commit has no parent; the worktree diff still protects local edits.
		}
	}
	cachedPolicyChangedPaths = changed;
	return cachedPolicyChangedPaths;
}

function checkCliCompatibilityEvidence() {
	const packageManifest = readJson('package.json');
	assertEqual(
		'CLI compatibility command',
		packageManifest.scripts?.['check:cli-compat'],
		'node scripts/agent-runtime/cli/check-cli-compat.mjs',
	);
	const compatibilityContracts = packageManifest.scripts?.['agent-runtime:contracts:cli-compat'] ?? '';
	for (const command of [
		'npm run agent-runtime:schemas:cli-compat:test',
		'npm run agent-runtime:external-cli:test',
		'npm run agent-runtime:cli-contracts:check',
		'npm run agent-runtime:compatibility:check',
		'npm run agent-runtime:historical-freeze:test',
		'npm run agent-runtime:historical-freeze:check',
		'npm run agent-runtime:cli-schemas:test',
	]) {
		if (!compatibilityContracts.includes(command)) {
			fail(`CLI compatibility validation must run ${command}`);
		}
	}
	for (const file of [
		'contracts/agent-runtime/public-v1-freeze.json',
		'contracts/agent-runtime/public-v1-external-freeze.json',
		'contracts/agent-runtime/public-v1-external-freeze.schema.json',
		'contracts/agent-runtime/public-v1-live-acceptance.json',
		'contracts/agent-runtime/public-v1-release-freezes.json',
		'contracts/agent-runtime/cli-cutover-v1.json',
		'contracts/agent-runtime/cli-cutover-v1.schema.json',
		'scripts/release/fixtures/legacy-cli-1.0.8/published-cli-v1.json',
		'scripts/release/fixtures/legacy-cli-1.0.8/published-cli-v1.schema.json',
		'scripts/agent-runtime/cli/check-published-cli-binding.mjs',
		'scripts/agent-runtime/cli/check-published-cli-artifact.mjs',
		'scripts/agent-runtime/cli/check-published-cli-public-proof.mjs',
	]) assertFileExists(file);
	for (const command of [
		'scripts/release/check-accepted-freeze.mjs',
		'scripts/release/check-release-freeze-registry.mjs',
	]) {
		assertIncludes(
			'scripts/agent-runtime/cli/check-cli-compat.mjs',
			command,
			'CLI compatibility lane must validate every current historical freeze record',
		);
	}
	assertEqual(
		'historical Public V1 freeze SHA-256',
		createHash('sha256').update(fs.readFileSync(path.join(rootDir, 'contracts/agent-runtime/public-v1-freeze.json'))).digest('hex'),
		'41c83bcbcbc8b8117c1e9989d7d430e03f2257c0004ba2af94363f203f4bf71b',
	);
	assertEqual(
		'legacy CLI 1.0.8 binding fixture identity',
		createHash('sha256').update(fs.readFileSync(path.join(rootDir, 'scripts/release/fixtures/legacy-cli-1.0.8/published-cli-v1.json'))).digest('hex'),
		'b7b446d15218a78d8c696d7c3732461ccffad6c0af6069637a02452c9b3fef98',
	);
	assertEqual(
		'legacy CLI 1.0.8 schema fixture identity',
		createHash('sha256').update(fs.readFileSync(path.join(rootDir, 'scripts/release/fixtures/legacy-cli-1.0.8/published-cli-v1.schema.json'))).digest('hex'),
		'62d8adbc7b736cd910c35db744cb70b4e2c03cc34c7d11a0e86d3a499cedb8e7',
	);
	const workflow = readText('.github/workflows/cli-external-compatibility.yml');
	if (!workflow.includes('workflow_dispatch:') || /\bpull_request:|\bpush:/u.test(workflow)) {
		fail('CLI external compatibility workflow must remain manual-only.');
	}
	if (!workflow.includes('agent-runtime:external-cli:public-proof')) {
		fail('CLI external compatibility workflow must retain published-proof coverage.');
	}
}

export function checkLegacyPairedReleaseEvidence() {
	for (const file of [
		'contracts/agent-runtime/public-v1-freeze.json',
		'contracts/agent-runtime/public-v1-external-freeze.schema.json',
		'contracts/agent-runtime/public-v1-release-freezes.json',
		'contracts/agent-runtime/releases/3.1.0/public-v1-external-freeze.json',
		'contracts/agent-runtime/releases/3.1.0/public-v1-external-freeze.schema.json',
		'contracts/agent-runtime/releases/3.1.0/paired-release-evidence.json',
		'contracts/agent-runtime/releases/3.1.0/published-cli-v1.json',
		'contracts/agent-runtime/releases/3.1.0/published-cli-v1.schema.json',
		'contracts/agent-runtime/releases/3.1.1/public-v1-external-freeze.json',
		'contracts/agent-runtime/releases/3.1.1/public-v1-external-freeze.schema.json',
		'contracts/agent-runtime/releases/3.1.1/paired-release-evidence.json',
		'scripts/check-release-audit-policy.mjs',
		'scripts/agent-runtime/contracts/check-historical-public-v1-freeze.mjs',
		'scripts/agent-runtime/contracts/check-historical-public-v1-freeze.test.mjs',
		'scripts/release/audit-policy.mjs',
		'scripts/release/audit-policy.test.mjs',
		'scripts/release/write-external-freeze.mjs',
		'scripts/release/write-external-freeze.test.mjs',
		'scripts/release/check-accepted-freeze.mjs',
		'scripts/release/check-accepted-freeze.test.mjs',
		'scripts/release/check-release-freeze-registry.mjs',
		'scripts/release/check-release-freeze-registry.test.mjs',
		'scripts/release/run-published-cli-live-acceptance.mjs',
		'scripts/release/run-published-cli-live-acceptance.test.mjs',
	]) {
		if (!fs.existsSync(path.join(rootDir, file))) {
			fail(`${file}: required release audit-policy artifact is missing`);
		}
	}

	const historicalFreezeBytes = fs.readFileSync(
		path.join(rootDir, 'contracts/agent-runtime/public-v1-freeze.json'),
	);
	assertEqual('historical Public V1 freeze size', historicalFreezeBytes.byteLength, 7178);
	assertEqual(
		'historical Public V1 freeze SHA-256',
		createHash('sha256').update(historicalFreezeBytes).digest('hex'),
		'41c83bcbcbc8b8117c1e9989d7d430e03f2257c0004ba2af94363f203f4bf71b',
	);

	const packageText = readText('package.json');
	const normalCheck = readJson('package.json').scripts.check;
	const normalCheckCommands = normalCheck.split('&&').map((command) => command.trim());
	const normalBuildIndexes = normalCheckCommands
		.map((command, index) => (command === 'npm run build' ? index : -1))
		.filter((index) => index >= 0);
	if (normalBuildIndexes.length !== 1) {
		fail('package.json: normal validation must build production artifacts exactly once');
	}
	for (const command of [
		'npm run release:audit-policy:test',
		'npm run release:notes:test',
		'npm run release:external-live:test',
		'npm run docs:public-v1:test',
	]) {
		if (!normalCheck.includes(command)) {
			fail(`package.json: normal validation must run ${command}`);
		}
	}
	assertIncludes(
		'package.json',
		'"release:freeze:write:historical": "node scripts/release/write-external-freeze.mjs"',
		'package scripts must identify the one-shot 3.0.2 external-freeze writer as historical',
	);
	assertIncludes(
		'package.json',
		'"release:freeze:check:historical": "node scripts/release/check-release-freeze-registry.mjs"',
		'package scripts must preserve the historical append-only release-freeze registry check',
	);
	for (const fixture of [
		'scripts/release/fixtures/legacy-cli-1.0.8/published-cli-v1.json',
		'scripts/release/fixtures/legacy-cli-1.0.8/published-cli-v1.schema.json',
	]) assertFileExists(fixture);
	assertEqual(
		'legacy CLI 1.0.8 binding fixture identity',
		createHash('sha256').update(fs.readFileSync(path.join(rootDir, 'scripts/release/fixtures/legacy-cli-1.0.8/published-cli-v1.json'))).digest('hex'),
		'b7b446d15218a78d8c696d7c3732461ccffad6c0af6069637a02452c9b3fef98',
	);
	assertEqual(
		'legacy CLI 1.0.8 schema fixture identity',
		createHash('sha256').update(fs.readFileSync(path.join(rootDir, 'scripts/release/fixtures/legacy-cli-1.0.8/published-cli-v1.schema.json'))).digest('hex'),
		'62d8adbc7b736cd910c35db744cb70b4e2c03cc34c7d11a0e86d3a499cedb8e7',
	);
	assertIncludes(
		'package.json',
		'"release:freeze:test": "node --test scripts/release/write-external-freeze.test.mjs scripts/release/check-accepted-freeze.test.mjs scripts/release/check-release-freeze-registry.test.mjs"',
		'package scripts must preserve the explicitly invoked historical freeze test suite',
	);
	const freezeWriterSource = readText('scripts/release/write-external-freeze.mjs');
	for (const required of [
		"new Set(['--live-evidence', '--accepted-by', '--accepted-at'])",
		"open(target, 'wx', 0o600)",
		'await link(evidenceTemporaryPath, evidencePath)',
		'OPERON_EXTERNAL_FREEZE_EXISTS',
	]) {
		if (!freezeWriterSource.includes(required)) {
			fail(`external-freeze writer is missing ${JSON.stringify(required)}`);
		}
	}
	assertIncludes(
		'package.json',
		'"agent-runtime:historical-freeze:check": "node scripts/agent-runtime/contracts/check-historical-public-v1-freeze.mjs"',
		'normal validation must expose the immutable historical freeze check',
	);
	assertIncludes(
		'package.json',
		'"agent-runtime:historical-freeze:test": "node --test scripts/agent-runtime/contracts/check-historical-public-v1-freeze.test.mjs"',
		'normal validation must test the immutable historical freeze boundary',
	);
	const packageManifest = JSON.parse(packageText);
	if (
		packageManifest.scripts?.['agent-runtime:mutation:live:published']
		!== 'node scripts/release/run-published-cli-live-acceptance.mjs'
	) {
		fail('published Runtime live validation must use the exact verified-tarball wrapper');
	}
	const publishedLiveSource = readText('scripts/release/run-published-cli-live-acceptance.mjs');
	for (const required of [
		'withVerifiedPublishedCli',
		"['--tarball', '--vault', '--output']",
		'OPERON_PUBLISHED_CLI_LIVE_VAULT_INVALID',
	]) {
		if (!publishedLiveSource.includes(required)) {
			fail(`published Runtime live wrapper is missing ${JSON.stringify(required)}`);
		}
	}
	if (/process\.env\.OPERON_CLI_EXECUTABLE\s*\?\?/u.test(publishedLiveSource)) {
		fail('published Runtime live wrapper must not accept a user-installed executable fallback');
	}
	if (/public-v1-freeze\.mjs --check/u.test(packageManifest.scripts?.['agent-runtime:contracts'] ?? '')) {
		fail('normal contract validation must not regenerate or source-check the historical Public V1 freeze');
	}
	for (const command of [
		'npm run agent-runtime:historical-freeze:test',
		'npm run agent-runtime:historical-freeze:check',
	]) {
		if (!(packageManifest.scripts?.['agent-runtime:contracts'] ?? '').includes(command)) {
			fail(`normal contract validation must run ${command}`);
		}
	}
	if ((packageManifest.scripts?.check ?? '').includes('npm run release:freeze:check')) {
		fail('normal validation must remain independent from the unaccepted external release freeze');
	}
	if (
		packageManifest.scripts?.['lint:scorecard:strict']
		!== 'eslint --config eslint.scorecard.config.mjs main.ts src --max-warnings 0'
	) {
		fail('strict scorecard lint must preserve the isolated type-aware source boundary');
	}
	for (const scriptName of ['check', 'check:candidate']) {
		const validationCommands = (packageManifest.scripts?.[scriptName] ?? '')
			.split('&&')
			.map(command => command.trim());
		const buildOffsets = validationCommands.flatMap((command, index) => (
			command === 'npm run build' ? [index] : []
		));
		if (buildOffsets.length !== 1) {
			fail(`${scriptName} must build production artifacts exactly once`);
		}
		if (validationCommands.includes('npm run release:freeze:test')) {
			fail(`${scriptName} must not run the historical release freeze test suite`);
		}
		const strictLintOffsets = validationCommands.flatMap((command, index) => (
			command === 'npm run lint:strict' ? [index] : []
		));
		const scorecardOffsets = validationCommands.flatMap((command, index) => (
			command === 'npm run lint:scorecard:strict' ? [index] : []
		));
		if (strictLintOffsets.length !== 1 || scorecardOffsets.length !== 1) {
			fail(`${scriptName} must run normal and scorecard strict lint exactly once`);
		}
		if (scorecardOffsets[0] !== strictLintOffsets[0] + 1) {
			fail(`${scriptName} must run strict scorecard lint immediately after normal strict lint`);
		}
	}
	const candidateCheck = packageManifest.scripts?.['check:candidate'] ?? '';
	if (candidateCheck.includes('npm run release:freeze:check')) {
		fail('check:candidate must not require exact accepted-release artifact identity');
	}
	if (candidateCheck.includes('npm run candidate:freeze:check')) {
		fail('check:candidate must not require a release evidence-registry seal');
	}
	if ((packageManifest.scripts?.['check:local'] ?? '').includes('npm run release:freeze:check')) {
		fail('check:local must not require an accepted release evidence seal');
	}
	if (!packageText.includes('"release:audit-policy": "node scripts/check-release-audit-policy.mjs"')) {
		fail('package scripts must expose the canonical release audit-policy check');
	}
	assertIncludes(
		'scripts/check-release-audit-policy.mjs',
		"['audit', '--omit=dev', '--json']",
		'release audit policy must inspect production dependencies only',
	);
	assertIncludes(
		'esbuild.config.mjs',
		'build/release/main-metafile.json',
		'production build must emit dependency evidence for the release audit',
	);
	assertIncludes(
		'scripts/check-release-audit-policy.mjs',
		"readJson('build/release/main-metafile.json')",
		'release audit policy must inspect the exact production build dependency evidence',
	);
	assertNoMatch(
		'scripts/check-release-audit-policy.mjs',
		/spawnSync\('npm', \['audit', '--json'\]/u,
		'release audit policy must not make development-only findings release blockers',
	);
}

function checkCssScorecard() {
	const bannedCssPatterns = [
		[/!important\b/, 'future CSS changes must avoid !important'],
		[/\ball\s*:\s*unset\b/, 'use explicit scoped resets instead of all: unset'],
		[/\bdisplay\s*:\s*contents\b/, 'avoid display: contents because Obsidian compatibility checks flag it'],
		[/\bcolumn-gap\s*:/, 'use gap shorthand instead of column-gap for Obsidian CSS compatibility'],
		[/\brow-gap\s*:/, 'use gap shorthand instead of row-gap for Obsidian CSS compatibility'],
		[/\btext-indent\s*:/, 'avoid text-indent because Obsidian compatibility checks flag css-text-indent'],
		[/\btext-decoration-[a-z-]+\s*:/, 'avoid text-decoration subproperties flagged by Obsidian CSS lint'],
		[/\btext-decoration\s*:\s*(?=[^;]*\b(?:underline|overline)\b)(?=[^;]*[^;\s]+\s+[^;\s]+)[^;]+;/, 'avoid compound text-decoration shorthand flagged by Obsidian CSS lint'],
	];

	for (const [pattern, label] of bannedCssPatterns) {
		assertNoMatch('styles.css', pattern, label);
	}
	assertNoCssPropertyDeclarations(
		'styles.css',
		['clip-path', '-webkit-clip-path'],
		'avoid clip-path because Obsidian compatibility checks flag css-clip-path',
	);

	assertNoDuplicateCssDeclarations('styles.css');

	assertCssRuleContains(
		'styles.css',
		'.operon-table-header-cell',
		['cursor: pointer;', 'user-select: none;'],
		'Table header cells must keep the interactive cursor contract',
	);
	assertIncludes(
		'styles.css',
		'.operon-table-root .operon-table-parent-task-cell:focus-visible :is(.operon-table-parent-task-chip, .operon-table-icon-only-button)',
		'Parent ID cells must expose one visible detailed or compact keyboard focus target',
	);
	assertIncludes(
		'src/ui/table/table-text-edit-route.ts',
		'export function resolveTableParentTaskActivation(',
		'Parent ID must retain its dedicated picker, editor, and source activation route',
	);
	assertIncludes(
		'src/ui/table/table-parent-task-tooltip-content.ts',
		"t('table', 'parentTaskSourceTabHint', {",
		'Parent ID tooltips must explain the platform-specific source new-tab modifier',
	);
	for (const parentCellSurface of ['src/ui/table/operon-table-view.ts', 'src/ui/embed-table-processor.ts']) {
		assertIncludes(
			parentCellSurface,
			"key === 'parentTask' ? (task.fieldValues['parentTask'] ?? '').trim() : ''",
			'Parent ID navigation must use the stored raw parent identity instead of its display label',
		);
		assertIncludes(
			parentCellSurface,
			'bindTableParentTaskCellActivation(cell, {',
			'Parent ID workspace and embedded cells must share the executable activation contract',
		);
		assertIncludes(
			parentCellSurface,
			"focusable: !editable && column.key !== 'parentTask'",
			'Parent ID compact cells must keep the gridcell as their sole keyboard focus owner',
		);
	}

	assertCssRuleContains(
		'styles.css',
		'.operon-table-header-resize-handle',
		['width: 7px;', 'cursor: col-resize;'],
		'Table column resize handles must remain reachable',
	);
	for (const relativePath of [
		'src/ui/table/operon-table-view.ts',
		'src/ui/embed-table-processor.ts',
		'src/ui/table/table-description-cell.ts',
		'src/ui/table/table-file-property-editor.ts',
		'src/ui/table/table-progress-cell.ts',
		'styles.css',
	]) {
		assertNoMatch(
			relativePath,
			/operon-table-empty-value/u,
			'Table empty cells must stay visually blank without removing their interaction owner',
		);
		if (relativePath !== 'styles.css') {
			assertNoMatch(
				relativePath,
				/['"]--['"]/u,
				'Table cell renderers must not reintroduce visible double-dash placeholders',
			);
		}
	}
	assertIncludes(
		'src/ui/table/table-progress-cell.ts',
		"const editable = kind === 'checkboxes' && !!options.onActivate;",
		'empty Checkbox Progress cells must keep their shared activation target',
	);
	assertIncludes(
		'main.ts',
		'openCheckboxesForTaskId(taskId, actionAnchor, actionAnchorRect, false)',
		'Table Checkbox Progress popovers must opt into cell-anchored desktop placement',
	);

	assertCssRuleContains(
		'styles.css',
		'.operon-table-root',
		[
			'--operon-table-detailed-value-max-width: 168px;',
			'--operon-table-chip-glow-size: 2px;',
			'--operon-table-progress-segment-glow-size: 1px;',
			'--operon-table-row-highlight-size: 1px;',
			'--operon-task-chip-bg: transparent;',
			'--operon-task-chip-hover-bg: transparent;',
			'--operon-task-chip-hover-accent: var(--operon-table-field-accent, var(--interactive-accent));',
			'--operon-task-chip-hover-border: color-mix(in srgb, var(--operon-task-chip-hover-accent) 62%, var(--background-modifier-border));',
		],
		'Table values must share stable geometry and preserve the interactive-accent fallback for uncolored cells',
	);
	assertCssRuleContains(
		'styles.css',
		'.operon-table-root .operon-table-cell-chip',
		[
			'border-width: 1px;',
			'border-style: solid;',
			'background: var(--operon-task-chip-bg, transparent);',
			'background-color: var(--operon-task-chip-bg, transparent);',
		],
		'All bordered Table chips must keep a fixed 1px border and neutral resting fill',
	);
	for (const declaration of [
		"'--operon-task-chip-hover-border': 'color-mix(in srgb, var(--operon-table-field-accent) 62%, var(--background-modifier-border))'",
		"'--operon-task-chip-focus-ring': 'color-mix(in srgb, var(--operon-task-chip-hover-border) 38%, transparent)'",
	]) {
		assertIncludes(
			'src/ui/table/table-cell-chip.ts',
			declaration,
			'Colored Table chips must derive hover borders and glow from their resolved local field color',
		);
	}
	assertIncludes(
		'styles.css',
		'.operon-table-root :is(.operon-table-list-value-chip, .operon-table-duration-like-chip):is(:hover, .is-operon-chip-hovered, :focus-visible)',
		'Duration-like Table values must share the canonical Context border and glow contract',
	);
	assertCssRuleContains(
		'styles.css',
		'.operon-table-duration-session-list',
		[
			'width: calc(100% + var(--operon-table-chip-glow-size) + var(--operon-table-chip-glow-size));',
			'margin: calc(-1 * var(--operon-table-chip-glow-size));',
			'padding: var(--operon-table-chip-glow-size);',
		],
		'Duration session values must reserve the same unclipped glow gutter as Context lists',
	);
	assertCssRuleContains(
		'styles.css',
		'button.operon-table-source-button:hover',
		['background: transparent;', 'background-color: transparent;'],
		'Source controls must keep a neutral fill while using the shared bordered hover contract',
	);
	assertCssRuleContains(
		'styles.css',
		'body:not(.is-mobile) .operon-table-root .operon-table-row:hover button.operon-table-source-button',
		['background: transparent;', 'background-color: transparent;'],
		'Source controls must stay neutral when row-wide Table hover is active',
	);
	assertCssRuleContains(
		'styles.css',
		'.operon-table-icon-only-button.operon-table-compact-datetime',
		['max-width: min(100%, var(--operon-table-detailed-value-max-width));'],
		'Table detailed datetime controls must consume the shared value width cap',
	);
	for (const selector of [
		'button.operon-table-task-icon-button:not(:disabled):not(.is-readonly):hover',
		'button.operon-table-task-type-button:hover',
		'.operon-table-icon-only-button:hover',
		'button.operon-table-duration-session-chip:hover',
		'button.operon-table-source-button:hover',
		'.operon-table-root button.operon-table-file-property-checkbox:not(:disabled):hover',
		'button.operon-table-task-icon-button:disabled:hover',
		'.operon-table-root button.operon-table-file-property-checkbox:disabled:hover',
	]) {
		assertCssRuleContains(
			'styles.css',
			selector,
			['box-shadow: 0 0 0 var(--operon-table-chip-glow-size, 2px)'],
			'Table bordered value controls must share the common hover/focus glow size',
		);
	}
	assertIncludes(
		'styles.css',
		'.operon-table-root .operon-table-cell-chip:is(:hover, .is-operon-chip-hovered, :focus-visible)',
		'Table detailed chips must use the shared hover/focus glow contract',
	);
	assertIncludes(
		'styles.css',
		'.operon-table-progress-action-shell.is-details-mode:is(:hover, :focus-within) .operon-task-progress-segment',
		'Table detailed progress must glow each segment without a surrounding shell',
	);
	assertIncludes(
		'styles.css',
		'box-shadow: 0 0 0 var(--operon-table-progress-segment-glow-size, 1px) color-mix(in srgb, var(--operon-task-progress-color) 28%, transparent);',
		'Table detailed progress segments must use the 1px segment glow token',
	);
	assertIncludes(
		'styles.css',
		'.operon-table-progress-action-shell.is-icon-mode:is(:hover, :focus-within),',
		'Table compact progress must retain its surrounding control glow',
	);
	assertCssRuleContains(
		'styles.css',
		'.operon-table-progress-action-shell.is-empty-mode:focus-within',
		['box-shadow: inset 0 0 0 var(--operon-table-chip-glow-size, 2px)'],
		'empty Checkbox Progress controls must keep a visible keyboard focus ring without a progress graphic',
	);
	assertIncludes(
		'styles.css',
		'.operon-table-progress-cell.is-details-mode:not(:has(.operon-table-progress-action-shell)):hover > .operon-table-progress-wrap .operon-task-progress-segment',
		'Table readonly detailed progress must keep per-segment visual-only hover glow',
	);
	assertIncludes(
		'styles.css',
		'.operon-table-progress-cell:not(:has(.operon-table-progress-action-shell)):hover > .operon-table-progress-ring',
		'Table readonly compact progress must keep its visual-only hover glow',
	);
	assertCssAtRuleContains(
		'styles.css',
		'@media (hover: hover) and (pointer: fine)',
		[
			'body:not(.is-mobile) .operon-table-root .operon-table-row:hover .operon-table-description-text:not(.is-empty)',
			'body:not(.is-mobile) .operon-table-root .operon-table-row:hover .operon-table-cell-chip:not(.operon-table-file-property-checkbox):not(.operon-table-parent-task-chip):not(.operon-table-field-accent-chip)',
			'body:not(.is-mobile) .operon-table-root .operon-table-row:hover .operon-table-parent-task-chip',
			'body:not(.is-mobile) .operon-table-root .operon-table-row:hover .operon-table-icon-only-button',
			'body:not(.is-mobile) .operon-table-root .operon-table-row:hover button.operon-table-file-property-checkbox',
			'body:not(.is-mobile) .operon-table-root .operon-table-row:hover button.operon-table-task-icon-button:disabled',
			'body:not(.is-mobile) .operon-table-root .operon-table-row:hover .operon-table-progress-action-shell.is-details-mode .operon-task-progress-segment',
			'background: var(--operon-task-chip-bg, transparent);',
			'background: transparent;',
		],
		['body.is-mobile', '.operon-table-progress-action-shell.is-empty-mode'],
		'Table row-wide hover must remain desktop fine-pointer-only and leave empty progress visually blank',
	);
	assertCssRuleContains(
		'styles.css',
		'body:not(.is-mobile) .operon-table-root .operon-table-row:hover .operon-table-field-accent-chip:not(.operon-table-file-property-checkbox)',
		[
			'--operon-task-chip-border: color-mix(in srgb, var(--operon-table-field-accent) 62%, var(--background-modifier-border));',
			'--operon-task-chip-focus-ring: color-mix(in srgb, var(--operon-task-chip-border) 38%, transparent);',
			'border-color: var(--operon-task-chip-border);',
		],
		'Colored Table row hover must use the resolved field color instead of the generic accent fallback',
	);
	for (const surfacePath of [
		'src/ui/table/operon-table-view.ts',
		'src/ui/embed-table-processor.ts',
	]) {
		assertIncludes(
			surfacePath,
			'renderTableCellChips(',
			'Workspace and embedded detailed Table values must keep using the shared colored-chip renderer',
		);
	}
	assertCssRuleContains(
		'styles.css',
		'.operon-table-cell.is-active-cell::before',
		['height: var(--operon-table-row-highlight-size, 1px);'],
		'Table active-cell rails must use the subtle 1px row highlight token',
	);
	assertCssRuleContains(
		'styles.css',
		'.operon-table-root .operon-table-progress-action-shell:focus-within',
		['outline: 2px solid ButtonText;', 'box-shadow: none;'],
		'Table progress controls must keep a forced-colors focus indicator',
	);
	assertCssRuleContains(
		'styles.css',
		'.operon-table-root .operon-table-date-value-chip',
		[
			'--operon-task-chip-bg: transparent;',
			'--operon-task-chip-hover-bg: transparent;',
			'background: transparent;',
			'background-color: transparent;',
		],
		'Table date and datetime chips must keep a neutral fill in every color mode',
	);
	assertCssRuleContains(
		'styles.css',
		'.operon-table-root .operon-table-date-value-chip:focus-visible',
		['outline: 2px solid ButtonText;', 'box-shadow: none;'],
		'Table date and datetime chips must keep a forced-colors focus indicator',
	);
	assertCssRuleContains(
		'styles.css',
		'.operon-table-cell-chip-list',
		[
			'display: flex;',
			'gap: 6px;',
			'box-sizing: border-box;',
			'width: calc(100% + var(--operon-table-chip-glow-size) + var(--operon-table-chip-glow-size));',
			'margin: calc(-1 * var(--operon-table-chip-glow-size));',
			'padding: var(--operon-table-chip-glow-size);',
			'overflow: hidden;',
			'min-width: 0;',
			'max-width: calc(100% + var(--operon-table-chip-glow-size) + var(--operon-table-chip-glow-size));',
		],
		'Table list wrappers must reserve glow paint space while clipping non-shrinking sibling values inside the column',
	);
	assertCssRuleContains(
		'styles.css',
		'.operon-table-list-value-chip',
		[
			'flex: 0 0 auto;',
			'width: max-content;',
			'max-width: var(--operon-table-detailed-value-max-width);',
			'overflow: hidden;',
			'background-color: transparent;',
			'text-overflow: ellipsis;',
			'white-space: nowrap;',
		],
		'Table list values must retain their natural width, shared cap, neutral fill, and ellipsis',
	);
	assertIncludes(
		'styles.css',
		'.operon-table-root .operon-table-list-value-chip:is(:hover, .is-operon-chip-hovered, :focus-visible),\n'
			+ '.operon-table-root .operon-table-cell.is-editable:is(:focus-visible, :focus-within) .operon-table-list-value-chip {\n'
			+ '\t--operon-task-chip-border: color-mix(\n'
			+ '\t\tin srgb,\n'
			+ '\t\tvar(--operon-table-field-accent, var(--interactive-accent)) 62%,\n'
			+ '\t\tvar(--background-modifier-border)\n'
			+ '\t);\n'
			+ '\t--operon-task-chip-focus-ring: color-mix(in srgb, var(--operon-task-chip-border) 38%, transparent);\n'
			+ '\tborder-color: var(--operon-task-chip-border);\n'
			+ '\tbackground: transparent;\n'
			+ '\tbackground-color: transparent;\n'
			+ '\tbox-shadow: 0 0 0 var(--operon-table-chip-glow-size, 2px) var(--operon-task-chip-focus-ring);',
		'Table list hover and focus must use the shared border and glow treatment',
	);
	assertCssRuleContains(
		'styles.css',
		'.operon-table-plain-text-value',
		['border: 0;', 'background-color: transparent;', 'box-shadow: none;'],
		'Table scalar text values must stay borderless and neutral',
	);

	assertIncludes(
		'styles.css',
		'body:not(.is-mobile) .mod-sidedock .workspace-leaf-content:is(\n\t[data-type="operon-table-view"],\n\t[data-type="operon-table-file-view"]\n) > .view-content.operon-table-view .operon-table-toolbar {\n\tgrid-template-columns: minmax(0, 1fr);\n\tgrid-template-areas: \'end\';\n\talign-items: center;\n}',
		'desktop sidebar Table leaves must keep a compact first toolbar row',
	);
	assertIncludes(
		'styles.css',
		') > .view-content.operon-table-view .operon-table-toolbar.has-favorite-presets {\n\tgrid-template-areas:\n\t\t\'end\'\n\t\t\'center\';\n}',
		'desktop sidebar Table leaves must place favorite presets in a second toolbar row only when present',
	);
	assertIncludes(
		'styles.css',
		') > .view-content.operon-table-view .operon-table-toolbar-start,\nbody:not(.is-mobile) .mod-sidedock',
		'desktop sidebar Table leaves must hide the title region only inside sidedocks',
	);
	assertIncludes(
		'styles.css',
		') > .view-content.operon-table-view .operon-table-toolbar-center {\n\twidth: 100%;\n\tjustify-content: center;\n\tflex-wrap: wrap;\n}',
		'desktop sidebar Table favorite presets must wrap within their own full-width second row',
	);
	assertIncludes(
		'styles.css',
		') > .view-content.operon-table-view .operon-table-group-sort-button,\nbody:not(.is-mobile) .mod-sidedock',
		'desktop sidebar Table leaves must hide Group and Sort only inside sidedocks',
	);
	assertIncludes(
		'styles.css',
		') > .view-content.operon-table-view .operon-table-filter-popover-host,\nbody:not(.is-mobile) .mod-sidedock',
		'desktop sidebar Table leaves must hide Filter only inside sidedocks',
	);
	assertIncludes(
		'styles.css',
		') > .view-content.operon-table-view .operon-table-export-button {\n\tdisplay: none;\n}',
		'desktop sidebar Table leaves must hide Export only inside sidedocks',
	);
	assertIncludes(
		'styles.css',
		') > .view-content.operon-table-view .operon-table-toolbar-end {\n\tjustify-content: flex-start;\n\twidth: 100%;\n}',
		'desktop sidebar Table controls must keep buttons aligned to the start edge',
	);
	assertIncludes(
		'styles.css',
		') > .view-content.operon-table-view .operon-table-search-wrap {\n\tflex: 1 1 var(--operon-table-search-width);\n\twidth: auto;\n\tmin-width: 0;\n\tmax-width: var(--operon-table-search-width);\n\tmargin-inline-start: auto;\n}',
		'desktop sidebar Table search must stay at the logical end and remain shrinkable',
	);
	assertIncludes(
		'styles.css',
		'body.is-mobile .workspace-leaf-content:is(\n\t[data-type="operon-table-view"],\n\t[data-type="operon-table-file-view"]\n) > .view-content.operon-table-view .operon-table-toolbar {\n\tgrid-template-columns: minmax(0, 1fr);\n\tgrid-template-areas: \'end\';\n\talign-items: center;\n}',
		'mobile Table leaves must keep only the end toolbar region regardless of workspace placement',
	);
	assertIncludes(
		'styles.css',
		'body.is-mobile .workspace-leaf-content:is(\n\t[data-type="operon-table-view"],\n\t[data-type="operon-table-file-view"]\n) > .view-content.operon-table-view .operon-table-toolbar-end {\n\tjustify-content: flex-start;\n\twidth: 100%;\n}',
		'mobile Table controls must keep preset buttons aligned to the start edge',
	);
	assertIncludes(
		'styles.css',
		'body.is-mobile .workspace-leaf-content:is(\n\t[data-type="operon-table-view"],\n\t[data-type="operon-table-file-view"]\n) > .view-content.operon-table-view .operon-table-search-wrap {\n\tflex: 1 1 var(--operon-table-search-width);\n\twidth: auto;\n\tmin-width: 0;\n\tmax-width: var(--operon-table-search-width);\n\tmargin-inline-start: auto;\n}',
		'mobile Table search must stay at the logical end and remain shrinkable',
	);
	assertIncludes(
		'styles.css',
		') > .view-content.operon-table-view .operon-table-toolbar-start,\nbody.is-mobile .workspace-leaf-content:is(',
		'mobile Table leaves must hide the title region across mobile workspace placements',
	);
	assertIncludes(
		'styles.css',
		') > .view-content.operon-table-view .operon-table-toolbar-center,\nbody.is-mobile .workspace-leaf-content:is(',
		'mobile Table leaves must hide favorite presets across mobile workspace placements',
	);
	assertIncludes(
		'styles.css',
		') > .view-content.operon-table-view .operon-table-group-sort-button,\nbody.is-mobile .workspace-leaf-content:is(',
		'mobile Table leaves must hide Group and Sort across mobile workspace placements',
	);
	assertIncludes(
		'styles.css',
		') > .view-content.operon-table-view .operon-table-filter-popover-host,\nbody.is-mobile .workspace-leaf-content:is(',
		'mobile Table leaves must hide Filter across mobile workspace placements',
	);
	assertIncludes(
		'styles.css',
		'body.is-mobile .workspace-leaf-content:is(\n\t[data-type="operon-table-view"],\n\t[data-type="operon-table-file-view"]\n) > .view-content.operon-table-view .operon-table-export-button {\n\tdisplay: none;\n}',
		'mobile Table leaves must hide Export across mobile workspace placements',
	);
	assertIncludes(
		'styles.css',
		'.operon-table-toolbar:not(:hover):not(:focus-within):not(:has([aria-expanded="true"])) {\n\t\tbox-sizing: border-box;\n\t\theight: 16px;\n\t\tmin-height: 16px;\n\t\tmax-height: 16px;',
		'sidebar Table toolbar must preserve hover, keyboard focus, and open popup expansion while using the 16px compact rail',
	);
	assertIncludes(
		'styles.css',
		'.operon-table-toolbar:not(:hover):not(:focus-within):not(:has([aria-expanded="true"])) .operon-table-toolbar-end {\n\t\tbox-sizing: border-box;\n\t\theight: 4px;\n\t\tmin-height: 4px;\n\t\tmax-height: 4px;',
		'sidebar Table toolbar compact state must render the 4px inner rail',
	);
	assertIncludes(
		'styles.css',
		'.operon-table-toolbar:not(:hover):not(:focus-within):not(:has([aria-expanded="true"])) .operon-table-toolbar-center {\n\t\theight: 0;\n\t\tmin-height: 0;\n\t\tmax-height: 0;\n\t\toverflow: hidden;',
		'sidebar Table compact rail must hide the favorite-preset second row without removing keyboard focus ownership',
	);
	assertCssAtRuleContains(
		'styles.css',
		'@media (hover: hover) and (pointer: fine)',
		[
			'body:not(.is-mobile) .mod-sidedock .workspace-leaf-content:is(',
			'[data-type="operon-table-view"]',
			'[data-type="operon-table-file-view"]',
			'> .view-content.operon-table-view .operon-table-toolbar:not(:hover):not(:focus-within):not(:has([aria-expanded="true"]))',
			'height: 16px;',
			'height: 4px;',
			'height: 0;',
			'opacity: 0;',
		],
		['body.is-mobile', '.operon-table-embed-toolbar'],
		'sidebar Table toolbar auto-collapse must stay fine-pointer, desktop, direct-leaf, and embed-safe',
	);
	assertCssAtRuleContains(
		'styles.css',
		'@media (prefers-reduced-motion: reduce)',
		[
			'body:not(.is-mobile) .mod-sidedock .workspace-leaf-content:is(',
			'[data-type="operon-table-view"]',
			'[data-type="operon-table-file-view"]',
			'> .view-content.operon-table-view .operon-table-toolbar-end > *',
			'transition-duration: 0ms;',
		],
		['.operon-table-embed-toolbar'],
		'sidebar Table toolbar reduced-motion override must stay desktop, direct-leaf, and embed-safe',
	);
	assertCssAtRuleContains(
		'styles.css',
		'@media (hover: hover) and (pointer: fine)',
		[
			'body:not(.is-mobile) .mod-sidedock',
			'[data-type="operon-calendar-view"] > .view-content.operon-calendar-view > .operon-calendar-root > .operon-calendar-toolbar',
			'[data-type="operon-filter-view"] > .view-content.operon-filter-view > .operon-filter-surface--sidebar > .operon-filter-header',
			':not(:hover):not(:focus-within):not(:has([aria-expanded="true"]))',
			'height: 16px;',
			'height: 4px;',
			'position: relative;',
			'position: absolute;',
			'top: 6px;',
			'inset-inline: 8px;',
			'opacity: 0;',
			'opacity: 1;',
			'pointer-events: none;',
		],
		[
			'body.is-mobile',
			'.operon-calendar-mobile-root',
			'.operon-filter-surface--preview',
			'.operon-filter-surface--dynamic-file-task',
			'.operon-embed-filter',
		],
		'Calendar and Filter sidebar toolbar rails must stay desktop, fine-pointer, direct-leaf, and popup-safe',
	);
	assertCssAtRuleContains(
		'styles.css',
		'@media (prefers-reduced-motion: reduce)',
		[
			'body:not(.is-mobile) .mod-sidedock',
			'[data-type="operon-calendar-view"] > .view-content.operon-calendar-view > .operon-calendar-root > .operon-calendar-toolbar',
			'[data-type="operon-filter-view"] > .view-content.operon-filter-view > .operon-filter-surface--sidebar > .operon-filter-header',
			'transition-duration: 0ms;',
		],
		['.operon-calendar-mobile-root', '.operon-filter-surface--preview', '.operon-embed-filter'],
		'Calendar and Filter sidebar toolbar rails must honor reduced motion without leaking into embedded surfaces',
	);
	assertCssRuleContains(
		'styles.css',
		'.operon-filter-surface--sidebar .operon-filter-header',
		['position: sticky;', 'top: 0;', 'z-index: 20;'],
		'Filter sidebar toolbar rail must preserve the sticky header positioning contract',
	);
	assertIncludes(
		'styles.css',
		')::after {\n\t\tcontent: \'\';\n\t\tposition: absolute;\n\t\ttop: 6px;\n\t\tinset-inline: 8px;\n\t\theight: 4px;\n\t\tborder-radius: 999px;',
		'Calendar and Filter sidebar toolbar rails must keep their scoped pseudo-element geometry',
	);
	assertIncludes(
		'src/ui/calendar/calendar-view.ts',
		"button.setAttribute('aria-expanded', 'true');",
		'Calendar sidebar toolbar collapse must remain open while the preset picker owns expansion',
	);
	assertIncludes(
		'src/ui/calendar/calendar-view.ts',
		"button.setAttribute('aria-expanded', 'false');",
		'Calendar sidebar toolbar collapse must resume after the preset picker closes',
	);
	assertIncludes(
		'src/ui/filter-view.ts',
		"this.filterPickerButtonEl?.setAttribute('aria-expanded', open ? 'true' : 'false');",
		'Filter sidebar toolbar collapse must remain open while the filter picker owns expansion',
	);
	assertIncludes(
		'src/ui/related-views.ts',
		"anchor.setAttribute('aria-expanded', 'true');",
		'Calendar and Filter sidebar toolbar collapse must remain open while Related Views owns expansion',
	);
	assertIncludes(
		'src/ui/related-views.ts',
		"anchor.setAttribute('aria-expanded', 'false');",
		'Calendar and Filter sidebar toolbar collapse must resume after Related Views closes',
	);
	assertIncludes(
		'src/ui/table/operon-table-view.ts',
		"cls: 'operon-table-toolbar-icon-button operon-table-preset-settings-button'",
		'Table preset settings must keep a stable semantic toolbar class',
	);
	assertIncludes(
		'src/ui/table/operon-table-view.ts',
		"cls: 'operon-table-toolbar-icon-button operon-table-export-button'",
		'Table export must keep a stable semantic toolbar class',
	);

	assertCssScopedRuleExcludes(
		'styles.css',
		'.operon-table-embed',
		'.operon-table-header-cell',
		[/\bcursor\s*:\s*default\b/, /\bpointer-events\s*:\s*none\b/],
		'embedded Table headers must not be made visually or functionally passive',
		selector => selectorMatchesTarget(selector, '.operon-table-header-cell-readonly'),
	);

	assertCssScopedRuleExcludes(
		'styles.css',
		'.operon-table-embed',
		'.operon-table-header-resize-handle',
		[
			/\bdisplay\s*:\s*none\b/,
			/\bvisibility\s*:\s*hidden\b/,
			/\bpointer-events\s*:\s*none\b/,
			/\b(?:width|inline-size)\s*:\s*0(?:px|rem|em|%)?\b/,
		],
		'embedded Table resize handles must remain reachable',
	);

	for (const selector of ['.operon-table-header-cell-sorted', '.operon-table-header-cell-active']) {
		assertCssScopedRuleExcludes(
			'styles.css',
			'.operon-table-embed',
			selector,
			[/\bbackground(?:-color)?\s*:\s*transparent\b/, /\bborder-color\s*:\s*transparent\b/, /\bbox-shadow\s*:\s*none\b/],
			'embedded Table header state affordances must remain visible',
		);
	}

	assertNoMatch(
		'styles.css',
		/\.operon-table-embed[^{]*\.operon-table-header-cell:hover[^{]*\{[^}]*\b(?:background(?:-color)?\s*:\s*transparent|border-color\s*:\s*transparent|box-shadow\s*:\s*none)\b/s,
		'embedded Table header hover affordance must remain visible',
	);

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
	assertCssRuleContains(
		'styles.css',
		'.operon-table-embed',
		[
			'--operon-task-chip-border: var(--background-modifier-border-hover);',
			'--operon-task-chip-bg: transparent;',
		],
		'embedded Table chips must keep a visible neutral border token',
	);

	for (const selector of [
		'.operon-table-root.operon-table-embed .operon-table-cell-chip',
		'.markdown-reading-view .operon-table-root .operon-table-cell-chip',
		'.markdown-preview-view .operon-table-root .operon-table-cell-chip',
	]) {
		const matchingRules = cssRules('styles.css').filter(candidate => candidate.selectors.includes(selector));
		if (matchingRules.length === 0) {
			fail(`styles.css: embedded Table chip markdown override must exist for ${selector}`);
			continue;
		}
		if (matchingRules.some(rule => /\bborder\s*:/.test(rule.body))) {
			fail(`styles.css: embedded Table chips must not use border shorthand for ${selector}`);
		}
		if (matchingRules.every(rule => !rule.body.includes('border-color: var(--operon-task-chip-border, var(--background-modifier-border));'))) {
			fail(`styles.css: embedded Table chips must resolve border color through the normal Table chip variable for ${selector}`);
		}
	}
}

function checkCalendarHoverGuideContract() {
	const calendarSource = readText('src/ui/calendar/calendar-view.ts');
	const settingsSource = readText('src/ui/settings-tab.ts');
	const calendarPresetAddStart = settingsSource.indexOf("settingsAsyncHandler('settings calendar preset add failed'");
	const calendarPresetAddEnd = settingsSource.indexOf('\n\t\tconst ', calendarPresetAddStart + 1);
	const calendarPresetAddSource = calendarPresetAddStart >= 0
		? settingsSource.slice(calendarPresetAddStart, calendarPresetAddEnd > calendarPresetAddStart ? calendarPresetAddEnd : undefined)
		: '';
	if (!calendarPresetAddSource.includes("colorSource: 'noColor'")) {
		fail('src/ui/settings-tab.ts: newly added Calendar presets must default Task color to No Color');
	}
	for (const token of [
		'export function resolveCalendarColorAccents(',
		'this.applyCalendarColorAccents(',
		'this.applyCalendarColorAccents(element, fieldValues, preset, settings, null);',
		"const calendarAccent = colorSource === 'noColor'",
		"interactionAccent: colorSource === 'noColor'",
		"resolveTaskColorSource(fieldValues, 'priorityColor', settings)",
		': calendarAccent,',
		'resolveCalendarColorAccents(fieldValues, preset.colorSource, settings, externalColor)',
		"'--operon-calendar-accent': accents.calendarAccent || 'transparent'",
		"'--operon-calendar-interaction-accent': accents.interactionAccent || 'transparent'",
		"'--operon-calendar-interaction-accent': 'var(--text-muted)'",
	]) {
		if (!calendarSource.includes(token)) {
			fail(`src/ui/calendar/calendar-view.ts: timed Calendar indicators must follow the preset color source with a No Color priority fallback: missing ${token}`);
		}
	}
	const activeTrackerRules = cssRules('styles.css').filter(candidate => candidate.selectors.includes(
		'.operon-calendar-root.is-surface-time-tracker-grid .operon-calendar-tracked-session-item.is-active-tracker',
	));
	if (activeTrackerRules.length === 0 || activeTrackerRules.some(rule => rule.body.includes('--operon-calendar-timed-hover-edge-'))) {
		fail('styles.css: active tracked tasks must not suppress the shared hover-only timed edge variables');
	}
	if (activeTrackerRules.every(rule => !rule.body.includes('border: 0;'))) {
		fail('styles.css: active tracked tasks must not restore a persistent perimeter border');
	}
	assertCssRuleContains(
		'styles.css',
		'.operon-calendar-timed-item',
		[
			'--operon-calendar-timed-hover-edge-top: repeating-linear-gradient(to right,',
			'--operon-calendar-timed-hover-edge-bottom: repeating-linear-gradient(to right,',
			'--operon-calendar-timed-edge-left:',
			'var(--operon-calendar-interaction-accent, transparent)',
			'left / 1px 100% no-repeat;',
		],
		'Calendar timed tasks must keep a one-pixel left edge driven by the resolved interaction color',
	);
	assertCssRuleContains(
		'styles.css',
		'.operon-calendar-timed-item:not(.is-availability-layer)::before',
		['background: var(--operon-calendar-timed-edge-left);', 'opacity: 0.9;'],
		'Calendar timed tasks must render only the persistent left interaction edge outside hover',
	);
	assertCssRuleContains(
		'styles.css',
		'.operon-calendar-mobile-timegrid-item:not(.is-availability-layer)::before',
		['background: var(--operon-calendar-timed-edge-left);', 'opacity: 0.9;', 'pointer-events: none;'],
		'Mobile Calendar timed tasks must render only the persistent left interaction edge outside touch interaction',
	);
	assertCssRuleContains(
		'styles.css',
		'.operon-calendar-mobile-timegrid-item.operon-calendar-mobile-item',
		['border: 0;', 'border-radius: 6px;'],
		'Mobile Calendar timed tasks must not restore the generic mobile perimeter border',
	);
	assertCssRuleContains(
		'styles.css',
		'.operon-calendar-mobile-timegrid-item:not(.is-availability-layer).is-touch-guide-active::before',
		[
			'var(--operon-calendar-timed-hover-edge-top),',
			'var(--operon-calendar-timed-hover-edge-bottom),',
			'var(--operon-calendar-timed-edge-left);',
			'box-shadow: inset 3px 0 5px -3px',
		],
		'Mobile Calendar long-press and drag must show the shared dashed edges and subtle left glow',
	);
	const resizeRailVisualRules = cssRules('styles.css').filter(candidate => candidate.selectors.some(selector => (
		selector.includes('.operon-calendar-timed-resize-handle')
		&& (selector.includes('::before') || selector.includes('::after'))
	)));
	if (resizeRailVisualRules.length > 0) {
		fail('styles.css: timed resize handles must remain invisible hit areas without fixed top or bottom rail pseudo-elements');
	}
	assertCssRuleContains(
		'styles.css',
		'.operon-calendar-timed-resize-handle',
		['height: 6px;', 'background: transparent;'],
		'Calendar timed resize handles must retain their transparent six-pixel hit area',
	);
	const bindCallCount = calendarSource.match(/this\.bindTimedHoverGuides\(/g)?.length ?? 0;
	if (bindCallCount < 4) {
		fail('src/ui/calendar/calendar-view.ts: timed Calendar hover guides must stay bound for mobile timed items, desktop task lanes, and tracked lanes');
	}
	for (const token of [
		'private renderTimedInteractionGuides(',
		"block.addClass('is-touch-dragging', 'is-touch-guide-active')",
		"block.removeClass('is-touch-dragging', 'is-touch-guide-active')",
		'private bindTrackedSessionInteraction(',
	]) {
		if (!calendarSource.includes(token)) {
			fail(`src/ui/calendar/calendar-view.ts: mobile timed interactions must share the guide renderer and clear touch-active state: missing ${token}`);
		}
	}
	const hoverGuideStart = calendarSource.indexOf('\tprivate bindTimedHoverGuides(');
	const hoverGuideEnd = hoverGuideStart >= 0
		? calendarSource.indexOf('\n\tprivate applyCalendarPresetTheme(', hoverGuideStart)
		: -1;
	const hoverGuideSource = hoverGuideStart >= 0 && hoverGuideEnd > hoverGuideStart
		? calendarSource.slice(hoverGuideStart, hoverGuideEnd)
		: '';
	if (!hoverGuideSource) {
		fail('src/ui/calendar/calendar-view.ts: Calendar timed hover guide binding must exist');
	}
	if (hoverGuideSource.includes('labelEl.style.left')) {
		fail('src/ui/calendar/calendar-view.ts: Calendar hover guide endpoint labels must be positioned by scoped CSS, not inline static left styles');
	}
	for (const token of [
		"element.style.getPropertyValue('--operon-calendar-interaction-accent').trim()",
		": 'var(--text-muted)';",
	]) {
		if (!calendarSource.includes(token)) {
			fail(`src/ui/calendar/calendar-view.ts: Calendar hover guides must resolve from the preset-aware interaction accent: missing ${token}`);
		}
	}
	for (const token of [
		"cls: 'operon-calendar-hover-guide-label is-duration'",
		"if (isCompactRange) guide.addClass('is-compact-range');",
		'const compactLabelRange = Math.abs(bottom - top) < 28;',
		'this.formatTimedGuideDurationLabel(startMinutes, endMinutes)',
		'durationEl.style.left = `${labelCenter}px`;',
		'private formatTimedGuideDurationLabel(startMinutes: number, endMinutes: number): string {',
		'formatTimeTrackerGridCompactDurationSeconds(Math.max(0, endMinutes - startMinutes) * 60)',
		"section.closest<HTMLElement>('.operon-calendar-mobile-timegrid-viewport, .operon-calendar-timed-viewport')",
		"'.operon-calendar-time-tracker-grid-label-gutter, .operon-calendar-time-tracker-grid-label-clip'",
		'const visibleTop = Math.max(0, viewportRect.top - sectionRect.top, stickyLaneHeaderBottom);',
		"guide.addClass('is-label-below')",
		"guide.addClass('is-label-above')",
	]) {
		if (!calendarSource.includes(token)) {
			fail(`src/ui/calendar/calendar-view.ts: Calendar hover guides must keep duration label contract: missing ${token}`);
		}
	}

	assertCssRuleContains(
		'styles.css',
		'.operon-calendar-hover-guide.is-hover-guide',
		[
			'height: 1px;',
			'border-top: 0;',
			'background: repeating-linear-gradient(to right,',
			'0 8px, transparent 8px 16px);',
		],
		'Calendar hover guide lines must keep the lower-frequency eight-pixel dashed pattern without changing edit guides',
	);
	assertCssRuleContains(
		'styles.css',
		'.operon-calendar-timed-item:not(.is-availability-layer):hover::before',
		[
			'var(--operon-calendar-timed-hover-edge-top),',
			'var(--operon-calendar-timed-hover-edge-bottom),',
			'var(--operon-calendar-timed-edge-left);',
		],
		'Calendar timed task top and bottom edges must enter the paint stack only during mouse hover',
	);
	const timedFocusRules = cssRules('styles.css').filter(candidate => candidate.selectors.includes(
		'.operon-calendar-timed-item:not(.is-availability-layer):focus-within:not(:hover)::before',
	));
	if (timedFocusRules.length === 0 || timedFocusRules.some(rule => rule.body.includes('timed-hover-edge'))) {
		fail('styles.css: timed task top and bottom edges must not persist through focus-within after hover ends');
	}
	for (const [selector, edge] of [
		['.operon-calendar-timed-item:not(.is-availability-layer).is-clipped-top:hover', 'top'],
		['.operon-calendar-timed-item:not(.is-availability-layer).is-clipped-top:focus-within', 'top'],
		['.operon-calendar-timed-item:not(.is-availability-layer).is-clipped-bottom:hover', 'bottom'],
		['.operon-calendar-timed-item:not(.is-availability-layer).is-clipped-bottom:focus-within', 'bottom'],
	]) {
		assertCssRuleContains(
			'styles.css',
			selector,
			[`--operon-calendar-timed-hover-edge-${edge}: linear-gradient(transparent, transparent) ${edge} / 100% 0 no-repeat;`],
			'Clipped Calendar timed task boundaries must stay hidden during hover and keyboard focus',
		);
	}
	const timedPlacementStart = calendarSource.indexOf('\tprivate applyTimedPlacementStyle(');
	const timedPlacementEnd = calendarSource.indexOf('\n\tprivate bindScheduledAllDayItemInteraction(', timedPlacementStart);
	const timedPlacementSource = timedPlacementStart >= 0 && timedPlacementEnd > timedPlacementStart
		? calendarSource.slice(timedPlacementStart, timedPlacementEnd)
		: '';
	for (const token of [
		"element.classList.toggle('is-clipped-top', startMinutes <= 0);",
		"element.classList.toggle('is-clipped-bottom', endMinutes >= 24 * 60);",
	]) {
		if (!timedPlacementSource.includes(token)) {
			fail(`src/ui/calendar/calendar-view.ts: standard timed placements must retain clipping classes: missing ${token}`);
		}
	}
	assertCssRuleContains(
		'styles.css',
		'.operon-calendar-hover-guide.is-hover-guide .operon-calendar-hover-guide-label',
		[
			'border: 1px solid var(--operon-calendar-guide-color, var(--text-muted));',
			'border-radius: 6px;',
			'background: var(--background-primary);',
			'color: var(--operon-calendar-guide-color, var(--text-muted));',
			'padding: 2px 8px;',
			'font-size: var(--font-ui-smaller);',
			'line-height: 1.25;',
		],
		'Calendar hover guide labels must stay readable, neutral, rectangular, and interaction-colored',
	);
	assertCssRuleContains(
		'styles.css',
		'.operon-calendar-mobile-timegrid-item.is-live-editing .operon-calendar-timed-drag-label',
		['display: none;'],
		'Mobile Calendar timed dragging must not show a redundant range tooltip above the duration label',
	);
	assertCssRuleContains(
		'styles.css',
		'.operon-calendar-mobile-timegrid-item-time',
		['display: none;'],
		'Mobile Calendar timed cards must not repeat their time range below the task description',
	);
	assertCssRuleContains(
		'styles.css',
		'.operon-calendar-mobile-hover-guide-overlay .operon-calendar-hover-guide.is-hover-guide .operon-calendar-hover-guide-label',
		['padding: 1px 4px;', 'font-size: 9px;', 'line-height: 1.2;'],
		'Mobile Calendar guide labels must match the compact fixed time-label scale',
	);
	assertCssRuleContains(
		'styles.css',
		'.operon-calendar-mobile-hover-guide-overlay .operon-calendar-hover-guide.is-hover-guide .operon-calendar-hover-guide-label.is-start',
		['transform: translate(calc(-100% - 2px), -50%);'],
		'Mobile Calendar start labels must retain their full border inside the time gutter',
	);
	assertCssRuleContains(
		'styles.css',
		'.operon-calendar-now-label',
		[
			'border: 1px solid #e14b4b;',
			'border-radius: 6px;',
			'background: var(--background-primary);',
			'color: #e14b4b;',
		],
		'Calendar current-time labels must keep a neutral rectangular surface with the existing red indicator color',
	);
	assertCssRuleContains(
		'styles.css',
		'.operon-calendar-timed-item:not(.is-availability-layer):hover',
		['left / 2px 100% no-repeat;'],
		'Calendar timed task interaction edge must strengthen to two pixels on hover and focus',
	);
	assertCssRuleContains(
		'styles.css',
		'.operon-calendar-timed-item:not(.is-availability-layer):hover::before',
		['box-shadow: inset 3px 0 5px -3px', 'var(--operon-calendar-interaction-accent, transparent) 65%'],
		'Calendar timed task interaction edge must keep a subtle inward hover glow',
	);
	assertCssRuleContains(
		'styles.css',
		'.operon-calendar-timed-item:not(.is-availability-layer):focus-within',
		['left / 2px 100% no-repeat;'],
		'Keyboard-focused Calendar timed tasks must retain the two-pixel interaction edge',
	);
	assertCssRuleContains(
		'styles.css',
		'.operon-calendar-timed-item:not(.is-availability-layer):focus-within:not(:hover)::before',
		['box-shadow: inset 3px 0 5px -3px', 'var(--operon-calendar-interaction-accent, transparent) 65%'],
		'Keyboard-focused Calendar timed tasks must retain the subtle interaction glow',
	);
	assertCssRuleContains(
		'styles.css',
		'.operon-calendar-hover-guide.is-hover-guide .operon-calendar-hover-guide-label.is-start',
		['left: 0;', 'transform: translate(calc(-100% - 4px), -50%);'],
		'Calendar hover start time label must stay anchored to the left guide endpoint',
	);
	assertCssRuleContains(
		'styles.css',
		'.operon-calendar-hover-guide.is-hover-guide .operon-calendar-hover-guide-label.is-end',
		['left: 0;', 'transform: translate(calc(-100% - 4px), -50%);'],
		'Calendar hover end time label must stay anchored to the left guide endpoint',
	);
	assertCssRuleContains(
		'styles.css',
		'.operon-calendar-hover-guide.is-hover-guide.is-compact-range .operon-calendar-hover-guide-label.is-start',
		['transform: translate(calc(-100% - 4px), -100%);'],
		'Calendar hover start time label must move above compact ranges to avoid label overlap',
	);
	assertCssRuleContains(
		'styles.css',
		'.operon-calendar-hover-guide.is-hover-guide.is-compact-range .operon-calendar-hover-guide-label.is-end',
		['transform: translate(calc(-100% - 4px), 0);'],
		'Calendar hover end time label must move below compact ranges to avoid label overlap',
	);
	assertCssRuleContains(
		'styles.css',
		'.operon-calendar-hover-guide.is-hover-guide.is-label-below .operon-calendar-hover-guide-label.is-duration',
		['transform: translate(-50%, 0);'],
		'Calendar duration labels must move inside the viewport at the top edge',
	);
	assertCssRuleContains(
		'styles.css',
		'.operon-calendar-hover-guide.is-hover-guide.is-label-above .operon-calendar-hover-guide-label.is-end',
		['transform: translate(calc(-100% - 4px), -100%);'],
		'Calendar end labels must move inside the viewport at the bottom edge',
	);
}

function checkSettingsDescriptionTextareaGuards() {
	const settingsSource = readText('src/ui/settings-tab.ts');
	const enLocale = readJson('i18n/locales/en.json');
	const textareaDeclarations = [
		'width: 100%;',
		'min-height: 72px;',
		'box-sizing: border-box;',
		'resize: vertical;',
	];

	for (const selector of ['.operon-priority-description-textarea', '.operon-pipeline-description-textarea']) {
		assertCssRuleContains(
			'styles.css',
			selector,
			textareaDeclarations,
			'pipeline and priority description textareas must stay vertically resizable and uncapped',
		);
		assertCssRuleExcludes(
			'styles.css',
			selector,
			[/\bmax-height\s*:/],
			'pipeline and priority description textareas must be expandable without a max-height cap',
		);
	}

	assertCssRuleContains(
		'styles.css',
		'.operon-priority-description-row',
		['grid-column: 3 / -1;', 'min-width: 0;'],
		'priority description textarea must stay aligned under the priority label column',
	);
	for (const selector of ['.operon-priority-column-header', '.operon-priority-row']) {
		assertCssRuleContains(
			'styles.css',
			selector,
			['display: grid;', 'grid-template-columns: 56px 40px minmax(140px, 1fr) 52px 132px;', 'gap: 8px;'],
			'priority header and rows must share the same settings grid columns',
		);
	}
	assertCssRuleContains(
		'styles.css',
		'.operon-pipeline-card',
		['max-width: 100%;', 'box-sizing: border-box;', 'overflow-x: clip;'],
		'pipeline cards must stay full-width and clipped inside settings panes',
	);
	assertCssRuleContains(
		'styles.css',
		'.operon-pipeline-description-row',
		['margin-bottom: 12px;'],
		'pipeline description textarea must stay separated from the status grid',
	);

	assertEqual(
		'settings.pipelineDescriptionPlaceholder',
		enLocale.settings.pipelineDescriptionPlaceholder,
		'Describe when humans and agents should use this pipeline...',
	);
	assertEqual(
		'settings.priorityDescriptionPlaceholder',
		enLocale.settings.priorityDescriptionPlaceholder,
		'Describe when humans and agents should use this priority...',
	);
	assertEqual(
		'settings.pipelineDescriptionAria',
		enLocale.settings.pipelineDescriptionAria,
		'Pipeline description: {{name}}',
	);
	assertEqual(
		'settings.priorityDescriptionAria',
		enLocale.settings.priorityDescriptionAria,
		'Priority description: {{name}}',
	);

	if (!settingsSource.includes("const descriptionRow = row.createDiv('operon-priority-description-row');")) {
		fail('src/ui/settings-tab.ts: priority description textarea must remain inside the priority row');
	}
	if (!settingsSource.includes("const descriptionRow = card.createDiv('operon-pipeline-description-row');")) {
		fail('src/ui/settings-tab.ts: pipeline description textarea must remain directly inside the pipeline card');
	}
	if (!settingsSource.includes("placeholder: t('settings', 'priorityDescriptionPlaceholder')")) {
		fail('src/ui/settings-tab.ts: priority description textarea must use the localized placeholder');
	}
	if (!settingsSource.includes("placeholder: t('settings', 'pipelineDescriptionPlaceholder')")) {
		fail('src/ui/settings-tab.ts: pipeline description textarea must use the localized placeholder');
	}
	if (settingsSource.includes('operon-priority-description-label') || settingsSource.includes('operon-pipeline-description-label')) {
		fail('src/ui/settings-tab.ts: description textareas should not reintroduce visible Description labels');
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

function checkTrackerSessionNoteActionContract() {
	assertIncludes(
		'styles.css',
		'.operon-tracker-session-modal-actions-primary {\n\tdisplay: flex;\n\talign-items: center;\n\tmargin-inline-start: auto;',
		'tracker session primary actions must stay right aligned',
	);
	assertIncludes(
		'styles.css',
		'.operon-tracker-session-modal-actions {\n\tdisplay: flex;\n\talign-items: center;\n\tjustify-content: space-between;\n\tflex-wrap: wrap;',
		'tracker session actions must wrap on narrow modal surfaces',
	);
	assertIncludes(
		'styles.css',
		'button.operon-tracker-session-modal-note {\n\tdisplay: inline-flex;',
		'tracker session Note action must retain its visible icon control',
	);
	assertNoMatch(
		'styles.css',
		/\.operon-tracker-session-modal-note[^{}]*\{[^{}]*(?:display:\s*none|visibility:\s*hidden|opacity:\s*0(?![.\d]))/u,
		'tracker session Note action must not be hidden',
	);
}

function checkCanonicalOnlyStorageContract() {
	const productionFiles = [
		'main.ts',
		...listFiles('src/storage', file => file.endsWith('.ts')),
		'src/ui/settings-tab.ts',
		'src/ui/settings/settings-search-registry.ts',
		...listFiles('i18n/locales', file => file.endsWith('.json')),
	];
	const forbiddenTokens = [
		'legacyStorageCleanup',
		'storageMigrationPath',
		'legacyStorageRetired',
		'legacyFallbackEnabled',
		'legacyFilePath',
		'setLegacyFallbackEnabled',
		'readLegacyOperonStorageSnapshot',
		'buildOperonDataPackageFromLegacySnapshot',
		'operon-data-package-migration',
		'storagePaths.legacy',
		'cleanupLegacyStorageFromSettings',
		'getLegacyStorageCleanupStatus',
		'getCachedLegacyStorageCleanupStatus',
	];
	const legacyOperonPathLiteral = /(['"`])\.operon(?:\/|(?=\1))/u;

	if (fs.existsSync(path.join(rootDir, 'src/storage/operon-data-package-migration.ts'))) {
		fail('src/storage/operon-data-package-migration.ts: legacy data package migration reader must not exist');
	}

	for (const file of productionFiles) {
		const source = readText(file);
		for (const token of forbiddenTokens) {
			if (source.includes(token)) {
				fail(`${file}: canonical-only storage contract must not reference ${token}`);
			}
		}
		if (legacyOperonPathLiteral.test(source)) {
			fail(`${file}: canonical-only storage contract must not reference vault-root .operon path literals`);
		}
	}
}

if (guardScope === 'plugin') {
	compareLocaleFiles();
	checkVersionAndAssets();
	checkPluginReleasePolicy();
	checkRepositoryIgnorePolicy();
	checkContinuousIntegrationWorkflow();
	checkCodeqlWorkflow();
	checkReleaseWorkflow();
	checkWorkflowSecurityPolicy();
	checkPublicSourceHygiene();
	checkCssScorecard();
	checkCalendarHoverGuideContract();
	checkSettingsDescriptionTextareaGuards();
	checkAuditedRawStrings();
	checkTrackerSessionNoteActionContract();
	checkCanonicalOnlyStorageContract();
} else {
	checkCliCompatibilityEvidence();
	checkWorkflowSecurityPolicy();
}

if (failures.length > 0) {
	console.error('Operon release guard failed:');
	for (const failure of failures) {
		console.error(`- ${failure}`);
	}
	process.exit(1);
}

console.log(`Operon release guard passed (${guardScope}).`);
