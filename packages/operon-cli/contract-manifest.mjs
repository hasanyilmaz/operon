import { createHash } from 'node:crypto';

export const CLI_SCHEMA_ENTRYPOINTS_V1 = Object.freeze([
	{
		schemaId: 'mutation-intent',
		ref: 'urn:operon:schema:cli:v1:operon-cli-local.schema.json#/$defs/mutationIntent',
	},
	{
		schemaId: 'mutation-plan-reference',
		ref: 'urn:operon:schema:cli:v1:operon-cli-local.schema.json#/$defs/mutationPlanReference',
	},
	{
		schemaId: 'plan-show-result',
		ref: 'urn:operon:schema:cli:v1:operon-cli-local.schema.json#/$defs/planShowResult',
	},
	{
		schemaId: 'operon-cli-config',
		ref: 'urn:operon:schema:cli:v1:operon-cli-local.schema.json#/$defs/config',
	},
	{
		schemaId: 'operon-cli-local-result',
		ref: 'urn:operon:schema:cli:v1:operon-cli-local.schema.json#/$defs/localResult',
	},
	...[
		['version-result', 'versionResult'],
		['manifest-result', 'manifestResult'],
		['schema-list-result', 'schemaListResult'],
		['schema-get-result', 'schemaGetResult'],
		['setup-result', 'setupResult'],
		['doctor-result', 'doctorResult'],
		['profile-list-result', 'profileListResult'],
		['profile-default-result', 'profileDefaultResult'],
		['profile-remove-result', 'profileRemoveResult'],
		['plan-show-envelope', 'planShowEnvelope'],
		['plan-apply-local-result', 'planApplyLocalResult'],
		['plan-recover-local-result', 'planRecoverLocalResult'],
		['plan-discard-result', 'planDiscardResult'],
	].map(([schemaId, definition]) => ({
		schemaId,
		ref: `urn:operon:schema:cli:v1:operon-cli-local.schema.json#/$defs/${definition}`,
	})),
	{
		schemaId: 'session-frame',
		ref: 'urn:operon:schema:cli:v1:session.schema.json#/$defs/frame',
	},
	{
		schemaId: 'session-read-group',
		ref: 'urn:operon:schema:cli:v1:session.schema.json#/$defs/readGroup',
	},
	{
		schemaId: 'session-result',
		ref: 'urn:operon:schema:cli:v1:session.schema.json#/$defs/success',
	},
	{
		schemaId: 'session-failure',
		ref: 'urn:operon:schema:cli:v1:session.schema.json#/$defs/failure',
	},
	{
		schemaId: 'session-uncertain-result',
		ref: 'urn:operon:schema:cli:v1:session.schema.json#/$defs/uncertainResult',
	},
	{
		schemaId: 'session-protocol',
		ref: 'urn:operon:schema:cli:v1:session.schema.json#/$defs/protocol',
	},
]);

export function buildCliManifestDocumentV1(manifestBase, schemas, schemaEntrypoints) {
	const projection = contractProjectionV1({
		...manifestBase,
		schemas,
		schemaEntrypoints,
	});
	return {
		...manifestBase,
		schemas,
		schemaEntrypoints,
		contractDigest: createHash('sha256')
			.update(Buffer.from(JSON.stringify(projection), 'utf8'))
			.digest('hex'),
	};
}

export function contractProjectionV1(value) {
	return {
		manifestVersion: value.manifestVersion,
		package: {
			name: value.package?.name,
			executable: value.package?.executable,
			node: value.package?.node,
		},
		compatibility: value.compatibility,
		runtimeContracts: value.runtimeContracts,
		localContracts: value.localContracts,
		exitCodes: value.exitCodes,
		contractPolicy: value.contractPolicy,
		deprecations: value.deprecations,
		limits: value.limits,
		errorRegistry: value.errorRegistry,
		protocols: value.protocols,
		platforms: value.platforms,
		commands: value.commands,
		runtimeCapabilities: value.runtimeCapabilities,
		convenienceMutations: value.convenienceMutations,
		convenienceContracts: value.convenienceContracts,
		mutationCapabilities: value.mutationCapabilities,
		projections: value.projections,
		schemas: value.schemas,
		schemaEntrypoints: value.schemaEntrypoints,
	};
}
