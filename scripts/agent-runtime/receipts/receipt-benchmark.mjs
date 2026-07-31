#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import process from "node:process";
import {
	RECEIPT_COUNTS,
	RECEIPT_LATENCY_BUDGET_MS,
	selectReceiptStore,
	summarizeStoreSamples,
} from "./receipt-benchmark-core.mjs";

const execFileAsync = promisify(execFile);
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const DEFAULT_OUTPUT = "/private/tmp/operon-agent-runtime-results/phase2-receipts.json";

function parseArgs(argv) {
	const options = {
		obsidianBin: "obsidian",
		iterations: 30,
		output: DEFAULT_OUTPUT,
		verifyRendererRestart: false,
	};
	for (let index = 0; index < argv.length; index += 1) {
		const flag = argv[index];
		if (flag === "--vault-ref") options.vaultRef = argv[++index];
		else if (flag === "--vault-path") options.vaultPath = argv[++index];
		else if (flag === "--obsidian-bin") options.obsidianBin = argv[++index];
		else if (flag === "--iterations") options.iterations = Number(argv[++index]);
		else if (flag === "--output") options.output = argv[++index];
		else if (flag === "--verify-renderer-restart") options.verifyRendererRestart = true;
		else throw new Error(`UNKNOWN_FLAG:${flag}`);
	}
	if (!options.vaultRef) throw new Error("VAULT_REF_REQUIRED");
	if (!options.vaultPath) throw new Error("VAULT_PATH_REQUIRED");
	if (!Number.isSafeInteger(options.iterations) || options.iterations < 3 || options.iterations > 100) {
		throw new Error("INVALID_ITERATIONS");
	}
	return options;
}

function buildBrowserBenchmarkCode(iterations) {
	const counts = JSON.stringify(RECEIPT_COUNTS);
	return `(async()=>{const counts=${counts};const iterations=${iterations};window.__operonAgentReceiptBenchmarkNonce="before-reload";`
		+ `const dbName="operon-agent-runtime-receipt-benchmark-v1";`
		+ `const storageKey="operon-agent-runtime-receipt-benchmark-v1";`
		+ `const markerKey=storageKey+":persistence";`
		+ `const defaultVault="a".repeat(64);const defaultClient="benchmark-client";`
		+ `const receipt=(index,overrides={})=>{const completedAt=overrides.completedAt||"2026-01-01T00:00:00.000Z";const expiresAt=overrides.expiresAt||new Date(Date.parse(completedAt)+86400000).toISOString();return {contractVersion:1,vaultIdentityHash:overrides.vaultIdentityHash||defaultVault,clientInstanceId:overrides.clientInstanceId||defaultClient,idempotencyKeyHash:overrides.idempotencyKeyHash||Math.abs(index).toString(16).padStart(64,"0").slice(-64),planHash:"c".repeat(64),mutationKind:overrides.mutationKind||"task.update",targetDigest:"d".repeat(64),terminalOutcome:"applied",effectiveAt:completedAt,completedAt,expiresAt};};`
		+ `const receiptFields=["clientInstanceId","completedAt","contractVersion","effectiveAt","expiresAt","idempotencyKeyHash","mutationKind","planHash","targetDigest","terminalOutcome","vaultIdentityHash"].sort().join(",");`
		+ `const validReceipt=(value)=>value&&Object.keys(value).sort().join(",")===receiptFields&&value.contractVersion===1&&/^[a-f0-9]{64}$/.test(value.vaultIdentityHash)&&/^[a-f0-9]{64}$/.test(value.idempotencyKeyHash)&&/^[a-f0-9]{64}$/.test(value.planHash)&&/^[a-f0-9]{64}$/.test(value.targetDigest)&&typeof value.clientInstanceId==="string"&&value.clientInstanceId.length>0&&["task.create","task.update","task.reminder-item","task.transition","task.pinned-state","timer.control","task.convert","task.inline-relocate","task.delete"].includes(value.mutationKind)&&["applied","already-applied","outcome-unknown"].includes(value.terminalOutcome)&&Number.isFinite(Date.parse(value.completedAt))&&Number.isFinite(Date.parse(value.effectiveAt))&&Number.isFinite(Date.parse(value.expiresAt))&&Date.parse(value.expiresAt)>Date.parse(value.completedAt)&&Date.parse(value.expiresAt)-Date.parse(value.completedAt)<=86400000;`
		+ `const keyFor=(value)=>[value.vaultIdentityHash,value.clientInstanceId,value.idempotencyKeyHash,value.mutationKind].join(":");const stored=(value)=>{if(!validReceipt(value))throw new Error("INVALID_RECEIPT_FIXTURE");return {key:keyFor(value),receipt:value};};`
		+ `const prune=(records,nowMs)=>records.filter((item)=>Date.parse(item.receipt.expiresAt)>nowMs).sort((left,right)=>right.receipt.completedAt.localeCompare(left.receipt.completedAt)||left.key.localeCompare(right.key)).slice(0,256);`
		+ `const samples=[];`
		+ `const openDb=()=>new Promise((resolve,reject)=>{const request=indexedDB.open(dbName,1);request.onupgradeneeded=()=>request.result.createObjectStore("receipts",{keyPath:"key"});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});`
		+ `const txDone=(tx)=>new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error("ABORTED"));});`
		+ `let indexedDbAvailable=true;let indexedDbAtomic=false;let indexedDbPersistence=false;let indexedDbComposite=false;let indexedDbRetention=false;let indexedDbExpiry=false;let indexedDbPayload=false;`
		+ `try{const db=await openDb();for(const count of counts){const base=Array.from({length:count},(_,i)=>stored(receipt(i)));for(let run=0;run<iterations;run++){let tx=db.transaction("receipts","readwrite");let store=tx.objectStore("receipts");store.clear();for(const item of base)store.put(item);await txDone(tx);const expected=stored(receipt(count+run));let started=performance.now();tx=db.transaction("receipts","readwrite");store=tx.objectStore("receipts");store.put(expected);await txDone(tx);const writeMs=performance.now()-started;started=performance.now();const loaded=await new Promise((resolve,reject)=>{const request=db.transaction("receipts","readonly").objectStore("receipts").get(expected.key);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});const readMs=performance.now()-started;started=performance.now();tx=db.transaction("receipts","readwrite");tx.objectStore("receipts").delete(expected.key);await txDone(tx);const deleteMs=performance.now()-started;const deleted=await new Promise((resolve,reject)=>{const request=db.transaction("receipts","readonly").objectStore("receipts").get(expected.key);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});const ok=validReceipt(loaded?.receipt)&&loaded?.receipt.planHash===expected.receipt.planHash&&loaded?.receipt.targetDigest===expected.receipt.targetDigest&&deleted===undefined;samples.push({store:"indexeddb",count,ok,writeMs,readMs,deleteMs});}}`
		+ `let tx=db.transaction("receipts","readwrite");tx.objectStore("receipts").put({key:"atomic-marker",value:"before"});await txDone(tx);tx=db.transaction("receipts","readwrite");const aborted=txDone(tx);tx.objectStore("receipts").put({key:"atomic-marker",value:"after"});tx.abort();try{await aborted;}catch{}const marker=await new Promise((resolve,reject)=>{const request=db.transaction("receipts","readonly").objectStore("receipts").get("atomic-marker");request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});indexedDbAtomic=marker?.value==="before";const scoped=[stored(receipt(999)),stored(receipt(999,{vaultIdentityHash:"b".repeat(64)})),stored(receipt(999,{clientInstanceId:"other-client"})),stored(receipt(1000)),stored(receipt(999,{mutationKind:"task.delete"}))];tx=db.transaction("receipts","readwrite");const scopedStore=tx.objectStore("receipts");scopedStore.clear();for(const item of scoped)scopedStore.put(item);await txDone(tx);const scopedRecords=await new Promise((resolve,reject)=>{const request=db.transaction("receipts","readonly").objectStore("receipts").getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});indexedDbComposite=new Set(scoped.map((item)=>item.key)).size===scoped.length&&scoped.every((item)=>scopedRecords.some((storedItem)=>storedItem.key===item.key&&validReceipt(storedItem.receipt)));const live=Array.from({length:258},(_,i)=>stored(receipt(2000+i,{completedAt:new Date(Date.UTC(2026,0,1,0,0,0,i)).toISOString()})));const expired=stored(receipt(9999,{completedAt:"2025-12-30T00:00:00.000Z",expiresAt:"2025-12-31T00:00:00.000Z"}));const retained=prune([...live,expired],Date.parse("2026-01-01T12:00:00.000Z"));tx=db.transaction("receipts","readwrite");const retentionStore=tx.objectStore("receipts");retentionStore.clear();for(const item of retained)retentionStore.put(item);await txDone(tx);const retainedRecords=await new Promise((resolve,reject)=>{const request=db.transaction("receipts","readonly").objectStore("receipts").getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});const expectedKeys=retained.map((item)=>item.key).sort();const actualKeys=retainedRecords.map((item)=>item.key).sort();indexedDbRetention=expectedKeys.length===256&&JSON.stringify(actualKeys)===JSON.stringify(expectedKeys);indexedDbExpiry=!retainedRecords.some((item)=>item.key===expired.key);indexedDbPayload=retainedRecords.every((item)=>validReceipt(item.receipt));tx=db.transaction("receipts","readwrite");tx.objectStore("receipts").put({key:"persistence-marker",value:"present"});await txDone(tx);db.close();const reopened=await openDb();const persisted=await new Promise((resolve,reject)=>{const request=reopened.transaction("receipts","readonly").objectStore("receipts").get("persistence-marker");request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});indexedDbPersistence=persisted?.value==="present";reopened.close();}catch(error){indexedDbAvailable=false;samples.push({store:"indexeddb",count:1,ok:false,writeMs:0,readMs:0,deleteMs:0,error:String(error)});}`
		+ `let localStorageAvailable=true;let localStorageAtomic=false;let localStoragePersistence=false;let localStorageComposite=false;let localStorageRetention=false;let localStorageExpiry=false;let localStoragePayload=false;`
		+ `try{for(const count of counts){let records=Array.from({length:count},(_,i)=>stored(receipt(i)));for(let run=0;run<iterations;run++){localStorage.setItem(storageKey,JSON.stringify(records));const expected=stored(receipt(count+run));let started=performance.now();const updated=[...records,expected];localStorage.setItem(storageKey,JSON.stringify(updated));const writeMs=performance.now()-started;started=performance.now();const loaded=JSON.parse(localStorage.getItem(storageKey)||"[]").find((item)=>item.key===expected.key);const readMs=performance.now()-started;started=performance.now();localStorage.setItem(storageKey,JSON.stringify(updated.filter((item)=>item.key!==expected.key)));const deleteMs=performance.now()-started;const deleted=!JSON.parse(localStorage.getItem(storageKey)||"[]").some((item)=>item.key===expected.key);samples.push({store:"localstorage",count,ok:validReceipt(loaded?.receipt)&&loaded?.receipt.planHash===expected.receipt.planHash&&deleted,writeMs,readMs,deleteMs});}}const scoped=[stored(receipt(999)),stored(receipt(999,{vaultIdentityHash:"b".repeat(64)})),stored(receipt(999,{clientInstanceId:"other-client"})),stored(receipt(1000)),stored(receipt(999,{mutationKind:"task.delete"}))];localStorageComposite=new Set(scoped.map((item)=>item.key)).size===scoped.length;const live=Array.from({length:258},(_,i)=>stored(receipt(2000+i,{completedAt:new Date(Date.UTC(2026,0,1,0,0,0,i)).toISOString()})));const expired=stored(receipt(9999,{completedAt:"2025-12-30T00:00:00.000Z",expiresAt:"2025-12-31T00:00:00.000Z"}));const retained=prune([...live,expired],Date.parse("2026-01-01T12:00:00.000Z"));localStorage.setItem(storageKey,JSON.stringify(retained));const retainedRecords=JSON.parse(localStorage.getItem(storageKey)||"[]");const expectedKeys=retained.map((item)=>item.key).sort();const actualKeys=retainedRecords.map((item)=>item.key).sort();localStorageRetention=expectedKeys.length===256&&JSON.stringify(actualKeys)===JSON.stringify(expectedKeys);localStorageExpiry=!retainedRecords.some((item)=>item.key===expired.key);localStoragePayload=retainedRecords.every((item)=>validReceipt(item.receipt));localStorageAtomic=false;localStorage.setItem(markerKey,"present");localStoragePersistence=localStorage.getItem(markerKey)==="present";}catch(error){localStorageAvailable=false;samples.push({store:"localstorage",count:1,ok:false,writeMs:0,readMs:0,deleteMs:0,error:String(error)});}`
		+ `return JSON.stringify({benchmarkVersion:1,samples,indexedDb:{available:indexedDbAvailable,atomicReplacementVerified:indexedDbAtomic,persistenceVerified:indexedDbPersistence,compositeKeyVerified:indexedDbComposite,retentionVerified:indexedDbRetention,expiryVerified:indexedDbExpiry,payloadValidationVerified:indexedDbPayload},localStorage:{available:localStorageAvailable,atomicReplacementVerified:localStorageAtomic,persistenceVerified:localStoragePersistence,compositeKeyVerified:localStorageComposite,retentionVerified:localStorageRetention,expiryVerified:localStorageExpiry,payloadValidationVerified:localStoragePayload}});})()`;
}

function buildPersistenceCheckCode(cleanup) {
	return `(async()=>{const dbName="operon-agent-runtime-receipt-benchmark-v1";const markerKey="operon-agent-runtime-receipt-benchmark-v1:persistence";`
		+ `const openDb=()=>new Promise((resolve,reject)=>{const request=indexedDB.open(dbName,1);request.onupgradeneeded=()=>request.result.createObjectStore("receipts",{keyPath:"key"});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});`
		+ `let indexedDb=false;let local=false;try{const db=await openDb();const marker=await new Promise((resolve,reject)=>{const request=db.transaction("receipts","readonly").objectStore("receipts").get("persistence-marker");request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});indexedDb=marker?.value==="present";db.close();}catch{}try{local=localStorage.getItem(markerKey)==="present";}catch{}`
		+ (cleanup
			? `let localStorageDeleted=false;let indexedDbDeleted=false;let indexedDbAbsenceVerified=false;try{localStorage.removeItem("operon-agent-runtime-receipt-benchmark-v1");localStorage.removeItem(markerKey);localStorageDeleted=localStorage.getItem("operon-agent-runtime-receipt-benchmark-v1")===null&&localStorage.getItem(markerKey)===null;}catch{}try{indexedDbDeleted=await new Promise((resolve)=>{const request=indexedDB.deleteDatabase(dbName);request.onsuccess=()=>resolve(true);request.onerror=()=>resolve(false);request.onblocked=()=>resolve(false);});if(indexedDbDeleted&&typeof indexedDB.databases==="function"){const databases=await indexedDB.databases();indexedDbAbsenceVerified=!databases.some((database)=>database.name===dbName);}}catch{}`
			: "")
		+ `return JSON.stringify({indexedDb,localStorage:local,rendererReloaded:window.__operonAgentReceiptBenchmarkNonce!=="before-reload"${cleanup ? ",cleanup:{localStorageDeleted,indexedDbDeleted,indexedDbAbsenceVerified}" : ""}});})()`;
}

function parseCliJson(stdout) {
	const trimmed = stdout.trim();
	const candidates = [trimmed, ...trimmed.split(/\r?\n/u).reverse()];
	for (const candidate of candidates) {
		try {
			const normalized = candidate.startsWith("=> ")
				? candidate.slice(3).trim()
				: candidate;
			const parsed = JSON.parse(normalized);
			if (typeof parsed === "string") return JSON.parse(parsed);
			if (parsed && typeof parsed === "object") return parsed;
		} catch {
			// Continue until a JSON result line is found.
		}
	}
	throw new Error("OBSIDIAN_EVAL_RESULT_NOT_JSON");
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const canonicalVaultPath = await realpath(options.vaultPath);
	if (!canonicalVaultPath.startsWith("/private/tmp/operon-agent-runtime-phase1-")) {
		throw new Error("SANITIZED_PHASE1_VAULT_REQUIRED");
	}
	const manifestBytes = await readFile(join(
		canonicalVaultPath,
		".obsidian",
		"plugins",
		"operon",
		"manifest.json",
	));
	const manifest = JSON.parse(manifestBytes.toString("utf8"));
	if (manifest?.id !== "operon") throw new Error("OPERON_MANIFEST_REQUIRED");
	const dataBytes = await readFile(join(
		canonicalVaultPath,
		".obsidian",
		"plugins",
		"operon",
		"data.json",
	));
	const hash = (value) => createHash("sha256").update(value).digest("hex");
	const { stdout: versionStdout } = await execFileAsync(options.obsidianBin, ["version"], {
		cwd: rootDir,
		timeout: 10_000,
	});
	const { stdout: resolvedVaultStdout } = await execFileAsync(options.obsidianBin, [
		`vault=${options.vaultRef}`,
		"vault",
		"info=path",
	], {
		cwd: rootDir,
		timeout: 10_000,
	});
	const resolvedVaultPath = await realpath(resolvedVaultStdout.trim());
	if (resolvedVaultPath !== canonicalVaultPath) throw new Error("VAULT_REF_PATH_MISMATCH");

	const code = buildBrowserBenchmarkCode(options.iterations);
	let raw = null;
	let restartPersistence = null;
	let cleanupResult = null;
	let benchmarkError = null;
	let cleanupError = null;
	let browserStateMayExist = false;
	try {
		browserStateMayExist = true;
		const { stdout } = await execFileAsync(options.obsidianBin, [
			`vault=${options.vaultRef}`,
			"eval",
			`code=${code}`,
		], {
			cwd: rootDir,
			maxBuffer: 4 * 1024 * 1024,
			timeout: 120_000,
		});
		raw = parseCliJson(stdout);
		if (options.verifyRendererRestart) {
			try {
				await execFileAsync(options.obsidianBin, [
					`vault=${options.vaultRef}`,
					"eval",
					"code=window.location.reload()",
				], {
					cwd: rootDir,
					timeout: 5_000,
				});
			} catch {
				// A renderer reload can terminate the initiating CLI call before it replies.
			}
			const deadline = Date.now() + 30_000;
			while (Date.now() < deadline && restartPersistence === null) {
				await new Promise((resolveWait) => setTimeout(resolveWait, 500));
				try {
					const check = await execFileAsync(options.obsidianBin, [
						`vault=${options.vaultRef}`,
						"eval",
						`code=${buildPersistenceCheckCode(false)}`,
					], {
						cwd: rootDir,
						maxBuffer: 1024 * 1024,
						timeout: 5_000,
					});
					restartPersistence = parseCliJson(check.stdout);
				} catch {
					// Keep polling while the renderer reloads.
				}
			}
		}
	} catch (error) {
		benchmarkError = error;
	} finally {
		if (browserStateMayExist) {
			try {
				const cleanup = await execFileAsync(options.obsidianBin, [
					`vault=${options.vaultRef}`,
					"eval",
					`code=${buildPersistenceCheckCode(true)}`,
				], {
					cwd: rootDir,
					maxBuffer: 1024 * 1024,
					timeout: 10_000,
				});
				cleanupResult = parseCliJson(cleanup.stdout);
			} catch (error) {
				cleanupError = error;
			}
		}
	}
	const cleanupVerified = cleanupResult?.cleanup?.localStorageDeleted === true
		&& cleanupResult?.cleanup?.indexedDbDeleted === true
		&& cleanupResult?.cleanup?.indexedDbAbsenceVerified === true;
	const cleanupFailure = cleanupError
		?? (cleanupVerified ? null : new Error("RECEIPT_BENCHMARK_CLEANUP_UNVERIFIED"));
	if (benchmarkError) {
		if (cleanupFailure) {
			throw new AggregateError(
				[benchmarkError, cleanupFailure],
				"RECEIPT_BENCHMARK_FAILED_AND_CLEANUP_FAILED",
			);
		}
		throw benchmarkError;
	}
	if (cleanupError) throw new Error("RECEIPT_BENCHMARK_CLEANUP_FAILED", { cause: cleanupError });
	if (!raw) throw new Error("RECEIPT_BENCHMARK_RESULT_MISSING");
	if (!cleanupVerified) throw new Error("RECEIPT_BENCHMARK_CLEANUP_UNVERIFIED");
	const indexedDbSamples = raw.samples.filter((sample) => sample.store === "indexeddb");
	const localStorageSamples = raw.samples.filter((sample) => sample.store === "localstorage");
	const evidence = {
		receiptBenchmarkVersion: 1,
		recordedAt: new Date().toISOString(),
		iterations: options.iterations,
		counts: RECEIPT_COUNTS,
		latencyBudgetMs: RECEIPT_LATENCY_BUDGET_MS,
		environment: {
			obsidianVersion: versionStdout.trim(),
			vaultIdentitySha256: hash(Buffer.from(canonicalVaultPath, "utf8")),
			vaultReferenceVerified: true,
			operonManifestSha256: hash(manifestBytes),
			operonDataSha256: hash(dataBytes),
		},
		indexedDb: {
			...raw.indexedDb,
			persistenceVerified: options.verifyRendererRestart
				? restartPersistence?.rendererReloaded === true && restartPersistence?.indexedDb === true
				: false,
			byCount: summarizeStoreSamples(indexedDbSamples),
		},
		localStorage: {
			...raw.localStorage,
			persistenceVerified: options.verifyRendererRestart
				? restartPersistence?.rendererReloaded === true && restartPersistence?.localStorage === true
				: false,
			byCount: summarizeStoreSamples(localStorageSamples),
		},
		rendererRestartAttempted: options.verifyRendererRestart,
		rendererRestartObserved: restartPersistence?.rendererReloaded === true,
		cleanup: cleanupResult.cleanup,
	};
	evidence.selection = selectReceiptStore(evidence);
	await mkdir(dirname(options.output), { recursive: true, mode: 0o700 });
	await writeFile(options.output, `${JSON.stringify(evidence, null, 2)}\n`, {
		encoding: "utf8",
		mode: 0o600,
	});
	process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

main().catch((error) => {
	process.stderr.write(`${JSON.stringify({
		ok: false,
		error: error instanceof Error ? error.message : "RECEIPT_BENCHMARK_FAILED",
	})}\n`);
	process.exitCode = 1;
});
