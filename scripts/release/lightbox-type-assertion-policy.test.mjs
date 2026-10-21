import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import ts from 'typescript';
import {
	checkLightboxTypeAssertions,
	LIGHTBOX_TYPE_ASSERTION_FILES,
	LIGHTBOX_TYPE_ASSERTION_RULE,
} from './lightbox-type-assertion-policy.mjs';

const policyUrl = new URL('./lightbox-type-assertion-policy.mjs', import.meta.url);
const nativeDeclarations = `
interface TextView {
 setViewData(data: string, clear: boolean): void;
 save(clear?: boolean): Promise<void>;
}
declare const view: TextView;
`;
const webDeclarations = `
interface ViewState { type: string; }
interface Leaf {
 detach(): void;
 setViewState(state: ViewState): Promise<void>;
 getViewState(): ViewState;
}
interface Workspace { getLayout(this: Workspace): Record<string, unknown>; }
declare const destination: Leaf, owned: Leaf, detachedLeaf: Leaf;
declare const workspace: Workspace;
const original = workspace.getLayout;
`;
const oldNative = `${nativeDeclarations}
const originalSet = view.setViewData.bind(view) as TextView['setViewData'];
const originalSave = view.save.bind(view) as (clear?: boolean) => Promise<void>;
`;
const oldWeb = `${webDeclarations}
const firstState = destination.getViewState.bind(destination) as Leaf['getViewState'];
const layout = original.call(workspace) as Record<string, unknown>;
const originalDetach = owned.detach.bind(owned) as Leaf['detach'];
const originalSetViewState = owned.setViewState.bind(owned) as Leaf['setViewState'];
const lastState = detachedLeaf.getViewState.bind(detachedLeaf) as Leaf['getViewState'];
`;

function nativeBinderSource() {
	const file = new URL('../../src/ui/native-lightbox-lifecycle.ts', import.meta.url);
	const ast = ts.createSourceFile('native-lightbox-lifecycle.ts', fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
	const declarations = ast.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === 'bindNativeLightboxMethod');
	assert.ok(declarations.length > 0);
	return declarations.map(node => node.getText(ast)).join('\n');
}

function fixture(t, { old = false } = {}) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'operon-lightbox-assertion-'));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	fs.mkdirSync(path.join(root, 'src/ui'), { recursive: true });
	fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({
		compilerOptions: { target: 'ES2020', strictNullChecks: true, types: [] },
		include: ['src/**/*.ts'],
	}));
	fs.writeFileSync(path.join(root, 'tsconfig.scorecard.json'), JSON.stringify({ extends: './tsconfig.json' }));
	fs.writeFileSync(path.join(root, LIGHTBOX_TYPE_ASSERTION_FILES[0]), old ? oldNative : `${nativeBinderSource()}
${nativeDeclarations}
const originalSet = bindNativeLightboxMethod(view, 'setViewData');
const originalSave = bindNativeLightboxMethod(view, 'save');
declare const payload: unknown;
const typed = payload as { id: string };
const example = "view.save.bind(view) as TextView['save']";
`);
	fs.writeFileSync(path.join(root, LIGHTBOX_TYPE_ASSERTION_FILES[1]), old ? oldWeb : `
import { bindNativeLightboxMethod } from './native-lightbox-lifecycle';
${webDeclarations}
const firstState = bindNativeLightboxMethod(destination, 'getViewState');
const layout = Reflect.apply(original, workspace, []);
const originalDetach = bindNativeLightboxMethod(owned, 'detach');
const originalSetViewState = bindNativeLightboxMethod(owned, 'setViewState');
const lastState = bindNativeLightboxMethod(detachedLeaf, 'getViewState');
`);
	return root;
}

function run(root) {
	const code = `import { runLightboxTypeAssertionCheck } from ${JSON.stringify(policyUrl.href)};
process.exitCode = await runLightboxTypeAssertionCheck(${JSON.stringify(root)});`;
	const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 30_000 });
	assert.ifError(result.error);
	return result;
}

test('all seven original bind/call assertions fail with file, line and rule diagnostics', async t => {
	const root = fixture(t, { old: true });
	const before = fs.readFileSync(path.join(root, 'tsconfig.json'), 'utf8');
	const findings = await checkLightboxTypeAssertions(root);
	assert.equal(findings.length, 7);
	assert.equal(findings.filter(finding => finding.file === LIGHTBOX_TYPE_ASSERTION_FILES[0]).length, 2);
	assert.equal(findings.filter(finding => finding.file === LIGHTBOX_TYPE_ASSERTION_FILES[1]).length, 5);
	assert.ok(findings.every(finding => finding.rule === LIGHTBOX_TYPE_ASSERTION_RULE && finding.line > 0 && finding.column > 0));
	assert.equal(fs.readFileSync(path.join(root, 'tsconfig.json'), 'utf8'), before);
});

test('the production binder and Reflect.apply pass while a necessary assertion stays allowed', async t => {
	assert.deepEqual(await checkLightboxTypeAssertions(fixture(t)), []);
});

test('the whole two-file boundary is checked while unrelated production files stay excluded', async t => {
	const root = fixture(t);
	const redundant = '\ndeclare const existing: string; const redundant = existing as string;\n';
	fs.writeFileSync(path.join(root, 'src/ui/unrelated.ts'), redundant);
	assert.deepEqual(await checkLightboxTypeAssertions(root), []);
	fs.appendFileSync(path.join(root, LIGHTBOX_TYPE_ASSERTION_FILES[1]), redundant);
	const findings = await checkLightboxTypeAssertions(root);
	assert.equal(findings.length, 1);
	assert.equal(findings[0].file, LIGHTBOX_TYPE_ASSERTION_FILES[1]);
});

test('missing targets and targets outside the scorecard project fail closed', async t => {
	const missing = fixture(t);
	fs.unlinkSync(path.join(missing, LIGHTBOX_TYPE_ASSERTION_FILES[1]));
	await assert.rejects(checkLightboxTypeAssertions(missing));
	const excluded = fixture(t);
	fs.writeFileSync(path.join(excluded, 'tsconfig.scorecard.json'), JSON.stringify({
		extends: './tsconfig.json', include: [LIGHTBOX_TYPE_ASSERTION_FILES[0]],
	}));
	await assert.rejects(checkLightboxTypeAssertions(excluded), /scorecard project/);
});

test('the command returns zero only for a successful clean analysis', t => {
	const clean = run(fixture(t));
	assert.equal(clean.status, 0, clean.stderr);
	assert.match(clean.stdout, /policy passed/);
	const rejected = run(fixture(t, { old: true }));
	assert.equal(rejected.status, 1);
	assert.match(rejected.stderr, /src\/ui\/web-lightbox\.ts:\d+:\d+ @typescript-eslint\/no-unnecessary-type-assertion/);
	const invalid = fixture(t);
	fs.writeFileSync(path.join(invalid, 'tsconfig.scorecard.json'), '{');
	const unavailable = run(invalid);
	assert.equal(unavailable.status, 1);
	assert.match(unavailable.stderr, /analysis failed/);
});

test('Plugin guard and validation use the policy while cli-compat skips it', () => {
	const packageManifest = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
	assert.equal(packageManifest.scripts['lightbox:type-assertions:check'], 'node scripts/check-lightbox-type-assertions.mjs');
	assert.equal(packageManifest.scripts['lightbox:type-assertions:test'], 'node --test scripts/release/lightbox-type-assertion-policy.test.mjs');
	assert.equal(packageManifest.scripts['check:plugin'].split(' && ').filter(command => command === 'npm run lightbox:type-assertions:test').length, 1);
	const text = fs.readFileSync(new URL('../release-guard.mjs', import.meta.url), 'utf8');
	const ast = ts.createSourceFile('release-guard.mjs', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
	const dispatch = ast.statements.find(node => ts.isIfStatement(node) && node.expression.getText(ast) === "guardScope === 'plugin'");
	assert.ok(dispatch && ts.isBlock(dispatch.thenStatement));
	const calls = [];
	const visit = node => {
		if (ts.isCallExpression(node) && node.expression.getText(ast) === 'checkLightboxTypeAssertionPolicy') calls.push(node);
		ts.forEachChild(node, visit);
	};
	visit(ast);
	assert.equal(calls.length, 1);
	assert.ok(calls[0].pos >= dispatch.thenStatement.pos && calls[0].end <= dispatch.thenStatement.end);
	assert.ok(ts.isAwaitExpression(calls[0].parent));
	assert.ok(text.includes("await import('./release/lightbox-type-assertion-policy.mjs')"));
});
