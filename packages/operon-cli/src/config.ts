import {
	lstatSync,
	readFileSync,
	readdirSync,
	realpathSync,
} from 'node:fs';
import { homedir } from 'node:os';
import {
	dirname,
	join,
	posix,
	resolve,
	win32,
} from 'node:path';

import {
	type CanonicalVaultFenceV1,
	type CliBenchmarkSpanSinkV1,
	assertCanonicalVaultFenceV1,
	canonicalVaultIdentityV1,
	createCanonicalVaultFenceV1,
} from './protocol';
import {
	assertSecureFileV1,
	ensureSecureDirectoryV1,
	writeSecureJsonAtomicV1,
} from './secure-storage';

const PROFILE_NAME_PATTERN_V1 = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;

export interface OperonCliVaultProfileV1 {
	name: string;
	canonicalPath: string;
	vaultSha256: string;
	verifiedAt: string;
}

export interface OperonCliConfigV1 {
	version: 1;
	defaultProfile?: string;
	profiles: OperonCliVaultProfileV1[];
}

export interface ResolvedVaultV1 {
	profile?: string;
	canonicalPath: string;
	vaultSha256: string;
}

interface SecureFileFingerprintV1 {
	dev: number;
	ino: number;
	size: number;
	mtimeMs: number;
	ctimeMs: number;
	uid: number;
	mode: number;
}

export interface ResolvedVaultCommandScopeV1 extends ResolvedVaultV1 {
	vaultFence: CanonicalVaultFenceV1;
	configPath: string;
	configFingerprint: SecureFileFingerprintV1 | null;
}

export function operonCliConfigRootV1(
	env: NodeJS.ProcessEnv = process.env,
	platform: NodeJS.Platform = process.platform,
	home: string = homedir(),
): string {
	if (env.OPERON_CONFIG_HOME) return resolve(env.OPERON_CONFIG_HOME);
	if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'Operon', 'cli');
	if (platform === 'win32') {
		const appData = env.APPDATA;
		if (!appData) throw new Error('CONFIG_ROOT_UNAVAILABLE');
		return join(appData, 'Operon', 'cli');
	}
	return join(env.XDG_CONFIG_HOME ?? join(home, '.config'), 'operon', 'cli');
}

export function configPathV1(root: string = operonCliConfigRootV1()): string {
	return join(root, 'config-v1.json');
}

export function loadOperonCliConfigV1(root: string = operonCliConfigRootV1()): OperonCliConfigV1 {
	const path = configPathV1(root);
	try {
		assertOwnerOnlyFile(path);
		const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
		return decodeConfig(parsed);
	} catch (error) {
		if (hasErrorCode(error, 'ENOENT')) return { version: 1, profiles: [] };
		throw error;
	}
}

export function saveOperonCliConfigV1(
	config: OperonCliConfigV1,
	root: string = operonCliConfigRootV1(),
): void {
	const normalized = decodeConfig(config);
	writeJsonAtomic(configPathV1(root), normalized);
}

export function upsertVaultProfileV1(
	config: OperonCliConfigV1,
	input: {
		name: string;
		vaultPath: string;
		makeDefault?: boolean;
		now?: string;
		platform?: NodeJS.Platform;
	},
): OperonCliConfigV1 {
	if (!PROFILE_NAME_PATTERN_V1.test(input.name)) throw new Error('INVALID_PROFILE_NAME');
	const vault = resolveExistingVaultIdentity(input.vaultPath);
	validateOperonManifestV1(vault.canonicalPath);
	const profile: OperonCliVaultProfileV1 = {
		name: input.name,
		canonicalPath: vault.canonicalPath,
		vaultSha256: vault.sha256,
		verifiedAt: input.now ?? new Date().toISOString(),
	};
	const transportNameCollision = config.profiles.some(candidate => (
		candidate.name !== profile.name
		&& !samePlatformPathV1(candidate.canonicalPath, profile.canonicalPath, input.platform)
		&& platformBasenameV1(candidate.canonicalPath, input.platform)
			=== platformBasenameV1(profile.canonicalPath, input.platform)
	));
	if (transportNameCollision) throw new Error('VAULT_NAME_AMBIGUOUS');
	const profiles = config.profiles
		.filter(candidate => candidate.name !== profile.name)
		.concat(profile)
		.sort((left, right) => left.name.localeCompare(right.name));
	const makeDefault = input.makeDefault === true || profiles.length === 1;
	return decodeConfig({
		version: 1,
		...(makeDefault
			? { defaultProfile: profile.name }
			: config.defaultProfile ? { defaultProfile: config.defaultProfile } : {}),
		profiles,
	});
}

export function removeVaultProfileV1(
	config: OperonCliConfigV1,
	name: string,
): OperonCliConfigV1 {
	const profiles = config.profiles.filter(profile => profile.name !== name);
	if (profiles.length === config.profiles.length) throw new Error('PROFILE_NOT_FOUND');
	return {
		version: 1,
		...(config.defaultProfile && config.defaultProfile !== name
			? { defaultProfile: config.defaultProfile }
			: {}),
		profiles,
	};
}

export function setDefaultVaultProfileV1(
	config: OperonCliConfigV1,
	name: string,
): OperonCliConfigV1 {
	if (!config.profiles.some(profile => profile.name === name)) throw new Error('PROFILE_NOT_FOUND');
	return { ...config, defaultProfile: name };
}

export function resolveVaultV1(
	config: OperonCliConfigV1,
	input: {
		explicitVault?: string;
		explicitProfile?: string;
		cwd?: string;
		platform?: NodeJS.Platform;
	},
): ResolvedVaultV1 {
	assertUniqueTransportVaultNames(config.profiles, input.platform);
	if (input.explicitVault) {
		const vault = resolveExistingVaultIdentity(input.explicitVault);
		return { canonicalPath: vault.canonicalPath, vaultSha256: vault.sha256 };
	}
	if (input.explicitProfile) return resolvedProfile(config, input.explicitProfile);
	const cwd = input.cwd ? safeRealpath(input.cwd) : undefined;
	if (cwd) {
		const matching = config.profiles.filter(profile => (
			isPlatformPathWithinV1(profile.canonicalPath, cwd, input.platform)
		));
		if (matching.length === 1) return resolvedProfile(config, matching[0].name);
		if (matching.length > 1) {
			const mostSpecific = [...matching].sort((left, right) => (
				right.canonicalPath.length - left.canonicalPath.length
			));
			if (mostSpecific[0].canonicalPath.length > mostSpecific[1].canonicalPath.length) {
				return resolvedProfile(config, mostSpecific[0].name);
			}
			throw new Error('VAULT_PROFILE_AMBIGUOUS');
		}
	}
	if (config.defaultProfile) return resolvedProfile(config, config.defaultProfile);
	if (config.profiles.length === 1) return resolvedProfile(config, config.profiles[0].name);
	throw new Error(config.profiles.length === 0 ? 'VAULT_NOT_CONFIGURED' : 'VAULT_PROFILE_REQUIRED');
}

export function createResolvedVaultCommandScopeV1(
	input: {
		explicitVault?: string;
		explicitProfile?: string;
		cwd?: string;
	},
	root: string = operonCliConfigRootV1(),
	benchmarkSpan?: CliBenchmarkSpanSinkV1,
): ResolvedVaultCommandScopeV1 {
	const path = configPathV1(root);
	const configStartedAt = performance.now();
	const before = secureFileFingerprintOrMissing(path);
	const config = loadOperonCliConfigV1(root);
	const after = secureFileFingerprintOrMissing(path);
	benchmarkSpan?.('config-load-decode', Math.max(0, performance.now() - configStartedAt));
	if (
		(before === null) !== (after === null)
		|| (before !== null && after !== null && !sameSecureFileFingerprint(before, after))
	) {
		throw new Error('CONFIG_CHANGED_DURING_RESOLUTION');
	}
	const vaultStartedAt = performance.now();
	const resolved = resolveVaultV1(config, input);
	const vaultFence = createCanonicalVaultFenceV1(resolved.canonicalPath);
	benchmarkSpan?.('vault-resolution', Math.max(0, performance.now() - vaultStartedAt));
	return {
		...resolved,
		vaultFence,
		configPath: path,
		configFingerprint: after,
	};
}

export function assertResolvedVaultCommandScopeV1(
	scope: ResolvedVaultCommandScopeV1,
): void {
	assertCanonicalVaultFenceV1(scope.vaultFence);
	try {
		const current = secureFileFingerprintOrMissing(scope.configPath);
		if (
			(scope.configFingerprint === null) !== (current === null)
			|| (
				scope.configFingerprint !== null
				&& current !== null
				&& !sameSecureFileFingerprint(scope.configFingerprint, current)
			)
		) {
			throw new Error('CONFIG_TARGET_CHANGED');
		}
	} catch (error) {
		if (error instanceof Error && error.message === 'CONFIG_TARGET_CHANGED') throw error;
		throw new Error('CONFIG_TARGET_CHANGED');
	}
}

function resolveExistingVaultIdentity(vaultPath: string): ReturnType<typeof canonicalVaultIdentityV1> {
	try {
		const vault = canonicalVaultIdentityV1(vaultPath);
		if (!lstatSync(vault.canonicalPath).isDirectory()) throw new Error('VAULT_NOT_DIRECTORY');
		return vault;
	} catch (error) {
		if (error instanceof Error && error.message === 'VAULT_NOT_DIRECTORY') throw error;
		throw new Error('VAULT_PATH_UNAVAILABLE');
	}
}

export function validateOperonManifestV1(vaultPath: string): {
	id: 'operon';
	version: string;
	minAppVersion: string;
} {
	const configDirectories = readdirSync(vaultPath, { withFileTypes: true })
		.filter(entry => entry.isDirectory() && entry.name.startsWith('.') && entry.name.length <= 128)
		.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
	if (configDirectories.length > 64) throw new Error('OPERON_CONFIG_DIRECTORY_SCAN_LIMIT');
	const manifestPaths = configDirectories
		.map(entry => join(vaultPath, entry.name, 'plugins', 'operon', 'manifest.json'))
		.filter(path => {
			try {
				const configPath = dirname(dirname(dirname(path)));
				const pluginsPath = dirname(dirname(path));
				const operonPath = dirname(path);
				for (const directory of [configPath, pluginsPath, operonPath]) {
					const stat = lstatSync(directory);
					if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
				}
				assertRegularFile(path);
				return true;
			} catch {
				return false;
			}
		});
	if (manifestPaths.length !== 1) {
		throw new Error(manifestPaths.length === 0
			? 'OPERON_PLUGIN_NOT_FOUND'
			: 'OPERON_CONFIG_DIRECTORY_AMBIGUOUS');
	}
	const manifestPath = manifestPaths[0];
	const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown;
	if (!isPlainRecord(parsed) || parsed.id !== 'operon') throw new Error('OPERON_PLUGIN_NOT_FOUND');
	if (typeof parsed.version !== 'string' || typeof parsed.minAppVersion !== 'string') {
		throw new Error('OPERON_MANIFEST_INVALID');
	}
	return {
		id: 'operon',
		version: parsed.version,
		minAppVersion: parsed.minAppVersion,
	};
}

export function ensureOwnerOnlyDirectory(path: string): void {
	ensureSecureDirectoryV1(path);
}

export function writeJsonAtomic(path: string, value: unknown): void {
	writeSecureJsonAtomicV1(path, value);
}

function resolvedProfile(config: OperonCliConfigV1, name: string): ResolvedVaultV1 {
	const profile = config.profiles.find(candidate => candidate.name === name);
	if (!profile) throw new Error('PROFILE_NOT_FOUND');
	let canonicalPath: string;
	try {
		canonicalPath = realpathSync(profile.canonicalPath);
	} catch {
		throw new Error('VAULT_PROFILE_MOVED');
	}
	const identity = canonicalVaultIdentityV1(canonicalPath);
	if (identity.sha256 !== profile.vaultSha256) throw new Error('VAULT_PROFILE_MOVED');
	return { profile: profile.name, canonicalPath, vaultSha256: identity.sha256 };
}

function decodeConfig(value: unknown): OperonCliConfigV1 {
	if (!isPlainRecord(value)) throw new Error('CONFIG_MALFORMED');
	const allowed = new Set(['version', 'defaultProfile', 'profiles']);
	if (Object.keys(value).some(key => !allowed.has(key))) throw new Error('CONFIG_UNKNOWN_FIELD');
	if (value.version !== 1 || !Array.isArray(value.profiles)) throw new Error('CONFIG_MALFORMED');
	const names = new Set<string>();
	const profiles = value.profiles.map(item => {
		if (!isPlainRecord(item)) throw new Error('CONFIG_MALFORMED');
		if (Object.keys(item).some(key => !['name', 'canonicalPath', 'vaultSha256', 'verifiedAt'].includes(key))) {
			throw new Error('CONFIG_UNKNOWN_FIELD');
		}
		if (
			typeof item.name !== 'string'
			|| !PROFILE_NAME_PATTERN_V1.test(item.name)
			|| typeof item.canonicalPath !== 'string'
			|| !/^[a-f0-9]{64}$/u.test(String(item.vaultSha256))
			|| typeof item.verifiedAt !== 'string'
		) throw new Error('CONFIG_MALFORMED');
		if (names.has(item.name)) throw new Error('CONFIG_DUPLICATE_PROFILE');
		names.add(item.name);
		return {
			name: item.name,
			canonicalPath: item.canonicalPath,
			vaultSha256: String(item.vaultSha256),
			verifiedAt: item.verifiedAt,
		};
	});
	assertUniqueTransportVaultNames(profiles);
	if (
		value.defaultProfile !== undefined
		&& (typeof value.defaultProfile !== 'string' || !names.has(value.defaultProfile))
	) throw new Error('CONFIG_DEFAULT_PROFILE_INVALID');
	return {
		version: 1,
		...(typeof value.defaultProfile === 'string' ? { defaultProfile: value.defaultProfile } : {}),
		profiles,
	};
}

function assertUniqueTransportVaultNames(
	profiles: readonly OperonCliVaultProfileV1[],
	platform: NodeJS.Platform = process.platform,
): void {
	const pathsByTransportName = new Map<string, string>();
	for (const profile of profiles) {
		const transportName = normalizedPathSegmentV1(platformBasenameV1(
			profile.canonicalPath,
			platform,
		), platform);
		const existing = pathsByTransportName.get(transportName);
		if (existing && !samePlatformPathV1(existing, profile.canonicalPath, platform)) {
			throw new Error('VAULT_NAME_AMBIGUOUS');
		}
		pathsByTransportName.set(transportName, profile.canonicalPath);
	}
}

function assertOwnerOnlyFile(path: string): void {
	try {
		assertSecureFileV1(path);
	} catch (error) {
		if (
			error
			&& typeof error === 'object'
			&& typeof (error as Record<string, unknown>).code === 'string'
		) throw error;
		const reason = error instanceof Error ? error.message : '';
		if (reason === 'SECURITY_WRONG_OWNER') throw new Error('CONFIG_FILE_WRONG_OWNER');
		if (reason === 'SECURITY_WRONG_MODE') throw new Error('CONFIG_FILE_WRONG_MODE');
		throw new Error('CONFIG_FILE_NOT_SECURE');
	}
}

function secureFileFingerprint(path: string): SecureFileFingerprintV1 {
	assertOwnerOnlyFile(path);
	const stat = lstatSync(path);
	const currentUid = typeof process.getuid === 'function' ? process.getuid() : null;
	if (
		!stat.isFile()
		|| stat.isSymbolicLink()
		|| (currentUid !== null && stat.uid !== currentUid)
		|| (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)
	) {
		throw new Error('CONFIG_FILE_NOT_SECURE');
	}
	return {
		dev: stat.dev,
		ino: stat.ino,
		size: stat.size,
		mtimeMs: stat.mtimeMs,
		ctimeMs: stat.ctimeMs,
		uid: stat.uid,
		mode: stat.mode,
	};
}

function secureFileFingerprintOrMissing(path: string): SecureFileFingerprintV1 | null {
	try {
		return secureFileFingerprint(path);
	} catch (error) {
		if (hasErrorCode(error, 'ENOENT')) return null;
		throw error;
	}
}

function sameSecureFileFingerprint(
	left: SecureFileFingerprintV1,
	right: SecureFileFingerprintV1,
): boolean {
	return left.dev === right.dev
		&& left.ino === right.ino
		&& left.size === right.size
		&& left.mtimeMs === right.mtimeMs
		&& left.ctimeMs === right.ctimeMs
		&& left.uid === right.uid
		&& left.mode === right.mode;
}

function assertRegularFile(path: string): void {
	const stat = lstatSync(path);
	if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('OPERON_MANIFEST_INVALID');
}

function safeRealpath(path: string): string | undefined {
	try {
		return realpathSync(path);
	} catch {
		return undefined;
	}
}

export function isPlatformPathWithinV1(
	parentPath: string,
	candidatePath: string,
	platform: NodeJS.Platform = process.platform,
): boolean {
	const pathApi = platform === 'win32' ? win32 : posix;
	const parent = normalizedPlatformPathV1(parentPath, platform);
	const candidate = normalizedPlatformPathV1(candidatePath, platform);
	const relation = pathApi.relative(parent, candidate);
	return relation === ''
		|| (!relation.startsWith(`..${pathApi.sep}`)
			&& relation !== '..'
			&& !pathApi.isAbsolute(relation));
}

export function samePlatformPathV1(
	left: string,
	right: string,
	platform: NodeJS.Platform = process.platform,
): boolean {
	return normalizedPlatformPathV1(left, platform) === normalizedPlatformPathV1(right, platform);
}

export function normalizedPlatformPathV1(
	value: string,
	platform: NodeJS.Platform = process.platform,
): string {
	const pathApi = platform === 'win32' ? win32 : posix;
	const normalized = pathApi.normalize(value).normalize('NFC');
	return platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized;
}

function platformBasenameV1(
	value: string,
	platform: NodeJS.Platform = process.platform,
): string {
	return (platform === 'win32' ? win32 : posix).basename(value);
}

function normalizedPathSegmentV1(
	value: string,
	platform: NodeJS.Platform,
): string {
	const normalized = value.normalize('NFC');
	return platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
	const prototype = Reflect.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function hasErrorCode(error: unknown, code: string): boolean {
	return !!error && typeof error === 'object' && (error as Record<string, unknown>).code === code;
}
