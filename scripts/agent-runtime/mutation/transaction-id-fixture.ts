import assert from 'node:assert/strict';
import { toLocalDatetime } from '../../../src/core/local-time';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { compileFunction } from 'node:vm';
import type * as TypeScript from 'typescript';
import { canonicalJsonV1, sha256HexV1, toJsonValueV1 } from '../../../src/agent-runtime/contracts/v1/canonical';
import { boundRuntimeTransactionIdV1 } from '../../../src/agent-runtime/runtime/transaction-identifiers';
import { resolveRuntimeIdentityGraphSourceBeforeContentV1 } from '../../../src/agent-runtime/runtime/identity-graph-source-state';
import { runtimeSemanticTransitionStepIdsV1 } from '../../../src/agent-runtime/runtime/semantic-transition';
import type { RuntimeMutationGatewayPortsV1 } from '../../../src/agent-runtime/runtime/mutation-gateway';
import type { GraphTransactionResourceStateV1 } from '../../../src/agent-runtime/runtime/receipts/graph-transaction-journal';

const ts = createRequire(resolve('package.json'))('typescript') as typeof TypeScript;
const source = ts.createSourceFile('main.ts', readFileSync('main.ts', 'utf8'), ts.ScriptTarget.Latest, true);

export function transactionState(content: string | null): GraphTransactionResourceStateV1 {
	return content === null
		? { state: 'absent', digest: sha256HexV1(''), content: null }
		: { state: 'present', digest: sha256HexV1(content), content };
}

/** Execute the production port, replacing only its Obsidian environment. */
export function runtimeTransactionPort<K extends keyof RuntimeMutationGatewayPortsV1>(
	name: K,
	bindings: Record<string, unknown> = {},
	host: object = {},
): NonNullable<RuntimeMutationGatewayPortsV1[K]> {
	const matches: TypeScript.Expression[] = [];
	const visit = (node: TypeScript.Node): void => {
		if (ts.isPropertyAssignment(node) && node.name.getText(source) === name) matches.push(node.initializer);
		ts.forEachChild(node, visit);
	};
	visit(source);
	assert.equal(matches.length, 1, `Unique production port: ${name}`);
	const code = ts.transpileModule(`(function () { return ${matches[0].getText(source)}; }).call(host)`, {
		compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
	}).outputText;
	const environment = {
		host, toLocalDatetime, boundRuntimeTransactionIdV1, canonicalJsonV1, sha256HexV1, toJsonValueV1,
		runtimeSemanticTransitionStepIdsV1, resolveRuntimeIdentityGraphSourceBeforeContentV1,
		graphResourceState: transactionState,
		...bindings,
	};
	return compileFunction(`return ${code}`, Object.keys(environment))(...Object.values(environment)) as NonNullable<RuntimeMutationGatewayPortsV1[K]>;
}

/** Exercise a private Plugin method without loading Obsidian or changing production seams. */
export function runtimeMainMethod(name: string, bindings: Record<string, unknown>): (...args: unknown[]) => unknown {
	const methods: TypeScript.MethodDeclaration[] = [];
	const visit = (node: TypeScript.Node): void => {
		if (ts.isMethodDeclaration(node) && node.name.getText(source) === name) methods.push(node);
		ts.forEachChild(node, visit);
	};
	visit(source);
	assert.equal(methods.length, 1);
	const method = methods[0];
	const asyncKeyword = method.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword) ? 'async ' : '';
	const code = ts.transpileModule(`(${asyncKeyword}function (${method.parameters.map(parameter => parameter.getText(source)).join(',')}) ${method.body!.getText(source)})`, {
		compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
	}).outputText;
	const environment = { canonicalJsonV1, toJsonValueV1, sha256HexV1, boundRuntimeTransactionIdV1, ...bindings };
	return compileFunction(`return ${code}`, Object.keys(environment))(...Object.values(environment)) as (...args: unknown[]) => unknown;
}
