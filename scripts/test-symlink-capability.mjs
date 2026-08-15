import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const UNAVAILABLE_CODES = new Set(['EACCES', 'ENOSYS', 'EPERM']);

export function createSymlinkCapabilityUnavailableReason({
	platform = process.platform,
	createTemporaryRoot = () => mkdtempSync(path.join(tmpdir(), 'operon-symlink-capability-')),
	createDirectory = target => mkdirSync(target),
	writeFile = target => writeFileSync(target, '{}'),
	createSymlink = (target, link, type) => symlinkSync(target, link, type),
	removeRoot = root => rmSync(root, { recursive: true, force: true }),
} = {}) {
	let checked = false;
	let unavailableReason;
	return function symlinkCapabilityUnavailableReasonV1() {
		if (checked) return unavailableReason;
		if (platform !== 'win32') {
			checked = true;
			return undefined;
		}

		const root = createTemporaryRoot();
		let nextUnavailableReason;
		try {
			const directoryTarget = path.join(root, 'directory-target');
			const fileTarget = path.join(root, 'file-target.json');
			createDirectory(directoryTarget);
			writeFile(fileTarget);
			try {
				createSymlink(directoryTarget, path.join(root, 'directory-link'), 'dir');
				createSymlink(fileTarget, path.join(root, 'file-link.json'), 'file');
			} catch (error) {
				const code = error && typeof error === 'object' && 'code' in error
					? String(error.code)
					: 'unknown';
				if (!UNAVAILABLE_CODES.has(code)) throw error;
				nextUnavailableReason = `Windows symbolic-link creation is unavailable (${code}).`;
			}
		} finally {
			removeRoot(root);
		}
		unavailableReason = nextUnavailableReason;
		checked = true;
		return unavailableReason;
	};
}

export const symlinkCapabilityUnavailableReason = createSymlinkCapabilityUnavailableReason();
