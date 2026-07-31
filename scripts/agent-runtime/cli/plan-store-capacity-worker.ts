import { existsSync } from 'node:fs';

import {
	buildMutationApplyRequestV1,
	confirmationTokenForPlanV1,
	markMutationPlanDispatchedV1,
	readMutationPlanV1,
} from '../../../packages/operon-cli/src/plan-store';
import { decodeMutationApplyRequestV1 } from '../../../src/agent-runtime/contracts/v1/decode';

async function main(): Promise<void> {
	const [root, planRef, releasePath, nowText] = process.argv.slice(2);
	if (!root || !planRef || !releasePath || !nowText) {
		throw new Error('CAPACITY_WORKER_ARGUMENTS_REQUIRED');
	}
	const now = Number.parseInt(nowText, 10);
	if (!Number.isSafeInteger(now)) throw new Error('CAPACITY_WORKER_NOW_INVALID');

	process.stdout.write('ready\n');
	const deadline = Date.now() + 10_000;
	while (!existsSync(releasePath)) {
		if (Date.now() >= deadline) throw new Error('CAPACITY_WORKER_RELEASE_TIMEOUT');
		await new Promise(resolve => setTimeout(resolve, 5));
	}

	let stage: 'read' | 'build' | 'decode' | 'mark' = 'read';
	let issues: unknown;
	try {
		const record = readMutationPlanV1(planRef, root, { allowExpired: true, now });
		const logicalNow = Date.parse(record.plan.createdAt) + 1_000;
		if (
			!Number.isSafeInteger(logicalNow)
			|| logicalNow >= Date.parse(record.plan.expiresAt)
		) throw new Error('CAPACITY_WORKER_PLAN_INTERVAL_INVALID');
		stage = 'build';
		const request = buildMutationApplyRequestV1(record, {
			confirmationToken: confirmationTokenForPlanV1(record.plan),
			now: new Date(logicalNow).toISOString(),
		});
		stage = 'decode';
		const decodedRequest = decodeMutationApplyRequestV1(request);
		if (!decodedRequest.ok) {
			issues = decodedRequest.issues;
			throw new Error('CAPACITY_WORKER_APPLY_REQUEST_MALFORMED');
		}
		stage = 'mark';
		const dispatched = markMutationPlanDispatchedV1(record, request, root, logicalNow);
		process.stdout.write(`${JSON.stringify({
			ok: true,
			planRef,
			requestId: dispatched.applyRequest?.requestId,
		})}\n`);
	} catch (error) {
		process.stdout.write(`${JSON.stringify({
			ok: false,
			planRef,
			stage,
			code: error instanceof Error ? error.message : 'UNKNOWN',
			...(issues === undefined ? {} : { issues }),
		})}\n`);
	}
}

void main();
