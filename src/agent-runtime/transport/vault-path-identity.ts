/**
 * Produces the stable path representation used by both the desktop Runtime and
 * the CLI before hashing a canonical vault path. `realpath` has already
 * resolved links; this step only removes platform spelling differences that
 * must not create distinct vault identities.
 */
export function normalizeCanonicalVaultPathForIdentityV1(
	value: string,
	platform: string,
): string {
	if (value.length === 0 || value.includes('\0')) throw new Error('VAULT_PATH_UNAVAILABLE');
	let normalized = value.normalize('NFC');
	if (platform !== 'win32') return normalized;
	normalized = normalized.replace(/\//gu, '\\');
	if (/^\\\\\?\\UNC\\/iu.test(normalized)) {
		normalized = `\\\\${normalized.slice(8)}`;
	} else if (/^\\\\\?\\/u.test(normalized)) {
		normalized = normalized.slice(4);
	}
	return normalized.toLocaleLowerCase('en-US');
}

export function isCanonicalPathWithinRootV1(
	rootPath: string,
	targetPath: string,
	platform: string,
): boolean {
	const separator = platform === 'win32' ? '\\' : '/';
	const normalizedRoot = normalizeCanonicalPathForContainmentV1(rootPath, platform);
	const normalizedTarget = normalizeCanonicalPathForContainmentV1(targetPath, platform);
	if (normalizedTarget === normalizedRoot) return true;
	const rootPrefix = normalizedRoot.endsWith(separator)
		? normalizedRoot
		: `${normalizedRoot}${separator}`;
	return normalizedTarget.startsWith(rootPrefix);
}

function normalizeCanonicalPathForContainmentV1(
	value: string,
	platform: string,
): string {
	if (value.length === 0 || value.includes('\0')) throw new Error('VAULT_PATH_UNAVAILABLE');
	if (platform !== 'win32') return value;
	let normalized = value.replace(/\//gu, '\\');
	if (/^\\\\\?\\UNC\\/iu.test(normalized)) {
		normalized = `\\\\${normalized.slice(8)}`;
	} else if (/^\\\\\?\\/u.test(normalized)) {
		normalized = normalized.slice(4);
	}
	return normalized.toLocaleLowerCase('en-US');
}
