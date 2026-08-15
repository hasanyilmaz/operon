import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const PROCESS_LAUNCH_MODULES = new Set([
	'child_process',
	'node:child_process',
	'cluster',
	'node:cluster',
]);
const PROCESS_BINDINGS = new Set(['process_wrap', 'spawn_sync']);
const TEST_SOURCE_PATTERN = /(?:^|[\\/])(?:__tests__|test|tests)(?:[\\/]|$)|\.(?:spec|test)\.[cm]?[jt]sx?$/u;

function lineNumberAt(text, index) {
	return text.slice(0, index).split('\n').length;
}

function addFinding(findings, file, sourceText, node, rule, detail) {
	findings.push({
		file,
		line: lineNumberAt(sourceText, node.getStart()),
		rule,
		detail,
	});
}

function staticString(node, constants) {
	if (ts.isStringLiteralLike(node)) return node.text;
	if (ts.isParenthesizedExpression(node)) return staticString(node.expression, constants);
	if (ts.isIdentifier(node)) return constants.get(node.text);
	if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
		const left = staticString(node.left, constants);
		const right = staticString(node.right, constants);
		return left === undefined || right === undefined ? undefined : left + right;
	}
	if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
	if (ts.isTemplateExpression(node)) {
		let value = node.head.text;
		for (const span of node.templateSpans) {
			const expression = staticString(span.expression, constants);
			if (expression === undefined) return undefined;
			value += expression + span.literal.text;
		}
		return value;
	}
	return undefined;
}

function callName(expression, constants) {
	if (ts.isIdentifier(expression)) return expression.text;
	if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
	if (ts.isElementAccessExpression(expression) && expression.argumentExpression) {
		return staticString(expression.argumentExpression, constants) ?? '';
	}
	return '';
}

function scriptKindForFile(file) {
	if (/\.tsx$/u.test(file)) return ts.ScriptKind.TSX;
	if (/\.jsx$/u.test(file)) return ts.ScriptKind.JSX;
	if (/\.[cm]?js$/u.test(file)) return ts.ScriptKind.JS;
	return ts.ScriptKind.TS;
}

export function inspectProductionSourceText(sourceText, file = '<source>') {
	const sourceFile = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, scriptKindForFile(file));
	const findings = [];
	const constants = new Map();
	const createRequireNames = new Set(['createRequire']);
	const createdRequireNames = new Set();

	for (const statement of sourceFile.statements) {
		if (!ts.isVariableStatement(statement)) continue;
		if (!(statement.declarationList.flags & ts.NodeFlags.Const)) continue;
		for (const declaration of statement.declarationList.declarations) {
			if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
			const value = staticString(declaration.initializer, constants);
			if (value !== undefined) constants.set(declaration.name.text, value);
		}
	}
	for (const statement of sourceFile.statements) {
		if (!ts.isImportDeclaration(statement) || !statement.importClause?.namedBindings) continue;
		if (staticString(statement.moduleSpecifier, constants) !== 'node:module') continue;
		if (!ts.isNamedImports(statement.importClause.namedBindings)) continue;
		for (const element of statement.importClause.namedBindings.elements) {
			if ((element.propertyName ?? element.name).text === 'createRequire') {
				createRequireNames.add(element.name.text);
			}
		}
	}
	function collectCreatedRequires(node) {
		if (
			ts.isVariableDeclaration(node)
			&& ts.isIdentifier(node.name)
			&& node.initializer
			&& ts.isCallExpression(node.initializer)
			&& createRequireNames.has(callName(node.initializer.expression, constants))
		) createdRequireNames.add(node.name.text);
		ts.forEachChild(node, collectCreatedRequires);
	}
	collectCreatedRequires(sourceFile);

	function visit(node) {
		if (
			(ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
			&& node.moduleSpecifier
			&& PROCESS_LAUNCH_MODULES.has(staticString(node.moduleSpecifier, constants))
		) {
			addFinding(findings, file, sourceText, node, 'process-launch-module', 'imports child_process');
		}

		if (ts.isCallExpression(node)) {
			const name = callName(node.expression, constants);
			const argument = node.arguments[0] ? staticString(node.arguments[0], constants) : undefined;
			const callsCreateRequireResult = ts.isCallExpression(node.expression)
				&& createRequireNames.has(callName(node.expression.expression, constants));
			if (
				(
					node.expression.kind === ts.SyntaxKind.ImportKeyword
					|| /require$/iu.test(name)
					|| createdRequireNames.has(name)
					|| callsCreateRequireResult
					|| name === 'getBuiltinModule'
				)
				&& PROCESS_LAUNCH_MODULES.has(argument)
			) {
				addFinding(findings, file, sourceText, node, 'process-launch-module', `loads ${argument}`);
			}
			if (name === 'binding' && argument && PROCESS_BINDINGS.has(argument)) {
				addFinding(findings, file, sourceText, node, 'process-launch-binding', `loads process binding ${argument}`);
			}
			if (
				name === 'openPath'
				|| name === 'openExternal'
				|| name === 'showItemInFolder'
				|| name === 'relaunch'
			) {
				addFinding(findings, file, sourceText, node, 'electron-external-launch', `uses Electron ${name}`);
			}
		}

		if (ts.isIdentifier(node) && node.text === 'utilityProcess') {
			addFinding(findings, file, sourceText, node, 'electron-utility-process', 'uses Electron utilityProcess');
		}
		if (ts.isIdentifier(node) && node.text === 'childProcess') {
			addFinding(findings, file, sourceText, node, 'process-launch-wrapper', 'uses the forbidden childProcess wrapper');
		}
		ts.forEachChild(node, visit);
	}
	visit(sourceFile);
	return findings;
}

export function inspectProductionBundleText(bundleText, file = 'main.js') {
	const rules = [
		['process-launch-module', /(?:node:)?child_process/u, 'contains a child_process module reference'],
		['electron-utility-process', /\butilityProcess\b/u, 'contains Electron utilityProcess'],
		['process-launch-binding', /\b(?:process_wrap|spawn_sync)\b/u, 'contains a process-launch binding'],
		['process-launch-wrapper', /\bchildProcess\b/u, 'contains the forbidden childProcess wrapper'],
		['process-launch-module', /(?:require|import|getBuiltinModule)\s*\(\s*["'](?:node:)?cluster["']/u, 'contains a cluster process-launch module reference'],
		['electron-external-launch', /\.(?:openPath|openExternal|showItemInFolder|relaunch)\s*\(/u, 'contains an Electron external-launch call'],
	];
	const findings = [];
	for (const [rule, pattern, detail] of rules) {
		const match = pattern.exec(bundleText);
		if (!match) continue;
		findings.push({ file, line: lineNumberAt(bundleText, match.index), rule, detail });
	}
	return findings;
}

function walkProductionSources(absoluteDir, relativeDir, files) {
	if (!fs.existsSync(absoluteDir)) return;
	for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
		const relativePath = path.join(relativeDir, entry.name);
		const absolutePath = path.join(absoluteDir, entry.name);
		if (entry.isDirectory()) {
			if (!TEST_SOURCE_PATTERN.test(relativePath)) walkProductionSources(absolutePath, relativePath, files);
			continue;
		}
		if (/\.[cm]?[jt]sx?$/u.test(entry.name) && !TEST_SOURCE_PATTERN.test(relativePath)) files.push(relativePath);
	}
}

export function collectProductionSourceFiles(rootDir) {
	const files = [];
	if (fs.existsSync(path.join(rootDir, 'main.ts'))) files.push('main.ts');
	walkProductionSources(path.join(rootDir, 'src'), 'src', files);
	return files.sort();
}

export function checkProductionProcessLaunchPolicy(rootDir, { requireBundle = true } = {}) {
	const findings = [];
	for (const relativePath of collectProductionSourceFiles(rootDir)) {
		findings.push(...inspectProductionSourceText(
			fs.readFileSync(path.join(rootDir, relativePath), 'utf8'),
			relativePath,
		));
	}
	const bundlePath = path.join(rootDir, 'main.js');
	if (requireBundle && !fs.existsSync(bundlePath)) {
		findings.push({ file: 'main.js', line: 1, rule: 'production-bundle-missing', detail: 'production bundle is missing' });
	} else if (fs.existsSync(bundlePath)) {
		findings.push(...inspectProductionBundleText(fs.readFileSync(bundlePath, 'utf8')));
	}
	return findings;
}

export function formatProcessLaunchFindings(findings) {
	return findings.map(finding => (
		`${finding.file}:${finding.line}: [${finding.rule}] ${finding.detail}`
	)).join('\n');
}
