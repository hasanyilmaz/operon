#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
	closeSync,
	constants as fsConstants,
	fstatSync,
	lstatSync,
	openSync,
	readFileSync,
} from "node:fs";
import { pathToFileURL } from "node:url";
import process from "node:process";
import {
	EVIDENCE_VERSION,
	MAX_INPUT_BYTES,
	MAX_OUTPUT_BYTES,
	PROBE_VERSION,
	PROBE_COMMAND,
	assertNoPhysicalPath,
	buildProbeRequest,
	byteDigest,
	canonicalVaultIdentity,
	cleanupRequest,
	publicErrorEnvelope,
	sanitizedInvocationIdentity,
	writeSecureRequest,
} from "./protocol.mjs";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;
const VALID_PROBE_PHASES = new Set([
	"loading",
	"plugin-loaded",
	"layout-ready",
	"startup-reconciled",
	"load-failed",
	"unloading",
]);

function usage() {
	return `Usage:
  node client.mjs --vault-ref <name-or-id> --vault-path <path> [options]

Options:
  --obsidian-bin <path>       Obsidian CLI executable (default: obsidian)
  --operation <name>          health, digest, delay, or generate
  --channel <name>            request-file (default) or argv
  --payload <text>            Synthetic non-secret payload
  --payload-file <path>       Read payload bytes from a local file
  --stdin                     Relay stdin through an owner-only request file
  --output-bytes <number>     Requested generated response payload size
  --delay-ms <number>         Requested synthetic handler delay
  --request-id <id>           Stable request id for a measurement
  --timeout-ms <number>       Process timeout (default: 30000)
  --allow-argv-non-sensitive  Required acknowledgement for argv transport
  --allow-unverified-vault    Permit a live call without --vault-path
  --dry-run                   Print sanitized invocation evidence only
`;
}

function parseInteger(value, flag) {
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 0) {
		throw new Error(`INVALID_${flag.replaceAll("-", "_").toUpperCase()}`);
	}
	return parsed;
}

export function parseArgs(argv) {
	const options = {
		obsidianBin: "obsidian",
		operation: "health",
		channel: "request-file",
		outputBytes: 0,
		delayMs: 0,
		timeoutMs: DEFAULT_TIMEOUT_MS,
	};
	const valueFlags = new Map([
		["--obsidian-bin", "obsidianBin"],
		["--vault-ref", "vaultRef"],
		["--vault-path", "vaultPath"],
		["--operation", "operation"],
		["--channel", "channel"],
		["--payload", "payload"],
		["--payload-file", "payloadFile"],
		["--output-bytes", "outputBytes"],
		["--delay-ms", "delayMs"],
		["--request-id", "requestId"],
		["--timeout-ms", "timeoutMs"],
	]);
	for (let index = 0; index < argv.length; index += 1) {
		const flag = argv[index];
		if (valueFlags.has(flag)) {
			const value = argv[index + 1];
			if (value === undefined) throw new Error(`MISSING_VALUE:${flag}`);
			options[valueFlags.get(flag)] = value;
			index += 1;
			continue;
		}
		if (flag === "--stdin") options.stdin = true;
		else if (flag === "--allow-argv-non-sensitive") options.allowArgv = true;
		else if (flag === "--allow-unverified-vault") options.allowUnverifiedVault = true;
		else if (flag === "--dry-run") options.dryRun = true;
		else if (flag === "--help" || flag === "-h") options.help = true;
		else throw new Error(`UNKNOWN_FLAG:${flag}`);
	}

	options.outputBytes = parseInteger(options.outputBytes, "output-bytes");
	options.delayMs = parseInteger(options.delayMs, "delay-ms");
	options.timeoutMs = parseInteger(options.timeoutMs, "timeout-ms");
	if (!["request-file", "argv"].includes(options.channel)) {
		throw new Error("INVALID_CHANNEL");
	}
	if (!["health", "digest", "delay", "generate"].includes(options.operation)) {
		throw new Error("INVALID_OPERATION");
	}
	if (options.outputBytes > MAX_OUTPUT_BYTES) throw new Error("OUTPUT_TOO_LARGE");
	const payloadSources = [options.payload !== undefined, Boolean(options.payloadFile), Boolean(options.stdin)]
		.filter(Boolean).length;
	if (payloadSources > 1) throw new Error("MULTIPLE_PAYLOAD_SOURCES");
	if (options.stdin && options.channel !== "request-file") {
		throw new Error("STDIN_REQUIRES_REQUEST_FILE");
	}
	if (options.channel === "argv" && !options.allowArgv) {
		throw new Error("ARGV_REQUIRES_NON_SENSITIVE_ACKNOWLEDGEMENT");
	}
	return options;
}

async function readStdin() {
	const chunks = [];
	let bytes = 0;
	for await (const chunk of process.stdin) {
		const buffer = Buffer.from(chunk);
		bytes += buffer.byteLength;
		if (bytes > MAX_INPUT_BYTES) throw new Error("PAYLOAD_TOO_LARGE");
		chunks.push(buffer);
	}
	return Buffer.concat(chunks);
}

async function loadPayload(options) {
	if (options.stdin) return readStdin();
	if (options.payloadFile) {
		let descriptor = null;
		try {
			const pathStat = lstatSync(options.payloadFile);
			if (pathStat.isSymbolicLink() || !pathStat.isFile()) {
				throw new Error("PAYLOAD_FILE_NOT_REGULAR");
			}
			if (pathStat.size > MAX_INPUT_BYTES) throw new Error("PAYLOAD_TOO_LARGE");
			descriptor = openSync(
				options.payloadFile,
				fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
			);
			const openedStat = fstatSync(descriptor);
			if (
				!openedStat.isFile()
				|| openedStat.dev !== pathStat.dev
				|| openedStat.ino !== pathStat.ino
			) {
				throw new Error("PAYLOAD_FILE_CHANGED");
			}
			const payload = readFileSync(descriptor);
			if (payload.byteLength > MAX_INPUT_BYTES) throw new Error("PAYLOAD_TOO_LARGE");
			return payload;
		} catch (error) {
			if (
				error instanceof Error
				&& /^(?:PAYLOAD_FILE_(?:NOT_REGULAR|CHANGED)|PAYLOAD_TOO_LARGE)$/u.test(error.message)
			) {
				throw error;
			}
			throw new Error("PAYLOAD_FILE_UNAVAILABLE");
		} finally {
			if (descriptor !== null) closeSync(descriptor);
		}
	}
	const payload = Buffer.from(options.payload ?? "", "utf8");
	if (payload.byteLength > MAX_INPUT_BYTES) throw new Error("PAYLOAD_TOO_LARGE");
	return payload;
}

function sanitizedProbeResult(parsed) {
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
	const generated = typeof parsed.generatedPayload === "string"
		? Buffer.from(parsed.generatedPayload, "base64url")
		: null;
	const result = {
		probeVersion: parsed.probeVersion,
		requestId: parsed.requestId,
		ok: parsed.ok,
		operation: parsed.operation,
		phase: VALID_PROBE_PHASES.has(parsed.phase) ? parsed.phase : null,
		vaultIdentity: parsed.vaultIdentity ?? null,
		input: parsed.input ?? null,
		output: parsed.output ?? null,
		handlerMs: parsed.handlerMs,
		error: parsed.error ?? null,
	};
	if (parsed.milestones && typeof parsed.milestones === "object") {
		result.milestones = Object.fromEntries(
			Object.entries(parsed.milestones)
				.filter(([key, value]) => [
					"pluginLoadedMs",
					"layoutReadyMs",
					"startupReconciledMs",
				].includes(key) && Number.isFinite(value) && value >= 0),
		);
	}
	if (generated) {
		result.generatedPayload = byteDigest(generated);
	}
	return result;
}

export function validateProbeResponse(parsed, request, input) {
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "RESULT_NOT_OBJECT";
	if (parsed.probeVersion !== PROBE_VERSION) return "RESULT_VERSION_MISMATCH";
	if (parsed.requestId !== request.requestId) return "RESULT_REQUEST_ID_MISMATCH";
	if (parsed.operation !== request.operation) return "RESULT_OPERATION_MISMATCH";
	if (!VALID_PROBE_PHASES.has(parsed.phase)) return "RESULT_PHASE_INVALID";
	if (parsed.ok !== true) return "RESULT_NOT_OK";
	if (!Number.isFinite(parsed.handlerMs) || parsed.handlerMs < 0) return "RESULT_HANDLER_TIME_INVALID";
	if (
		parsed.input?.bytes !== input.bytes
		|| parsed.input?.sha256 !== input.sha256
	) {
		return "RESULT_INPUT_DIGEST_MISMATCH";
	}
	if (request.expectedVaultSha256 && parsed.vaultIdentity?.expectedMatch !== true) {
		return "RESULT_VAULT_IDENTITY_MISMATCH";
	}

	const expectedOutputBytes = request.operation === "generate" ? request.outputBytes : 0;
	const generated = typeof parsed.generatedPayload === "string"
		? Buffer.from(parsed.generatedPayload, "base64url")
		: Buffer.alloc(0);
	if (
		generated.byteLength !== expectedOutputBytes
		|| parsed.output?.bytes !== expectedOutputBytes
		|| parsed.output?.sha256 !== byteDigest(generated).sha256
	) {
		return "RESULT_OUTPUT_DIGEST_MISMATCH";
	}
	return null;
}

export function runProcess(executable, args, options = {}) {
	return new Promise((resolve) => {
		const startedAt = process.hrtime.bigint();
		let stdout = Buffer.alloc(0);
		let stderr = Buffer.alloc(0);
		let overflow = false;
		let timedOut = false;
		let spawnError = null;
		const child = spawn(executable, args, {
			stdio: ["ignore", "pipe", "pipe"],
			env: options.env ?? process.env,
			shell: false,
		});
		const append = (current, chunk) => {
			if (current.byteLength + chunk.byteLength > MAX_CAPTURE_BYTES) {
				overflow = true;
				child.kill("SIGKILL");
				return current;
			}
			return Buffer.concat([current, chunk]);
		};
		child.stdout?.on("data", (chunk) => {
			stdout = append(stdout, Buffer.from(chunk));
		});
		child.stderr?.on("data", (chunk) => {
			stderr = append(stderr, Buffer.from(chunk));
		});
		child.on("error", (error) => {
			spawnError = error;
		});
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGKILL");
		}, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
		child.on("close", (exitCode, signal) => {
			clearTimeout(timer);
			const processMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
			resolve({
				exitCode,
				signal,
				processMs,
				stdout,
				stderr,
				overflow,
				timedOut,
				spawnError,
			});
		});
	});
}

function buildCliArgs(options, request, input, requestToken) {
	const args = [];
	if (options.vaultRef) args.push(`vault=${options.vaultRef}`);
	args.push(PROBE_COMMAND);
	if (requestToken) {
		args.push(
			"channel=request-file",
			`requestToken=${requestToken}`,
		);
	} else {
		args.push(
			"channel=argv",
			`probeVersion=${request.probeVersion}`,
			`requestId=${request.requestId}`,
			`operation=${request.operation}`,
			`expectedVaultSha256=${request.expectedVaultSha256 ?? ""}`,
			`payload=${request.payloadBase64}`,
			`inputBytes=${input.bytes}`,
			`inputSha256=${input.sha256}`,
			`outputBytes=${request.outputBytes}`,
			`delayMs=${request.delayMs}`,
		);
	}
	return args;
}

export async function executeProbe(options) {
	if (!options.dryRun && !options.vaultRef) {
		throw new Error("VAULT_REF_REQUIRED");
	}
	if (!options.vaultPath && !options.allowUnverifiedVault) {
		throw new Error("VAULT_PATH_REQUIRED");
	}
	if (
		process.platform === "win32"
		&& options.channel === "request-file"
		&& !options.dryRun
	) {
		throw new Error("REQUEST_FILE_CHANNEL_UNAVAILABLE_WINDOWS");
	}

	const payload = await loadPayload(options);
	let vaultIdentity = null;
	if (options.vaultPath) {
		try {
			vaultIdentity = canonicalVaultIdentity(options.vaultPath);
		} catch {
			throw new Error("VAULT_PATH_UNAVAILABLE");
		}
	}
	const { request, input } = buildProbeRequest({
		payload,
		operation: options.operation,
		requestId: options.requestId,
		expectedVaultSha256: vaultIdentity?.sha256 ?? null,
		outputBytes: options.outputBytes,
		delayMs: options.delayMs,
	});
	let requestFile = null;
	if (options.channel === "request-file" && !options.dryRun) {
		requestFile = writeSecureRequest(request);
	}
	const cliArgs = buildCliArgs(options, request, input, requestFile?.token);

	const evidence = {
		evidenceVersion: EVIDENCE_VERSION,
		recordedAt: new Date().toISOString(),
		environment: {
			platform: process.platform,
			arch: process.arch,
			node: process.versions.node,
		},
		invocation: {
			requestId: request.requestId,
			operation: request.operation,
			channel: options.channel,
			inputSource: options.stdin
				? "stdin"
				: options.payloadFile
					? "payload-file"
					: options.payload === undefined
						? "empty"
						: "literal",
			vaultRefSha256: sanitizedInvocationIdentity(options.vaultRef),
			expectedVaultSha256: request.expectedVaultSha256,
			input,
			outputRequestedBytes: request.outputBytes,
			delayMs: request.delayMs,
			timeoutMs: options.timeoutMs,
		},
		dryRun: Boolean(options.dryRun),
	};
	if (options.dryRun) return assertNoPhysicalPath(evidence);

	try {
		const processResult = await runProcess(options.obsidianBin, cliArgs, {
			timeoutMs: options.timeoutMs,
		});
		let parsed = null;
		let parseError = null;
		if (processResult.stdout.byteLength > 0) {
			try {
				parsed = JSON.parse(processResult.stdout.toString("utf8").trim());
			} catch {
				parseError = "INVALID_JSON_RESULT";
			}
		}
		const contractError = parsed
			? validateProbeResponse(parsed, request, input)
			: null;
		evidence.transport = {
			exitCode: processResult.exitCode,
			signal: processResult.signal,
			processMs: processResult.processMs,
			timedOut: processResult.timedOut,
			overflow: processResult.overflow,
			spawnErrorCode: processResult.spawnError?.code ?? null,
			stdout: byteDigest(processResult.stdout),
			stderr: byteDigest(processResult.stderr),
			parseError,
			contractError,
			result: sanitizedProbeResult(parsed),
		};
		evidence.ok = processResult.exitCode === 0
			&& !processResult.timedOut
			&& !processResult.overflow
			&& !processResult.spawnError
			&& !parseError
			&& !contractError
			&& Boolean(evidence.transport.result?.ok);
		return assertNoPhysicalPath(evidence);
	} finally {
		if (requestFile) {
			cleanupRequest(requestFile.token, { fileIdentity: requestFile.fileIdentity });
		}
	}
}

export async function main(argv = process.argv.slice(2)) {
	try {
		const options = parseArgs(argv);
		if (options.help) {
			process.stdout.write(usage());
			return 0;
		}
		const evidence = await executeProbe(options);
		process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
		return evidence.ok === false ? 1 : 0;
	} catch (error) {
		const publicError = publicErrorEnvelope(error);
		const result = {
			evidenceVersion: EVIDENCE_VERSION,
			ok: false,
			error: publicError,
		};
		process.stderr.write(`${JSON.stringify(result)}\n`);
		return 2;
	}
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	process.exitCode = await main();
}
