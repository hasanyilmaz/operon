import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
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
	for (const renderedBinding of [
		'getDeveloperApiGrantApprovalCapabilities(grant)',
		'new Set(reactivationCapabilities)',
		'updateApprovalButton()',
		'const showsApprovalControls',
		"if (grant.state !== 'suspended')",
		"if (grant.state === 'suspended' || (!showsApprovalControls && grant.state !== 'revoked'))",
		"t('settings', 'developerApiGrantedCapabilities')",
		"t('settings', 'repeatScopePending')",
		'grant.suspensionReason',
		"grant.suspensionReason === 'consumer-version-invalid'",
		'!grant.approvalBinding',
		'integration.approve(grant.approvalBinding, [...selected])',
	]) {
		assert.ok(renderer.includes(renderedBinding), `missing bound Developer API approval UI: ${renderedBinding}`);
	}
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

	const mainSource = readFileSync('main.ts', 'utf8');
	const integrationStart = mainSource.indexOf('private buildDeveloperApiSettingsIntegration');
	const integrationEnd = mainSource.indexOf('\n\tprivate ', integrationStart + 1);
	const integrationSource = mainSource.slice(integrationStart, integrationEnd);
	const getLiveConsumer = integrationSource.indexOf('getCurrentConsumer(listedGrant.consumerId)');
	const reconcileIdentity = integrationSource.indexOf('reconcileForApproval(consumer)');
	const exactLiveVersion = integrationSource.indexOf(
		'grant.observedConsumerVersion ?? grant.consumerVersion',
	);
	const exactLiveIdentity = integrationSource.indexOf('consumer.name === grant.consumerName');
	const createBinding = integrationSource.indexOf('createApprovalBinding(grant, consumer)');
	assert.ok(getLiveConsumer >= 0, 'Settings must reverify the live consumer before rendering approval');
	assert.ok(
		reconcileIdentity > getLiveConsumer,
		'Settings must reconcile the live consumer before constructing an approval binding',
	);
	assert.ok(
		exactLiveVersion > reconcileIdentity && exactLiveIdentity > reconcileIdentity,
		'Settings must require the reconciled exact live name and version',
	);
	assert.ok(
		createBinding > exactLiveVersion && createBinding > exactLiveIdentity,
		'Settings must create an approval binding only after exact live identity checks',
	);
});
