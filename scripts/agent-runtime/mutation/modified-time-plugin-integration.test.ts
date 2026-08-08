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
		'update-time-on-edit': {
			settings: {
				dateFormat: "yyyy-MM-dd'T'HH:mm",
				enableNumberProperties: false,
				headerUpdated: 'legacyModified',
			},
		},
		'frontmatter-date-manager': {
			settings: {
				dateFormat: "yyyy-MM-dd'T'HH:mm:ss",
				enableAutoUpdate: true,
				enableModifiedTime: true,
				enableNumberProperties: false,
				headerUpdated: 'modification',
				timezone: '',
			},
		},
		'update-time': { settings: { updatedPropertyName: 'updated' } },
	}));

	assert.deepEqual(propertyNames, ['legacyModified', 'modification', 'updated']);
});

test('modified-time integrations deduplicate properties and reject unsafe setting values', () => {
	const propertyNames = getExternalModifiedTimeFrontmatterPropertyNames(appWithPlugins({
		'update-time-on-edit': {
			settings: {
				dateFormat: "yyyy-MM-dd'T'HH:mm",
				headerUpdated: 'modification',
			},
		},
		'frontmatter-date-manager': {
			settings: {
				dateFormat: "yyyy-MM-dd'T'HH:mm:ss",
				enableAutoUpdate: true,
				headerUpdated: 'modification',
			},
		},
		'update-time': { settings: { updatedPropertyName: 'bad:key' } },
	}));

	assert.deepEqual(propertyNames, ['modification']);
});

test('modified-time integrations reject inactive or non-canonical provider configurations', () => {
	const propertyNames = getExternalModifiedTimeFrontmatterPropertyNames(appWithPlugins({
		'update-time-on-edit': {
			settings: {
				dateFormat: 'yyyy/MM/dd HH:mm',
				headerUpdated: 'legacyModified',
			},
		},
		'frontmatter-date-manager': {
			settings: {
				dateFormat: "yyyy-MM-dd'T'HH:mm:ss",
				enableAutoUpdate: false,
				enableModifiedTime: true,
				headerUpdated: 'modification',
			},
		},
	}));

	assert.deepEqual(propertyNames, []);
	assert.deepEqual(getExternalModifiedTimeFrontmatterPropertyNames(appWithPlugins({
		'update-time-on-edit': {
			settings: {
				dateFormat: "yyyy-MM-dd'T'HH:mm",
				enableNumberProperties: true,
				headerUpdated: 'legacyModified',
			},
		},
		'frontmatter-date-manager': {
			settings: {
				dateFormat: "yyyy-MM-dd'T'HH:mm:ss",
				enableAutoUpdate: true,
				enableModifiedTime: true,
				headerUpdated: 'modification',
				timezone: 'UTC',
			},
		},
	})), []);
});
