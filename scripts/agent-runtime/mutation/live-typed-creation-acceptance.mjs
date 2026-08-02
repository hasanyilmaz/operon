#!/usr/bin/env node

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requirePublishedCliExecutable } from '../cli/require-published-cli-executable.mjs';

const TYPED_CREATE_FEATURES = [
	'exact-inline-placement',
	'exact-file-target',
	'deterministic-file-template',
	'file-body-replacement',
	'same-source-task-graph',
	'cross-source-parent-related',
];
const GRAPH_TRANSACTION_FEATURES = [
	'vault-wide-graph-transaction',
	'compare-aware-compensation',
	'same-plan-safe-continuation',
	'cross-source-reciprocal-dependency',
];
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDirectory, '../../..');
const expectedTempRoot = realpathSync(process.platform === 'darwin' ? '/private/tmp' : '/tmp');
const requestedVault = process.argv[2] ?? path.join(
	expectedTempRoot,
	'operon-agent-runtime-phase1-v1',
);
const vaultPath = realpathSync(requestedVault);
const vaultStat = lstatSync(vaultPath);
assert.equal(vaultStat.isDirectory(), true, 'Live acceptance target must be a directory.');
assert.equal(vaultStat.isSymbolicLink(), false, 'Live acceptance target cannot be a symlink.');
assert.equal(path.dirname(vaultPath), expectedTempRoot, 'Live acceptance target must stay in temp.');
assert.match(path.basename(vaultPath), /^operon-agent-runtime-phase1-[A-Za-z0-9._-]+$/u);

const cliConfigRoot = mkdtempSync(path.join(tmpdir(), 'operon-a5-typed-cli-'));
process.on('exit', () => {
	rmSync(cliConfigRoot, { recursive: true, force: true });
});
const cliArtifact = await requirePublishedCliExecutable(pluginRoot);
const inlinePath = 'Daily/2026-01-15.md';

const manifest = runCli(['manifest']);
assert.equal(manifest.ok, true);
const manifestCreate = manifest.result?.convenienceContracts?.['task.create'];
assert.equal(manifestCreate?.typedCreateVersion, 1);
assert.deepEqual(manifestCreate?.typedCreateFeatures, TYPED_CREATE_FEATURES);
assert.equal(manifestCreate?.graphTransactionVersion, 1);
assert.deepEqual(manifestCreate?.graphTransactionFeatures, GRAPH_TRANSACTION_FEATURES);

const catalog = runCli(['catalog']);
assert.equal(catalog.result?.policies?.creation?.typedCreateVersion, 1);
assert.deepEqual(
	catalog.result?.policies?.creation?.typedCreateFeatures,
	TYPED_CREATE_FEATURES,
);
assert.equal(catalog.result?.policies?.creation?.graphTransactionVersion, 1);
assert.deepEqual(
	catalog.result?.policies?.creation?.graphTransactionFeatures,
	GRAPH_TRANSACTION_FEATURES,
);
const templateCandidates = catalog.result?.policies?.creation?.fileTaskTemplateCandidates ?? [];
const folderTemplate = templateCandidates.find(candidate => (
	candidate.kind === 'folder' && candidate.sourcePath === 'Templates/Fixture Task.md'
));
assert.ok(folderTemplate, 'Sanitized vault must publish the static folder template candidate.');
for (const candidate of templateCandidates) {
	assert.equal('content' in candidate, false);
	assert.equal('body' in candidate, false);
	assert.equal('revision' in candidate, false);
}

const firstLineCandidate = readPlacementCandidate(inlinePath);
const suffix = randomUUID().slice(0, 8);
const sameSourcePreview = previewCreate({
	operation: 'create',
	items: [{
		itemRef: 'child',
		description: `A5 same source child ${suffix}`,
		target: {
			representation: 'inline',
			mode: 'exact-path',
			filePath: inlinePath,
		},
		fields: [],
		parent: { kind: 'created', itemRef: 'parent' },
	}, {
		itemRef: 'parent',
		description: `A5 same source parent ${suffix}`,
		target: {
			representation: 'inline',
			mode: 'exact-path',
			filePath: inlinePath,
			lineNumber: firstLineCandidate,
		},
		fields: [],
		dependencies: [{
			relation: 'blocks',
			target: { kind: 'created', itemRef: 'child' },
		}],
	}],
}, 'A5 exact-line and same-source graph acceptance.');
assert.equal(sameSourcePreview.result?.plan?.riskLevel, 'routine');
assert.equal(sameSourcePreview.result?.plan?.atomicGroups.length, 1);
const sameSourceApplied = applyPreview(sameSourcePreview);
assert.equal(sameSourceApplied.result?.status, 'applied');
const sameSourceEffects = new Map(
	sameSourcePreview.result.plan.createEffects.map(effect => [effect.itemRef, effect]),
);
const createdParent = readTask(sameSourceEffects.get('parent').operonId);
const createdChild = readTask(sameSourceEffects.get('child').operonId);
assert.equal(createdParent.locator.filePath, inlinePath);
assert.equal(createdChild.locator.filePath, inlinePath);
assert.equal(createdChild.relationships.parentOperonId, createdParent.identity.operonId);
assert.equal(
	createdParent.relationships.blockingOperonIds.includes(createdChild.identity.operonId),
	true,
);

const mixedParentDescription = `A5 mixed File parent ${suffix}`;
const mixedParentPath = `Tasks/${mixedParentDescription}.md`;
const mixedParentPreview = previewCreate({
	operation: 'create',
	items: [{
		itemRef: 'mixed-parent',
		description: mixedParentDescription,
		target: {
			representation: 'file',
			mode: 'exact-path',
			filePath: mixedParentPath,
		},
		fields: [],
		bodyMarkdown: '# Children\n\nKeep this body.',
	}],
}, 'A5 mixed File parent setup acceptance.');
assert.equal(applyPreview(mixedParentPreview).result?.status, 'applied');
const mixedParentEffect = mixedParentPreview.result.plan.createEffects[0];
const mixedChildLineCandidate = readPlacementCandidate(mixedParentPath);
const mixedChildPreview = previewCreate({
	operation: 'create',
	items: [{
		itemRef: 'mixed-child',
		description: `A5 mixed inline child ${suffix}`,
		target: {
			representation: 'inline',
			mode: 'exact-path',
			filePath: mixedParentPath,
			lineNumber: mixedChildLineCandidate,
		},
		fields: [],
		parent: { kind: 'existing', operonId: mixedParentEffect.operonId },
	}],
}, 'A5 mixed File parent and inline child postflight acceptance.');
const mixedChildEffect = mixedChildPreview.result.plan.createEffects[0];
assert.equal(applyPreview(mixedChildPreview).result?.status, 'applied');
const mixedChild = readTask(mixedChildEffect.operonId);
assert.equal(mixedChild.relationships.parentOperonId, mixedParentEffect.operonId);
assert.ok(
	mixedChild.locator.lineNumber > mixedChildEffect.locator.lineNumber,
	'Aggregate frontmatter expansion must be verified against the final inline line.',
);

const fileDescription = `A5 template body ${suffix}`;
const filePath = `Tasks/${fileDescription}.md`;
assert.equal(existsSync(path.join(vaultPath, filePath)), false);
const filePreview = previewCreate({
	operation: 'create',
	items: [{
		itemRef: 'file',
		description: fileDescription,
		target: {
			representation: 'file',
			mode: 'exact-path',
			filePath,
			templateId: folderTemplate.id,
		},
		fields: [],
		bodyMarkdown: '# A5 Acceptance\n\nTemplate body replaced through typed stdin.',
	}],
}, 'A5 deterministic template and body replacement acceptance.');
const fileEffect = filePreview.result.plan.createEffects[0];
assert.equal(fileEffect.templateId, folderTemplate.id);
assert.match(fileEffect.templateDigest, /.+/u);
assert.ok(fileEffect.bodyMarkdownSummary?.utf8Bytes > 0);
const planRef = filePreview.client.planRef;
const planFile = path.join(cliConfigRoot, 'plans', `${planRef}.json`);
const storedPlan = JSON.parse(readFileSync(planFile, 'utf8'));
const fileApplied = applyPreview(filePreview);
assert.equal(fileApplied.result?.status, 'applied');
const fileTask = readTask(fileEffect.operonId);
assert.match(fileTask.sourceMarkdown, /# A5 Acceptance/u);
assert.match(fileTask.sourceMarkdown, /Template body replaced through typed stdin\./u);

storedPlan.applyRequest = {
	contractVersion: 1,
	requestId: `a5-recover-${randomUUID()}`,
	kind: 'mutation-apply',
	plan: storedPlan.plan,
	authorization: {
		basis: 'user-explicit-request',
		reason: 'A5 same-plan recovery acceptance.',
	},
	idempotencyKey: storedPlan.idempotencyKey,
	acknowledgements: [],
};
writeFileSync(planFile, `${JSON.stringify(storedPlan, null, 2)}\n`, { mode: 0o600 });
chmodSync(planFile, 0o600);
const recovered = runCli(['plan', 'recover', planRef]);
assert.equal(recovered.result?.status, 'already-applied');
assert.equal(recovered.result?.postflight?.status, 'receipt-replay');

const crossLineCandidate = readPlacementCandidate(inlinePath);
const parentDescription = `A5 cross source parent ${suffix}`;
const relatedDescription = `A5 related target ${suffix}`;
const parentPath = `Tasks/${parentDescription}.md`;
const relatedPath = `Tasks/${relatedDescription}.md`;
const crossPreview = previewCreate({
	operation: 'create',
	items: [{
		itemRef: 'child',
		description: `A5 cross source child ${suffix}`,
		target: {
			representation: 'inline',
			mode: 'exact-path',
			filePath: inlinePath,
			lineNumber: crossLineCandidate,
		},
		fields: [],
		parent: { kind: 'created', itemRef: 'parent' },
		related: [{ kind: 'created', itemRef: 'related-target' }],
	}, {
		itemRef: 'related-target',
		description: relatedDescription,
		target: {
			representation: 'file',
			mode: 'exact-path',
			filePath: relatedPath,
		},
		fields: [],
	}, {
		itemRef: 'parent',
		description: parentDescription,
		target: {
			representation: 'file',
			mode: 'exact-path',
			filePath: parentPath,
		},
		fields: [],
	}],
}, 'A5 confirmed cross-source parent and related acceptance.');
const crossPlan = crossPreview.result.plan;
assert.equal(crossPlan.riskLevel, 'elevated');
assert.equal(crossPlan.requiresConfirmation, true);
assert.ok(crossPlan.warnings.some(warning => warning.code === 'cross-source-graph-partial-risk'));
assert.ok(
	crossPlan.requiredAcknowledgements.some(code => code.includes('cross-source-graph-partial-risk')),
);
assert.equal(crossPlan.atomicGroups.at(-1)?.groupId, `task-source:${inlinePath}`);
const shown = runCli(['plan', 'show', crossPreview.client.planRef]);
assert.match(shown.result?.plan?.confirmationToken, /^[a-f0-9]{64}$/u);
const crossApplied = applyPreview(crossPreview, shown.result.plan.confirmationToken);
assert.equal(crossApplied.result?.status, 'applied');
const crossEffects = new Map(crossPlan.createEffects.map(effect => [effect.itemRef, effect]));
const crossChild = readTask(crossEffects.get('child').operonId);
assert.equal(crossChild.relationships.parentOperonId, crossEffects.get('parent').operonId);
assert.equal(
	crossChild.relationships.relatedOperonIds.includes(crossEffects.get('related-target').operonId),
	true,
);

const dependencyDescription = `A5 dependency target ${suffix}`;
const dependencyPreview = previewCreate({
	operation: 'create',
	items: [{
		itemRef: 'contract',
		description: `A5 dependency source ${suffix}`,
		target: {
			representation: 'inline',
			mode: 'exact-path',
			filePath: inlinePath,
		},
		fields: [],
		dependencies: [{
			relation: 'blocks',
			target: { kind: 'created', itemRef: 'acceptance' },
		}],
	}, {
		itemRef: 'acceptance',
		description: dependencyDescription,
		target: {
			representation: 'file',
			mode: 'exact-path',
			filePath: `Tasks/${dependencyDescription}.md`,
		},
		fields: [],
	}],
}, 'A6 cross-source reciprocal dependency transaction acceptance.');
assert.equal(dependencyPreview.result?.plan?.riskLevel, 'elevated');
assert.equal(dependencyPreview.result?.plan?.requiresConfirmation, true);
const dependencyShown = runCli(['plan', 'show', dependencyPreview.client.planRef]);
const dependencyApplied = applyPreview(
	dependencyPreview,
	dependencyShown.result.plan.confirmationToken,
);
assert.equal(dependencyApplied.result?.status, 'applied');
const dependencyEffects = new Map(
	dependencyPreview.result.plan.createEffects.map(effect => [effect.itemRef, effect]),
);
const dependencySource = readTask(dependencyEffects.get('contract').operonId);
const dependencyTarget = readTask(dependencyEffects.get('acceptance').operonId);
assert.equal(
	dependencySource.relationships.blockingOperonIds.includes(
		dependencyTarget.identity.operonId,
	),
	true,
);
assert.equal(
	dependencyTarget.relationships.blockedByOperonIds.includes(
		dependencySource.identity.operonId,
	),
	true,
);

process.stdout.write(`${JSON.stringify({
	status: 'ok',
	vault: path.basename(vaultPath),
	manifestGate: true,
	catalogGate: true,
	templateCandidatesContentFree: true,
	exactLineApplied: true,
	templateBodyApplied: true,
	sameSourceGraphAtomic: true,
	mixedFileParentInlineChildShiftVerified: true,
	crossSourceParentRelatedConfirmed: true,
	crossSourceDependencyTransactional: true,
	recoveryStatus: recovered.result.status,
}, null, 2)}\n`);

function readPlacementCandidate(filePath) {
	const context = runCli(['context'], {
		contractVersion: 1,
		requestId: `a5-placement-${randomUUID()}`,
		kind: 'context',
		consistency: 'live-verified',
		purpose: 'mutation-readiness',
		projection: 'placement-candidates',
		placement: { mode: 'lines', filePath },
		limit: 64,
	});
	assert.equal(context.result?.ok, true);
	assert.equal(context.result?.placement?.mode, 'lines');
	const candidate = context.result.placement.lines[0]?.locator?.lineNumber;
	assert.equal(Number.isSafeInteger(candidate), true, 'A live blank-line candidate is required.');
	return candidate;
}

function previewCreate(spec, reason, allowFailure = false) {
	return runCli(['task', 'create'], {
		contractVersion: 1,
		kind: 'mutation-intent',
		reason,
		spec,
	}, allowFailure);
}

function applyPreview(preview, confirmationToken) {
	return runCli([
		'plan',
		'apply',
		preview.client.planRef,
		...(confirmationToken ? ['--confirm', confirmationToken] : []),
	]);
}

function readTask(operonId) {
	const result = runCli(['task', 'get'], {
		contractVersion: 1,
		requestId: `a5-get-${randomUUID()}`,
		kind: 'task-get',
		selector: { kind: 'operon-id', operonId },
		consistency: 'live-verified',
		include: ['source-markdown'],
	});
	assert.equal(result.result?.ok, true, `Task ${operonId} must be live-readable.`);
	return result.result.task;
}

function runCli(command, input, allowFailure = false) {
	const isLocalCommand = command[0] === 'manifest' || command[0] === 'plan';
	const result = spawnSync(
		process.execPath,
		[
			cliArtifact,
			...command,
			...(isLocalCommand ? [] : ['--vault', vaultPath]),
			...(command[0] === 'plan' && ['apply', 'recover'].includes(command[1])
				? ['--timeout-ms', '30000']
				: []),
			...(input === undefined ? [] : ['--input', '-']),
			'--json',
		],
		{
			cwd: pluginRoot,
			encoding: 'utf8',
			env: {
				...process.env,
				OPERON_CONFIG_HOME: cliConfigRoot,
			},
			...(input === undefined ? {} : { input: `${JSON.stringify(input)}\n` }),
			maxBuffer: 4 * 1_024 * 1_024,
		},
	);
	if (!allowFailure) {
		assert.equal(result.status, 0, result.stderr || result.stdout || 'Operon CLI failed.');
	} else {
		assert.notEqual(result.status, 0, 'The expected capability blocker must fail.');
	}
	return JSON.parse(result.stdout);
}
