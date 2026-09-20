import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
	approveDeveloperApiCapabilities,
	createDeveloperApiGrantApprovalBinding,
	createEmptyDeveloperApiGrantPackage,
	reconcileDeveloperApiConsumerVersion,
	recordDeveloperApiGrantRequest,
	revokeDeveloperApiGrant,
	suspendDeveloperApiGrantForAuditRecovery,
} from '../src/agent-runtime/developer-api/grants';
import { buildDeveloperApiGrantApprovalUiState } from '../src/ui/settings/developer-api-grant-ui-state';
import { mountDeveloperApiDeclarativeSettingsEntryV1 } from '../src/ui/settings/developer-api-settings-route';
import { OPERON_SETTINGS_SEARCH_REGISTRY } from '../src/ui/settings/settings-search-registry';

class SettingsHostFixture {
	readonly classes = new Set<string>();
	readonly operations: string[] = [];
	children: string[] = [];

	empty(): void {
		this.operations.push('empty');
		this.children = [];
	}

	addClass(className: string): void {
		this.operations.push(`addClass:${className}`);
		this.classes.add(className);
	}
}

const NOW = '2026-08-31T12:00:00.000Z';
const LATER = '2026-08-31T12:01:00.000Z';
const consumer = (version = '1.2.3') => ({
	id: 'consumer.settings',
	name: 'Settings Consumer',
	version,
	instanceEpoch: 'settings-instance',
});

test('Developer API approval UI state separates recovery scope and keeps unsafe controls closed', () => {
	const pendingPackage = recordDeveloperApiGrantRequest(
		createEmptyDeveloperApiGrantPackage(),
		consumer(),
		['tasks.query', 'tasks.read'],
		NOW,
	);
	const pendingRecord = pendingPackage.consumersById[consumer().id];
	assert.ok(pendingRecord);
	const pendingBinding = createDeveloperApiGrantApprovalBinding(pendingRecord, consumer());
	assert.ok(pendingBinding);
	assert.deepEqual(buildDeveloperApiGrantApprovalUiState({
		...pendingRecord,
		approvalBinding: pendingBinding,
	}), {
		approvalCapabilities: ['tasks.query', 'tasks.read'],
		reactivationCapabilities: [],
		pendingApprovalCapabilities: ['tasks.query', 'tasks.read'],
		initialSelectedCapabilities: ['tasks.query', 'tasks.read'],
		showsApprovalControls: true,
		showsDeny: true,
		showsRevoke: false,
		approvalDisabled: false,
	});

	let suspendedPackage = approveDeveloperApiCapabilities(
		createEmptyDeveloperApiGrantPackage(),
		consumer(),
		['tasks.read'],
		NOW,
	);
	suspendedPackage = recordDeveloperApiGrantRequest(
		suspendedPackage,
		consumer(),
		['tasks.query', 'tasks.read'],
		LATER,
	);
	const revision = suspendedPackage.consumersById[consumer().id]?.revision ?? -1;
	suspendedPackage = suspendDeveloperApiGrantForAuditRecovery(
		suspendedPackage,
		consumer().id,
		revision,
		LATER,
	);
	const suspendedRecord = suspendedPackage.consumersById[consumer().id];
	assert.ok(suspendedRecord);
	const suspendedBinding = createDeveloperApiGrantApprovalBinding(suspendedRecord, consumer('1.2.4'));
	assert.ok(suspendedBinding);
	const suspendedState = buildDeveloperApiGrantApprovalUiState({
		...suspendedRecord,
		approvalBinding: suspendedBinding,
	});
	assert.deepEqual(suspendedState.reactivationCapabilities, ['tasks.read']);
	assert.deepEqual(suspendedState.pendingApprovalCapabilities, ['tasks.query']);
	assert.deepEqual(suspendedState.initialSelectedCapabilities, ['tasks.read']);
	assert.equal(suspendedState.showsDeny, false);
	assert.equal(suspendedState.showsRevoke, true);
	assert.equal(suspendedState.approvalDisabled, false);
	assert.equal(buildDeveloperApiGrantApprovalUiState({
		...suspendedRecord,
		approvalBinding: null,
	}).approvalDisabled, true);

	const invalidRecord = reconcileDeveloperApiConsumerVersion(
		approveDeveloperApiCapabilities(
			createEmptyDeveloperApiGrantPackage(),
			consumer(),
			['tasks.read'],
			NOW,
		),
		consumer('invalid'),
		['tasks.read'],
		LATER,
	).grantPackage.consumersById[consumer().id];
	assert.ok(invalidRecord);
	const invalidState = buildDeveloperApiGrantApprovalUiState({
		...invalidRecord,
		approvalBinding: null,
	});
	assert.equal(invalidState.showsApprovalControls, false);
	assert.equal(invalidState.showsRevoke, true);

	const revokedRecord = revokeDeveloperApiGrant(suspendedPackage, consumer().id, LATER)
		.consumersById[consumer().id];
	assert.ok(revokedRecord);
	const revokedState = buildDeveloperApiGrantApprovalUiState({
		...revokedRecord,
		approvalBinding: null,
	});
	assert.equal(revokedState.showsApprovalControls, false);
	assert.equal(revokedState.showsDeny, false);
	assert.equal(revokedState.showsRevoke, false);
});

test('Developer API declarative routing is bounded, ordered, and idempotent', () => {
	const unrelatedHost = new SettingsHostFixture();
	let unrelatedRenderCalls = 0;
	assert.equal(mountDeveloperApiDeclarativeSettingsEntryV1(
		'settings.operonDocs',
		unrelatedHost,
		() => { unrelatedRenderCalls += 1; },
	), false);
	assert.deepEqual(unrelatedHost.operations, []);
	assert.deepEqual(unrelatedHost.children, []);
	assert.equal(unrelatedRenderCalls, 0);

	const host = new SettingsHostFixture();
	let renderCalls = 0;
	const render = (renderHost: SettingsHostFixture): void => {
		assert.equal(renderHost, host);
		renderHost.operations.push('render');
		renderHost.children.push('developer-api-panel');
		renderCalls += 1;
	};
	for (let index = 0; index < 2; index += 1) {
		assert.equal(mountDeveloperApiDeclarativeSettingsEntryV1(
			'integrations.developerApi',
			host,
			render,
		), true);
		assert.deepEqual(host.children, ['developer-api-panel']);
	}
	assert.deepEqual(host.operations, [
		'empty',
		'addClass:operon-settings-search-bounded-render',
		'render',
		'empty',
		'addClass:operon-settings-search-bounded-render',
		'render',
	]);
	assert.equal(renderCalls, 2);
	assert.equal(host.classes.has('operon-settings-search-bounded-render'), true);
});

test('Developer API registry discoverability and renderer wiring remain intact', () => {
	const entry = OPERON_SETTINGS_SEARCH_REGISTRY.find(candidate => (
		candidate.id === 'integrations.developerApi'
	));
	assert.ok(entry);
	assert.equal(entry.tabId, 'coreGeneral');
	for (const alias of ['developer API', 'plugins', 'permissions', 'grants', 'audit', 'integration']) {
		assert.equal(entry.aliases?.includes(alias), true, `missing Developer API alias: ${alias}`);
	}

	const source = readFileSync('src/ui/settings-tab.ts', 'utf8');
	const customStart = source.indexOf('private renderSettingsSearchCustomEntry');
	const customEnd = source.indexOf('private getSettingsSearchAliases', customStart);
	const customRenderer = source.slice(customStart, customEnd);
	const routeCall = customRenderer.indexOf('mountDeveloperApiDeclarativeSettingsEntryV1(');
	const liveRendererCall = customRenderer.indexOf('this.renderDeveloperApiIntegrations(host)');
	assert.ok(routeCall >= 0 && liveRendererCall > routeCall);

	const coreStart = source.indexOf('private renderCoreGeneralTab');
	const coreEnd = source.indexOf('private renderBackupRestoreTab', coreStart);
	assert.ok(source.slice(coreStart, coreEnd).includes('this.renderDeveloperApiIntegrations(containerEl)'));

	const rendererStart = source.indexOf('private renderDeveloperApiIntegrations');
	const rendererEnd = source.indexOf('private renderReleaseNotesSettingsCard', rendererStart);
	const renderer = source.slice(rendererStart, rendererEnd);
	for (const action of [
		'integration.listGrants()',
		'integration.approve(grant.approvalBinding, [...selected])',
		'integration.deny(grant.consumerId)',
		'integration.revoke(grant.consumerId)',
		'integration.listAudit()',
		'integration.clearAudit()',
	]) {
		assert.ok(renderer.includes(action), `missing Developer API settings action: ${action}`);
	}
	assert.ok(renderer.includes("description.dataset.operonSettingsSearchId = 'integrations.developerApi'"));
	assert.ok(renderer.includes("grant.state === 'suspended'"));
	assert.ok(renderer.includes('buildDeveloperApiGrantApprovalUiState(grant)'));
	assert.ok(renderer.includes('!grant.approvalBinding || selected.size === 0'));
	assert.ok(renderer.includes("t('settings', 'developerApiGrantedCapabilities')"));
	assert.ok(renderer.includes("t('settings', 'repeatScopePending')"));
	assert.ok(renderer.includes('if (approvalUiState.showsDeny)'));
	assert.ok(renderer.includes('if (approvalUiState.showsRevoke)'));
});
