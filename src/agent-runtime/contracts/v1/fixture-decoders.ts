import {
	decodeCapabilityAdvertisementsV1,
	decodeCapabilityRegistryV1,
	decodeCatalogRequestV1,
	decodeCliClientErrorEnvelopeV1,
	decodeCliInvocationV1,
	decodeCliResultEnvelopeV1,
	decodeCompatibilityOfferV1,
	decodeCompatibilitySelectionV1,
	decodeContextPackV1,
	decodeContextRequestV1,
	decodeDeveloperApiAccessFailureV1,
	decodeDeveloperApiAccessRequestV1,
	decodeDeveloperApiChannelStatusV1,
	decodeDeveloperMutationApplyInputV1,
	decodeDeveloperMutationExecutionResultV1,
	decodeDeveloperMutationPendingRecoveriesResultV1,
	decodeDeveloperMutationPreviewInputV1,
	decodeDeveloperMutationPreviewResultV1,
	decodeDeveloperMutationRecoverInputV1,
	decodeEntityResolutionResultV1,
	decodeEntityResolveRequestV1,
	decodeFieldCatalogV1,
	decodeMutationApplyRequestV1,
	decodeMutationPreviewRequestV1,
	decodeMutationPreviewResultV1,
	decodeMutationReceiptV1,
	decodeMutationResultV1,
	decodeOperonCatalogV1,
	decodeRelationshipRequestV1,
	decodeRelationshipResultV1,
	decodeRuntimeDiagnosticsV1,
	decodeRuntimeHealthV1,
	decodeSealedMutationPlanV1,
	decodeStructuredErrorV1,
	decodeTaskContextV1,
	decodeTaskFinderRequestV1,
	decodeTaskFinderResultV1,
	decodeTaskGetRequestV1,
	decodeTaskGetResultV1,
	decodeTaskFilterQueryRequestV1,
	decodeTaskFilterQueryResultV1,
	decodeTaskQueryRequestV1,
	decodeTaskQueryResultV1,
	decodeTaskSourceLocatorV1,
	decodeTimerReadRequestV1,
	decodeTimerReadResultV1,
	type DecodeIssueV1,
	type DecodeResultV1,
} from './decode';

export type ContractSchemaIdV1 =
	| 'compatibility-offer'
	| 'compatibility-selection'
	| 'structured-error'
	| 'runtime-health'
	| 'runtime-diagnostics'
	| 'capability-advertisements'
	| 'capability-registry'
	| 'field-catalog'
	| 'catalog-request'
	| 'operon-catalog'
	| 'task-source-locator'
	| 'task-context'
	| 'entity-resolve-request'
	| 'entity-resolution-result'
	| 'task-get-request'
	| 'task-get-result'
	| 'task-query-request'
	| 'task-query-result'
	| 'task-filter-query-request'
	| 'task-filter-query-result'
	| 'task-finder-request'
	| 'task-finder-result'
	| 'relationship-request'
	| 'relationship-result'
	| 'context-request'
	| 'context-pack'
	| 'cli-invocation'
	| 'cli-result'
	| 'cli-client-error'
	| 'developer-api-access-request'
	| 'developer-api-access-failure'
	| 'developer-api-channel-status'
	| 'developer-mutation-preview-input'
	| 'developer-mutation-preview-result'
	| 'developer-mutation-apply-input'
	| 'developer-mutation-recover-input'
	| 'developer-mutation-pending-recoveries-result'
	| 'developer-mutation-execution-result'
	| 'mutation-preview-request'
	| 'mutation-preview-result'
	| 'sealed-mutation-plan'
	| 'mutation-apply-request'
	| 'mutation-result'
	| 'mutation-receipt'
	| 'timer-read-request'
	| 'timer-read-result';

type ContractDecoderV1 = (value: unknown) => DecodeResultV1<unknown>;

export const DECODER_REGISTRY_V1: Readonly<Record<ContractSchemaIdV1, ContractDecoderV1>> =
	Object.freeze({
		'compatibility-offer': decodeCompatibilityOfferV1,
		'compatibility-selection': decodeCompatibilitySelectionV1,
		'structured-error': decodeStructuredErrorV1,
		'runtime-health': decodeRuntimeHealthV1,
		'runtime-diagnostics': decodeRuntimeDiagnosticsV1,
		'capability-advertisements': decodeCapabilityAdvertisementsV1,
		'capability-registry': decodeCapabilityRegistryV1,
		'field-catalog': decodeFieldCatalogV1,
		'catalog-request': decodeCatalogRequestV1,
		'operon-catalog': decodeOperonCatalogV1,
		'task-source-locator': decodeTaskSourceLocatorV1,
		'task-context': decodeTaskContextV1,
		'entity-resolve-request': decodeEntityResolveRequestV1,
		'entity-resolution-result': decodeEntityResolutionResultV1,
		'task-get-request': decodeTaskGetRequestV1,
		'task-get-result': decodeTaskGetResultV1,
		'task-query-request': decodeTaskQueryRequestV1,
		'task-query-result': decodeTaskQueryResultV1,
		'task-filter-query-request': decodeTaskFilterQueryRequestV1,
		'task-filter-query-result': decodeTaskFilterQueryResultV1,
		'task-finder-request': decodeTaskFinderRequestV1,
		'task-finder-result': decodeTaskFinderResultV1,
		'relationship-request': decodeRelationshipRequestV1,
		'relationship-result': decodeRelationshipResultV1,
		'context-request': decodeContextRequestV1,
		'context-pack': decodeContextPackV1,
		'cli-invocation': decodeCliInvocationV1,
		'cli-result': decodeCliResultEnvelopeV1,
		'cli-client-error': decodeCliClientErrorEnvelopeV1,
		'developer-api-access-request': decodeDeveloperApiAccessRequestV1,
		'developer-api-access-failure': decodeDeveloperApiAccessFailureV1,
		'developer-api-channel-status': decodeDeveloperApiChannelStatusV1,
		'developer-mutation-preview-input': decodeDeveloperMutationPreviewInputV1,
		'developer-mutation-preview-result': decodeDeveloperMutationPreviewResultV1,
		'developer-mutation-apply-input': decodeDeveloperMutationApplyInputV1,
		'developer-mutation-recover-input': decodeDeveloperMutationRecoverInputV1,
		'developer-mutation-pending-recoveries-result':
			decodeDeveloperMutationPendingRecoveriesResultV1,
		'developer-mutation-execution-result': decodeDeveloperMutationExecutionResultV1,
		'mutation-preview-request': decodeMutationPreviewRequestV1,
		'mutation-preview-result': decodeMutationPreviewResultV1,
		'sealed-mutation-plan': decodeSealedMutationPlanV1,
		'mutation-apply-request': decodeMutationApplyRequestV1,
		'mutation-result': decodeMutationResultV1,
		'mutation-receipt': decodeMutationReceiptV1,
		'timer-read-request': decodeTimerReadRequestV1,
		'timer-read-result': decodeTimerReadResultV1,
	});

export function decodeContractFixtureV1(
	schemaId: string,
	value: unknown,
): DecodeResultV1<unknown> {
	if (!Object.prototype.hasOwnProperty.call(DECODER_REGISTRY_V1, schemaId)) {
		return fixtureFailure('', 'value', `Unknown schema id: ${schemaId}`);
	}
	return DECODER_REGISTRY_V1[schemaId as ContractSchemaIdV1](value);
}

function fixtureFailure(
	path: string,
	code: DecodeIssueV1['code'],
	message: string,
): DecodeResultV1<never> {
	return { ok: false, issues: [{ path, code, message }] };
}
