import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { TFile, type App, type MarkdownView } from 'obsidian';
import { TaskSourceModifyReconciler } from '../src/systems/task-source-modify-reconciliation';
import { resolveOperonIdPlaceholders } from '../src/core/operon-id-placeholders';
import { isOperonExcludedPath } from '../src/core/operon-path-exclusions';
import { localNow } from '../src/core/local-time';
import { TaskWriter, type TaskWriterIndexerPort } from '../src/core/task-writer';
import { loadPropertyTypeRegistry } from '../src/core/property-type-registry';
import { PropertyEditorAdapter } from '../src/core/property-editor-adapter';
import { PropertyEditorDraft } from '../src/core/property-editor-draft';
import { planPropertyEditorWrite, propertyEditorPreservesBody, readPropertyEditorDocument } from '../src/core/property-editor-document';
import { inferVaultPropertyEditorTypes, resolvePropertyEditorField } from '../src/core/property-editor-fields';
import { readRawYamlPropertyExpectation, isEmptyFilePropertyValue } from '../src/core/raw-yaml-property';
import { capturePropertyEditorMarkdown, PropertyEditorSourceConflict } from '../src/ui/task-editor-markdown-source';
import { getNativePropertyIndex } from '../src/indexer/native-property-index';
import { DEFAULT_SETTINGS } from '../src/types/settings';
import { TASK_EDITOR_AUTOSAVE_DELAY_MS } from '../src/ui/task-editor-source-sync';
import { applyFieldRules } from '../src/core/field-rules';
import { resolveReverseWorkflowFromTerminalDate, resolveWorkflowStatus } from '../src/types/pipeline';
import { parseRepeatRule } from '../src/core/repeat-rule';
import { deriveCountModeRepeatEndFromFieldValues, splitTaskListValue } from '../src/core/task-field-patch';
import { localToday } from '../src/core/local-time';
import { REMINDER_RULE_ANCHORS } from '../src/core/reminder-rules';
import { normalizeListValues } from '../src/ui/editor-property-format';
import { encodeVaultPropertyValue } from '../src/core/vault-property-codec';
// Execute the production methods without mounting Obsidian DOM. Only UI rendering is stubbed.
function members(path: string, names: string[]): string {
    const source = readFileSync(path, 'utf8'), ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    const all = ast.statements.filter(ts.isClassDeclaration).flatMap(node => [...node.members]);
    return names.map(name => { const member = all.find(m => m.name?.getText(ast) === name); assert.ok(member, name); return member.getText(ast).replace(/^(private|protected) /u, ''); }).join('\n');
}
const uiPath = 'src/ui/native-property-editor.ts';
const hostCode = members(uiPath, ['markEdited', 'setFilePropertyValue', 'hydrate', 'makeAdapter', 'field', 'hasDesktopPropertyRules', 'prepareRepeatIdentityPatch', 'isEdited', 'scheduleEdited', 'cancelTimer', 'scheduleSave', 'persist', 'prepareClose', 'refresh', 'settleRefresh', 'discard']);
const fieldCode = members('src/ui/editor-property-fields.ts', ['applyDraftFieldRules', 'applyStatusDraftChange', 'applyDateDraftChange', 'applyTerminalDateDraftChange', 'syncDerivedRepeatFieldsFromDraft', 'applyTaskFieldPickerPayload', 'commitWorkflowActionPayload']);
const pluginCode = members('main.ts', ['saveLightboxNoteProperties']);
const decode = (source: string) => readPropertyEditorDocument(source, DEFAULT_SETTINGS.keyMappings)!;
const key = (canonical: string) => DEFAULT_SETTINGS.keyMappings.find(m => m.canonicalKey === canonical)?.visiblePropertyName ?? canonical;
const flush = async () => {
    for (let i = 0; i < 3; i++)
        await new Promise<void>(resolve => setImmediate(resolve));
};
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
class Clock {
    now = 0;
    private id = 0;
    timers = new Map<number, {
        at: number;
        run: () => void;
    }>();
    setTimeout = (run: () => void, delay: number) => { const id = ++this.id; this.timers.set(id, { at: this.now + delay, run }); return id; };
    clearTimeout = (id: number) => { this.timers.delete(id); };
    async tick(ms: number) {
        this.now += ms;
        for (const [id, entry] of [...this.timers])
            if (entry.at <= this.now) {
                this.timers.delete(id);
                entry.run();
            }
        await flush();
    }
}
const base = '---\nCaption: original # keep\nCount: 0\nFlag: false\nUpdated: 2026-11-01T12:00\n---\n# Body\n';
function world(source = base) {
    const file = new (TFile as unknown as {
        new (path: string): TFile;
    })('Fixture.md');
    Object.assign(file, { path: 'Fixture.md', extension: 'md', name: 'Fixture.md' });
    const state = { disk: source, writes: 0, attempts: 0, active: 0, maxActive: 0, target: file as TFile | null, fail: false, afterFailure: false,
        gate: null as ReturnType<typeof deferred> | null, beforeCommit: () => { }, afterCommit: () => { }, task: false, reindexes: 0, readFailures: 0 };
    type TestView = {
        file: TFile;
        lastSavedData: string;
        data: string;
        saving: boolean;
        editor: {
            getValue: () => string;
            offsetToPos: (ch: number) => {
                line: number;
                ch: number;
            };
            transaction: (payload: {
                changes: Array<{
                    from: {
                        ch: number;
                    };
                    to: {
                        ch: number;
                    };
                    text: string;
                }>;
            }) => void;
        };
        setText: (next: string) => void;
    };
    const views: TestView[] = [];
    function view(text = state.disk): TestView {
        let buffer = text;
        const v = { file, lastSavedData: state.disk, data: state.disk, saving: false,
            editor: { getValue: () => buffer, offsetToPos: (ch: number) => ({ line: 0, ch }), transaction: ({ changes }: {
                    changes: Array<{
                        from: {
                            ch: number;
                        };
                        to: {
                            ch: number;
                        };
                        text: string;
                    }>;
                }) => {
                    for (const c of changes)
                        buffer = buffer.slice(0, c.from.ch) + c.text + buffer.slice(c.to.ch);
                } }, setText: (next: string) => { buffer = next; } };
        views.push(v);
        return v;
    }
    const app = { metadataCache: { getFileCache: () => null }, vault: { getMarkdownFiles: () => [], getAbstractFileByPath: (path: string) => path === file.path ? state.target : null, read: async () => {
                if (state.readFailures > 0) {
                    state.readFailures--;
                    throw Error('Injected readback failure');
                }
                return state.disk;
            },
            process: async (_file: TFile, transform: (s: string) => string) => {
                state.attempts++;
                state.active++;
                state.maxActive = Math.max(state.maxActive, state.active);
                try {
                    if (state.gate)
                        await state.gate.promise;
                    state.beforeCommit();
                    if (state.fail)
                        throw Error('Injected write failure');
                    state.disk = transform(state.disk);
                    state.writes++;
                    state.afterCommit();
                    if (state.afterFailure)
                        throw Error('Injected lost acknowledgement');
                    return state.disk;
                }
                finally {
                    state.active--;
                }
            } } } as unknown as App;
    const settings = { ...DEFAULT_SETTINGS, keyMappings: [...DEFAULT_SETTINGS.keyMappings] };
    const types = { Caption: 'text', Count: 'number', Flag: 'checkbox', Mixed: 'multitext', Other: 'text' } as const;
    getNativePropertyIndex(app).setTypes(types);
    const indexer = { resolveFileTaskIdForOpening: () => state.task ? 'new-task' : null, scheduleReindex: () => { state.reindexes++; } };
    const writer = new TaskWriter(app, indexer as unknown as TaskWriterIndexerPort, settings.keyMappings);
    const globals = { capturePropertyEditorMarkdown, PropertyEditorSourceConflict, planPropertyEditorWrite, propertyEditorPreservesBody, readPropertyEditorDocument, resolvePropertyEditorField, getNativePropertyIndex };
    const Plugin = new Function(...Object.keys(globals), ts.transpile(`class Plugin {${pluginCode}};return Plugin;`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(globals));
    const plugin = new Plugin();
    Object.assign(plugin, { app, settings, writer, indexer, propertyEditorWrittenSources: new WeakMap(), isExcalidrawTaskSource: () => false, getMarkdownViewsForPath: () => views as unknown as MarkdownView[] });
    const clock = new Clock();
    function editor() {
        const globals = { ...globalRules, PropertyEditorAdapter, getNativePropertyIndex, inferVaultPropertyEditorTypes, readRawYamlPropertyExpectation, isEmptyFilePropertyValue,
            TASK_EDITOR_AUTOSAVE_DELAY_MS, Date: { now: () => clock.now } };
        const Host = new Function(...Object.keys(globals), ts.transpile(`class Host {${fieldCode}\n${hostCode}};return Host;`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(globals));
        const e = new Host();
        Object.assign(e, { app, settings, options: { save: (changes: unknown, current: () => boolean) => plugin.saveLightboxNoteProperties(file, changes, current) },
            draft: new PropertyEditorDraft(decode(state.disk)), submitted: new Set(), disposed: false, rendering: false, adding: null, fieldValues: {}, tags: [], checkbox: 'open', surfaces: new Map(), add: { focus() { } },
            timer: null, nextSaveAt: 0, saving: null, pendingRefresh: false, win: clock, message: { hidden: true, textContent: '' }, interaction: false,
            hasActiveInteraction: () => e.interaction, render() { }, closePicker() { e.interaction = false; },
            refreshSchedulingDraftControls() { }, refreshMobileCoreButtons() { }, refreshWorkflowPickerSurfaceValues() { }, applyThemeColor() { },
        });
        e.hydrate();
        return e;
    }
    return { state, file, app, settings, writer, clock, editor, view, views, types, plugin };
}
const globalRules = { applyFieldRules, resolveReverseWorkflowFromTerminalDate, resolveWorkflowStatus, parseRepeatRule, deriveCountModeRepeatEndFromFieldValues,
    localToday, splitTaskListValue, REMINDER_RULE_ANCHORS, normalizeListValues, Notice: class {
    }, t: (_group: string, k: string) => k };
test('full save chain debounces from the last edit and preserves native typed values, comments and body', async () => {
    const w = world(), e = w.editor();
    w.view();
    w.view();
    e.setFilePropertyValue('Caption', 'first');
    await w.clock.tick(1500);
    assert.equal(w.state.writes, 0);
    e.setFilePropertyValue('Caption', 'last');
    e.setFilePropertyValue('Count', 3);
    await w.clock.tick(1999);
    assert.equal(w.state.writes, 0);
    await w.clock.tick(1);
    assert.equal(w.state.writes, 1);
    assert.equal(e.isEdited, false);
    assert.equal(decode(w.state.disk).frontmatter.Count, 3);
    assert.equal(decode(w.state.disk).frontmatter.Flag, false);
    assert.match(w.state.disk, /Caption: last # keep/u);
    assert.ok(w.state.disk.endsWith('# Body\n'));
    for (const v of w.views)
        assert.equal(v.editor.getValue(), w.state.disk);
});
test('save in flight retains later same-field and other-field changes, then drains once in order', async () => {
    const w = world(), e = w.editor();
    w.state.gate = deferred();
    e.setFilePropertyValue('Caption', 'sent');
    await w.clock.tick(2000);
    e.setFilePropertyValue('Caption', 'later');
    e.setFilePropertyValue('Count', 7);
    await w.clock.tick(2000);
    assert.equal(w.state.attempts, 1);
    assert.equal(w.state.writes, 0);
    w.state.gate.resolve();
    await flush();
    assert.equal(e.isEdited, true);
    await w.clock.tick(0);
    assert.equal(w.state.writes, 2);
    assert.equal(w.state.maxActive, 1);
    assert.equal(decode(w.state.disk).frontmatter.Caption, 'later');
    assert.equal(decode(w.state.disk).frontmatter.Count, 7);
    assert.equal(e.isEdited, false);
});
test('closing before debounce drains all edits including a change arriving during its pending write', async () => {
    const w = world(), e = w.editor();
    w.state.gate = deferred();
    e.setFilePropertyValue('Caption', 'one');
    const closing = e.prepareClose();
    await flush();
    e.setFilePropertyValue('Caption', 'two');
    w.state.gate.resolve();
    assert.equal(await closing, true);
    assert.equal(decode(w.state.disk).frontmatter.Caption, 'two');
    assert.equal(w.state.maxActive, 1);
    assert.equal(w.clock.timers.size, 0);
});
for (const same of [false, true])
    test(`two editor instances serialize ${same ? 'same-field conflicts' : 'different-field saves'} through the real writer`, async () => {
        const w = world(), a = w.editor(), b = w.editor();
        w.state.gate = deferred();
        a.setFilePropertyValue('Caption', 'A');
        b.setFilePropertyValue(same ? 'Caption' : 'Count', same ? 'B' : 9);
        const first = a.prepareClose(), second = b.prepareClose();
        await flush();
        assert.equal(w.state.attempts, 1);
        w.state.gate.resolve();
        assert.equal(await first, true);
        assert.equal(await second, !same);
        assert.equal(w.state.maxActive, 1);
        assert.equal(decode(w.state.disk).frontmatter.Caption, 'A');
        assert.equal(b.isEdited, same);
        if (same) {
            assert.equal(w.state.writes, 1);
            assert.equal(b.message.hidden, false);
        }
        else
            assert.equal(decode(w.state.disk).frontmatter.Count, 9);
    });
test('matching final value is idempotent and a stale picker never adopts an external same-field edit', async () => {
    const w = world(), a = w.editor(), b = w.editor();
    a.setFilePropertyValue('Caption', 'same');
    b.setFilePropertyValue('Caption', 'same');
    assert.equal(await a.prepareClose(), true);
    assert.equal(await b.prepareClose(), true);
    assert.equal(w.state.writes, 1);
    const c = w.editor();
    c.interaction = true;
    w.state.disk = w.state.disk.replace('Caption: same', 'Caption: external');
    c.refresh(decode(w.state.disk));
    c.setFilePropertyValue('Caption', 'mine');
    assert.equal(await c.prepareClose(), false);
    assert.match(w.state.disk, /Caption: external/u);
    assert.equal(c.isEdited, true);
});
test('unrelated unsaved source changes survive the real writer and synchronize all native views', async () => {
    const w = world(), e = w.editor();
    w.view();
    const tab = w.view();
    tab.setText(w.state.disk.replace('# Body', '# Unsaved body').replace('Count: 0', 'Count: 9'));
    e.setFilePropertyValue('Caption', 'saved');
    assert.equal(await e.prepareClose(), true);
    assert.match(w.state.disk, /# Unsaved body/u);
    assert.equal(decode(w.state.disk).frontmatter.Count, 9);
    for (const v of w.views)
        assert.equal(v.editor.getValue(), w.state.disk);
});
for (const same of [false, true])
    test(`native ${same ? 'same-field' : 'body'} edit after disk commit is ${same ? 'preserved as conflict' : 'rebased without a second write'}`, async () => {
        const w = world(), e = w.editor(), tab = w.view();
        e.setFilePropertyValue('Caption', 'saved');
        w.state.afterCommit = () => tab.setText(tab.editor.getValue().replace(same ? 'Caption: original' : '# Body', same ? 'Caption: external' : '# Late body'));
        assert.equal(await e.prepareClose(), !same);
        assert.equal(w.state.writes, 1);
        assert.match(tab.editor.getValue(), same ? /Caption: external/u : /# Late body/u);
        if (!same)
            assert.match(tab.editor.getValue(), /Caption: saved/u);
        assert.match(w.state.disk, /Caption: saved/u);
        assert.ok(w.state.disk.endsWith('# Body\n'));
        assert.equal(e.isEdited, same);
        if (same)
            assert.equal(e.message.hidden, false);
    });
for (const mode of ['failure', 'lost-ack', 'delete', 'rename', 'replace', 'task', 'mapping', 'types'] as const)
    test(`write boundary ${mode} keeps file identity and draft safe`, async () => {
        const w = world(), e = w.editor();
        const v = w.view();
        e.setFilePropertyValue('Caption', 'next');
        if (mode === 'failure')
            w.state.fail = true;
        if (mode === 'lost-ack')
            w.state.afterFailure = true;
        w.state.beforeCommit = () => {
            if (mode === 'delete')
                w.state.target = null;
            if (mode === 'rename')
                w.file.path = 'Renamed.md';
            if (mode === 'replace')
                w.state.target = new (TFile as unknown as {
                    new (path: string): TFile;
                })('Fixture.md');
            if (mode === 'task')
                w.state.task = true;
            if (mode === 'mapping')
                w.settings.keyMappings = [...w.settings.keyMappings];
            if (mode === 'types')
                getNativePropertyIndex(w.app).setTypes({ ...w.types, Caption: 'number' });
        };
        const result = await e.prepareClose();
        assert.equal(result, mode === 'lost-ack');
        assert.equal(e.isEdited, mode !== 'lost-ack');
        assert.equal(w.state.writes, mode === 'lost-ack' ? 1 : 0);
        assert.equal(v.editor.getValue(), mode === 'lost-ack' ? w.state.disk : base);
        if (mode !== 'lost-ack') {
            assert.equal(w.state.disk, base);
            assert.equal(e.message.hidden, false);
        }
    });
test('first property, false, zero and mixed list append with exact types; clear keeps its existing key', async () => {
    const w = world('# Body\n'), e = w.editor();
    await w.clock.tick(5000);
    assert.equal(w.state.writes, 0);
    e.setFilePropertyValue('Flag', false);
    e.setFilePropertyValue('Count', 0);
    e.setFilePropertyValue('Mixed', ['02', 2, 'a; b']);
    assert.equal(await e.prepareClose(), true);
    const saved = decode(w.state.disk);
    assert.deepEqual(saved.order, ['Flag', 'Count', 'Mixed']);
    assert.deepEqual(saved.frontmatter, { Flag: false, Count: 0, Mixed: ['02', 2, 'a; b'] });
    e.setFilePropertyValue('Mixed', []);
    assert.equal(await e.prepareClose(), true);
    assert.deepEqual(decode(w.state.disk).order, saved.order);
});
test('shared scheduling dependencies commit atomically and retain YAML order and Updated', async () => {
    const initial = `---\n${key('datetimeStart')}: 2026-11-10T10:00\n${key('dateScheduled')}: 2026-11-10\n${key('datetimeModified')}: 2026-11-01T12:00\n---\nBody\n`;
    const w = world(initial), e = w.editor();
    e.adding = key('estimate');
    e.commitWorkflowActionPayload({ estimate: '3600' });
    e.adding = null;
    e.commitWorkflowActionPayload({ dateScheduled: '2026-11-11' });
    assert.equal(await e.prepareClose(), true);
    const saved = decode(w.state.disk);
    assert.equal(saved.frontmatter[key('datetimeStart')], '2026-11-11T10:00:00');
    assert.equal(saved.frontmatter[key('datetimeEnd')], '2026-11-11T11:00:00');
    assert.equal(saved.frontmatter[key('estimate')], 3600);
    assert.equal(saved.frontmatter[key('datetimeModified')], '2026-11-01T12:00');
    assert.deepEqual(saved.order, [key('datetimeStart'), key('dateScheduled'), key('datetimeModified'), key('estimate'), key('datetimeEnd')]);
    const reopen = w.editor();
    assert.equal(reopen.fieldValues.estimate, '3600');
    assert.ok(!saved.order.includes(key('operonId')));
});
test('a conflicting dependent field blocks the whole scheduled change', async () => {
    const w = world(`---\n${key('dateScheduled')}: 2026-11-10\n${key('datetimeStart')}: 2026-11-10T10:00\n${key('datetimeEnd')}: 2026-11-10T11:00\n---\nBody\n`), e = w.editor();
    e.commitWorkflowActionPayload({ dateScheduled: '2026-11-11' });
    w.state.disk = w.state.disk.replace('T11:00', 'T12:00');
    const before = w.state.disk;
    assert.equal(await e.prepareClose(), false);
    assert.equal(w.state.disk, before);
    assert.equal(w.state.writes, 0);
    assert.equal(e.isEdited, true);
});
test('Status and repeat definition persist and reopen without task identity or Updated mutation', async () => {
    const w = world(), e = w.editor(), pipeline = DEFAULT_SETTINGS.pipelines[0], terminal = pipeline.statuses.find(s => s.isFinished)!;
    e.commitWorkflowActionPayload({ status: pipeline.name + '.' + terminal.label });
    e.commitWorkflowActionPayload({ repeat: 'mode=count|freq=day|interval=1|count=3', repeatOccurrenceDate: '2026-11-10' });
    assert.equal(await e.prepareClose(), true);
    const saved = decode(w.state.disk), reopen = w.editor();
    assert.equal(saved.frontmatter[key('dateCompleted')], localToday());
    assert.ok(reopen.fieldValues.datetimeRepeatEnd);
    assert.equal(saved.frontmatter.Updated, '2026-11-01T12:00');
    assert.ok(!saved.order.includes(key('operonId')));
    assert.ok(!saved.order.includes(key('repeatSeriesId')));
});
// Exercise the workspace gate that close, navigation and transfer all await.
function workspace(e: ReturnType<ReturnType<typeof world>['editor']>, file: TFile) {
    const code = members('src/ui/native-task-workspace.ts', ['prepare', 'togglePropertyEditor']);
    const Workspace = new Function(ts.transpile(`class Workspace {${code}};return Workspace;`, { target: ts.ScriptTarget.ES2022 }))();
    const c = new Workspace();
    let confirmations = 0;
    Object.assign(c, { propertyEditor: e, propertyFile: file, propertyHidden: false, disposed: false, layout() { }, provider: { confirmDiscard: async () => { confirmations++; return false; } } });
    return { c, confirmations: () => confirmations };
}
test('hiding the actual workspace panel retains its draft and the original autosave deadline', async () => {
    const w = world(), e = w.editor(), { c } = workspace(e, w.file);
    e.setFilePropertyValue('Caption', 'hidden');
    await w.clock.tick(1200);
    await c.togglePropertyEditor(w.file);
    assert.equal(c.propertyHidden, true);
    assert.equal(c.propertyEditor, e);
    assert.equal(e.isEdited, true);
    await w.clock.tick(799);
    assert.equal(w.state.writes, 0);
    await w.clock.tick(1);
    assert.equal(w.state.writes, 1);
    assert.equal(e.isEdited, false);
    assert.equal(decode(w.state.disk).frontmatter.Caption, 'hidden');
});
for (const allowDiscard of [false, true])
    test(`workspace ${allowDiscard ? 'close' : 'navigation and transfer'} waits for the real write and retains a failed draft`, async () => {
        const w = world(), e = w.editor(), f = workspace(e, w.file);
        w.state.gate = deferred();
        w.state.fail = true;
        e.setFilePropertyValue('Caption', 'pending');
        let finished = false;
        const transition = f.c.prepare(allowDiscard).then((ok: boolean) => { finished = true; return ok; });
        await flush();
        assert.equal(finished, false);
        w.state.gate.resolve();
        assert.equal(await transition, false);
        assert.equal(e.isEdited, true);
        assert.equal(f.confirmations(), allowDiscard ? 1 : 0);
        assert.equal(w.state.disk, base);
        // Recovery retries the retained edit through the same gate, not a replacement write path.
        w.state.fail = false;
        assert.equal(await f.c.prepare(allowDiscard), true);
        assert.equal(e.isEdited, false);
        assert.equal(w.state.writes, 1);
    });
test('failed closing discards only after an explicit affirmative response and performs no write', async () => {
    const w = world(), e = w.editor(), { c } = workspace(e, w.file);
    e.setFilePropertyValue('Caption', 'pending');
    w.state.disk = w.state.disk.replace('Caption: original', 'Caption: external');
    assert.equal(await c.prepare(true), false);
    assert.equal(e.isEdited, true);
    c.provider.confirmDiscard = async () => true;
    assert.equal(await c.prepare(true), true);
    assert.equal(e.isEdited, false);
    assert.equal(w.state.writes, 0);
    assert.match(w.state.disk, /Caption: external/u);
});
test('the full chain preserves BOM, CRLF, quoted keys, YAML comments and untouched body bytes', async () => {
    const initial = '\uFEFF---\r\n# before\r\n"Caption": "old # text"  # keep\r\nCount: 0\r\n---\r\n# Body\r\n\r\n';
    const w = world(initial), e = w.editor();
    w.view();
    e.setFilePropertyValue('Caption', 'new');
    e.setFilePropertyValue('Flag', false);
    assert.equal(await e.prepareClose(), true);
    assert.equal(w.state.disk, '\uFEFF---\r\n# before\r\n"Caption": new  # keep\r\nCount: 0\r\nFlag: false\r\n---\r\n# Body\r\n\r\n');
    assert.equal(w.views[0].editor.getValue(), w.state.disk);
});
test('unsafe external YAML rejects the entire pending package with zero writes', async () => {
    for (const external of ['---\nCaption: one\nCaption: two\n---\nBody\n', '---\nCaption: [\n---\nBody\n']) {
        const w = world(), e = w.editor();
        e.setFilePropertyValue('Caption', 'mine');
        e.setFilePropertyValue('Count', 2);
        w.state.disk = external;
        assert.equal(await e.prepareClose(), false);
        assert.equal(e.isEdited, true);
        assert.equal(w.state.writes, 0);
        assert.equal(w.state.disk, external);
    }
});
test('Add Property chooser and actual value-picker lifecycle cancel without creating a field or frontmatter', async () => {
    const w = world('# Body\n'), e = w.editor();
    const addCode = members(uiPath, ['openAddPicker', 'openAddition', 'closePicker', 'confirmNewFileProperty', 'getFilePropertyPickerOwner']);
    const pickerCode = members('src/ui/editor-property-fields.ts', ['openFilePropertyPicker', 'canEditFileProperty']);
    type Chooser = {
        onSelect: (choice: {
            field: string;
        }) => void;
        onClose: () => void;
    };
    type ValuePicker = {
        onClose: () => void;
        onMutation: (value: {
            kind: 'set';
            value: string;
        }) => void;
    };
    let chooser: Chooser | null = null, valuePicker: ValuePicker | null = null;
    const globals = { getNativePropertyIndex, inferVaultPropertyEditorTypes, isEmptyFilePropertyValue, encodeVaultPropertyValue,
        t: (_group: string, k: string) => k, resolveSurfaceFloatingHostOptions: () => ({}), requestFloatingPanelCloseForRoot: () => { },
        collectNativeFieldValueCandidates: () => [],
        showSearchableFieldPicker: (_anchor: unknown, options: Chooser) => { chooser = options; return () => options.onClose(); },
        openTableFilePropertyPicker: (options: ValuePicker) => { valuePicker = options; return () => options.onClose(); },
    };
    const Add = new Function(...Object.keys(globals), ts.transpile(`class Add {${addCode}\n${pickerCode}};return Add;`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(globals));
    for (const name of ['openAddPicker', 'openAddition', 'closePicker', 'confirmNewFileProperty', 'getFilePropertyPickerOwner', 'openFilePropertyPicker', 'canEditFileProperty'])
        e[name] = Add.prototype[name];
    const element = () => ({ addClass() { }, removeClass() { }, querySelectorAll: () => [], focus() { }, isConnected: true });
    Object.assign(e, { propertyInteractionEpoch: 0, fileProperties: new Map(), filePropertyRows: new Map(),
        nativePropertyField: () => ({ icon: 'text', type: 'text' }), indexer: { getAllTasks: () => [] }, closeActiveWorkflowActionPicker() { },
        refreshFilePropertyValue() { }, refreshDesktopFileProperties() { },
        add: { ...element(), ownerDocument: { win: { createDiv: element, createEl: element } } }, root: element(),
    });
    Object.assign(w.app.vault, { getMarkdownFiles: () => [] });
    e.openAddPicker();
    assert.ok(chooser);
    (chooser as Chooser).onClose();
    await flush();
    assert.equal(valuePicker, null);
    e.openAddPicker();
    (chooser as Chooser).onSelect({ field: 'Caption' });
    (chooser as Chooser).onClose();
    await flush();
    assert.ok(valuePicker);
    assert.equal(e.fileProperties.get('Caption').pending, true);
    e.closePicker();
    await w.clock.tick(4000);
    assert.equal(e.fileProperties.has('Caption'), false);
    assert.equal(e.closeFilePropertyPicker, null);
    assert.equal(e.isEdited, false);
    assert.deepEqual(e.draft.properties.order, []);
    assert.equal(w.state.writes, 0);
    assert.equal(w.state.disk, '# Body\n');
    // Confirm through the same real onMutation callback instead of mutating the draft directly.
    e.openAddPicker();
    (chooser as Chooser).onSelect({ field: 'Caption' });
    (chooser as Chooser).onClose();
    await flush();
    (valuePicker as ValuePicker).onMutation({ kind: 'set', value: 'confirmed' });
    e.closePicker();
    await w.clock.tick(2000);
    assert.equal(w.state.writes, 1);
    assert.equal(decode(w.state.disk).frontmatter.Caption, 'confirmed');
});
for (const current of [false, true])
    test(`a new native view after commit is ${current ? 'already synchronized' : 'reported without overwriting its draft'}`, async () => {
        const w = world(), e = w.editor();
        w.view();
        const original = w.state.disk;
        w.state.afterCommit = () => w.view(current ? w.state.disk : original.replace('# Body', '# Late new tab'));
        e.setFilePropertyValue('Caption', 'saved');
        assert.equal(await e.prepareClose(), current);
        assert.equal(w.state.writes, 1);
        assert.equal(e.isEdited, !current);
        if (!current) {
            assert.match(w.views[1].editor.getValue(), /Caption: original/u);
            assert.match(w.views[1].editor.getValue(), /# Late new tab/u);
        }
    });
for (const fail of [false, true])
    test(`clearing an in-flight new property after ${fail ? 'failed' : 'successful'} addition can finish safely`, async () => {
        const w = world(), e = w.editor();
        w.state.gate = deferred();
        w.state.fail = fail;
        e.setFilePropertyValue('Other', 'new');
        await w.clock.tick(2000);
        e.setFilePropertyValue('Other', null);
        w.state.gate.resolve();
        await flush();
        w.state.fail = false;
        assert.equal(await e.prepareClose(), true);
        assert.equal(e.isEdited, false);
        const saved = decode(w.state.disk);
        assert.equal(saved.order.includes('Other'), !fail);
        assert.equal(w.state.writes, fail ? 0 : 2);
        if (!fail)
            assert.equal(saved.frontmatter.Other, null);
    });
test('reverting a native unsaved property to its disk value synchronizes the buffer without writing disk', async () => {
    const w = world(), e = w.editor(), tab = w.view();
    tab.setText(w.state.disk.replace('Caption: original', 'Caption: temporary'));
    e.refresh(decode(tab.editor.getValue()));
    e.setFilePropertyValue('Caption', 'original');
    assert.equal(await e.prepareClose(), true);
    assert.equal(e.isEdited, false);
    assert.equal(w.state.writes, 0);
    assert.equal(tab.editor.getValue(), base);
    assert.equal(w.state.disk, base);
});
test('writer disk readback recovery cannot acknowledge an unverified native source synchronization', async () => {
    const w = world(), e = w.editor(), tab = w.view();
    e.setFilePropertyValue('Caption', 'saved');
    w.state.afterCommit = () => { w.state.readFailures = 1; };
    assert.equal(await e.prepareClose(), false);
    assert.equal(w.state.writes, 1);
    assert.equal(e.isEdited, true);
    assert.equal(tab.editor.getValue(), base);
    assert.match(w.state.disk, /Caption: saved/u);
    assert.equal(e.message.hidden, false);
});
test('an idempotent save refreshes a stale clean native view without another disk write', async () => {
    const w = world(), e = w.editor(), tab = w.view();
    e.setFilePropertyValue('Caption', 'same');
    w.state.disk = base.replace('Caption: original', 'Caption: same');
    assert.equal(await e.prepareClose(), true);
    assert.equal(w.state.writes, 0);
    assert.equal(tab.editor.getValue(), w.state.disk);
});
for (const boundary of ['identity', 'task', 'types', 'mapping', 'disposed'] as const)
    test(`no-op native synchronization rechecks ${boundary} after asynchronous verification`, async () => {
        const w = world(), e = w.editor(), tab = w.view();
        const dirty = base.replace('Caption: original', 'Caption: temporary');
        tab.setText(dirty);
        e.refresh(decode(dirty));
        e.setFilePropertyValue('Caption', 'original');
        let reads = 0;
        w.app.vault.read = async () => {
            const text = w.state.disk;
            if (++reads === 2) {
                if (boundary === 'identity')
                    w.state.target = new (TFile as unknown as {
                        new (path: string): TFile;
                    })('Fixture.md');
                if (boundary === 'task')
                    w.state.task = true;
                if (boundary === 'types')
                    getNativePropertyIndex(w.app).setTypes({ ...w.types, Caption: 'number' });
                if (boundary === 'mapping')
                    w.settings.keyMappings = [...w.settings.keyMappings];
                if (boundary === 'disposed')
                    e.disposed = true;
            }
            return text;
        };
        assert.equal(await e.prepareClose(), false);
        assert.equal(e.isEdited, true);
        assert.equal(w.state.writes, 0);
        assert.equal(tab.editor.getValue(), dirty);
    });
test('retrying a cleared failed addition preserves and saves an unrelated native body edit', async () => {
    const w = world(), e = w.editor(), tab = w.view();
    w.state.gate = deferred();
    w.state.fail = true;
    e.setFilePropertyValue('Other', 'new');
    await w.clock.tick(2000);
    e.setFilePropertyValue('Other', null);
    w.state.gate.resolve();
    await flush();
    w.state.fail = false;
    tab.setText(base.replace('# Body', '# User body edit'));
    assert.equal(await e.prepareClose(), true);
    assert.equal(e.isEdited, false);
    assert.equal(w.state.writes, 1);
    assert.ok(!decode(w.state.disk).order.includes('Other'));
    assert.match(w.state.disk, /# User body edit/u);
    assert.equal(tab.editor.getValue(), w.state.disk);
});

for (const [name, sample, value, type] of [
 ['Summary', 'existing text', 'confirmed text', 'text'],
 ['Genre', ['Drama'], ['Comedy', 0], 'list'],
 ['Amount', 2, 0, 'number'],
 ['Enabled', true, false, 'checkbox'],
 ['Related', ['[[Original]]'], ['[[New]]', 'plain value', 0, '[[A;B]]'], 'list'],
 ['CustomDefault', ['old'], ['02', 2, 'a; b'], 'list'],
 ['CustomLegacy', ['old'], ['02', 2, 'a; b'], 'list'],
 ['CustomVault', ['old'], ['02', 2, 'a; b'], 'list'],
] as const) test(`${name} uses a single-line chooser, typed ${type} picker and safe save`, async () => {
 const w=world('# Body\n');
 if (name.startsWith('Custom')) {
  w.settings.keyMappings.push({canonicalKey:name,visiblePropertyName:name,type:'list',enabled:true,isSystem:false,sync:'yes'});
  if (name !== 'CustomDefault') w.settings.inlinePropertyDefinitions={version:1,entries:[{sourceName:name,type:'list',encoding:name==='CustomLegacy'?'legacy':'vault-v1'}]};
 }
 const e=w.editor();
 type Option={field:string;icon:string;secondaryLabel?:string};
 type Chooser={fields:Option[];onSelect:(field:Option)=>void;onClose:()=>void};
 type Picker={field:{type:string};onClose:()=>void;onMutation:(mutation:{kind:'set';value:unknown})=>void};
 let chooser:Chooser|null=null, picker:Picker|null=null;
 const globals={getNativePropertyIndex,inferVaultPropertyEditorTypes,isEmptyFilePropertyValue,encodeVaultPropertyValue,
  t:(_group:string,k:string)=>k,resolveSurfaceFloatingHostOptions:()=>({}),requestFloatingPanelCloseForRoot:()=>{},collectNativeFieldValueCandidates:()=>[],
  showSearchableFieldPicker:(_anchor:unknown,options:Chooser)=>{chooser=options;return ()=>options.onClose();},
  openTableFilePropertyPicker:(options:Picker)=>{picker=options;return ()=>options.onClose();}};
 const code=members(uiPath,['openAddPicker','openAddition','usesSharedControl','closePicker','confirmNewFileProperty','getFilePropertyPickerOwner'])+members('src/ui/editor-property-fields.ts',['openFilePropertyPicker','canEditFileProperty']);
 const Add=new Function(...Object.keys(globals),ts.transpile(`class Add {${code}};return Add;`,{target:ts.ScriptTarget.ES2022}))(...Object.values(globals));
 for(const method of ['openAddPicker','openAddition','usesSharedControl','closePicker','confirmNewFileProperty','getFilePropertyPickerOwner','openFilePropertyPicker','canEditFileProperty']) e[method]=Add.prototype[method];
 const element=()=>({addClass(){},removeClass(){},querySelectorAll:()=>[],focus(){},isConnected:true});
 Object.assign(e,{propertyInteractionEpoch:0,fileProperties:new Map(),filePropertyRows:new Map(),
  nativePropertyField:(name:string,type:string)=>({name,icon:type,type}),resolveWorkflowPickerIcon:()=> 'link-2',openWorkflowPickerFromAction:()=>{throw Error('Related must use the standard list picker');},indexer:{getAllTasks:()=>[]},closeActiveWorkflowActionPicker(){},refreshFilePropertyValue(){},refreshDesktopFileProperties(){},
  add:{...element(),ownerDocument:{win:{createDiv:element,createEl:element}}},root:element()});
 Object.assign(w.app.vault,{getMarkdownFiles:()=>[w.file]});
 Object.assign(w.app,{metadataCache:{getFileCache:()=>({frontmatter:{[name]:sample,operonId:'protected',StructuredOnly:{nested:true},BlankAuto:null}})}});
 const choose=async()=>{e.openAddPicker();const c=chooser as unknown as Chooser;const option=c.fields.find(f=>f.field===name);assert.ok(option);assert.equal(option.secondaryLabel,undefined);assert.notEqual(option.icon,'shield-alert');assert.ok(!c.fields.some(f=>f.field==='operonId'||f.field==='StructuredOnly'));assert.ok(c.fields.some(f=>f.field==='BlankAuto'));c.onSelect(option);c.onClose();await flush();};
 await choose();assert.ok(picker);assert.equal(e.fileProperties.get(name).field.type,type);
 e.closePicker();await w.clock.tick(3000);assert.equal(w.state.writes,0);assert.deepEqual(e.draft.properties.order,[]);
 await choose();(picker as unknown as Picker).onMutation({kind:'set',value});e.closePicker();await w.clock.tick(2000);
 assert.equal(w.state.writes,1);assert.deepEqual(decode(w.state.disk).frontmatter[name],value);assert.equal(e.isEdited,false);
 const reopened=w.editor();assert.equal(reopened.field(name).type,type);assert.equal(reopened.field(name).reason,undefined);
 assert.equal(getNativePropertyIndex(w.app).getTypes()[name],undefined);
 if (name === 'Related') {
  assert.equal(e.usesSharedControl(reopened.field(name)),false);
  reopened.setFilePropertyValue(name,['[[Edited]]',7,'a; b']);assert.equal(await reopened.prepareClose(),true);
  assert.deepEqual(decode(w.state.disk).frontmatter[name],['[[Edited]]',7,'a; b']);
  assert.equal(w.editor().field(name).reason,undefined);
 }
});
test('Auto existing values take precedence over vault inference without removing real type protections', () => {
 const document={frontmatter:{AutoList:[0,"zero"],AutoNumber:0,AutoFlag:false,AutoText:'text',Object:{nested:true}},order:['AutoList','AutoNumber','AutoFlag','AutoText','Object']};
 for (const [name,type] of [['AutoList','list'],['AutoNumber','number'],['AutoFlag','checkbox'],['AutoText','text']]) {
  const field=resolvePropertyEditorField(name,document,[],{}, {[name]:'text'});assert.equal(field.type,type);assert.equal(field.reason,undefined);
 }
 assert.ok(resolvePropertyEditorField('Object',document,[],{}).reason);
 assert.ok(resolvePropertyEditorField('AutoList',document,[],{AutoList:'number'}).reason);
 assert.equal(resolvePropertyEditorField('Blank',{frontmatter:{Blank:null},order:['Blank']},[],{}, {Blank:'number'}).type,'number');
});

test('invalid explicit declarations remain protected instead of being inferred as Auto', async () => {
 const w=world('---\nCustomDeclared: original\n---\nBody\n');
 Object.assign(w.app.vault,{configDir:'.obsidian',adapter:{exists:async()=>true,read:async()=>JSON.stringify({types:{CustomDeclared:'unsupported-external-type'}})}});
 getNativePropertyIndex(w.app).setTypes(await loadPropertyTypeRegistry(w.app));
 const e=w.editor();assert.ok(e.field('CustomDeclared').reason);
 e.setFilePropertyValue('CustomDeclared','replacement');await w.clock.tick(3000);assert.equal(w.state.writes,0);assert.equal(e.isEdited,false);
});

test('opening Add refreshes an existing blank Auto row after vault inference changes', () => {
 const w=world('---\nFlexible: \n---\nBody\n'),e=w.editor();
 assert.equal(e.field('Flexible').type,'text');
 Object.assign(w.app.vault,{getMarkdownFiles:()=>[w.file]});
 Object.assign(w.app,{metadataCache:{getFileCache:()=>({frontmatter:{Flexible:42}})}});
 e.nativePropertyField=(_name:string,type:string)=>({icon:type});
 const rendered:string[]=[];e.render=()=>rendered.push(e.field('Flexible').type);
 const globals={getNativePropertyIndex,inferVaultPropertyEditorTypes,resolveSurfaceFloatingHostOptions:()=>({}),t:()=>'',showSearchableFieldPicker:()=>()=>{}};
 const Add=new Function(...Object.keys(globals),ts.transpile(`class Add {${members(uiPath,['openAddPicker'])}};return Add;`,{target:ts.ScriptTarget.ES2022}))(...Object.values(globals));
 Add.prototype.openAddPicker.call(e);assert.equal(rendered.at(-1),'number');
});

test('full save preserves block-scalar YAML comments', async () => {
 const source='---\nCaption: |2-\n  original\n # keep this comment\n   # keep this too\nCount: 0\n---\nBody\n';
 const w=world(source),e=w.editor();e.setFilePropertyValue('Caption','saved');
 assert.equal(await e.prepareClose(),true);
 assert.equal(w.state.disk,'---\nCaption: saved\n # keep this comment\n   # keep this too\nCount: 0\n---\nBody\n');
 assert.equal(w.editor().field('Caption').reason,undefined);
});

test('late native alias ambiguity preserves native draft and reports conflict after the disk commit', async () => {
 const w=world('---\nSchedule: 2026-11-10\n---\nBody\n');
 w.settings.keyMappings=w.settings.keyMappings.map(m=>m.canonicalKey==='dateScheduled'?{...m,visiblePropertyName:'Schedule'}:m);
 const e=w.editor(),tab=w.view();
 e.setFilePropertyValue('Schedule','2026-11-11');
 const late=tab.editor.getValue().replace('---\nBody','dateScheduled: 2026-11-12\n---\nBody');
 w.state.afterCommit=()=>tab.setText(late);
 assert.equal(await e.prepareClose(),false);
 assert.equal(e.isEdited,true);assert.equal(w.state.writes,1);assert.equal(tab.editor.getValue(),late);
 assert.equal(decode(w.state.disk).frontmatter.Schedule,'2026-11-11');
});

function attachRawReconciliation(w:ReturnType<typeof world>) {
 const names=['markInternalTaskWrite','reconcileTaskSourceModify','normalizeWorkflowStateAfterRawEdit','normalizeWorkflowStateAfterRawEditPass','resolveOperonIdPlaceholdersInContent'];
 let nextId=0;
 const globals={TFile,isOperonExcludedPath,resolveOperonIdPlaceholders,generateOperonId:()=> 'id'+String(++nextId).padStart(5,'0'),localNow};
 const Host=new Function(...Object.keys(globals),ts.transpile(`class Host {${members('main.ts',names)}};return Host;`,{target:ts.ScriptTarget.ES2022}))(...Object.values(globals));
 const h=w.plugin;
 for (const name of names) h[name]=Host.prototype[name];
 let followups=0;
 Object.assign(w.app.vault,{cachedRead:async()=>w.state.disk,modify:async(_file:TFile,text:string)=>{w.state.disk=text;followups++;}});
 Object.assign(h,{tasksConversionOwnedSources:new Map(),tasksConversionSettledSources:new Map(),workflowNormalizationRenameTargets:new Map(),workflowNormalizationInProgress:new Set(),workflowNormalizationPending:new Set(),workflowNormalizationWaiters:new Map(),
  isTemplatedFileTaskCreationCandidate:()=>false,buildRawTaskLinePlaceholderContext:()=>({})});
 Object.assign(h.indexer,{getAllTasks:()=>[],forceReindexFilePathAfterMutation:async()=>{},handleFileDelete:async()=>{}});
 const reconciler=new TaskSourceModifyReconciler({suppressionMs:750,settleDelayMs:25,now:()=>w.clock.now,setTimer:w.clock.setTimeout,clearTimer:w.clock.clearTimeout,reconcile:(path,mode)=>h.reconcileTaskSourceModify(path,mode),onError:(_path,error)=>{throw error;}});
 h.taskSourceModifyReconciler=reconciler;
 Object.assign((w.writer as unknown as {hooks:object}).hooks,{onBeforeWriteFile:(path:string)=>h.markInternalTaskWrite(path)});
 w.state.afterCommit=()=>{reconciler.handleModify(w.file.path);};
 return {reconciler,followups:()=>followups};
}

for (const body of ['- [ ] Child {{operonId:: {{operonId}}}}\n','Body\n']) test(`YAML-only save does not normalize existing task/template content: ${body.trim()}`, async () => {
 const w=world('---\nCaption: original\nTemplate: "{{operonId}}"\n---\n'+body),e=w.editor(),r=attachRawReconciliation(w);
 e.setFilePropertyValue('Caption','saved');assert.equal(await e.prepareClose(),true);
 const saved=w.state.disk;await w.clock.tick(775);
 assert.equal(r.followups(),0);assert.equal(w.state.disk,saved);assert.ok(saved.includes('{{operonId}}'));
 // Duplicated own modify events remain harmless; later external edits use the normalizer.
 r.reconciler.handleModify(w.file.path);await flush();assert.equal(r.followups(),0);
 w.state.disk+='External edit\n';r.reconciler.handleModify(w.file.path);await flush();
 assert.equal(r.followups(),1);assert.ok(w.state.disk.includes('id00001'));r.reconciler.destroy();
});

test('a native task body edit merged during property save still receives existing task normalization', async () => {
 const w=world('---\nCaption: original\n---\nBody\n'),e=w.editor(),tab=w.view(),r=attachRawReconciliation(w);
 tab.setText(tab.editor.getValue()+'- [ ] New {{operonId:: {{operonId}}}}\n');
 e.setFilePropertyValue('Caption','saved');assert.equal(await e.prepareClose(),true);await w.clock.tick(775);
 assert.equal(r.followups(),1);assert.ok(w.state.disk.includes('id00001'));r.reconciler.destroy();
});

test('failed provisional writes cannot suppress a later native edit to the proposed content', async () => {
 const w=world('---\nCaption: original\n---\n- [ ] Child {{operonId:: {{operonId}}}}\n'),e=w.editor(),r=attachRawReconciliation(w);
 const originalProcess=w.app.vault.process;let proposed='';
 w.app.vault.process=async(_file,transform)=>{proposed=transform(w.state.disk);throw Error('Disk rejected after transform');};
 e.setFilePropertyValue('Caption','saved');assert.equal(await e.prepareClose(),false);
 w.app.vault.process=originalProcess;w.state.disk=proposed;await w.clock.tick(10000);
 r.reconciler.handleModify(w.file.path);await flush();assert.equal(r.followups(),1);r.reconciler.destroy();
});

test('settling a newer property save releases the previous source receipt for native undo', async () => {
 const w=world('---\nCaption: original\n---\n- [ ] Child {{operonId:: {{operonId}}}}\n'),e=w.editor(),r=attachRawReconciliation(w);
 e.setFilePropertyValue('Caption','first');assert.equal(await e.prepareClose(),true);await w.clock.tick(775);const previous=w.state.disk;
 e.setFilePropertyValue('Caption','second');assert.equal(await e.prepareClose(),true);await w.clock.tick(775);assert.equal(r.followups(),0);
 w.state.disk=previous;r.reconciler.handleModify(w.file.path);await flush();assert.equal(r.followups(),1);r.reconciler.destroy();
});

test('writer secondary readback releases an uncommitted provisional receipt', async () => {
 const w=world('---\nCaption: original\n---\n- [ ] Child {{operonId:: {{operonId}}}}\n'),e=w.editor(),r=attachRawReconciliation(w);
 const originalProcess=w.app.vault.process;let proposed='';
 w.app.vault.process=async(_file,transform)=>{proposed=transform(w.state.disk);w.state.readFailures=1;throw Error('Uncommitted with lost first readback');};
 e.setFilePropertyValue('Caption','saved');assert.equal(await e.prepareClose(),false);
 w.app.vault.process=originalProcess;w.state.disk=proposed;await w.clock.tick(10000);
 r.reconciler.handleModify(w.file.path);await flush();assert.equal(r.followups(),1);r.reconciler.destroy();
});

test('writer secondary recovery settles the new receipt without retaining old saved bytes', async () => {
 const w=world('---\nCaption: original\n---\n- [ ] Child {{operonId:: {{operonId}}}}\n'),e=w.editor(),r=attachRawReconciliation(w);
 e.setFilePropertyValue('Caption','first');assert.equal(await e.prepareClose(),true);await w.clock.tick(775);const previous=w.state.disk;
 w.state.afterFailure=true;w.state.afterCommit=()=>{w.state.readFailures=1;r.reconciler.handleModify(w.file.path);};
 e.setFilePropertyValue('Caption','second');assert.equal(await e.prepareClose(),false);assert.equal(e.isEdited,true);await w.clock.tick(775);assert.equal(r.followups(),0);
 w.state.disk=previous;r.reconciler.handleModify(w.file.path);await flush();assert.equal(r.followups(),1);r.reconciler.destroy();
});

test('post-commit divergence cannot settle a receipt twice and resurrect an older save', async () => {
 const w=world('---\nCaption: original\n---\n- [ ] Child {{operonId:: {{operonId}}}}\n'),e=w.editor(),r=attachRawReconciliation(w);
 e.setFilePropertyValue('Caption','first');assert.equal(await e.prepareClose(),true);await w.clock.tick(775);const previous=w.state.disk;
 w.state.afterCommit=()=>{w.state.disk+='External edit\n';r.reconciler.handleModify(w.file.path);};
 e.setFilePropertyValue('Caption','second');assert.equal(await e.prepareClose(),false);assert.equal(e.isEdited,true);
 w.state.disk=previous;await w.clock.tick(775);assert.equal(r.followups(),1);r.reconciler.destroy();
});
