#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import process from "node:process";
import { executeProbe, parseArgs, runProcess } from "./client.mjs";
import {
	EVIDENCE_VERSION,
	assertNoPhysicalPath,
	byteDigest,
	publicErrorEnvelope,
} from "./protocol.mjs";

function wait(milliseconds) {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function sanitizedProcessResult(result) {
	return {
		exitCode: result.exitCode,
		signal: result.signal,
		processMs: result.processMs,
		timedOut: result.timedOut,
		overflow: result.overflow,
		spawnErrorCode: result.spawnError?.code ?? null,
		stdout: byteDigest(result.stdout),
		stderr: byteDigest(result.stderr),
	};
}

export function hasLivePostReloadPhase(evidence) {
	const phase = evidence.transport?.result?.phase;
	return evidence.ok === true
		&& (
			phase === "loading"
			|| phase === "plugin-loaded"
			|| phase === "layout-ready"
			|| phase === "startup-reconciled"
		);
}

export async function runLiveLifecycle(argv = process.argv.slice(2)) {
	const options = parseArgs(argv);
	if (!options.vaultRef) throw new Error("VAULT_REF_REQUIRED");
	const reloadArgs = [
		`vault=${options.vaultRef}`,
		"plugin:reload",
		"id=operon",
	];

	const inFlightPromise = executeProbe({
		...options,
		operation: "delay",
		delayMs: 1_500,
		requestId: "lifecycle-in-flight",
	});
	await wait(200);
	const firstReload = await runProcess(options.obsidianBin, reloadArgs, {
		timeoutMs: options.timeoutMs,
	});
	const inFlight = await inFlightPromise;
	const afterFirstReload = await executeProbe({
		...options,
		operation: "health",
		delayMs: 0,
		requestId: "lifecycle-after-first-reload",
	});
	const secondReload = await runProcess(options.obsidianBin, reloadArgs, {
		timeoutMs: options.timeoutMs,
	});
	const afterSecondReload = await executeProbe({
		...options,
		operation: "health",
		delayMs: 0,
		requestId: "lifecycle-after-second-reload",
	});

	const evidence = {
		evidenceVersion: EVIDENCE_VERSION,
		lifecycleEvidenceVersion: 1,
		recordedAt: new Date().toISOString(),
		inFlight,
		firstReload: sanitizedProcessResult(firstReload),
		afterFirstReload,
		secondReload: sanitizedProcessResult(secondReload),
		afterSecondReload,
	};
	evidence.ok = firstReload.exitCode === 0
		&& secondReload.exitCode === 0
		&& inFlight.transport?.result?.phase === "unloading"
		&& hasLivePostReloadPhase(afterFirstReload)
		&& hasLivePostReloadPhase(afterSecondReload);
	return assertNoPhysicalPath(evidence);
}

async function main() {
	try {
		const evidence = await runLiveLifecycle();
		process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
		return evidence.ok ? 0 : 1;
	} catch (error) {
		process.stderr.write(`${JSON.stringify({
			ok: false,
			error: publicErrorEnvelope(error, "LIFECYCLE_EVIDENCE_FAILURE"),
		})}\n`);
		return 2;
	}
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	process.exitCode = await main();
}
