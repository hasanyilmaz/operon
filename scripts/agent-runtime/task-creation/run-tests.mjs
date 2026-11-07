import {pluginHostFixture} from './plugin-host-loader.mjs';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const dir = await mkdtemp(path.join(tmpdir(), 'operon-task-creation-'));
try {
 const outfile = path.join(dir, 'tests.cjs');
 await build({ stdin: { contents: "import './scripts/agent-runtime/task-creation/extension.test.ts'; import './scripts/agent-runtime/task-creation/preparation.test.ts'; import './scripts/agent-runtime/task-creation/definition-journal.test.ts'; import './scripts/agent-runtime/task-creation/materializer.test.ts'; import './scripts/agent-runtime/task-creation/execution.test.ts'; import './scripts/agent-runtime/task-creation/plugin-preparation.test.ts'; import './scripts/agent-runtime/task-creation/developer-session.test.ts';", resolveDir: process.cwd() }, plugins:[await pluginHostFixture()], bundle: true, outfile, format: 'cjs', platform: 'node', logLevel: 'silent', alias: { obsidian: path.resolve('scripts/test-support/obsidian-native-yaml.ts') } });
 const result = spawnSync(process.execPath, ['--test', outfile], { stdio: 'inherit' });
 if (result.status !== 0) process.exitCode = result.status ?? 1;
} finally { await rm(dir, { recursive: true, force: true }); }
