import fs from 'node:fs';
import path from 'node:path';
import { ESLint } from 'eslint';
import parser from '@typescript-eslint/parser';
import tseslint from 'typescript-eslint';
import ts from 'typescript';

export const LIGHTBOX_TYPE_ASSERTION_FILES = Object.freeze([
	'src/ui/native-lightbox-lifecycle.ts',
	'src/ui/web-lightbox.ts',
]);
export const LIGHTBOX_TYPE_ASSERTION_RULE = '@typescript-eslint/no-unnecessary-type-assertion';

function configFailure(diagnostics) {
	return new Error(ts.formatDiagnostics(diagnostics, {
		getCanonicalFileName: file => file,
		getCurrentDirectory: () => process.cwd(),
		getNewLine: () => '\n',
	}));
}

export async function checkLightboxTypeAssertions(rootDir) {
	rootDir = path.resolve(rootDir);
	const configPath = path.join(rootDir, 'tsconfig.scorecard.json');
	const config = ts.readConfigFile(configPath, ts.sys.readFile);
	if (config.error) throw configFailure([config.error]);
	const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, rootDir, undefined, configPath);
	if (parsed.errors.length) throw configFailure(parsed.errors);
	const program = ts.createProgram(parsed.fileNames, { ...parsed.options, strictBindCallApply: true });
	for (const file of LIGHTBOX_TYPE_ASSERTION_FILES) {
		const absolute = path.join(rootDir, file);
		if (!fs.statSync(absolute).isFile() || !program.getSourceFile(absolute)) {
			throw new Error(`Lightbox assertion analysis requires ${file} in the scorecard project.`);
		}
	}
	const eslint = new ESLint({
		cwd: rootDir,
		overrideConfigFile: true,
		allowInlineConfig: false,
		overrideConfig: {
			files: [...LIGHTBOX_TYPE_ASSERTION_FILES],
			languageOptions: { parser, parserOptions: { programs: [program], tsconfigRootDir: rootDir } },
			plugins: { '@typescript-eslint': tseslint.plugin },
			rules: { [LIGHTBOX_TYPE_ASSERTION_RULE]: 'error' },
		},
	});
	const results = await eslint.lintFiles([...LIGHTBOX_TYPE_ASSERTION_FILES]);
	if (results.length !== LIGHTBOX_TYPE_ASSERTION_FILES.length) throw new Error('Incomplete lightbox assertion analysis.');
	return results.flatMap(result => result.messages.map(message => ({
		file: path.relative(rootDir, result.filePath).split(path.sep).join('/'),
		line: message.line ?? 1,
		column: message.column ?? 1,
		rule: message.ruleId ?? 'analysis',
		message: message.message,
	})));
}

export function formatLightboxTypeAssertionFindings(findings) {
	return findings.map(finding => `${finding.file}:${finding.line}:${finding.column} ${finding.rule}: ${finding.message}`).join('\n');
}

export async function runLightboxTypeAssertionCheck(rootDir, { log = console.log, error = console.error } = {}) {
	try {
		const findings = await checkLightboxTypeAssertions(rootDir);
		if (findings.length) {
			error(`Lightbox type assertion policy failed:\n${formatLightboxTypeAssertionFindings(findings)}`);
			return 1;
		}
		log('Lightbox type assertion policy passed (2 files).');
		return 0;
	} catch (cause) {
		error(`Lightbox type assertion analysis failed: ${cause instanceof Error ? cause.message : String(cause)}`);
		return 1;
	}
}
