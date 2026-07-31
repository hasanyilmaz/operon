import { spawn } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { win32 } from 'node:path';

const WINDOWS_EXECUTABLE_EXTENSIONS_V1 = ['.exe', '.com'] as const;

export function resolveObsidianExecutableV1(
	value: string,
	options: {
		platform?: NodeJS.Platform;
		env?: NodeJS.ProcessEnv;
		cwd?: string;
	} = {},
): string {
	if (value.length === 0 || value.includes('\0')) throw new Error('OBSIDIAN_BIN_INVALID');
	const platform = options.platform ?? process.platform;
	if (platform !== 'win32') return value;
	const env = options.env ?? process.env;
	const cwd = options.cwd ?? process.cwd();
	if (isWindowsExplicitPathV1(value)) {
		const absolute = win32.isAbsolute(value) ? value : win32.resolve(cwd, value);
		return assertWindowsExecutableFileV1(absolute);
	}
	const extension = win32.extname(value).toLocaleLowerCase('en-US');
	if (extension && !WINDOWS_EXECUTABLE_EXTENSIONS_V1.includes(
		extension as typeof WINDOWS_EXECUTABLE_EXTENSIONS_V1[number],
	)) throw new Error('OBSIDIAN_BIN_INVALID');
	const candidates = extension
		? [value]
		: WINDOWS_EXECUTABLE_EXTENSIONS_V1.map(candidate => `${value}${candidate}`);
	for (const directory of (env.PATH ?? '').split(win32.delimiter).filter(Boolean)) {
		for (const candidate of candidates) {
			try {
				return assertWindowsExecutableFileV1(win32.join(directory, candidate));
			} catch (error) {
				if (error instanceof Error && error.message === 'OBSIDIAN_BIN_NOT_FOUND') continue;
				throw error;
			}
		}
	}
	throw new Error('OBSIDIAN_BIN_NOT_FOUND');
}

export function terminateProcessTreeV1(
	pid: number | undefined,
	platform: NodeJS.Platform = process.platform,
): void {
	if (!pid || !Number.isSafeInteger(pid) || pid < 1) return;
	if (platform !== 'win32') {
		try {
			process.kill(pid, 'SIGTERM');
		} catch {
			// The child may already have exited.
		}
		return;
	}
	const systemRoot = process.env.SystemRoot && win32.isAbsolute(process.env.SystemRoot)
		? process.env.SystemRoot
		: 'C:\\Windows';
	const terminator = spawn(
		win32.join(systemRoot, 'System32', 'taskkill.exe'),
		['/pid', String(pid), '/t', '/f'],
		{
		stdio: 'ignore',
		windowsHide: true,
		shell: false,
		},
	);
	const fallback = () => {
		try {
			process.kill(pid, 'SIGKILL');
		} catch {
			// The target may already have exited.
		}
	};
	terminator.once('error', fallback);
	terminator.once('close', exitCode => {
		if (exitCode !== 0) fallback();
	});
	terminator.unref();
}

function isWindowsExplicitPathV1(value: string): boolean {
	return value.includes('\\')
		|| value.includes('/')
		|| /^[A-Za-z]:/u.test(value)
		|| value.startsWith('\\\\');
}

function assertWindowsExecutableFileV1(path: string): string {
	const extension = win32.extname(path).toLocaleLowerCase('en-US');
	if (!WINDOWS_EXECUTABLE_EXTENSIONS_V1.includes(
		extension as typeof WINDOWS_EXECUTABLE_EXTENSIONS_V1[number],
	)) throw new Error('OBSIDIAN_BIN_INVALID');
	try {
		const stat = lstatSync(path);
		if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('OBSIDIAN_BIN_INVALID');
		return path;
	} catch (error) {
		if (
			error
			&& typeof error === 'object'
			&& (error as Record<string, unknown>).code === 'ENOENT'
		) throw new Error('OBSIDIAN_BIN_NOT_FOUND');
		throw error;
	}
}
