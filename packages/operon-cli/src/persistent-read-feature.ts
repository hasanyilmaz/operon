import {
	PersistentReadTransportV1,
	type PersistentReadTransportEvidenceV1,
} from './persistent-read-client';

declare const __OPERON_CLI_PERSISTENT_READ__: boolean;

export const OPERON_CLI_PERSISTENT_READ_ENABLED_V1 =
	typeof __OPERON_CLI_PERSISTENT_READ__ === 'boolean'
		? __OPERON_CLI_PERSISTENT_READ__
		: false;

export function createPersistentReadTransportV1(
	evidenceSink?: (evidence: PersistentReadTransportEvidenceV1) => void,
): PersistentReadTransportV1 | undefined {
	return OPERON_CLI_PERSISTENT_READ_ENABLED_V1
		? new PersistentReadTransportV1(undefined, evidenceSink)
		: undefined;
}
