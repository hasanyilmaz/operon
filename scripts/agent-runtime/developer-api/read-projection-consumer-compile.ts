import type {
	OperonReadProjectionDeveloperApiAccessorV1,
	ReadProjectionDeveloperApiAccessRequestV1,
} from '../../../src/agent-runtime/extensions/read-projection-v1/public-contract';
import type { OperonDeveloperApiConsumerPluginV1 } from '../../../src/agent-runtime/public/v1';

declare const operon: OperonReadProjectionDeveloperApiAccessorV1;
declare const consumer: OperonDeveloperApiConsumerPluginV1;

const request = {
	contractVersion: 1,
	runtimeApi: { min: 1, max: 1 },
	requestedCapabilities: ['read-projection.context.build'],
} as const satisfies ReadProjectionDeveloperApiAccessRequestV1<readonly ['read-projection.context.build']>;

const access = operon.getReadProjectionDeveloperApiV1(consumer, request);
if (access.ok) {
	void access.api.context.build({
		contractVersion: 1,
		requestId: 'consumer-compile-context',
		kind: 'context',
		consistency: 'live-verified',
		purpose: 'analysis',
		projection: 'project-analysis',
		selector: { kind: 'operon-id', operonId: 'abc1234' },
	});
	// @ts-expect-error A context-only grant must not project the task finder.
	void access.api.tasks.find;
}
