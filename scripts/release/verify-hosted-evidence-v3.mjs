#!/usr/bin/env node

import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkEvidenceSealV3 } from './evidence-seal-v3.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const pluginRoot = path.resolve(path.dirname(scriptPath), '../..');

export async function verifyHostedEvidenceV3(options = {}) {
	const root = options.pluginRoot ?? pluginRoot;
	const fetchImpl = options.fetchImpl ?? fetch;
	const token = options.token ?? process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
	assert.ok(typeof token === 'string' && token.trim() !== '', 'OPERON_HOSTED_EVIDENCE_TOKEN_REQUIRED');
	const checked = await checkEvidenceSealV3({ pluginRoot: root });
	const proofs = [
		checked.evidence.plugin.validation.hosted.ci,
		checked.evidence.plugin.validation.hosted.codeql,
		checked.evidence.pairedWindowsValidation,
	];
	for (const proof of proofs) await verifyProof(proof, fetchImpl, token);
	return Object.freeze({ status: 'passed', version: checked.version, candidateCommit: checked.candidateCommit, proofs: proofs.map(proof => ({ repository: proof.repository, runId: proof.runId, jobId: proof.jobId })) });
}

async function verifyProof(proof, fetchImpl, token) {
	const root = `https://api.github.com/repos/${proof.repository}/actions`;
	const [run, job] = await Promise.all([
		getJson(fetchImpl, `${root}/runs/${proof.runId}`, token),
		getJson(fetchImpl, `${root}/jobs/${proof.jobId}`, token),
	]);
	assert.equal(run.id, proof.runId, 'OPERON_HOSTED_EVIDENCE_RUN_ID_MISMATCH');
	assert.equal(run.repository?.full_name, proof.repository, 'OPERON_HOSTED_EVIDENCE_REPOSITORY_MISMATCH');
	assert.equal(run.path, proof.workflowPath, 'OPERON_HOSTED_EVIDENCE_WORKFLOW_MISMATCH');
	assert.equal(run.head_sha, proof.headSha, 'OPERON_HOSTED_EVIDENCE_HEAD_MISMATCH');
	assert.equal(run.head_branch, 'main', 'OPERON_HOSTED_EVIDENCE_BRANCH_MISMATCH');
	assert.equal(
		run.event,
		proof.repository === 'hasanyilmaz/operon-cli' ? 'workflow_dispatch' : 'push',
		'OPERON_HOSTED_EVIDENCE_EVENT_MISMATCH',
	);
	assert.equal(run.run_attempt, proof.runAttempt, 'OPERON_HOSTED_EVIDENCE_RUN_ATTEMPT_MISMATCH');
	assert.equal(run.status, 'completed', 'OPERON_HOSTED_EVIDENCE_RUN_INCOMPLETE');
	assert.equal(run.conclusion, 'success', 'OPERON_HOSTED_EVIDENCE_RUN_FAILED');
	assert.equal(job.id, proof.jobId, 'OPERON_HOSTED_EVIDENCE_JOB_ID_MISMATCH');
	assert.equal(job.run_id, proof.runId, 'OPERON_HOSTED_EVIDENCE_JOB_RUN_MISMATCH');
	assert.equal(job.run_attempt, proof.runAttempt, 'OPERON_HOSTED_EVIDENCE_JOB_ATTEMPT_MISMATCH');
	assert.equal(job.name, proof.jobName, 'OPERON_HOSTED_EVIDENCE_JOB_NAME_MISMATCH');
	assert.equal(job.status, 'completed', 'OPERON_HOSTED_EVIDENCE_JOB_INCOMPLETE');
	assert.equal(job.conclusion, 'success', 'OPERON_HOSTED_EVIDENCE_JOB_FAILED');
}

async function getJson(fetchImpl, url, token) {
	const response = await fetchImpl(url, {
		headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'user-agent': 'operon-release-evidence-seal-v3' },
		signal: AbortSignal.timeout(20_000),
	});
	assert.equal(response.status, 200, `OPERON_HOSTED_EVIDENCE_HTTP_${response.status}`);
	return response.json();
}

if (path.resolve(process.argv[1] ?? '') === scriptPath) {
	console.log(JSON.stringify(await verifyHostedEvidenceV3()));
}
