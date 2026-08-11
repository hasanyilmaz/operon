const WINDOWS_RESERVED_SEGMENT = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const WINDOWS_DRIVE_PATH = /^[a-z]:/iu;

/** Shared portable Vault path admission for authoritative Table resources. */
export function isSafeOperonSettingsBackupTablePathV1(path: string): boolean {
	if (!path || path !== path.normalize('NFC') || !path.toLowerCase().endsWith('.table')) return false;
	if (path.startsWith('/') || path.startsWith('//') || WINDOWS_DRIVE_PATH.test(path) || path.includes('\\')) return false;
	const segments = path.split('/');
	return segments.every(segment => (
		segment.length > 0
		&& segment !== '.'
		&& segment !== '..'
		&& !segment.endsWith('.')
		&& !segment.endsWith(' ')
		&& !/[<>:"|?*]/u.test(segment)
		&& !WINDOWS_RESERVED_SEGMENT.test(segment)
		&& !Array.from(segment).some(character => {
			const codePoint = character.codePointAt(0) ?? 0;
			return codePoint <= 0x1f || codePoint === 0x7f;
		})
	));
}

/** NFKC + case + Windows trailing-dot/space collision identity. */
export function operonSettingsBackupTablePathCollisionKeyV1(path: string): string | null {
	try {
		const segments = path.split('/').map(segment => (
			segment.normalize('NFKC').replace(/[. ]+$/u, '').toLocaleLowerCase('en-US')
		));
		if (segments.some(segment => !segment || WINDOWS_RESERVED_SEGMENT.test(segment))) return null;
		return segments.join('/');
	} catch {
		return null;
	}
}
