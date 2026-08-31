import {
	getDeveloperApiGrantApprovalCapabilities,
	type DeveloperApiGrantApprovalBindingV1,
	type DeveloperApiGrantCapabilityV1,
	type DeveloperApiGrantRecordV1,
} from '../../agent-runtime/developer-api';

export interface DeveloperApiGrantApprovalUiInputV1 extends DeveloperApiGrantRecordV1 {
	readonly approvalBinding: DeveloperApiGrantApprovalBindingV1 | null;
}

export interface DeveloperApiGrantApprovalUiStateV1 {
	readonly approvalCapabilities: readonly DeveloperApiGrantCapabilityV1[];
	readonly reactivationCapabilities: readonly DeveloperApiGrantCapabilityV1[];
	readonly pendingApprovalCapabilities: readonly DeveloperApiGrantCapabilityV1[];
	readonly initialSelectedCapabilities: readonly DeveloperApiGrantCapabilityV1[];
	readonly showsApprovalControls: boolean;
	readonly showsDeny: boolean;
	readonly showsRevoke: boolean;
	readonly approvalDisabled: boolean;
}

export function buildDeveloperApiGrantApprovalUiState(
	grant: DeveloperApiGrantApprovalUiInputV1,
): DeveloperApiGrantApprovalUiStateV1 {
	const approvalCapabilities = getDeveloperApiGrantApprovalCapabilities(grant);
	const approvalSet = new Set(approvalCapabilities);
	const grantedSet = new Set(grant.grantedCapabilities);
	const reactivationCapabilities = grant.state === 'suspended'
		? grant.grantedCapabilities.filter(capability => approvalSet.has(capability))
		: [];
	const pendingApprovalCapabilities = grant.pendingCapabilities
		.filter(capability => approvalSet.has(capability) && !grantedSet.has(capability));
	const initialSelectedCapabilities = grant.state === 'suspended'
		? reactivationCapabilities
		: pendingApprovalCapabilities;
	const showsApprovalControls = approvalCapabilities.length > 0 && grant.state !== 'revoked';
	return {
		approvalCapabilities,
		reactivationCapabilities,
		pendingApprovalCapabilities,
		initialSelectedCapabilities,
		showsApprovalControls,
		showsDeny: showsApprovalControls && grant.state !== 'suspended',
		showsRevoke: grant.state === 'suspended'
			|| (!showsApprovalControls && grant.state !== 'revoked'),
		approvalDisabled: !grant.approvalBinding || initialSelectedCapabilities.length === 0,
	};
}
