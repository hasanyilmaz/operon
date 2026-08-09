import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const settingsSource = readFileSync('src/ui/settings-tab.ts', 'utf8');
const registrySource = readFileSync('src/ui/settings/settings-search-registry.ts', 'utf8');

test('declarative settings render the live Developer API grant controls', () => {
	assert.match(
		registrySource,
		/section\('integrations', 'coreGeneral', 'developerApi'/u,
		'Developer API integrations must stay discoverable in the native settings registry',
	);
	assert.match(
		settingsSource,
		/if \(entry\.id === 'integrations\.developerApi'\) \{[\s\S]*?this\.renderDeveloperApiIntegrationContent\(host\);/u,
		'The declarative settings entry must render the same live grant content as the imperative fallback',
	);
	assert.match(
		settingsSource,
		/private renderDeveloperApiIntegrations[\s\S]*?this\.renderDeveloperApiIntegrationContent\(section\);/u,
		'The imperative settings page must share the live grant renderer',
	);
});

test('live Developer API grant controls preserve approval, denial, revocation, and audit actions', () => {
	for (const expected of [
		'integration.listGrants()',
		'integration.approve(grant.consumerId, [...selected])',
		'integration.deny(grant.consumerId)',
		'integration.revoke(grant.consumerId)',
		'integration.listAudit()',
		'integration.clearAudit()',
	]) {
		assert.ok(settingsSource.includes(expected), `missing live Developer API settings action: ${expected}`);
	}
	assert.ok(
		settingsSource.includes("section.createDiv('operon-developer-api-capability-list')"),
		'pending capabilities must remain individually selectable',
	);
});
