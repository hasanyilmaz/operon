import assert from 'node:assert/strict';
import test from 'node:test';

import { getExternalModifiedTimeFrontmatterPropertyNames } from '../../../src/core/obsidian-app';

function appWithPlugins(plugins: Record<string, unknown>) {
	return {
		plugins: {
			getPlugin: (pluginId: string) => plugins[pluginId] ?? null,
		},
	} as unknown as Parameters<typeof getExternalModifiedTimeFrontmatterPropertyNames>[0];
}

test('modified-time integrations resolve each supported plugin setting contract', () => {
	const propertyNames = getExternalModifiedTimeFrontmatterPropertyNames(appWithPlugins({
		'update-time-on-edit': { settings: { headerUpdated: 'legacyModified' } },
		'frontmatter-date-manager': { settings: { headerUpdated: 'modification' } },
		'update-time': { settings: { updatedPropertyName: 'updated' } },
	}));

	assert.deepEqual(propertyNames, ['legacyModified', 'modification', 'updated']);
});

test('modified-time integrations deduplicate properties and reject unsafe setting values', () => {
	const propertyNames = getExternalModifiedTimeFrontmatterPropertyNames(appWithPlugins({
		'update-time-on-edit': { settings: { headerUpdated: 'modification' } },
		'frontmatter-date-manager': { settings: { headerUpdated: 'modification' } },
		'update-time': { settings: { updatedPropertyName: 'bad:key' } },
	}));

	assert.deepEqual(propertyNames, ['modification']);
});
