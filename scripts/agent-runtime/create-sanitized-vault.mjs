#!/usr/bin/env node

import { build } from 'esbuild';
import {
	cp,
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	realpath,
	rm,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixedTempRoot = await realpath(process.platform === 'darwin' ? '/private/tmp' : tmpdir());
const defaultVaultPath = path.join(fixedTempRoot, 'cli-test-vault');
const argumentsV1 = process.argv.slice(2);
const productionBundle = argumentsV1.includes('--production');
const allowActiveVaultEphemera = argumentsV1.includes('--allow-active-vault-ephemera');
const positionalArguments = argumentsV1.filter(argument => (
	argument !== '--production'
	&& argument !== '--allow-active-vault-ephemera'
));
if (positionalArguments.length > 1) throw new Error('SANITIZED_VAULT_ARGUMENTS_INVALID');
const requestedVaultPath = positionalArguments[0] ?? defaultVaultPath;
const vaultPath = path.resolve(requestedVaultPath);
if (
	path.dirname(vaultPath) !== fixedTempRoot
	|| (
		path.basename(vaultPath) !== 'cli-test-vault'
		&& !/^operon-agent-runtime-phase1-[A-Za-z0-9._-]+$/u.test(path.basename(vaultPath))
	)
) {
	throw new Error('SANITIZED_VAULT_TARGET_OUTSIDE_FIXED_TEMP_ROOT');
}
const existingTarget = await lstat(vaultPath).catch(error => {
	if (error?.code === 'ENOENT') return null;
	throw error;
});
if (existingTarget?.isSymbolicLink()) throw new Error('SANITIZED_VAULT_TARGET_IS_SYMLINK');
const artifactRootOverride = process.env.OPERON_SANITIZED_PLUGIN_ARTIFACT_ROOT;
if (artifactRootOverride && !productionBundle) {
	throw new Error('SANITIZED_PLUGIN_ARTIFACT_OVERRIDE_REQUIRES_PRODUCTION');
}
const productionArtifactRoot = artifactRootOverride
	? await realpath(path.resolve(artifactRootOverride))
	: rootDir;
const selectedBundlePath = path.join(
	productionArtifactRoot,
	productionBundle ? 'main.js' : 'build/agent-runtime-probe/main.js',
);
const selectedManifestPath = path.join(productionArtifactRoot, 'manifest.json');
const selectedStylesPath = path.join(productionArtifactRoot, 'styles.css');
if (artifactRootOverride) {
	const [mainStat, manifestStat, stylesStat] = await Promise.all([
		lstat(selectedBundlePath),
		lstat(selectedManifestPath),
		lstat(selectedStylesPath),
	]);
	if (!mainStat.isFile() || !manifestStat.isFile() || !stylesStat.isFile()) {
		throw new Error('SANITIZED_PLUGIN_ARTIFACT_SOURCE_INVALID');
	}
	const artifactManifest = JSON.parse(await readFile(selectedManifestPath, 'utf8'));
	if (artifactManifest.id !== 'operon' || typeof artifactManifest.version !== 'string') {
		throw new Error('SANITIZED_PLUGIN_ARTIFACT_MANIFEST_INVALID');
	}
}
const pluginTarget = path.join(vaultPath, '.obsidian/plugins/operon');

await removeVaultWithRetries(vaultPath);
await mkdir(pluginTarget, { recursive: true });
await Promise.all([
	cp(selectedBundlePath, path.join(pluginTarget, 'main.js')),
	cp(selectedManifestPath, path.join(pluginTarget, 'manifest.json')),
	cp(selectedStylesPath, path.join(pluginTarget, 'styles.css')),
]);

await Promise.all([
	writeJson(path.join(vaultPath, '.obsidian/community-plugins.json'), ['operon']),
	writeJson(path.join(vaultPath, '.obsidian/daily-notes.json'), {
		folder: 'Daily',
		format: 'YYYY-MM-DD',
		autorun: false,
		template: '',
	}),
	writeJson(path.join(vaultPath, '.obsidian/types.json'), {
		types: {
			aliases: 'aliases',
			cssclasses: 'multitext',
			tags: 'tags',
			'Fixture Topic': 'text',
			ReminderDatetimes: 'multitext',
			ReminderRules: 'multitext',
		},
	}),
]);

await Promise.all([
	writeText(
		path.join(vaultPath, 'Daily/2026-01-15.md'),
		`# Synthetic Daily Note

- [ ] Türkçe görev and English context {{operonId:: inln001}} {{status:: Work.Inbox}} {{priority:: P2}} {{reminderDatetimes:: 2026-01-16T09:00:00}} {{reminderRules:: dateDue.30m}} {{fixtureTopic:: Architecture}}

- [ ] Recurring inline parent {{operonId:: recpar1}} {{status:: Work.Active}}

- [ ] Recurring inline fixture {{operonId:: rec0001}} {{status:: Work.Inbox}} {{parentTask:: recpar1}} {{dateScheduled:: 2026-01-15}} {{repeat:: mode=done|freq=day|interval=1}} {{repeatSeriesId:: rsinl01}}

- [ ] Dynamic template refusal fixture {{operonId:: tmpl001}} {{status:: Work.Inbox}}

- [ ] Timer session child fixture {{operonId:: tmrch01}} {{status:: Work.Active}} {{parentTask:: tmrpar1}}

- [ ] Repeat conversion fixture {{operonId:: cnv0001}} {{status:: Work.Inbox}} {{parentTask:: file001}} {{dateScheduled:: 2026-01-15}} {{repeat:: mode=schedule|freq=day|interval=1}} {{repeatSeriesId:: rscnv01}}
  - [ ] Attached plain checkbox survives conversion
`,
	),
	writeText(
		path.join(vaultPath, 'Tasks/Synthetic File Task.md'),
		`---
operonId: file001
status: Work.Active
priority: P1
parentTask: gran001
ReminderDatetimes:
  - 2026-01-16T09:00:00
ReminderRules:
  - dateDue.30m
Fixture Topic: Architecture
datetimeCreated: 2026-01-15T10:20:30
datetimeModified: 2026-01-15T10:20:30
---

# Synthetic File Task

This note contains no production task data.
`,
	),
	writeText(
		path.join(vaultPath, 'Tasks/Conversion Grandparent.md'),
		`---
operonId: gran001
status: Work.Active
datetimeCreated: 2026-01-15T10:20:30
datetimeModified: 2026-01-15T10:20:30
---

# Conversion Grandparent
`,
	),
	writeText(
		path.join(vaultPath, 'Tasks/Timer Session Parent.md'),
		`---
operonId: tmrpar1
status: Work.Active
datetimeCreated: 2026-01-15T10:20:30
datetimeModified: 2026-01-15T10:20:30
---

# Timer Session Parent
`,
	),
	writeText(
		path.join(vaultPath, 'Tasks/Recurring Fixture - 2026-01-15.md'),
		`---
operonId: recf001
status: Work.Inbox
dateScheduled: 2026-01-15
repeat: mode=schedule|freq=day|interval=1
repeatSeriesId: rsfil01
repeatOccurrenceDate: 2026-01-15
datetimeCreated: 2026-01-15T10:20:30
datetimeModified: 2026-01-15T10:20:30
---

# Recurring Fixture
`,
	),
	writeText(
		path.join(vaultPath, 'Tasks/Plain Recurring Fixture.md'),
		`---
operonId: recp001
status: Work.Inbox
dateScheduled: 2026-01-15
repeat: mode=schedule|freq=day|interval=1
repeatSeriesId: rspln01
repeatOccurrenceDate: 2026-01-15
datetimeCreated: 2026-01-15T10:20:30
datetimeModified: 2026-01-15T10:20:30
---

# Plain Recurring Fixture
`,
	),
	writeText(
		path.join(vaultPath, 'Tasks/Unrelated Fixture.md'),
		`---
operonId: unrel01
status: Work.Active
datetimeCreated: 2026-01-15T10:20:30
datetimeModified: 2026-01-15T10:20:30
---

# Unrelated Fixture
`,
	),
	writeText(
		path.join(vaultPath, 'Tasks/Title Loss Fixture.md'),
		`---
title: User-authored title
operonId: title01
status: Work.Inbox
datetimeCreated: 2026-01-15T10:20:30
datetimeModified: 2026-01-15T10:20:30
---

Title loss fixture body.
`,
	),
	writeText(
		path.join(vaultPath, 'Targets/No Blank Target.md'),
		`---
type: fixture
---
# No blank conversion target`,
	),
	writeText(
		path.join(vaultPath, 'Templates/Fixture Task.md'),
		`---
status: Work.Inbox
priority: P2
Fixture Topic: Templates
---

# Fixture template
`,
	),
	writeText(
		path.join(vaultPath, 'Templates/Dynamic Fixture.md'),
		`---
status: Work.Inbox
---

<% tp.date.now("YYYY-MM-DD") %>
`,
	),
	...Array.from({ length: 20 }, (_, index) => {
		const suffix = String(index).padStart(3, '0');
		return writeText(
			path.join(vaultPath, `Warm/Delete ${suffix}.md`),
			`---
operonId: delw${suffix}
status: Work.Inbox
datetimeCreated: 2026-01-15T10:20:30
datetimeModified: 2026-01-15T10:20:30
---

# Warm delete ${suffix}
`,
		);
	}),
	writeText(
		path.join(vaultPath, 'Warm/Conversion Target.md'),
		`# Warm conversion target
${'\n'.repeat(25)}`,
	),
	writeJson(
		path.join(pluginTarget, 'state/repeat-series.json'),
		{
			version: 5,
			series: {
				rsinl01: {
					seriesId: 'rsinl01',
					sourceTaskId: 'rec0001',
					sourceFormat: 'inline',
					baseTitle: null,
					lastMaterializedTitle: 'Recurring inline fixture',
					naming: null,
					skipDates: [],
					yamlPropertyValueRemovalConfigured: false,
					yamlPropertyValueRemovals: [],
					baseTemporalTemplate: null,
					inlineCompletionMode: 'replace-completed',
					createdAt: '2026-01-15T10:20:30',
					updatedAt: '2026-01-15T10:20:30',
					overrides: {
						single: {},
						following: [],
					},
				},
				rscnv01: {
					seriesId: 'rscnv01',
					sourceTaskId: 'cnv0001',
					sourceFormat: 'inline',
					baseTitle: null,
					lastMaterializedTitle: 'Repeat conversion fixture',
					naming: null,
					skipDates: [],
					yamlPropertyValueRemovalConfigured: false,
					yamlPropertyValueRemovals: [],
					baseTemporalTemplate: null,
					inlineCompletionMode: 'keep-completed',
					createdAt: '2026-01-15T10:20:30',
					updatedAt: '2026-01-15T10:20:30',
					overrides: {
						single: {},
						following: [],
					},
				},
				rspln01: {
					seriesId: 'rspln01',
					sourceTaskId: 'recp001',
					sourceFormat: 'yaml',
					baseTitle: 'Plain Recurring Fixture',
					lastMaterializedTitle: 'Plain Recurring Fixture',
					naming: {
						mode: 'plain',
						template: 'Plain Recurring Fixture',
						weekTokenCase: null,
					},
					skipDates: [],
					yamlPropertyValueRemovalConfigured: false,
					yamlPropertyValueRemovals: [],
					baseTemporalTemplate: null,
					inlineCompletionMode: 'keep-completed',
					createdAt: '2026-01-15T10:20:30',
					updatedAt: '2026-01-15T10:20:30',
					overrides: {
						single: {},
						following: [],
					},
				},
			},
		},
	),
]);

const generatedSettings = await generateSettingsFixtures();
await Promise.all([
	writeJson(path.join(pluginTarget, 'data.json'), generatedSettings.dataPackage),
	writeText(
		path.join(vaultPath, 'Operon/Tables/Default table.table'),
		generatedSettings.defaultTableFile,
	),
]);
await assertPortableVault(vaultPath, { allowActiveVaultEphemera });

process.stdout.write(`${JSON.stringify({
	schemaVersion: 1,
	vaultPath: await realpath(vaultPath),
	pluginId: 'operon',
	bundle: productionBundle ? 'main.js' : 'build/agent-runtime-probe/main.js',
}, null, 2)}\n`);

async function generateSettingsFixtures() {
	const tempDir = await mkdtemp(path.join(tmpdir(), 'operon-agent-runtime-settings-'));
	const outfile = path.join(tempDir, 'sanitized-vault-settings.mjs');
	try {
		await build({
			entryPoints: [path.join(rootDir, 'scripts/agent-runtime/sanitized-vault-settings.ts')],
			outfile,
			bundle: true,
			format: 'esm',
			platform: 'node',
			target: ['node18'],
			logLevel: 'silent',
			plugins: [{
				name: 'obsidian-sanitized-vault-stub',
				setup(buildContext) {
					buildContext.onResolve({ filter: /^obsidian$/ }, () => ({
						path: 'obsidian',
						namespace: 'operon-test',
					}));
					buildContext.onLoad({ filter: /^obsidian$/, namespace: 'operon-test' }, () => ({
						loader: 'js',
						contents: `
							export const Platform = {
								isDesktop: true,
								isDesktopApp: true,
								isMobile: false,
								isMobileApp: false,
								isPhone: false,
							};
							export const normalizePath = value => value.replace(/\\\\/gu, '/').replace(/\\/{2,}/gu, '/');
						`,
					}));
				},
			}],
		});
		const generated = await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
		return {
			dataPackage: generated.buildSanitizedAgentRuntimeDataPackage(),
			defaultTableFile: generated.buildSanitizedDefaultTableFile(),
		};
	} finally {
		await rm(tempDir, { recursive: true, force: true });
	}
}

async function writeJson(filePath, value) {
	await writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeText(filePath, value) {
	await mkdir(path.dirname(filePath), { recursive: true });
	await writeFile(filePath, value, { encoding: 'utf8', mode: 0o600 });
}

async function removeVaultWithRetries(targetPath) {
	const retryableCodes = new Set(['EBUSY', 'ENOTEMPTY', 'EPERM']);
	for (let attempt = 0; attempt < 5; attempt += 1) {
		const target = await lstat(targetPath).catch(error => {
			if (error?.code === 'ENOENT') return null;
			throw error;
		});
		if (target?.isSymbolicLink()) throw new Error('SANITIZED_VAULT_TARGET_IS_SYMLINK');
		try {
			await rm(targetPath, { recursive: true, force: true });
			return;
		} catch (error) {
			if (!retryableCodes.has(error?.code) || attempt === 4) throw error;
			await delay(100 * (attempt + 1));
		}
	}
}

async function assertPortableVault(rootPath, { allowActiveVaultEphemera }) {
	const expectedFiles = new Set([
		'.obsidian/community-plugins.json',
		'.obsidian/daily-notes.json',
		'.obsidian/types.json',
		'.obsidian/plugins/operon/data.json',
		'.obsidian/plugins/operon/main.js',
		'.obsidian/plugins/operon/manifest.json',
		'.obsidian/plugins/operon/state/repeat-series.json',
		'.obsidian/plugins/operon/styles.css',
		'Daily/2026-01-15.md',
		'Operon/Tables/Default table.table',
		'Tasks/Conversion Grandparent.md',
		'Tasks/Synthetic File Task.md',
		'Tasks/Timer Session Parent.md',
		'Tasks/Plain Recurring Fixture.md',
		'Tasks/Recurring Fixture - 2026-01-15.md',
		'Tasks/Title Loss Fixture.md',
		'Tasks/Unrelated Fixture.md',
		'Targets/No Blank Target.md',
		'Templates/Dynamic Fixture.md',
		'Templates/Fixture Task.md',
	]);
	for (let index = 0; index < 20; index += 1) {
		expectedFiles.add(`Warm/Delete ${String(index).padStart(3, '0')}.md`);
	}
	expectedFiles.add('Warm/Conversion Target.md');
	const forbidden = [
		'/Users/',
		'Dropbox',
		'Stratejya',
	];
	const actualFiles = [];
	await walk(rootPath, '');
	for (const relativePath of actualFiles) {
		if (!expectedFiles.has(relativePath)) {
			throw new Error(`Sanitized vault contains unexpected file ${relativePath}`);
		}
		const content = await readFile(path.join(rootPath, relativePath), 'utf8');
		for (const marker of forbidden) {
			if (content.includes(marker)) {
				throw new Error(`Sanitized vault contains forbidden marker ${marker} in ${relativePath}`);
			}
		}
	}
	if (actualFiles.length !== expectedFiles.size) {
		throw new Error('Sanitized vault is missing an expected portable fixture file');
	}

	async function walk(absoluteDirectory, relativeDirectory) {
		for (const entry of await readdir(absoluteDirectory, { withFileTypes: true })) {
			const relativePath = relativeDirectory
				? path.posix.join(relativeDirectory, entry.name)
				: entry.name;
			if (
				allowActiveVaultEphemera
				&& isActiveVaultEphemeralPath(relativePath)
			) continue;
			const absolutePath = path.join(absoluteDirectory, entry.name);
			if (entry.isSymbolicLink()) throw new Error(`Sanitized vault contains symlink ${relativePath}`);
			if (entry.isDirectory()) {
				await walk(absolutePath, relativePath);
			} else if (entry.isFile()) {
				actualFiles.push(relativePath);
			} else {
				throw new Error(`Sanitized vault contains unsupported entry ${relativePath}`);
			}
		}
	}
}

function isActiveVaultEphemeralPath(relativePath) {
	return [
		'.obsidian/app.json',
		'.obsidian/appearance.json',
		'.obsidian/core-plugins.json',
		'.obsidian/workspace.json',
		'.obsidian/workspace-mobile.json',
	].includes(relativePath)
		|| relativePath === '.obsidian/plugins/operon/runtime'
		|| relativePath.startsWith('.obsidian/plugins/operon/runtime/')
		|| relativePath === '.obsidian/plugins/operon/cache'
		|| relativePath.startsWith('.obsidian/plugins/operon/cache/')
		|| (
			relativePath.startsWith('.obsidian/plugins/operon/state/')
			&& relativePath !== '.obsidian/plugins/operon/state/repeat-series.json'
		);
}
