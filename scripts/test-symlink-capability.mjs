import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let checked = false;
let unavailableReason;

export function symlinkCapabilityUnavailableReason() {
	if (checked) return unavailableReason;
	checked = true;
	if (process.platform !== 'win32') return undefined;

	const root = mkdtempSync(path.join(tmpdir(), 'operon-symlink-capability-'));
	try {
		const directoryTarget = path.join(root, 'directory-target');
		const fileTarget = path.join(root, 'file-target.json');
		mkdirSync(directoryTarget);
		writeFileSync(fileTarget, '{}');
		symlinkSync(directoryTarget, path.join(root, 'directory-link'), 'dir');
		symlinkSync(fileTarget, path.join(root, 'file-link.json'), 'file');
	} catch (error) {
		const code = error && typeof error === 'object' && 'code' in error
			? String(error.code)
			: 'unknown';
		if (code !== 'EPERM' && code !== 'EACCES' && code !== 'ENOSYS') throw error;
		unavailableReason = `Windows symbolic-link creation is unavailable (${code}).`;
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
	return unavailableReason;
}
