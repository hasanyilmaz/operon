import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { build } from 'esbuild';

/** Exercise the real Plugin methods and writer with a mobile Vault adapter. */
export async function runMobileInlineRecurrenceTests(rootDir) {
 const source = await readFile(path.join(rootDir, 'main.ts'), 'utf8');
 const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
 const plugin = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'OperonPlugin');
 assert.ok(plugin);
 const names = ['isPluginTaskWritePathContained', 'commitInlineTerminalRecurrenceMutation', 'runPluginUiTaskMutation', 'getTaskMutationFieldValue'];
 const methods = names.map(name => {
  const method = plugin.members.find(member => member.name?.getText(ast) === name);
  assert.ok(method, name);
  return method.getText(ast);
 }).join('\n');
 const dir = await mkdtemp(path.join(tmpdir(), 'operon-mobile-inline-recurrence-'));
 try {
  const outfile = path.join(dir, 'repro.mjs');
  await build({
   stdin: { resolveDir: rootDir, loader: 'ts', contents: `
import assert from 'node:assert/strict';
import { TFile, TFolder } from 'obsidian';
import { TaskWriter } from './src/core/task-writer';
import { parseTaskLine } from './src/core/parser';
import { validateVaultRelativePathV1 } from './src/agent-runtime/contracts/v1/identity';
const Platform = { isDesktop: false, isMobile: true };
const generateOperonId = () => 'next001';
const localNow = () => '2026-09-11T12:00:00';
class Probe { ${methods} }
const original = '- [ ] recurring #test {{operonId:: recur01}} {{status:: task.todo}} {{repeat:: mode=done|freq=day|interval=1}} {{repeatSeriesId:: series1}} {{repeatOccurrenceDate:: 2026-09-10}} {{datetimeModified:: 2026-09-09T18:12:55}}';
const file = new TFile('Tasks/Repro.md');
let content = original, writes = 0, processCalls = 0, stale = false, ioFailure = false, desktopCalls = 0, desktopAllowed = false, duplicates = false, available = true;
const parsed = parseTaskLine(original, 0, file.path, []);
assert.ok(parsed);
const task = { ...parsed, primary: { format: 'inline', filePath: file.path, lineNumber: 0 }, fieldValues: Object.fromEntries(parsed.fields.map(field => [field.key, field.value])) };
const app = { vault: {
 adapter: {},
 getAbstractFileByPath: p => available && p === file.path ? file : null,
 read: async () => content,
 process: async (f, callback) => {
  processCalls++;
  if (stale) content += '\\nConcurrent user edit';
  if (ioFailure) throw new Error('Injected write failure');
  const next = callback(content); writes++; content = next; return content;
 },
}};
const indexer = { getTask: id => id === task.operonId ? task : undefined, hasDuplicateOperonIdConflict: () => duplicates, isPathIndexable: () => true, scheduleReindex: () => {} };
const probe = new Probe();
Object.assign(probe, { app, indexer, parseInlineTaskLine: (line, number, p) => parseTaskLine(line, number, p, []), resolveCompletionTimestamp: localNow, suppressRawTaskCreationNotice: () => {}, redirectDuplicateOperonIdAction: () => {}, schedulePluginUiTaskIndexRefresh: () => {}, isAgentRuntimeMutationPathContained: async () => { desktopCalls++; return desktopAllowed; } });
// The planner seam supplies a deterministic successor; the Plugin commit and writer are unmodified.
probe.recurrenceService = { planTerminalRecurrenceTransition: ({postTransitionSourceContent}) => ({ disposition: 'materialize-inline', preview: { seriesId: 'series1', nextOperonId: 'next001', sourceTaskRetained: true, plannedSourceContent: postTransitionSourceContent + '\\n- [ ] next {{operonId:: next001}}' } }) };
probe.writer = new TaskWriter(app, indexer, [], { validateWritePath: () => probe.isAgentRuntimeMutationPathContained(), validatePluginWritePath: p => probe.isPluginTaskWritePathContained(p) });
probe.updateTaskFieldsAndRefresh = async (id, payload, options) => {
 const result = await probe.commitInlineTerminalRecurrenceMutation(task, payload, options.onTaskWriteStarted);
 if (result.outcome === 'blocked') options.onRecurrenceBlocked();
 if (result.outcome === 'committed') options.onTaskCommitted(payload);
 return result.outcome === 'committed';
};
const payload = { status: 'task.done', _checkbox: 'done', datetimeModified: localNow() };
assert.equal(await probe.isPluginTaskWritePathContained(file.path), true);
assert.equal(desktopCalls, 0, 'Mobile must not consult the desktop API');
for (const p of ['../Repro.md', '/Repro.md', 'Tasks//Repro.md', 'Tasks/./Repro.md', 'Tasks/Other.md', 'Tasks/Repro.txt']) assert.equal(await probe.isPluginTaskWritePathContained(p), false, p);
available = false; assert.equal(await probe.isPluginTaskWritePathContained(file.path), false); available = true;
const before = { status: 'task.todo', _checkbox: 'open', _description: 'recurring', _tags: 'test' };
assert.equal(await probe.writer.taskFieldsMatchCurrentSource(task.operonId, before), true);
for (const [key, value] of Object.entries({ status: 'other', _checkbox: 'done', _description: 'changed', _tags: 'other', _unknown: 'x' })) assert.equal(await probe.writer.taskFieldsMatchCurrentSource(task.operonId, { ...before, [key]: value }), false, key);
content += '\\n' + original;
assert.equal(await probe.writer.taskFieldsMatchCurrentSource(task.operonId, before), false, 'Duplicate source IDs remain rejected');
content = original.replace('{{status:: task.todo}}', '{{status:: task.todo}} {{status:: task.done}}');
assert.equal(await probe.writer.taskFieldsMatchCurrentSource(task.operonId, before), false, 'Conflicting field aliases remain rejected');
content = original;
assert.equal((await probe.writer.applyExactMarkdownSourceMutation(file.path, original, 'changed')).outcome, 'invalid-target', 'Runtime origin must not use the plugin hook');
assert.equal(writes, 0);
assert.equal(await probe.runPluginUiTaskMutation(task.operonId, payload, { changedKeys: Object.keys(payload) }), 'committed');
assert.equal(writes, 1); assert.ok(content.startsWith('- [x]')); assert.ok(content.includes('next001'));
content = original; writes = 0; stale = true;
assert.equal((await probe.commitInlineTerminalRecurrenceMutation(task, payload)).outcome, 'failed');
assert.equal(writes, 0); assert.ok(content.endsWith('Concurrent user edit')); assert.ok(!content.includes('next001'));
stale = false; content = original; ioFailure = true;
const priorConsoleError = console.error;
try {
 console.error = () => {};
 const beforeCalls = processCalls;
 assert.equal(await probe.runPluginUiTaskMutation(task.operonId, payload, { changedKeys: Object.keys(payload) }), 'failed-before-commit', 'An unchanged source must not claim an external edit');
 assert.equal(processCalls - beforeCalls, 1, 'No write retry');
} finally { console.error = priorConsoleError; }
assert.equal(content, original); assert.equal(writes, 0); ioFailure = false;
Platform.isDesktop = true; Platform.isMobile = false;
assert.equal(await probe.isPluginTaskWritePathContained(file.path), false, 'Desktop denial remains authoritative');
desktopAllowed = true;
assert.equal(await probe.isPluginTaskWritePathContained(file.path), true);
assert.equal((await probe.commitInlineTerminalRecurrenceMutation(task, payload)).outcome, 'committed');
assert.equal(writes, 1);
Platform.isDesktop = false;
assert.equal(await probe.isPluginTaskWritePathContained(file.path), false, 'Unknown platforms fail closed');
console.log('mobile-inline-recurrence: mobile commit, conflict preservation, unchanged-source feedback, and desktop/Runtime boundaries passed');
` },
   outfile, bundle: true, format: 'esm', platform: 'node', target: ['node18'], logLevel: 'silent',
   alias: { obsidian: path.join(rootDir, 'scripts/test-support/obsidian.ts') },
  });
  await import(pathToFileURL(outfile).href);
 } finally { await rm(dir, {recursive:true, force:true}); }
}
