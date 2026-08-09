import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

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
	assertEqual('CI seal classifier id', validationSteps.get('Classify exact evidence-seal commit')?.id, 'evidence_seal');
	assertEqual('CI heavy validation condition', validationSteps.get('Run validation')?.if, "github.event_name == 'push' && steps.evidence_seal.outputs.mode != 'evidence-seal'");
	assertEqual('CI seal validation condition', validationSteps.get('Verify exact evidence seal and hosted proof')?.if, "github.event_name == 'push' && steps.evidence_seal.outputs.mode == 'evidence-seal'");
	for (const command of ['npm run release:evidence-seal:check', 'npm run release:hosted-evidence:check', 'npm run agent-runtime:external-cli:public-proof', 'npm run release:freeze:check']) {
		if (!validationSteps.get('Verify exact evidence seal and hosted proof')?.run?.includes(command)) fail(`CI seal step must execute ${command}`);
	}
	const windowsSteps = new Map((windows?.steps ?? []).map(step => [step.name, step]));
	assertEqual('Windows seal validation condition', windowsSteps.get('Verify exact evidence seal')?.if, "github.event_name == 'push' && steps.evidence_seal.outputs.mode == 'evidence-seal'");
	assertEqual('Windows heavy validation condition', windowsSteps.get('Run validation')?.if, "github.event_name == 'push' && steps.evidence_seal.outputs.mode != 'evidence-seal'");
	const installIndex = workflowText.indexOf('run: npm ci');
	const buildIndex = workflowText.indexOf('run: npm run build');
	const classifyIndex = workflowText.indexOf('release:evidence-seal:classify');
	const auditPolicyIndex = workflowText.indexOf('run: npm run release:audit-policy');
	const validationIndex = workflowText.indexOf('run: npm run check');
	const releaseGuardIndex = workflowText.indexOf('run: npm run release:guard');
	const evidenceSealIndex = workflowText.indexOf('npm run release:evidence-seal:check');
	const hostedEvidenceIndex = workflowText.indexOf('npm run release:hosted-evidence:check');
	const publicProofIndex = workflowText.indexOf('npm run agent-runtime:external-cli:public-proof');
	const candidateFreezeIndex = workflowText.indexOf('run: npm run candidate:freeze:check');

	assertIncludes(workflow, 'node-version: "24.18.0"', 'CI must use the exact canonical Node release baseline');
	assertIncludes(workflow, 'npm install --global npm@11.12.1', 'CI must pin the canonical npm version');
	assertIncludes(workflow, 'actions: read', 'CI must read exact hosted release evidence');
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
	assertIncludes(
		workflow,
		'run: npm run candidate:freeze:check',
		'CI main pushes must verify candidate evidence without requiring accepted-release artifact identity',
	);
	for (const command of [
		'release:evidence-seal:classify',
		'npm run release:evidence-seal:check',
		'npm run release:hosted-evidence:check',
		'npm run agent-runtime:external-cli:public-proof',
		'npm run release:freeze:check',
	]) assertIncludes(workflow, command, `CI evidence-seal lane must run ${command}`);
	if (!/- name: Verify candidate Public V1 freeze\s+if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main' && steps\.evidence_seal\.outputs\.mode != 'evidence-seal'\s+run: npm run candidate:freeze:check/u.test(workflowText)) {
		fail('CI must bind the candidate evidence check to exact main-branch pushes');
	}
	if (!/- name: Run validation\s+env:\s+OPERON_TASK_FINDER_PERFORMANCE_MODE: diagnostic\s+run: npm run check/u.test(workflowText)) {
		fail('CI must keep shared-runner Task Finder timings diagnostic while reference runs enforce performance gates');
	}
	assertIncludes(
		workflow,
		"if: github.event_name == 'push' && steps.evidence_seal.outputs.mode != 'evidence-seal'",
		'CI must skip the heavy suite only for a strictly classified evidence seal',
	);
	assertNoMatch(
		workflow,
		/OPERON_PLUGIN_RELEASE_VALIDATION/u,
		'CI must not enable plugin-release tag validation',
	);
	if (
		installIndex < 0
		|| buildIndex < installIndex
		|| classifyIndex < buildIndex
		|| auditPolicyIndex < classifyIndex
		|| validationIndex < auditPolicyIndex
		|| releaseGuardIndex < validationIndex
		|| evidenceSealIndex < releaseGuardIndex
		|| hostedEvidenceIndex < evidenceSealIndex
		|| publicProofIndex < hostedEvidenceIndex
		|| candidateFreezeIndex < publicProofIndex
	) {
		fail('CI must run install, artifact build, classification, audit, guarded validation, seal proof, and candidate evidence in order');
	}
}

function checkCodeqlWorkflow() {
	const workflow = '.github/workflows/codeql.yml';
	const workflowText = readText(workflow);
	const document = readWorkflow(workflow);
	assertEqual('CodeQL gate name', document.jobs?.gate?.name, 'CodeQL gate');
	assertEqual('CodeQL analysis seal condition', document.jobs?.analyze?.if, "needs.classify.outputs.mode != 'evidence-seal'");
	assertEqual('CodeQL gate dependency result condition', document.jobs?.gate?.if, "always() && needs.classify.result == 'success'");
	if (!Array.isArray(document.jobs?.gate?.needs) || JSON.stringify(document.jobs.gate.needs) !== JSON.stringify(['classify', 'analyze'])) {
		fail('CodeQL gate must depend exactly on classification and analysis');
	}
	const gateRun = document.jobs?.gate?.steps?.find(step => step.name === 'Require the correct CodeQL lane')?.run ?? '';
	for (const assertion of ['test "$ANALYZE_RESULT" = skipped', 'test "$ANALYZE_RESULT" = success']) {
		if (!gateRun.includes(assertion)) fail(`CodeQL gate must enforce ${assertion}`);
	}
	assertIncludes(workflow, 'name: CodeQL gate', 'CodeQL must expose the stable release evidence gate');
	assertIncludes(workflow, 'release:evidence-seal:classify', 'CodeQL must classify exact main evidence-seal commits');
	assertIncludes(workflow, "if: needs.classify.outputs.mode != 'evidence-seal'", 'CodeQL analysis must be skipped only for a strict evidence seal');
	assertIncludes(workflow, 'test "$ANALYZE_RESULT" = skipped', 'CodeQL gate must require skipped analysis for an evidence seal');
	assertIncludes(workflow, 'test "$ANALYZE_RESULT" = success', 'CodeQL gate must require successful analysis for candidates');
	assertIncludes(workflow, 'node-version: "24.18.0"', 'CodeQL seal classification must use canonical Node');
	assertIncludes(workflow, 'npm install --global npm@11.12.1', 'CodeQL seal classification must pin canonical npm');
}

function checkReleaseWorkflow() {
	const workflow = '.github/workflows/release.yml';
	const workflowText = readText(workflow);
	const document = readWorkflow(workflow);
	const steps = document.jobs?.['build-release']?.steps ?? [];
	const stepNames = steps.map(step => step.name);
	const requiredOrder = [
		'Require exact evidence-seal tag target',
		'Verify release dependency audit policy',
		'Verify release guard',
		'Verify exact evidence seal',
		'Verify hosted evidence online',
		'Verify exact published CLI public proof',
		'Verify final accepted Public V1 freeze',
	];
	let previous = -1;
	for (const name of requiredOrder) {
		const index = stepNames.indexOf(name);
		if (index <= previous) fail(`release workflow parsed step order invalid at ${name}`);
		previous = index;
	}
	const releaseSteps = new Map(steps.map(step => [step.name, step]));
	assertEqual('release strict seal command', releaseSteps.get('Verify exact evidence seal')?.run, 'npm run release:evidence-seal:check');
	assertEqual('release hosted evidence command', releaseSteps.get('Verify hosted evidence online')?.run, 'npm run release:hosted-evidence:check');
	assertEqual('release public CLI proof command', releaseSteps.get('Verify exact published CLI public proof')?.run, 'npm run agent-runtime:external-cli:public-proof');
	assertEqual('release final freeze command', releaseSteps.get('Verify final accepted Public V1 freeze')?.run, 'npm run release:freeze:check');
	const installIndex = workflowText.indexOf('run: npm ci');
	const buildIndex = workflowText.indexOf('run: npm run build');
	const classifyIndex = workflowText.indexOf('release:evidence-seal:classify');
	const auditPolicyIndex = workflowText.indexOf('run: npm run release:audit-policy');
	const evidenceSealIndex = workflowText.indexOf('run: npm run release:evidence-seal:check');
	const hostedEvidenceIndex = workflowText.indexOf('run: npm run release:hosted-evidence:check');
	const publicProofIndex = workflowText.indexOf('run: npm run agent-runtime:external-cli:public-proof');
	const acceptedFreezeIndex = workflowText.indexOf('run: npm run release:freeze:check');
	const releaseGuardIndex = workflowText.indexOf('run: npm run release:guard');
	const exactTagIndex = workflowText.indexOf('name: Verify exact release tag target');
	const existingReleaseIndex = workflowText.indexOf('name: Refuse an existing GitHub release');
	const attestationIndex = workflowText.indexOf('uses: actions/attest@');
	const releaseCreateIndex = workflowText.indexOf('gh release create');

	assertIncludes(workflow, 'id-token: write', 'release workflow must grant OIDC token permission for artifact attestations');
	assertIncludes(workflow, 'attestations: write', 'release workflow must grant artifact attestation permission');
	assertIncludes(workflow, 'actions: read', 'release workflow must verify hosted evidence online');
	assertIncludes(workflow, 'node-version: "24.18.0"', 'release workflow must use the exact canonical Node release baseline');
	assertIncludes(workflow, 'npm install --global npm@11.12.1', 'release workflow must pin the canonical npm version');
	assertIncludes(
		workflow,
		'run: npm run release:audit-policy',
		'release workflow must enforce the canonical dependency audit policy',
	);
	assertIncludes(
		workflow,
		'run: npm run release:freeze:check',
		'release workflow must require an accepted Public V1 freeze',
	);
	assertIncludes(workflow, 'release:evidence-seal:classify', 'release workflow must require an exact evidence-seal tag target');
	assertIncludes(workflow, 'run: npm run release:evidence-seal:check', 'release workflow must validate the exact evidence seal');
	assertIncludes(workflow, 'run: npm run release:hosted-evidence:check', 'release workflow must verify hosted evidence online');
	assertIncludes(workflow, 'run: npm run agent-runtime:external-cli:public-proof', 'release workflow must reverify the exact published CLI proof');
	assertNoMatch(workflow, /run:\s+npm run check(?:\s|$)/u, 'release workflow must not replay the heavy product suite after an accepted evidence seal');
	if (
		exactTagIndex < 0
		|| existingReleaseIndex < exactTagIndex
		|| installIndex < existingReleaseIndex
		|| buildIndex < installIndex
		|| classifyIndex < buildIndex
		|| auditPolicyIndex < classifyIndex
		|| releaseGuardIndex < auditPolicyIndex
		|| evidenceSealIndex < releaseGuardIndex
		|| hostedEvidenceIndex < evidenceSealIndex
		|| publicProofIndex < hostedEvidenceIndex
		|| acceptedFreezeIndex < publicProofIndex
		|| attestationIndex < acceptedFreezeIndex
		|| releaseCreateIndex < attestationIndex
	) {
		fail('release workflow must preserve exact-tag, immutable-release, evidence-seal, attestation, and publish ordering');
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

function checkWorkflowSecurityPolicy() {
	const workflowRoot = path.join(rootDir, '.github/workflows');
	const workflows = fs.readdirSync(workflowRoot)
		.filter(file => file.endsWith('.yml') || file.endsWith('.yaml'))
		.sort();
	const exactCodeqlRevision = 'bce182f857edf1feab116e9795a3393d21977282';
	const exactCheckoutRevision = '3d3c42e5aac5ba805825da76410c181273ba90b1';
	const exactSetupNodeRevision = '820762786026740c76f36085b0efc47a31fe5020';
	const exactWorkflowPermissions = new Map([
		['ci.yml', ['actions: read', 'contents: read']],
		['cli-external-compatibility.yml', ['contents: read']],
		['codeql.yml', ['actions: read', 'contents: read', 'security-events: write']],
		['release.yml', ['actions: read', 'contents: write', 'id-token: write', 'attestations: write']],
	]);

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
	if (exactWorkflowPermissions.size !== workflows.length) {
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
	for (const relativePath of retiredCliPaths) {
		if (fs.existsSync(path.join(rootDir, relativePath))) {
			fail(`${relativePath}: retired embedded CLI path must remain absent`);
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

function checkReleaseAuditPolicy() {
	for (const file of [
		'contracts/release/dev-audit-policy-v1.json',
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
		'scripts/release/evidence-seal-v3.mjs',
		'scripts/release/evidence-seal-v3.test.mjs',
		'scripts/release/verify-hosted-evidence-v3.mjs',
		'scripts/release/run-published-cli-live-acceptance.mjs',
		'scripts/release/run-published-cli-live-acceptance.test.mjs',
	]) {
		if (!fs.existsSync(path.join(rootDir, file))) {
			fail(`${file}: required release audit-policy artifact is missing`);
		}
	}

	const policy = JSON.parse(readText('contracts/release/dev-audit-policy-v1.json'));
	const expectedPolicy = {
		policyVersion: 2,
		production: {
			maximumVulnerabilities: 0,
		},
		development: {
			maximumVulnerabilities: 0,
			directRoot: 'eslint-plugin-obsidianmd',
			resolvedAdvisory: {
				packageName: 'brace-expansion',
				url: 'https://github.com/advisories/GHSA-mh99-v99m-4gvg',
				allowedInstalledVersions: ['1.1.18', '2.1.4', '5.0.9'],
			},
			forbiddenRuntimePackages: [
				'@eslint/config-array',
				'@eslint/eslintrc',
				'@microsoft/eslint-plugin-sdl',
				'brace-expansion',
				'eslint',
				'eslint-plugin-import',
				'eslint-plugin-json-schema-validator',
				'eslint-plugin-n',
				'eslint-plugin-obsidianmd',
				'eslint-plugin-react',
				'minimatch',
			],
		},
	};
	if (JSON.stringify(policy) !== JSON.stringify(expectedPolicy)) {
		fail('contracts/release/dev-audit-policy-v1.json must exactly match the approved clean audit policy');
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
	const normalFreezeIndex = normalCheckCommands.indexOf('npm run release:freeze:test');
	if (normalBuildIndexes.length !== 1 || normalFreezeIndex < 0 || normalBuildIndexes[0] >= normalFreezeIndex) {
		fail('package.json: normal validation must build production artifacts before release freeze tests');
	}
	for (const command of [
		'npm run release:audit-policy:test',
		'npm run release:notes:test',
		'npm run release:freeze:test',
		'npm run release:external-live:test',
		'npm run docs:public-v1:test',
	]) {
		if (!packageText.includes(command)) {
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
		'"candidate:freeze:check": "node scripts/release/check-candidate-freeze-registry.mjs"',
		'package scripts must expose the fail-closed candidate evidence-registry check',
	);
	assertIncludes(
		'package.json',
		'"release:freeze:check:historical": "node scripts/release/check-release-freeze-registry.mjs"',
		'package scripts must preserve the historical append-only release-freeze registry check',
	);
	assertIncludes(
		'package.json',
		'"release:freeze:check": "npm run release:evidence-seal:check"',
		'package scripts must bind the final release freeze gate to the strict evidence seal',
	);
	for (const script of [
		'"release:evidence-seal:write": "node scripts/release/evidence-seal-v3.mjs write"',
		'"release:evidence-seal:classify": "node scripts/release/evidence-seal-v3.mjs classify"',
		'"release:evidence-seal:check": "node scripts/release/evidence-seal-v3.mjs check"',
		'"release:evidence-seal:test": "node --test scripts/release/evidence-seal-v3.test.mjs"',
		'"release:hosted-evidence:check": "node scripts/release/verify-hosted-evidence-v3.mjs"',
	]) assertIncludes('package.json', script, `package scripts must expose ${script}`);
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
		'normal validation must cover historical freeze writing and append-only registry checking',
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
	const candidateCheck = packageManifest.scripts?.['check:candidate'] ?? '';
	if (!candidateCheck.endsWith('&& npm run candidate:freeze:check')) {
		fail('check:candidate must finish with the candidate evidence-registry check');
	}
	if (candidateCheck.includes('npm run release:freeze:check')) {
		fail('check:candidate must not require exact accepted-release artifact identity');
	}
	if (!(packageManifest.scripts?.['check:local'] ?? '').endsWith('&& npm run release:freeze:check')) {
		fail('check:local must leave the accepted external-freeze check as its final stale gate');
	}
	if (!packageText.includes('"release:audit-policy": "node scripts/check-release-audit-policy.mjs"')) {
		fail('package scripts must expose the canonical release audit-policy check');
	}
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

	assertCssRuleContains(
		'styles.css',
		'.operon-table-header-resize-handle',
		['width: 7px;', 'cursor: col-resize;'],
		'Table column resize handles must remain reachable',
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

compareLocaleFiles();
checkVersionAndAssets();
checkReleaseAuditPolicy();
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
checkCanonicalOnlyStorageContract();

if (failures.length > 0) {
	console.error('Operon release guard failed:');
	for (const failure of failures) {
		console.error(`- ${failure}`);
	}
	process.exit(1);
}

console.log('Operon release guard passed.');
