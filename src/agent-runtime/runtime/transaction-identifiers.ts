import { sha256HexV1 } from '../contracts/v1/canonical';

/** Preserve existing identities; bound only generated transaction identifiers. */
export function boundRuntimeTransactionIdV1(identity: string): string {
	return identity.length <= 128 ? identity : `sha256:${sha256HexV1(identity)}`;
}
