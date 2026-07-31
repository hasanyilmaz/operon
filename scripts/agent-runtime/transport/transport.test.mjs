import assert from "node:assert/strict";
import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	buildProbeRequest,
	canonicalVaultIdentity,
	cleanupRequest,
	createRequestToken,
	decodeProbePayload,
	ensureSecureRequestRoot,
	fileIdentityMatches,
	fixedResultsRoot,
	MAX_INPUT_BYTES,
	publicErrorEnvelope,
	readSecureRequest,
	recommendedSafeLimit,
	requestPathForToken,
	sha256,
	validateRequestToken,
	writeSecureRequest,
} from "./protocol.mjs";
import {
	executeProbe,
	parseArgs,
	validateProbeResponse,
} from "./client.mjs";
import {
	compactColdAttempt,
	summarizeTimings,
	writeEvidenceFile,
} from "./benchmark.mjs";
import { hasLivePostReloadPhase } from "./live-lifecycle.mjs";

function testRoot() {
	const parent = mkdtempSync(join(tmpdir(), "operon-transport-test-"));
	const root = join(parent, "requests");
	mkdirSync(root, { mode: 0o700 });
	return root;
}

test("request token is opaque and path-safe", () => {
	const token = createRequestToken();
	assert.match(token, /^[A-Za-z0-9_-]{32}$/);
	assert.equal(validateRequestToken(token), token);
	assert.throws(() => validateRequestToken("../escape"), /INVALID_REQUEST_TOKEN/);
	assert.equal(requestPathForToken(token, "/tmp/root"), `/tmp/root/${token}.request.json`);
});

test("secure request write is atomic, mode 0600, and consumed once", () => {
	const root = testRoot();
	const request = { probeVersion: 1, requestId: "test", payloadBase64: "YWJj" };
	const written = writeSecureRequest(request, { root });
	const stat = lstatSync(written.path);
	assert.equal(stat.isFile(), true);
	assert.equal(stat.mode & 0o777, 0o600);
	assert.equal(written.sha256, sha256(JSON.stringify(request)));

	const read = readSecureRequest(written.token, { root });
	assert.deepEqual(read.request, request);
	assert.equal(existsSync(written.path), false);
	assert.equal(cleanupRequest(written.token, { root }), false);
});

test("atomic publication never removes a pre-existing target", () => {
	const root = testRoot();
	const token = "A".repeat(32);
	const target = requestPathForToken(token, root);
	writeFileSync(target, "attacker sentinel", { mode: 0o600 });
	assert.throws(
		() => writeSecureRequest({ requestId: "must-fail" }, { root, token }),
		(error) => error?.code === "EEXIST",
	);
	assert.equal(existsSync(target), true);
	assert.equal(readFileSync(target, "utf8"), "attacker sentinel");
});

test("cleanup never removes a same-token replacement", () => {
	const root = testRoot();
	const token = "R".repeat(32);
	const written = writeSecureRequest({ requestId: "original" }, { root, token });
	unlinkSync(written.path);
	writeFileSync(written.path, "replacement", { mode: 0o600 });
	assert.equal(
		cleanupRequest(token, { root, fileIdentity: written.fileIdentity }),
		false,
	);
	assert.equal(readFileSync(written.path, "utf8"), "replacement");
	unlinkSync(written.path);
});

test("published request identity must match the captured file generation", () => {
	const identity = { dev: 1, ino: 2, size: 3, ctimeMs: 4 };
	assert.equal(fileIdentityMatches(identity, identity), true);
	assert.equal(fileIdentityMatches(identity, { ...identity, ino: 3 }), false);
	assert.equal(fileIdentityMatches(identity, { ...identity, dev: 2 }), false);
	assert.equal(fileIdentityMatches(identity, { ...identity, size: 4 }), false);
	assert.equal(fileIdentityMatches(identity, { ...identity, ctimeMs: 5 }), false);
});

test("insecure request root and symlink root fail closed", () => {
	const root = testRoot();
	chmodSync(root, 0o755);
	assert.throws(() => ensureSecureRequestRoot(root), /REQUEST_ROOT_WRONG_MODE/);

	const parent = mkdtempSync(join(tmpdir(), "operon-transport-link-test-"));
	const real = join(parent, "real");
	const linked = join(parent, "linked");
	mkdirSync(real, { mode: 0o700 });
	symlinkSync(real, linked);
	assert.throws(() => ensureSecureRequestRoot(linked), /REQUEST_ROOT_NOT_SECURE/);
});

test("probe request preserves exact payload bytes", () => {
	const payload = Buffer.from("Türkçe\nEnglish\u0000", "utf8");
	const built = buildProbeRequest({
		payload,
		operation: "digest",
		requestId: "fixture-request",
		expectedVaultSha256: "a".repeat(64),
	});
	assert.deepEqual(decodeProbePayload(built.request), payload);
	assert.equal(built.input.bytes, payload.byteLength);
	assert.equal(built.input.sha256, sha256(payload));
});

test("vault identity is canonical and does not expose path in hash", () => {
	const root = mkdtempSync(join(tmpdir(), "operon-vault-identity-"));
	const identity = canonicalVaultIdentity(root);
	assert.equal(identity.sha256, sha256(identity.canonicalPath));
	assert.equal(identity.sha256.includes(root), false);
});

test("safe limits apply 25 percent margin and round down to 4 KiB", () => {
	assert.equal(recommendedSafeLimit(1024 * 1024), 786432);
	assert.equal(recommendedSafeLimit(5000), 0);
	assert.throws(() => recommendedSafeLimit(-1), /INVALID_LIMIT/);
});

test("argv transport requires an explicit non-sensitive acknowledgement", () => {
	assert.throws(
		() => parseArgs(["--channel", "argv"]),
		/ARGV_REQUIRES_NON_SENSITIVE_ACKNOWLEDGEMENT/,
	);
	const parsed = parseArgs([
		"--channel",
		"argv",
		"--allow-argv-non-sensitive",
		"--output-bytes",
		"4096",
	]);
	assert.equal(parsed.channel, "argv");
	assert.equal(parsed.outputBytes, 4096);
});

test("stdin can only relay through the request-file channel", () => {
	assert.throws(
		() => parseArgs([
			"--stdin",
			"--channel",
			"argv",
			"--allow-argv-non-sensitive",
		]),
		/STDIN_REQUIRES_REQUEST_FILE/,
	);
	assert.equal(parseArgs(["--stdin"]).channel, "request-file");
});

test("payload files are capped before full allocation and errors stay path-free", async () => {
	const root = mkdtempSync(join(tmpdir(), "operon-payload-limit-test-"));
	const oversized = join(root, "oversized.bin");
	writeFileSync(oversized, Buffer.alloc(MAX_INPUT_BYTES + 1));
	await assert.rejects(
		executeProbe({
			dryRun: true,
			allowUnverifiedVault: true,
			channel: "request-file",
			payloadFile: oversized,
			operation: "digest",
			outputBytes: 0,
			delayMs: 0,
			timeoutMs: 1_000,
		}),
		/PAYLOAD_TOO_LARGE/,
	);
	assert.deepEqual(
		publicErrorEnvelope(new Error(`ENOENT at /Users/private/${oversized}`)),
		{ code: "CLIENT_FAILURE", reason: "CLIENT_FAILURE" },
	);
});

test("evidence output refuses a pre-existing symlink", () => {
	const outputRoot = ensureSecureRequestRoot(fixedResultsRoot());
	const suffix = createRequestToken();
	const outputFile = join(outputRoot, `symlink-${suffix}.json`);
	const victim = join(testRoot(), "victim.json");
	writeFileSync(victim, "victim", { mode: 0o600 });
	symlinkSync(victim, outputFile);
	assert.throws(() => writeEvidenceFile(outputFile, "{}\n"));
	assert.equal(readFileSync(victim, "utf8"), "victim");
	unlinkSync(outputFile);
});

test("timing summary is deterministic and excludes failures", () => {
	const records = [
		{ ok: true, transport: { processMs: 10, result: { handlerMs: 2 } } },
		{ ok: false, transport: { processMs: 500, result: { handlerMs: 400 } } },
		{ ok: true, transport: { processMs: 20, result: { handlerMs: 4 } } },
	];
	assert.deepEqual(summarizeTimings(records), {
		attempts: 3,
		successes: 2,
		phaseCounts: { unavailable: 3 },
		processMs: { min: 10, median: 10, p95: 20, max: 20 },
		handlerMs: { min: 2, median: 2, p95: 4, max: 4 },
	});
});

test("cold evidence keeps a bounded transport summary", () => {
	const evidence = compactColdAttempt({
		ok: false,
		recordedAt: "2026-07-23T00:00:00.000Z",
		invocation: { args: ["must-not-be-retained"] },
		transport: {
			exitCode: 1,
			processMs: 10,
			timedOut: false,
			overflow: false,
			stdout: { bytes: 0, sha256: "a".repeat(64) },
			stderr: { bytes: 88, sha256: "b".repeat(64) },
			parseError: "INVALID_JSON_RESULT",
		},
	});
	assert.deepEqual(evidence, {
		ok: false,
		recordedAt: "2026-07-23T00:00:00.000Z",
		transport: {
			exitCode: 1,
			processMs: 10,
			timedOut: false,
			overflow: false,
			spawnErrorCode: null,
			stdout: { bytes: 0, sha256: "a".repeat(64) },
			stderr: { bytes: 88, sha256: "b".repeat(64) },
			parseError: "INVALID_JSON_RESULT",
			contractError: null,
			result: null,
		},
	});
	assert.equal("invocation" in evidence, false);
});

test("lifecycle evidence rejects terminal handlers after reload", () => {
	const evidenceFor = (phase) => ({
		ok: true,
		transport: { result: { phase } },
	});
	assert.equal(hasLivePostReloadPhase(evidenceFor("loading")), true);
	assert.equal(hasLivePostReloadPhase(evidenceFor("startup-reconciled")), true);
	assert.equal(hasLivePostReloadPhase(evidenceFor("unloading")), false);
	assert.equal(hasLivePostReloadPhase(evidenceFor("load-failed")), false);
	assert.equal(hasLivePostReloadPhase({ ok: false }), false);
});

test("client contract rejects unknown lifecycle phases", () => {
	const input = { bytes: 0, sha256: sha256(Buffer.alloc(0)) };
	const request = {
		requestId: "phase-contract",
		operation: "health",
		expectedVaultSha256: null,
		outputBytes: 0,
	};
	assert.equal(validateProbeResponse({
		probeVersion: 1,
		requestId: request.requestId,
		ok: true,
		operation: request.operation,
		phase: "future-phase",
		vaultIdentity: { expectedMatch: null },
		input,
		output: { bytes: 0, sha256: input.sha256 },
		handlerMs: 1,
	}, request, input), "RESULT_PHASE_INVALID");
});

test("request-file client uses token-only invocation and leaves no request file", async () => {
	const fixtureRoot = mkdtempSync(join(tmpdir(), "operon-transport-client-test-"));
	const fakeCli = join(fixtureRoot, "fake-obsidian");
	const fakeSource = `#!/usr/bin/env node
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const tokenArg = process.argv.find((value) => value.startsWith("requestToken="));
if (!tokenArg) process.exit(3);
const token = tokenArg.slice("requestToken=".length);
if (!/^[A-Za-z0-9_-]{32}$/.test(token)) process.exit(4);
const requestPath = path.join(os.tmpdir(), "operon-agent-runtime-uid-" + process.getuid(), token + ".request.json");
const request = JSON.parse(fs.readFileSync(requestPath, "utf8"));
fs.unlinkSync(requestPath);
const payload = Buffer.from(request.payloadBase64 || "", "base64url");
const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");
process.stdout.write(JSON.stringify({
  probeVersion: 1,
  requestId: request.requestId,
  ok: true,
  operation: request.operation,
  phase: "startup-reconciled",
  vaultIdentity: { expectedMatch: true },
  input: { bytes: payload.length, sha256: digest(payload) },
  output: { bytes: 0, sha256: digest(Buffer.alloc(0)) },
  handlerMs: 1
}));
`;
	writeFileSync(fakeCli, fakeSource, { mode: 0o755 });
	chmodSync(fakeCli, 0o755);
	const vault = join(fixtureRoot, "vault");
	mkdirSync(vault);

	const evidence = await executeProbe({
		obsidianBin: fakeCli,
		vaultRef: "synthetic-vault",
		vaultPath: vault,
		operation: "digest",
		channel: "request-file",
		payload: "synthetic payload",
		outputBytes: 0,
		delayMs: 0,
		timeoutMs: 5_000,
	});
	assert.equal(evidence.ok, true);
	assert.equal(evidence.transport.result.input.bytes, 17);
	assert.equal(evidence.transport.result.vaultIdentity.expectedMatch, true);
});

test("client rejects a stale or mismatched structured response", async () => {
	const fixtureRoot = mkdtempSync(join(tmpdir(), "operon-transport-mismatch-test-"));
	const fakeCli = join(fixtureRoot, "fake-obsidian");
	const fakeSource = `#!/usr/bin/env node
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const token = process.argv.find(value => value.startsWith("requestToken=")).slice("requestToken=".length);
const requestPath = path.join(os.tmpdir(), "operon-agent-runtime-uid-" + process.getuid(), token + ".request.json");
const request = JSON.parse(fs.readFileSync(requestPath, "utf8"));
fs.unlinkSync(requestPath);
const payload = Buffer.from(request.payloadBase64 || "", "base64url");
const digest = value => crypto.createHash("sha256").update(value).digest("hex");
process.stdout.write(JSON.stringify({
  probeVersion: 1,
  requestId: "stale-request",
  ok: true,
  operation: request.operation,
  phase: "startup-reconciled",
  vaultIdentity: { expectedMatch: true },
  input: { bytes: payload.length, sha256: digest(payload) },
  output: { bytes: 0, sha256: digest(Buffer.alloc(0)) },
  handlerMs: 1
}));
`;
	writeFileSync(fakeCli, fakeSource, { mode: 0o755 });
	chmodSync(fakeCli, 0o755);
	const vault = join(fixtureRoot, "vault");
	mkdirSync(vault);

	const evidence = await executeProbe({
		obsidianBin: fakeCli,
		vaultRef: "synthetic-vault",
		vaultPath: vault,
		operation: "digest",
		channel: "request-file",
		payload: "synthetic payload",
		outputBytes: 0,
		delayMs: 0,
		timeoutMs: 5_000,
		requestId: "current-request",
	});
	assert.equal(evidence.ok, false);
	assert.equal(evidence.transport.contractError, "RESULT_REQUEST_ID_MISMATCH");
});
