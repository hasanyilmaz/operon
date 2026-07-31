import { existsSync } from 'node:fs';

import {
	buildMutationApplyRequestV1,
	confirmationTokenForPlanV1,
	markMutationPlanDispatchedV1,
	readMutationPlanV1,
} from '../../../packages/operon-cli/src/plan-store';

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

	try {
		const record = readMutationPlanV1(planRef, root);
		const request = buildMutationApplyRequestV1(record, {
			confirmationToken: confirmationTokenForPlanV1(record.plan),
			now: new Date(now).toISOString(),
		});
		const dispatched = markMutationPlanDispatchedV1(record, request, root, now);
		process.stdout.write(`${JSON.stringify({
			ok: true,
			planRef,
			requestId: dispatched.applyRequest?.requestId,
		})}\n`);
	} catch (error) {
		process.stdout.write(`${JSON.stringify({
			ok: false,
			planRef,
			code: error instanceof Error ? error.message : 'UNKNOWN',
		})}\n`);
	}
}

void main();
