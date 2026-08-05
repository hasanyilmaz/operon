import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	mkdtempSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { symlinkCapabilityUnavailableReason } from "../test-symlink-capability.mjs";

const script = resolve("scripts/agent-runtime/create-sanitized-vault.mjs");
const fixedTempRoot = realpathSync(process.platform === "darwin" ? "/private/tmp" : tmpdir());

test("sanitized vault generator rejects targets outside its fixed temp namespace", () => {
	const target = join(mkdtempSync(join(tmpdir(), "operon-vault-target-test-")), "vault");
	const result = spawnSync(process.execPath, [script, target], { encoding: "utf8" });
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /SANITIZED_VAULT_TARGET_OUTSIDE_FIXED_TEMP_ROOT/u);
});

test("sanitized vault generator refuses a matching-name symlink without touching its target", {
	skip: symlinkCapabilityUnavailableReason(),
}, () => {
	const victimRoot = mkdtempSync(join(tmpdir(), "operon-vault-victim-test-"));
	const sentinel = join(victimRoot, "sentinel.txt");
	writeFileSync(sentinel, "keep", { mode: 0o600 });
	const target = join(
		fixedTempRoot,
		`operon-agent-runtime-phase1-symlink-${process.pid}-${Date.now()}`,
	);
	mkdirSync(victimRoot, { recursive: true });
	symlinkSync(victimRoot, target, process.platform === "win32" ? "junction" : "dir");
	try {
		const result = spawnSync(process.execPath, [script, target], { encoding: "utf8" });
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /SANITIZED_VAULT_TARGET_IS_SYMLINK/u);
		assert.equal(readFileSync(sentinel, "utf8"), "keep");
	} finally {
		unlinkSync(target);
	}
});
