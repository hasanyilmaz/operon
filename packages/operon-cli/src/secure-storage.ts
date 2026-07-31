import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
	chmodSync,
	closeSync,
	lstatSync,
	mkdirSync,
	openSync,
	readdirSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

export type CliStorageSecurityBackendV1 = 'posix-mode' | 'windows-dacl';

export interface CliStorageSecurityStatusV1 {
	backend: CliStorageSecurityBackendV1;
	secure: boolean;
	failureReason?: string;
}

const OPERON_CLI_ROOT_FILES_V1 = new Set([
	'client-v1.json',
	'client-v1.json.initialized',
	'config-v1.json',
	'update-check-v1.json',
]);
const OPERON_CLI_ROOT_DIRECTORIES_V1 = new Set(['plans']);
const POWERSHELL_RESULT_LIMIT_V1 = 16_384;

export function cliStorageSecurityBackendV1(
	platform: NodeJS.Platform = process.platform,
): CliStorageSecurityBackendV1 {
	return platform === 'win32' ? 'windows-dacl' : 'posix-mode';
}

export function ensureSecureDirectoryV1(
	path: string,
	platform: NodeJS.Platform = process.platform,
): void {
	mkdirSync(path, { recursive: true, mode: 0o700 });
	assertSecurePathKindV1(path, 'directory', platform);
	if (platform === 'win32') {
		applyAndVerifyWindowsOwnerOnlyAclV1(path, 'directory');
		return;
	}
	chmodSync(path, 0o700);
	assertSecurePathKindV1(path, 'directory', platform);
}

export function assertSecureFileV1(
	path: string,
	platform: NodeJS.Platform = process.platform,
): void {
	assertSecurePathKindV1(path, 'file', platform);
	if (platform === 'win32') verifyWindowsOwnerOnlyAclV1(path, 'file');
}

export function secureCreatedFileV1(
	path: string,
	platform: NodeJS.Platform = process.platform,
): void {
	if (platform === 'win32') applyAndVerifyWindowsOwnerOnlyAclV1(path, 'file');
	else chmodSync(path, 0o600);
	assertSecureFileV1(path, platform);
}

export function writeSecureJsonAtomicV1(
	path: string,
	value: unknown,
	platform: NodeJS.Platform = process.platform,
): void {
	ensureSecureDirectoryV1(dirname(path), platform);
	const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
	let descriptor: number | null = null;
	try {
		descriptor = openSync(temporary, 'wx', 0o600);
		writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
		closeSync(descriptor);
		descriptor = null;
		if (platform === 'win32') applyAndVerifyWindowsOwnerOnlyAclV1(temporary, 'file');
		renameSync(temporary, path);
		if (platform !== 'win32') chmodSync(path, 0o600);
		assertSecureFileV1(path, platform);
	} finally {
		if (descriptor !== null) closeSync(descriptor);
		try {
			unlinkSync(temporary);
		} catch {
			// The atomic rename normally consumes the temporary file.
		}
	}
}

export function inspectCliStorageSecurityV1(
	root: string,
	platform: NodeJS.Platform = process.platform,
): CliStorageSecurityStatusV1 {
	const backend = cliStorageSecurityBackendV1(platform);
	try {
		assertSecurePathKindV1(root, 'directory', platform);
		if (platform === 'win32') verifyWindowsOwnerOnlyAclV1(root, 'directory');
		for (const entry of readdirSync(root, { withFileTypes: true })) {
			if (entry.isSymbolicLink()) throw new Error('SECURITY_REPARSE_POINT');
			const child = join(root, entry.name);
			if (entry.isDirectory()) {
				if (!OPERON_CLI_ROOT_DIRECTORIES_V1.has(entry.name)) {
					throw new Error('SECURITY_FOREIGN_CONTENT');
				}
				assertSecurePathKindV1(child, 'directory', platform);
				if (platform === 'win32') verifyWindowsOwnerOnlyAclV1(child, 'directory');
				inspectPlansDirectoryV1(child, platform);
				continue;
			}
			if (!entry.isFile() || !isRecognizedRootFileV1(entry.name)) {
				throw new Error('SECURITY_FOREIGN_CONTENT');
			}
			assertSecureFileV1(child, platform);
		}
		return { backend, secure: true };
	} catch (error) {
		return {
			backend,
			secure: false,
			failureReason: error instanceof Error ? error.message : 'SECURITY_CHECK_FAILED',
		};
	}
}

export function repairCliStorageSecurityV1(
	root: string,
	platform: NodeJS.Platform = process.platform,
): CliStorageSecurityStatusV1 {
	const stat = lstatSync(root);
	if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('SECURITY_ROOT_NOT_REPAIRABLE');
	const entries = readdirSync(root, { withFileTypes: true });
	for (const entry of entries) {
		if (
			entry.isSymbolicLink()
			|| (entry.isDirectory() && !OPERON_CLI_ROOT_DIRECTORIES_V1.has(entry.name))
			|| (entry.isFile() && !isRecognizedRootFileV1(entry.name))
			|| (!entry.isDirectory() && !entry.isFile())
		) {
			throw new Error(entry.isSymbolicLink()
				? 'SECURITY_REPARSE_POINT'
				: 'SECURITY_FOREIGN_CONTENT');
		}
	}
	if (platform === 'win32') applyAndVerifyWindowsOwnerOnlyAclV1(root, 'directory');
	else chmodSync(root, 0o700);
		for (const entry of entries) {
			const child = join(root, entry.name);
			if (entry.isDirectory()) {
			if (platform === 'win32') applyAndVerifyWindowsOwnerOnlyAclV1(child, 'directory');
			else chmodSync(child, 0o700);
			repairPlansDirectoryV1(child, platform);
				continue;
			}
			if (isRecognizedAtomicRootTempV1(entry.name)) {
				assertSecureFileV1(child, platform);
				unlinkSync(child);
				continue;
			}
			if (platform === 'win32') applyAndVerifyWindowsOwnerOnlyAclV1(child, 'file');
			else chmodSync(child, 0o600);
	}
	const status = inspectCliStorageSecurityV1(root, platform);
	if (!status.secure) throw new Error(status.failureReason ?? 'SECURITY_REPAIR_FAILED');
	return status;
}

function assertSecurePathKindV1(
	path: string,
	kind: 'file' | 'directory',
	platform: NodeJS.Platform,
): void {
	const stat = lstatSync(path);
	if (
		stat.isSymbolicLink()
		|| (kind === 'file' ? !stat.isFile() : !stat.isDirectory())
	) throw new Error(kind === 'file' ? 'SECURE_FILE_INVALID' : 'SECURE_DIRECTORY_INVALID');
	if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
		throw new Error('SECURITY_WRONG_OWNER');
	}
	if (platform !== 'win32') {
		const forbidden = kind === 'file' ? 0o077 : 0o077;
		if ((stat.mode & forbidden) !== 0) throw new Error('SECURITY_WRONG_MODE');
	}
}

function isRecognizedRootFileV1(name: string): boolean {
	return OPERON_CLI_ROOT_FILES_V1.has(name)
		|| isRecognizedAtomicRootTempV1(name);
}

function isRecognizedAtomicRootTempV1(name: string): boolean {
	const match = /^(.+)\.(\d+)\.([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.tmp$/iu.exec(name);
	return match !== null && OPERON_CLI_ROOT_FILES_V1.has(match[1] ?? '');
}

function inspectPlansDirectoryV1(path: string, platform: NodeJS.Platform): void {
	for (const entry of readdirSync(path, { withFileTypes: true })) {
		if (
			entry.isSymbolicLink()
			|| !entry.isFile()
			|| !isRecognizedPlanFileV1(entry.name)
		) throw new Error(entry.isSymbolicLink()
			? 'SECURITY_REPARSE_POINT'
			: 'SECURITY_FOREIGN_CONTENT');
		assertSecureFileV1(join(path, entry.name), platform);
	}
}

function repairPlansDirectoryV1(path: string, platform: NodeJS.Platform): void {
	for (const entry of readdirSync(path, { withFileTypes: true })) {
		if (
			entry.isSymbolicLink()
			|| !entry.isFile()
			|| !isRecognizedPlanFileV1(entry.name)
		) throw new Error(entry.isSymbolicLink()
			? 'SECURITY_REPARSE_POINT'
			: 'SECURITY_FOREIGN_CONTENT');
		secureCreatedFileV1(join(path, entry.name), platform);
	}
}

function isRecognizedPlanFileV1(name: string): boolean {
	return /^[A-Za-z0-9_-]{32}\.json$/u.test(name)
		|| name === '.dispatch-capacity.lock'
		|| /^\.dispatch-capacity\.lock\.stale\.\d+\.[A-Za-z0-9-]+$/u.test(name);
}

function applyAndVerifyWindowsOwnerOnlyAclV1(
	path: string,
	kind: 'file' | 'directory',
): void {
	runWindowsAclScriptV1(path, kind, true);
}

function verifyWindowsOwnerOnlyAclV1(path: string, kind: 'file' | 'directory'): void {
	runWindowsAclScriptV1(path, kind, false);
}

function runWindowsAclScriptV1(
	path: string,
	kind: 'file' | 'directory',
	repair: boolean,
): void {
	const script = [
		'$ErrorActionPreference = "Stop"',
		'$p = [Environment]::GetEnvironmentVariable("OPERON_SECURITY_PATH", "Process")',
		'$expectedKind = [Environment]::GetEnvironmentVariable("OPERON_SECURITY_KIND", "Process")',
		'$repair = [Environment]::GetEnvironmentVariable("OPERON_SECURITY_REPAIR", "Process") -eq "1"',
		'$item = Get-Item -LiteralPath $p -Force',
		'$cursor = $item',
		'while ($null -ne $cursor) { if (($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "SECURITY_REPARSE_POINT" }; $cursor = $cursor.Parent }',
		'if ($expectedKind -eq "directory" -and -not $item.PSIsContainer) { throw "SECURE_DIRECTORY_INVALID" }',
		'if ($expectedKind -eq "file" -and $item.PSIsContainer) { throw "SECURE_FILE_INVALID" }',
		'$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User',
		'if ($repair) {',
		'  $acl = New-Object Security.AccessControl.FileSecurity',
		'  if ($expectedKind -eq "directory") { $acl = New-Object Security.AccessControl.DirectorySecurity }',
		'  $acl.SetOwner($sid)',
		'  $acl.SetAccessRuleProtection($true, $false)',
		'  $rights = [Security.AccessControl.FileSystemRights]::FullControl',
		'  $inherit = [Security.AccessControl.InheritanceFlags]::None',
		'  if ($expectedKind -eq "directory") { $inherit = [Security.AccessControl.InheritanceFlags]"ContainerInherit, ObjectInherit" }',
		'  $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, $rights, $inherit, [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow)',
		'  $acl.AddAccessRule($rule)',
		'  Set-Acl -LiteralPath $p -AclObject $acl',
		'}',
		'$actual = Get-Acl -LiteralPath $p',
		'if ($actual.Owner -ne $sid.Value -and $actual.Owner -ne ([Security.Principal.WindowsIdentity]::GetCurrent().Name)) { throw "SECURITY_WRONG_OWNER" }',
		'if (-not $actual.AreAccessRulesProtected) { throw "SECURITY_ACL_INHERITED" }',
		'$bad = @()',
		'foreach ($access in $actual.Access) {',
		'  try { $accessSid = $access.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value } catch { $accessSid = "" }',
		'  if ($access.AccessControlType -ne "Allow" -or $accessSid -ne $sid.Value) { $bad += $access }',
		'}',
		'if ($bad.Count -ne 0) { throw "SECURITY_ACL_TOO_BROAD" }',
		'@{ ok = $true; owner = $sid.Value } | ConvertTo-Json -Compress',
	].join('; ');
	const result = spawnSync('powershell.exe', [
		'-NoLogo',
		'-NoProfile',
		'-NonInteractive',
		'-ExecutionPolicy',
		'Bypass',
		'-Command',
		script,
	], {
		encoding: 'utf8',
		windowsHide: true,
		shell: false,
		env: {
			...process.env,
			OPERON_SECURITY_PATH: path,
			OPERON_SECURITY_KIND: kind,
			OPERON_SECURITY_REPAIR: repair ? '1' : '0',
		},
		maxBuffer: POWERSHELL_RESULT_LIMIT_V1,
	});
	if (result.error || result.status !== 0) {
		const detail = (result.stderr || result.error?.message || '').trim();
		throw new Error(detail.includes('SECURITY_') ? detail : 'SECURITY_ACL_UNAVAILABLE');
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(result.stdout.trim()) as unknown;
	} catch {
		throw new Error('SECURITY_ACL_INVALID_RESULT');
	}
	if (
		!parsed
		|| typeof parsed !== 'object'
		|| Array.isArray(parsed)
		|| (parsed as Record<string, unknown>).ok !== true
	) throw new Error('SECURITY_ACL_INVALID_RESULT');
}
