import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Notice, TFile } from 'obsidian';
import { buildUniqueOperonTableFilePath, getOperonTableFilePathKey, parseOperonTableFile, serializeOperonTableFile } from '../../src/storage/table-file';
import { prepareCanonicalTableFileRestoreExpectedHash, writeCanonicalTableFileWithAcknowledgement } from '../../src/storage/table-file-write-acknowledgement';
import { renameCanonicalTableFileWithAcknowledgement } from '../../src/storage/table-file-rename-acknowledgement';
import { notifyTablePresetErrorOnce } from '../../src/ui/table/table-preset-error-notice';
import { TablePresetRegistry } from '../../src/storage/table-preset-registry';
import { applyTablePresetPatch } from '../../src/ui/table/table-preset-model';
import { readSealedFixture, withSettingsFixture } from './settings-preservation-harness';

const ts = createRequire(`${process.cwd()}/package.json`)('typescript') as typeof import('typescript');

/** Execute the real integration methods without loading Obsidian's plugin UI. */
function integrationMethods(file: string, names: string[], dependencies: Record<string, unknown>) {
	const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
	const methods: string[] = [];
	source.forEachChild(node => {
		if (!ts.isClassDeclaration(node)) return;
		for (const member of node.members) {
			if (member.name && names.includes(member.name.getText(source))) methods.push(member.getText(source));
		}
	});
	assert.equal(methods.length, names.length, 'Integration methods must remain covered');
	const compiled = ts.transpileModule(`class Probe { ${methods.join('\n')} }`, {
		compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
	}).outputText;
	return new (Function(...Object.keys(dependencies), `${compiled}; return Probe;`)(...Object.values(dependencies)))();
}

export const tableSettingsSaveCases = ['aligned-columns', 'mismatched-columns', 'renamed-preset'].map(scenario => ({
	name: `Table ${scenario} preserves save feedback and rollback through settings recovery`,
	async run(): Promise<void> {
		await withSettingsFixture({}, async fixture => {
			const storage = fixture.createStorage();
			await storage.initialize();
			const previous = readSealedFixture('Personal.table');
			const table = JSON.parse(previous);
			const initialPath = scenario === 'mismatched-columns' ? 'Tables/Other.table' : 'Tables/Personal table.table';
			await storage.updateSettings({ tablePresetFileBindings: [{ id: table.id, path: initialPath }] });
			const external = fixture.package();
			external.settings.operonDocsFolder = 'Synced Docs';
			fixture.seed(fixture.canonicalPath, JSON.stringify(external));
			await assert.rejects(storage.updateSettings({ operonDocsFolder: 'Rejected edit' }));
			table.columns.reverse();
			if (scenario === 'renamed-preset') table.name = 'Renamed table';
			const parsed = parseOperonTableFile(previous, initialPath);
			assert.equal(parsed.status, 'valid');
			if (parsed.status !== 'valid') throw new Error('Invalid sealed Table fixture');
			const expected = serializeOperonTableFile(applyTablePresetPatch(parsed.preset, { id: table.id, name: table.name, columns: table.columns }));
			const file = Object.assign(Object.create(TFile.prototype) as TFile, { path: initialPath, parent: { path: 'Tables' } });
			let source = previous;
			let settingsSaves = 0;
			let closes = 0;
			let rejection: unknown = null;
			const messages: string[] = [];
			const notices = Notice as unknown as { onNotice: ((message: string) => void) | null };
			notices.onNotice = message => messages.push(message);
			try {
				const probe = integrationMethods('main.ts', [
					'writeCanonicalTableFile', 'resolveTableFilePathForName', 'renameCanonicalTableFile', 'handleTablePresetFileWriteFailure',
				], { TFile, parseOperonTableFile, getOperonTableFilePathKey, buildUniqueOperonTableFilePath,
					writeCanonicalTableFileWithAcknowledgement, prepareCanonicalTableFileRestoreExpectedHash,
					renameCanonicalTableFileWithAcknowledgement, notifyTablePresetErrorOnce });
				Object.assign(probe, {
					app: {
						vault: { getAbstractFileByPath: (path: string) => path === file.path ? file : null,
							read: async () => source, modify: async (_file: TFile, next: string) => { source = next; }, getFiles: () => [file] },
						fileManager: { renameFile: async (_file: TFile, path: string) => { file.path = path; } },
					},
					settings: storage.getSettings(),
					storage: { saveSettings: async () => { settingsSaves++; await storage.saveSettings(); } },
					expectedTableFileModifyHashes: new Map(), expectedTableFileRenames: new Map(), hashTableFileContent: (text: string) => text,
					syncTablePresetProjectionFromRegistry: () => {},
				});
				const registry = new TablePresetRegistry({
					loadFileBindings: () => storage.getSettings().tablePresetFileBindings,
					listTableFiles: () => [file], readTableFile: async () => source, applyPatch: applyTablePresetPatch,
					writeTableFile: async (path, serialized, context) => {
						if (rejection !== null) throw rejection;
						await probe.writeCanonicalTableFile(path, serialized, context.baseFileContent);
					},
					schedulePatch: () => 0, cancelScheduledPatch: () => {},
				});
				probe.tablePresetRegistry = registry;
				await registry.refresh();
				const modal = integrationMethods('src/ui/table/table-preset-quick-settings-modal.ts', ['runAction', 'runAndClose'], {
					notifyTablePresetErrorOnce, t: () => 'Table preset action failed.',
				});
				modal.close = () => { closes++; };
				const save = async () => {
					await registry.queuePatch(table.id, 'explicit-save', { id: table.id, name: table.name, columns: table.columns }, {
						onError: error => probe.handleTablePresetFileWriteFailure(error),
					}).flush();
				};
				await modal.runAndClose(save);
				if (scenario === 'aligned-columns') {
					assert.equal(source, expected);
					assert.equal(settingsSaves, 0, 'A columns-only save must not depend on general settings');
					assert.equal(closes, 1);
					assert.deepEqual(messages, []);
				} else {
					assert.equal(source, previous, 'Failed settings save must restore the previous table');
					assert.equal(file.path, initialPath, 'Failed settings save must restore the path');
					assert.equal(settingsSaves, 1);
					assert.equal(closes, 0, 'Failed Save must keep the editor open');
					assert.equal(messages.length, 1, 'The modal must not duplicate the detailed failure');
					assert.match(messages[0], /Operon could not save the Table file.*settings writes are suspended/);
					await storage.reloadCanonicalSettingsPackage();
					await modal.runAndClose(save);
					assert.equal(source, expected);
					assert.equal(file.path, `Tables/${table.name}.table`);
					assert.equal(settingsSaves, 2);
					assert.equal(closes, 1, 'A new explicit Save succeeds after verified recovery');
					assert.equal(messages.length, 1);
					assert.equal(fixture.package().settings.operonDocsFolder, 'Synced Docs');
				}
				const failure = () => Promise.reject(new Error('Separate action failure'));
				const before = messages.length;
				await modal.runAction(failure);
				await modal.runAction(failure);
				assert.equal(messages.length, before + 2, 'Independent failures must still be reported');
				assert.equal(messages[messages.length - 1], 'Table preset action failed.');
				for (const reused of ['Primitive adapter failure', new Error('Reused adapter failure')]) {
					rejection = reused;
					const count = messages.length;
					await modal.runAndClose(save);
					await modal.runAndClose(save);
					assert.equal(messages.length, count + 2, 'Each save must report exactly one failure, even for reused or primitive rejections');
					assert.match(messages[messages.length - 1], /Operon could not save the Table file/);
				}
				registry.dispose();
			} finally { notices.onNotice = null; }
		});
	},
}));
