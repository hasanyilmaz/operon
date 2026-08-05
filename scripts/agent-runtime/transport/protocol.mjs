import {
	closeSync,
	constants as fsConstants,
	fchmodSync,
	fstatSync,
	fsyncSync,
	linkSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	realpathSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

export const PROBE_VERSION = 1;
export const EVIDENCE_VERSION = 1;
export const PROBE_COMMAND = "operon:transport-probe";
export const REQUEST_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;
export const MAX_INPUT_BYTES = 1024 * 1024;
export const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
export const MAX_REQUEST_FILE_BYTES = 2 * 1024 * 1024;

function currentUid() {
	return typeof process.getuid === "function" ? process.getuid() : null;
}

export function sha256(value) {
	return createHash("sha256").update(value).digest("hex");
}

export function byteDigest(value) {
	const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
	return {
		bytes: buffer.byteLength,
		sha256: sha256(buffer),
	};
}

export function canonicalVaultIdentity(vaultPath) {
	const canonicalPath = realpathSync(vaultPath);
	return {
		canonicalPath,
		sha256: sha256(Buffer.from(canonicalPath, "utf8")),
	};
}

export function fixedRequestRoot() {
	const uid = currentUid();
	const userSegment = uid === null ? "uid-unavailable" : `uid-${uid}`;
	// Keep the owner-validated directory directly under the OS temp directory.
	// An intermediate shared directory would add a symlink/ownership boundary.
	return join(tmpdir(), `operon-agent-runtime-${userSegment}`);
}

export function fixedResultsRoot() {
	return process.platform === "darwin"
		? "/private/tmp/operon-agent-runtime-results"
		: join(tmpdir(), "operon-agent-runtime-results");
}

function permissions(mode) {
	return mode & 0o777;
}

export function ensureSecureRequestRoot(root = fixedRequestRoot()) {
	mkdirSync(root, { recursive: true, mode: 0o700 });
	const stat = lstatSync(root);
	if (stat.isSymbolicLink() || !stat.isDirectory()) {
		throw new Error("REQUEST_ROOT_NOT_SECURE");
	}
	const uid = currentUid();
	if (uid !== null && stat.uid !== uid) {
		throw new Error("REQUEST_ROOT_WRONG_OWNER");
	}
	if (permissions(stat.mode) !== 0o700) {
		throw new Error("REQUEST_ROOT_WRONG_MODE");
	}
	return root;
}

export function createRequestToken() {
	return randomBytes(24).toString("base64url");
}

export function validateRequestToken(token) {
	if (!REQUEST_TOKEN_PATTERN.test(token)) {
		throw new Error("INVALID_REQUEST_TOKEN");
	}
	return token;
}

export function requestPathForToken(token, root = fixedRequestRoot()) {
	validateRequestToken(token);
	return join(root, `${token}.request.json`);
}

function assertSecureRequestFile(filePath) {
	const stat = lstatSync(filePath);
	if (stat.isSymbolicLink() || !stat.isFile()) {
		throw new Error("REQUEST_FILE_NOT_REGULAR");
	}
	const uid = currentUid();
	if (uid !== null && stat.uid !== uid) {
		throw new Error("REQUEST_FILE_WRONG_OWNER");
	}
	if (permissions(stat.mode) !== 0o600) {
		throw new Error("REQUEST_FILE_WRONG_MODE");
	}
	if (stat.size > MAX_REQUEST_FILE_BYTES) {
		throw new Error("REQUEST_FILE_TOO_LARGE");
	}
	return stat;
}

export function fileIdentityMatches(expected, actual) {
	return expected.dev === actual.dev
		&& expected.ino === actual.ino
		&& expected.size === actual.size
		&& expected.ctimeMs === actual.ctimeMs;
}

function captureFileIdentity(stat) {
	return {
		dev: stat.dev,
		ino: stat.ino,
		size: stat.size,
		ctimeMs: stat.ctimeMs,
	};
}

export function writeSecureRequest(request, options = {}) {
	const token = options.token ?? createRequestToken();
	validateRequestToken(token);
	if (process.platform === "win32") {
		throw new Error("REQUEST_FILE_CHANNEL_UNAVAILABLE_WINDOWS");
	}
	const root = ensureSecureRequestRoot(options.root);

	const targetPath = requestPathForToken(token, root);
	const tempPath = join(
		root,
		`.${token}.${randomBytes(8).toString("hex")}.tmp`,
	);
	const body = Buffer.from(JSON.stringify(request), "utf8");
	if (body.byteLength > MAX_REQUEST_FILE_BYTES) {
		throw new Error("REQUEST_FILE_TOO_LARGE");
	}

	let descriptor = null;
	let published = false;
	let fileIdentity = null;
	try {
		descriptor = openSync(
			tempPath,
			fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
			0o600,
		);
		fchmodSync(descriptor, 0o600);
		writeFileSync(descriptor, body);
		fsyncSync(descriptor);
		const writtenStat = fstatSync(descriptor);
		const writtenFileIdentity = captureFileIdentity(writtenStat);

		// link() is atomic and refuses to replace an attacker-created target.
		linkSync(tempPath, targetPath);
		published = true;
		unlinkSync(tempPath);
		const targetStat = assertSecureRequestFile(targetPath);
		if (
			targetStat.dev !== writtenFileIdentity.dev
			|| targetStat.ino !== writtenFileIdentity.ino
		) {
			throw new Error("REQUEST_FILE_CHANGED");
		}
		fileIdentity = captureFileIdentity(targetStat);
		closeSync(descriptor);
		descriptor = null;
		return {
			token,
			path: targetPath,
			fileIdentity,
			...byteDigest(body),
		};
	} catch (error) {
		if (descriptor !== null) {
			try {
				closeSync(descriptor);
			} catch {
				// Best-effort cleanup after the original failure.
			}
		}
		try {
			unlinkSync(tempPath);
		} catch {
			// The temporary link may already have been removed.
		}
		if (published && fileIdentity) {
			try {
				cleanupRequest(token, { root, fileIdentity });
			} catch {
				// Preserve the original publication failure.
			}
		}
		throw error;
	}
}

export function readSecureRequest(token, options = {}) {
	validateRequestToken(token);
	if (process.platform === "win32") {
		throw new Error("REQUEST_FILE_CHANNEL_UNAVAILABLE_WINDOWS");
	}
	const root = ensureSecureRequestRoot(options.root);
	const filePath = requestPathForToken(token, root);
	const pathStat = assertSecureRequestFile(filePath);

	const noFollow = fsConstants.O_NOFOLLOW ?? 0;
	const descriptor = openSync(filePath, fsConstants.O_RDONLY | noFollow);
	try {
		const openedStat = fstatSync(descriptor);
		if (!openedStat.isFile() || permissions(openedStat.mode) !== 0o600) {
			throw new Error("REQUEST_FILE_CHANGED");
		}
		const uid = currentUid();
		if (uid !== null && openedStat.uid !== uid) {
			throw new Error("REQUEST_FILE_WRONG_OWNER");
		}
		if (!fileIdentityMatches(captureFileIdentity(pathStat), openedStat)) {
			throw new Error("REQUEST_FILE_CHANGED");
		}
		if (openedStat.size > MAX_REQUEST_FILE_BYTES) {
			throw new Error("REQUEST_FILE_TOO_LARGE");
		}
		const body = readFileSync(descriptor);
		return {
			request: JSON.parse(body.toString("utf8")),
			...byteDigest(body),
		};
	} finally {
		closeSync(descriptor);
		if (options.consume !== false) {
			try {
				cleanupRequest(token, {
					root,
					fileIdentity: captureFileIdentity(pathStat),
				});
			} catch {
				// The client also performs cleanup after the handler returns.
			}
		}
	}
}

export function cleanupRequest(token, options = {}) {
	const filePath = requestPathForToken(token, options.root);
	try {
		if (options.fileIdentity) {
			const stat = lstatSync(filePath);
			if (
				stat.isSymbolicLink()
				|| !stat.isFile()
				|| !fileIdentityMatches(options.fileIdentity, stat)
			) {
				return false;
			}
		}
		unlinkSync(filePath);
		return true;
	} catch (error) {
		if (error?.code === "ENOENT") {
			return false;
		}
		throw error;
	}
}

export function buildProbeRequest(options) {
	const payload = Buffer.isBuffer(options.payload)
		? options.payload
		: Buffer.from(options.payload ?? "");
	const requestId = options.requestId ?? randomUUID();
	const request = {
		probeVersion: PROBE_VERSION,
		requestId,
		operation: options.operation ?? "health",
		expectedVaultSha256: options.expectedVaultSha256 ?? null,
		payloadBase64: payload.toString("base64url"),
		outputBytes: options.outputBytes ?? 0,
		delayMs: options.delayMs ?? 0,
	};
	return {
		request,
		input: byteDigest(payload),
	};
}

export function decodeProbePayload(request) {
	return Buffer.from(request.payloadBase64 ?? "", "base64url");
}

export function recommendedSafeLimit(maximumZeroFailureBytes) {
	if (!Number.isSafeInteger(maximumZeroFailureBytes) || maximumZeroFailureBytes < 0) {
		throw new Error("INVALID_LIMIT");
	}
	const discounted = Math.floor(maximumZeroFailureBytes * 0.75);
	const quantum = 4 * 1024;
	return Math.floor(discounted / quantum) * quantum;
}

export function sanitizedInvocationIdentity(value) {
	if (!value) return null;
	return sha256(Buffer.from(String(value), "utf8"));
}

export function assertNoPhysicalPath(value) {
	const serialized = JSON.stringify(value);
	const home = process.env.HOME;
	if (home && serialized.includes(home)) {
		throw new Error("EVIDENCE_CONTAINS_HOME_PATH");
	}
	const forbidden = [
		["/", "Users", "/"].join(""),
		["Drop", "box"].join(""),
		["Strate", "jya"].join(""),
	];
	for (const marker of forbidden) {
		if (serialized.includes(marker)) {
			throw new Error(`EVIDENCE_CONTAINS_FORBIDDEN_MARKER:${marker}`);
		}
	}
	return value;
}

export function publicErrorEnvelope(error, fallback = "CLIENT_FAILURE") {
	const rawCode = typeof error?.code === "string" ? error.code : "";
	const rawReason = error instanceof Error ? error.message : String(error ?? "");
	const safePattern = /^[A-Z][A-Z0-9_]*(?::--[a-z0-9-]+)?$/u;
	const reason = safePattern.test(rawReason) ? rawReason : fallback;
	const code = safePattern.test(rawCode)
		? rawCode
		: safePattern.test(reason)
			? reason.split(":", 1)[0]
			: fallback;
	return { code, reason };
}

export function describeRequestLocation(token, root = fixedRequestRoot()) {
	validateRequestToken(token);
	return {
		rootName: basename(root),
		tokenSha256: sha256(token),
	};
}
