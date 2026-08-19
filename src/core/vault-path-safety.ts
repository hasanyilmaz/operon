const WINDOWS_DRIVE_RE = /^[A-Za-z]:/u;
const URI_SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:/u;
const PORTABLE_SEGMENT_FORBIDDEN_RE = /[<>:"|?*]/u;
const WINDOWS_RESERVED_DEVICE_RE = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/iu;

/** Strict portable vault-relative path validation, without an Obsidian runtime dependency. */
export function isSafeVaultRelativePath(value: string): boolean {
	if (
		!value
		|| value !== value.trim()
		|| value.normalize('NFC') !== value
		|| value.startsWith('/')
		|| value.startsWith('~')
		|| value.startsWith('\\')
		|| WINDOWS_DRIVE_RE.test(value)
		|| URI_SCHEME_RE.test(value)
		|| value.includes('\\')
		|| value.includes('//')
		|| containsControlCharacter(value)
	) return false;

	return value.split('/').every(segment => (
		!!segment
		&& segment !== '.'
		&& segment !== '..'
		&& !segment.endsWith('.')
		&& !segment.endsWith(' ')
		&& !PORTABLE_SEGMENT_FORBIDDEN_RE.test(segment)
		&& !WINDOWS_RESERVED_DEVICE_RE.test(segment)
	));
}

export function isSafeVaultRelativeMarkdownPath(value: string): boolean {
	return value.toLowerCase().endsWith('.md') && isSafeVaultRelativePath(value);
}

function containsControlCharacter(value: string): boolean {
	for (const character of value) {
		const code = character.codePointAt(0) ?? 0;
		if (code <= 31 || code === 127) return true;
	}
	return false;
}
