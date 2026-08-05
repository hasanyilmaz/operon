#!/usr/bin/env node

import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
	closeSync,
	constants as fsConstants,
	fchmodSync,
	fstatSync,
	fsyncSync,
	linkSync,
	lstatSync,
	openSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { createInterface } from "node:readline/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import process from "node:process";
import { executeProbe, parseArgs } from "./client.mjs";
import {
	EVIDENCE_VERSION,
	assertNoPhysicalPath,
	ensureSecureRequestRoot,
	fixedResultsRoot,
	publicErrorEnvelope,
	recommendedSafeLimit,
	sha256,
} from "./protocol.mjs";

const execFileAsync = promisify(execFile);

export const INPUT_STEPS = [
	1 * 1024,
	4 * 1024,
	16 * 1024,
	64 * 1024,
	256 * 1024,
	1 * 1024 * 1024,
];

export const OUTPUT_STEPS = [
	1 * 1024,
	4 * 1024,
	16 * 1024,
	64 * 1024,
	256 * 1024,
	1 * 1024 * 1024,
	2 * 1024 * 1024,
	4 * 1024 * 1024,
];

function percentile(values, fraction) {
	if (values.length === 0) return null;
	const sorted = [...values].sort((left, right) => left - right);
	const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
	return sorted[index];
}

export function summarizeTimings(records) {
	const processTimes = records
		.filter((record) => record.ok)
		.map((record) => record.transport.processMs);
	const handlerTimes = records
		.filter((record) => record.ok && Number.isFinite(record.transport.result?.handlerMs))
		.map((record) => record.transport.result.handlerMs);
	return {
		attempts: records.length,
		successes: records.filter((record) => record.ok).length,
		phaseCounts: records.reduce((counts, record) => {
			const phase = record.transport?.result?.phase ?? "unavailable";
			counts[phase] = (counts[phase] ?? 0) + 1;
			return counts;
		}, {}),
		processMs: {
			min: processTimes.length ? Math.min(...processTimes) : null,
			median: percentile(processTimes, 0.5),
			p95: percentile(processTimes, 0.95),
			max: processTimes.length ? Math.max(...processTimes) : null,
		},
		handlerMs: {
			min: handlerTimes.length ? Math.min(...handlerTimes) : null,
			median: percentile(handlerTimes, 0.5),
			p95: percentile(handlerTimes, 0.95),
			max: handlerTimes.length ? Math.max(...handlerTimes) : null,
		},
	};
}

function stablePayload(size) {
	return "P".repeat(size);
}

const SIZE_REPEATS = 3;
const SIZE_QUANTUM = 4 * 1024;

async function runRepeated(options, count) {
	const records = [];
	for (let index = 0; index < count; index += 1) {
		records.push(await executeProbe({
			...options,
			requestId: `warm-${String(index + 1).padStart(3, "0")}`,
		}));
	}
	return records;
}

async function measureSize(options, direction, size) {
	const attempts = [];
	for (let repeat = 0; repeat < SIZE_REPEATS; repeat += 1) {
		const evidence = await executeProbe(direction === "input"
			? {
				...options,
				operation: "digest",
				payload: stablePayload(size),
				outputBytes: 0,
				requestId: `input-${size}-${repeat + 1}`,
			}
			: {
				...options,
				operation: "generate",
				payload: "",
				outputBytes: size,
				requestId: `output-${size}-${repeat + 1}`,
			});
		const exact = direction === "input"
			? evidence.transport?.result?.input?.bytes === size
			: evidence.transport?.result?.generatedPayload?.bytes === size;
		attempts.push({
			ok: Boolean(evidence.ok && exact),
			transport: evidence.transport,
		});
	}
	return {
		size,
		ok: attempts.every((attempt) => attempt.ok),
		attempts,
	};
}

async function refineFirstFailure(options, direction, lower, upper) {
	const records = [];
	let passing = lower;
	let failing = upper;
	while (failing - passing > SIZE_QUANTUM) {
		const midpoint = Math.floor(((passing + failing) / 2) / SIZE_QUANTUM)
			* SIZE_QUANTUM;
		if (midpoint <= passing || midpoint >= failing) break;
		const record = await measureSize(options, direction, midpoint);
		records.push(record);
		if (record.ok) passing = midpoint;
		else failing = midpoint;
	}
	return records;
}

async function measureDirection(options, direction, steps) {
	const records = [];
	let lastPassing = 0;
	for (const size of steps) {
		const record = await measureSize(options, direction, size);
		records.push(record);
		if (record.ok) {
			lastPassing = size;
			continue;
		}
		records.push(...await refineFirstFailure(
			options,
			direction,
			lastPassing,
			size,
		));
		break;
	}
	return records.sort((left, right) => left.size - right.size);
}

async function runSizeMatrix(options) {
	const input = await measureDirection(options, "input", INPUT_STEPS);
	const output = await measureDirection(options, "output", OUTPUT_STEPS);
	const successfulInput = input.filter((record) => record.ok).map((record) => record.size);
	const successfulOutput = output.filter((record) => record.ok).map((record) => record.size);
	return {
		repeatsPerSize: SIZE_REPEATS,
		input,
		output,
		recommendedLimits: {
			inputBytes: successfulInput.length
				? recommendedSafeLimit(Math.max(...successfulInput))
				: 0,
			outputBytes: successfulOutput.length
				? recommendedSafeLimit(Math.max(...successfulOutput))
				: 0,
		},
	};
}

async function waitForManualClose(iteration, total) {
	if (!process.stdin.isTTY) {
		throw new Error("COLD_BENCHMARK_REQUIRES_INTERACTIVE_TTY");
	}
	const reader = createInterface({ input: process.stdin, output: process.stderr });
	try {
		await reader.question(
			`Cold launch ${iteration}/${total}: close Obsidian completely, then press Enter. `,
		);
	} finally {
		reader.close();
	}
}

function wait(delayMs) {
	return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export function compactColdAttempt(evidence) {
	const transport = evidence.transport ?? {};
	return {
		ok: evidence.ok,
		recordedAt: evidence.recordedAt,
		transport: {
			exitCode: transport.exitCode ?? null,
			processMs: transport.processMs ?? null,
			timedOut: transport.timedOut ?? false,
			overflow: transport.overflow ?? false,
			spawnErrorCode: transport.spawnErrorCode ?? null,
			stdout: transport.stdout ?? null,
			stderr: transport.stderr ?? null,
			parseError: transport.parseError ?? null,
			contractError: transport.contractError ?? null,
			result: transport.result ?? null,
		},
	};
}

async function pollColdLaunch(options, iteration) {
	const startedAt = process.hrtime.bigint();
	const deadline = Date.now() + options.timeoutMs;
	const firstObservedMs = {};
	const phaseTransitions = [];
	let firstAttempt = null;
	let lastAttempt = null;
	let attempt = 0;
	while (Date.now() < deadline) {
		const remainingMs = deadline - Date.now();
		if (remainingMs <= 0) break;
		attempt += 1;
		const evidence = await executeProbe({
			...options,
			timeoutMs: Math.max(1, Math.min(remainingMs, 5_000)),
			requestId: `cold-${String(iteration).padStart(3, "0")}-${attempt}`,
		});
		const compactAttempt = compactColdAttempt(evidence);
		firstAttempt ??= compactAttempt;
		lastAttempt = compactAttempt;
		const phase = evidence.transport?.result?.phase;
		if (evidence.transport?.result && firstObservedMs.handlerAvailable === undefined) {
			firstObservedMs.handlerAvailable = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
		}
		if (typeof phase === "string" && firstObservedMs[phase] === undefined) {
			const observedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
			firstObservedMs[phase] = observedMs;
			phaseTransitions.push({ phase, observedMs });
		}
		if (evidence.ok && evidence.transport?.result?.phase === "startup-reconciled") {
			return {
				ok: true,
				totalReadyMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
				firstObservedMs,
				attemptCount: attempt,
				firstAttempt,
				lastAttempt,
				phaseTransitions,
			};
		}
		const pollDelayMs = Math.min(150, deadline - Date.now());
		if (pollDelayMs > 0) await wait(pollDelayMs);
	}
	return {
		ok: false,
		totalReadyMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
		firstObservedMs,
		attemptCount: attempt,
		firstAttempt,
		lastAttempt,
		phaseTransitions,
	};
}

export function writeEvidenceFile(outputFile, body) {
	if (process.platform === "win32") {
		throw new Error("OUTPUT_FILE_CHANNEL_UNAVAILABLE_WINDOWS");
	}
	const tempFile = `${outputFile}.${randomBytes(8).toString("hex")}.tmp`;
	let descriptor = null;
	let published = false;
	try {
		descriptor = openSync(
			tempFile,
			fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
			0o600,
		);
		fchmodSync(descriptor, 0o600);
		writeFileSync(descriptor, body);
		fsyncSync(descriptor);
		closeSync(descriptor);
		descriptor = null;
		linkSync(tempFile, outputFile);
		published = true;
		unlinkSync(tempFile);

		const pathStat = lstatSync(outputFile);
		if (pathStat.isSymbolicLink() || !pathStat.isFile() || (pathStat.mode & 0o777) !== 0o600) {
			throw new Error("OUTPUT_FILE_NOT_SECURE");
		}
		const opened = openSync(outputFile, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
		try {
			const openedStat = fstatSync(opened);
			if (openedStat.dev !== pathStat.dev || openedStat.ino !== pathStat.ino) {
				throw new Error("OUTPUT_FILE_CHANGED");
			}
			JSON.parse(readFileSync(opened, "utf8"));
		} finally {
			closeSync(opened);
		}
	} catch (error) {
		if (descriptor !== null) closeSync(descriptor);
		try {
			unlinkSync(tempFile);
		} catch {
			// Best-effort cleanup after the original failure.
		}
		if (published) {
			try {
				unlinkSync(outputFile);
			} catch {
				// Best-effort cleanup of this invocation's publication.
			}
		}
		throw error;
	}
}

function parseBenchmarkArgs(argv) {
	const mode = argv[0] ?? "warm";
	if (!["warm", "sizes", "cold", "argv-visibility"].includes(mode)) {
		throw new Error("INVALID_BENCHMARK_MODE");
	}
	const filtered = [];
	let count = mode === "warm" ? 30 : 5;
	let outputPath = null;
	let allowCold = false;
	let allowProcessInspection = false;
	for (let index = 1; index < argv.length; index += 1) {
		if (argv[index] === "--count") {
			count = Number(argv[index + 1]);
			index += 1;
		} else if (argv[index] === "--output") {
			outputPath = argv[index + 1];
			index += 1;
		} else if (argv[index] === "--allow-cold-launch") {
			allowCold = true;
		} else if (argv[index] === "--allow-process-inspection") {
			allowProcessInspection = true;
		} else {
			filtered.push(argv[index]);
		}
	}
	if (!Number.isSafeInteger(count) || count < 1 || count > 1_000) {
		throw new Error("INVALID_BENCHMARK_COUNT");
	}
	return {
		mode,
		count,
		outputPath,
		allowCold,
		allowProcessInspection,
		clientOptions: parseArgs(filtered),
	};
}

async function measureArgvVisibility(options) {
	const sentinel = "OPERON_PHASE1_SYNTHETIC_ARGV_SENTINEL";
	const encodedSentinel = Buffer.from(sentinel, "utf8").toString("base64url");
	const probePromise = executeProbe({
		...options,
		channel: "argv",
		allowArgv: true,
		operation: "delay",
		payload: sentinel,
		delayMs: 3_000,
		timeoutMs: Math.max(options.timeoutMs, 5_000),
		requestId: "argv-visibility",
	});
	await wait(250);
	const processList = await execFileAsync("ps", ["-axo", "command"], {
		maxBuffer: 4 * 1024 * 1024,
		encoding: "utf8",
	});
	const evidence = await probePromise;
	const processBytes = Buffer.from(processList.stdout, "utf8");
	return {
		probe: evidence,
		processList: {
			bytes: processBytes.byteLength,
			sha256: sha256(processBytes),
			rawSentinelVisible: processList.stdout.includes(sentinel),
			encodedSentinelVisible: processList.stdout.includes(encodedSentinel),
		},
	};
}

export async function runBenchmark(argv = process.argv.slice(2)) {
	const parsed = parseBenchmarkArgs(argv);
	if (parsed.outputPath) {
		if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$/u.test(parsed.outputPath)) {
			throw new Error("OUTPUT_MUST_BE_A_SAFE_JSON_BASENAME");
		}
		if (process.platform === "win32") {
			throw new Error("OUTPUT_FILE_CHANNEL_UNAVAILABLE_WINDOWS");
		}
	}
	const base = {
		evidenceVersion: EVIDENCE_VERSION,
		benchmarkVersion: 1,
		recordedAt: new Date().toISOString(),
		mode: parsed.mode,
	};
	if (parsed.mode === "warm") {
		const records = await runRepeated(parsed.clientOptions, parsed.count);
		base.summary = summarizeTimings(records);
		base.records = records;
	} else if (parsed.mode === "sizes") {
		base.matrix = await runSizeMatrix(parsed.clientOptions);
	} else if (parsed.mode === "cold") {
		if (!parsed.allowCold) {
			throw new Error("COLD_BENCHMARK_REQUIRES_EXPLICIT_OPT_IN");
		}
		base.records = [];
		for (let index = 0; index < parsed.count; index += 1) {
			await waitForManualClose(index + 1, parsed.count);
			base.records.push(await pollColdLaunch(parsed.clientOptions, index + 1));
		}
		const readyTimes = base.records
			.filter((record) => record.ok)
			.map((record) => record.totalReadyMs);
		base.summary = {
			attempts: base.records.length,
			successes: base.records.filter((record) => record.ok).length,
			totalReadyMs: {
				min: readyTimes.length ? Math.min(...readyTimes) : null,
				median: percentile(readyTimes, 0.5),
				p95: percentile(readyTimes, 0.95),
				max: readyTimes.length ? Math.max(...readyTimes) : null,
			},
			firstObservedMs: Object.fromEntries(
				["handlerAvailable", "loading", "plugin-loaded", "layout-ready", "startup-reconciled"]
					.map((phase) => {
						const values = base.records
							.map((record) => record.firstObservedMs?.[phase])
							.filter(Number.isFinite);
						return [phase, {
							observations: values.length,
							min: values.length ? Math.min(...values) : null,
							median: percentile(values, 0.5),
							p95: percentile(values, 0.95),
							max: values.length ? Math.max(...values) : null,
						}];
					}),
			),
		};
	} else {
		if (!parsed.allowProcessInspection) {
			throw new Error("PROCESS_INSPECTION_REQUIRES_EXPLICIT_OPT_IN");
		}
		base.visibility = await measureArgvVisibility(parsed.clientOptions);
	}

	const evidence = assertNoPhysicalPath(base);
	if (parsed.outputPath) {
		const outputRoot = ensureSecureRequestRoot(fixedResultsRoot());
		const outputFile = join(outputRoot, parsed.outputPath);
		writeEvidenceFile(outputFile, `${JSON.stringify(evidence, null, 2)}\n`);
	}
	return evidence;
}

async function main() {
	try {
		const evidence = await runBenchmark();
		process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
		return 0;
	} catch (error) {
		const publicError = publicErrorEnvelope(error, "BENCHMARK_FAILURE");
		process.stderr.write(`${JSON.stringify({
			ok: false,
			error: publicError,
		})}\n`);
		return 2;
	}
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	process.exitCode = await main();
}
