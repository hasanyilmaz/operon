import { sha256HexV1 } from '../agent-runtime/contracts/v1/canonical';
import { parseOperonTableFile } from '../storage/table-file';
import type { TablePresetFileBinding } from '../types/table';
import { canonicalizeOperonSettingsBackupJson, parseOperonSettingsBackupV1 } from './settings-backup-format';
import {
	validateOperonSettingsBackupTableManifestV1,
	type OperonSettingsBackupTableManifestV1,
	type OperonSettingsBackupValidatedTableEntryV1,
} from './settings-backup-table-manifest';

export type OperonSettingsBackupTableConflictDecisionV1 = 'skip' | 'cancel';
export type OperonSettingsBackupTableResourceActionKindV1 = 'reuse' | 'create' | 'skip';

export interface OperonSettingsBackupValidatedTableBundleV1 {
	manifest: OperonSettingsBackupTableManifestV1;
	settingsText: string;
	tableFiles: readonly OperonSettingsBackupValidatedTableEntryV1[];
	/** SHA-256 of the exact ZIP bytes, supplied by the archive coordinator. */
	archiveSha256: string;
}

export interface OperonSettingsBackupTargetTablePathV1 {
	path: string;
	kind: 'file' | 'folder';
	/** Bound Table ID for a target .table file; null means unrelated/unbound. */
	id: string | null;
	/** Exact current file checksum; null when unavailable or not a regular file. */
	sha256: string | null;
}

export interface OperonSettingsBackupTargetTableSnapshotV1 {
	paths: readonly OperonSettingsBackupTargetTablePathV1[];
	bindings: readonly TablePresetFileBinding[];
	orderIds: readonly string[];
	defaultPresetId: string | null;
	initialized: boolean;
	tableFavoriteIds: readonly string[];
}

export interface OperonSettingsBackupTableResourcePreflightInputV1 {
	bundle: OperonSettingsBackupValidatedTableBundleV1;
	target: OperonSettingsBackupTargetTableSnapshotV1;
	availableFilterSetIds: readonly string[];
	/** True only when the compatible preset-favorites group is selected by the settings restore plan. */
	includeSourceTableFavorites: boolean;
	conflictDecisions?: Readonly<Record<string, OperonSettingsBackupTableConflictDecisionV1>>;
}

export interface OperonSettingsBackupTableResourceConflictV1 {
	id: string;
	sourceId: string;
	sourcePath: string;
	kind: 'path' | 'id' | 'dependency' | 'target-snapshot';
	message: string;
	decision: OperonSettingsBackupTableConflictDecisionV1 | null;
}

export interface OperonSettingsBackupTableResourceActionV1 {
	id: string;
	path: string;
	sha256: string;
	archivePath: string;
	kind: OperonSettingsBackupTableResourceActionKindV1;
}

export interface OperonSettingsBackupTableResourceProjectionV1 {
	tablePresetFileBindings: readonly TablePresetFileBinding[];
	tablePresetOrderIds: readonly string[];
	tableDefaultPresetId: string | null;
	tablePresetFileInitialized: boolean;
	tableFavoriteIds: readonly string[];
}

export interface OperonSettingsBackupTableResourceRestorePlanV1 {
	version: 1;
	planId: string;
	archiveSha256: string;
	sourceBodyChecksum: string;
	targetFingerprint: string;
	decisionFingerprint: string;
	actions: readonly OperonSettingsBackupTableResourceActionV1[];
	projection: OperonSettingsBackupTableResourceProjectionV1;
}

export function computeOperonSettingsBackupTableResourcePlanIdV1(
	plan: Omit<OperonSettingsBackupTableResourceRestorePlanV1, 'planId'>,
): string {
	return fingerprint(plan);
}

export interface OperonSettingsBackupTableResourcePreflightResultV1 {
	classification: 'ready' | 'decision-required' | 'canceled' | 'blocked';
	conflicts: readonly OperonSettingsBackupTableResourceConflictV1[];
	actions: readonly OperonSettingsBackupTableResourceActionV1[];
	plan: OperonSettingsBackupTableResourceRestorePlanV1 | null;
}

/**
 * Pure resource preflight. It never reads or writes the vault and therefore
 * relies on a coordinator-provided exact target snapshot. Apply must rerun it
 * against fresh source/archive and target fingerprints before any mutation.
 */
export function preflightOperonSettingsBackupTableResourcesV1(
	input: OperonSettingsBackupTableResourcePreflightInputV1,
): OperonSettingsBackupTableResourcePreflightResultV1 {
	const decisions = input.conflictDecisions ?? {};
	if (!/^[a-f0-9]{64}$/u.test(input.bundle.archiveSha256)) return blocked('Archive SHA-256 is invalid.');
	const encoder = new TextEncoder();
	const logicalValidation = validateOperonSettingsBackupTableManifestV1(input.bundle.manifest, [
		{ path: 'settings.json', bytes: encoder.encode(input.bundle.settingsText) },
		...input.bundle.tableFiles.map(item => ({
			path: item.descriptor.path,
			bytes: encoder.encode(item.text),
		})),
	]);
	if (!logicalValidation.ok) return blocked('Table manifest, settings and resource inventory are not exactly bound.');
	const parsedSettings = parseOperonSettingsBackupV1(input.bundle.settingsText);
	if (!parsedSettings.ok || parsedSettings.value.body.scope.tableFiles !== 'included') {
		return blocked('Validated Table resources are not bound to an included settings document.');
	}
	if (input.bundle.tableFiles.length !== input.bundle.manifest.tableFiles.length) {
		return blocked('Validated Table inventory is incomplete.');
	}
	if (input.bundle.manifest.defaultPresetId === undefined) {
		return blocked('Table bundle manifest does not declare its source default binding.');
	}

	const targetConflicts = validateTargetSnapshot(input.target);
	if (targetConflicts.length > 0) {
		return { classification: 'blocked', conflicts: targetConflicts, actions: [], plan: null };
	}
	const targetById = new Map(input.target.paths.filter(item => item.id).map(item => [item.id as string, item]));
	const targetByPath = new Map(input.target.paths.map(item => [portablePathKey(item.path), item]));
	const filterIds = new Set(input.availableFilterSetIds);
	const conflicts: OperonSettingsBackupTableResourceConflictV1[] = [];
	const actions: OperonSettingsBackupTableResourceActionV1[] = [];
	let canceled = false;

	for (const source of input.bundle.tableFiles) {
		const { descriptor } = source;
		const parsedTable = parseOperonTableFile(source.text, descriptor.originalPath);
		if (parsedTable.status !== 'valid' || !parsedTable.preset) return blocked(`Validated Table became invalid: ${descriptor.id}.`);
		const conflictMessages: Array<{ kind: OperonSettingsBackupTableResourceConflictV1['kind']; message: string }> = [];
		if (parsedTable.preset.filterSetId && !filterIds.has(parsedTable.preset.filterSetId)) {
			conflictMessages.push({
				kind: 'dependency',
				message: `Table ${descriptor.id} references unavailable Filter ${parsedTable.preset.filterSetId}.`,
			});
		}
		const pathKey = portablePathKey(descriptor.originalPath);
		const targetAtPath = targetByPath.get(pathKey);
		const targetWithId = targetById.get(descriptor.id);
		const exactReuse = targetAtPath?.kind === 'file'
			&& targetAtPath.path === descriptor.originalPath
			&& targetAtPath.id === descriptor.id
			&& targetAtPath.sha256 === descriptor.sha256;
		if (!exactReuse) {
			if (targetAtPath) {
				conflictMessages.push({ kind: 'path', message: `Target path is occupied: ${descriptor.originalPath}.` });
			}
			if (targetWithId) {
				conflictMessages.push({ kind: 'id', message: `Target Table ID already exists at ${targetWithId.path}.` });
			}
			const ancestor = findFileAncestor(descriptor.originalPath, input.target.paths);
			if (ancestor) conflictMessages.push({ kind: 'path', message: `Target file blocks parent path: ${ancestor}.` });
		}

		if (conflictMessages.length === 0) {
			actions.push(action(descriptor, exactReuse ? 'reuse' : 'create'));
			continue;
		}
		const conflictId = `table:${descriptor.id}`;
		const decision = decisions[conflictId] ?? null;
		for (const conflict of conflictMessages) {
			conflicts.push({
				id: conflictId,
				sourceId: descriptor.id,
				sourcePath: descriptor.originalPath,
				kind: conflict.kind,
				message: conflict.message,
				decision,
			});
		}
		if (decision === 'skip') actions.push(action(descriptor, 'skip'));
		else if (decision === 'cancel') canceled = true;
	}

	if (canceled) return { classification: 'canceled', conflicts, actions, plan: null };
	if (conflicts.some(conflict => conflict.decision === null)) {
		return { classification: 'decision-required', conflicts, actions, plan: null };
	}

	const active = actions.filter(item => item.kind !== 'skip');
	const projection = projectTableResources(input, active);
	const targetFingerprint = fingerprint(input.target);
	const decisionFingerprint = fingerprint(sortRecord(decisions));
	const planMaterial = {
		version: 1 as const,
		archiveSha256: input.bundle.archiveSha256,
		sourceBodyChecksum: parsedSettings.value.integrity.value,
		targetFingerprint,
		decisionFingerprint,
		actions,
		projection,
	};
	const plan = deepFreeze({ ...planMaterial, planId: computeOperonSettingsBackupTableResourcePlanIdV1(planMaterial) });
	return { classification: 'ready', conflicts, actions: deepFreeze(actions), plan };
}

function projectTableResources(
	input: OperonSettingsBackupTableResourcePreflightInputV1,
	active: readonly OperonSettingsBackupTableResourceActionV1[],
): OperonSettingsBackupTableResourceProjectionV1 {
	const activeIds = new Set(active.map(item => item.id));
	const incomingBindings = active.map(item => ({ id: item.id, path: item.path }));
	const retainedBindings = input.target.bindings.filter(item => !activeIds.has(item.id));
	const retainedOrder = input.target.orderIds.filter(id => !activeIds.has(id));
	const sourceOrder = input.bundle.manifest.tableFiles.map(item => item.id).filter(id => activeIds.has(id));
	const sourceDefault = input.bundle.manifest.defaultPresetId;
	const tableDefaultPresetId = sourceDefault && activeIds.has(sourceDefault)
		? sourceDefault
		: input.target.defaultPresetId;
	const sourceFavorites = input.includeSourceTableFavorites
		? readSourceTableFavoriteIds(input.bundle.settingsText).filter(id => activeIds.has(id))
		: [];
	const retainedFavorites = input.target.tableFavoriteIds.filter(id => !activeIds.has(id));
	return deepFreeze({
		tablePresetFileBindings: [...incomingBindings, ...retainedBindings],
		tablePresetOrderIds: [...sourceOrder, ...retainedOrder],
		tableDefaultPresetId,
		tablePresetFileInitialized: input.target.initialized || active.length > 0,
		tableFavoriteIds: unique([...sourceFavorites, ...retainedFavorites]),
	});
}

function readSourceTableFavoriteIds(settingsText: string): string[] {
	const parsed = parseOperonSettingsBackupV1(settingsText);
	if (!parsed.ok) return [];
	const data = parsed.value.body.groups['preset-favorites']?.data;
	if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
	const favorites = (data as Record<string, unknown>).presetFavorites;
	if (!favorites || typeof favorites !== 'object' || Array.isArray(favorites)) return [];
	const table = (favorites as Record<string, unknown>).table;
	return Array.isArray(table) && table.every(item => typeof item === 'string') ? [...table] : [];
}

function validateTargetSnapshot(
	target: OperonSettingsBackupTargetTableSnapshotV1,
): OperonSettingsBackupTableResourceConflictV1[] {
	const conflicts: OperonSettingsBackupTableResourceConflictV1[] = [];
	const paths = new Map<string, string>();
	const ids = new Map<string, string>();
	for (const item of target.paths) {
		const key = portablePathKey(item.path);
		const collision = paths.get(key);
		if (collision) conflicts.push(targetConflict(`Target paths collide: ${collision} and ${item.path}.`));
		paths.set(key, item.path);
		if (item.id) {
			const duplicate = ids.get(item.id);
			if (duplicate) conflicts.push(targetConflict(`Target Table ID ${item.id} is duplicated at ${duplicate} and ${item.path}.`));
			ids.set(item.id, item.path);
		}
	}
	const bindingIds = new Set<string>();
	const bindingPaths = new Set<string>();
	for (const binding of target.bindings) {
		const pathKey = portablePathKey(binding.path);
		if (bindingIds.has(binding.id)) conflicts.push(targetConflict(`Target binding ID is duplicated: ${binding.id}.`));
		if (bindingPaths.has(pathKey)) conflicts.push(targetConflict(`Target binding path is duplicated: ${binding.path}.`));
		bindingIds.add(binding.id);
		bindingPaths.add(pathKey);
		const entry = target.paths.find(item => portablePathKey(item.path) === pathKey);
		if (!entry || entry.kind !== 'file' || entry.id !== binding.id) {
			conflicts.push(targetConflict(`Target binding is not backed by its exact file snapshot: ${binding.id}.`));
		}
	}
	if (new Set(target.orderIds).size !== target.orderIds.length) {
		conflicts.push(targetConflict('Target Table order contains duplicate IDs.'));
	}
	if (target.defaultPresetId && !target.orderIds.includes(target.defaultPresetId)) {
		conflicts.push(targetConflict('Target Table default is not present in target order.'));
	}
	return conflicts;
}

function action(
	descriptor: OperonSettingsBackupTableManifestV1['tableFiles'][number],
	kind: OperonSettingsBackupTableResourceActionKindV1,
): OperonSettingsBackupTableResourceActionV1 {
	return {
		id: descriptor.id,
		path: descriptor.originalPath,
		sha256: descriptor.sha256,
		archivePath: descriptor.path,
		kind,
	};
}

function targetConflict(message: string): OperonSettingsBackupTableResourceConflictV1 {
	return { id: 'target-snapshot', sourceId: '', sourcePath: '', kind: 'target-snapshot', message, decision: null };
}

function blocked(message: string): OperonSettingsBackupTableResourcePreflightResultV1 {
	return { classification: 'blocked', conflicts: [targetConflict(message)], actions: [], plan: null };
}

function findFileAncestor(path: string, targets: readonly OperonSettingsBackupTargetTablePathV1[]): string | null {
	const fileKeys = new Map(targets.filter(item => item.kind === 'file').map(item => [portablePathKey(item.path), item.path]));
	const segments = path.split('/');
	for (let index = 1; index < segments.length; index++) {
		const ancestor = fileKeys.get(portablePathKey(segments.slice(0, index).join('/')));
		if (ancestor) return ancestor;
	}
	return null;
}

function portablePathKey(path: string): string {
	return path.split('/').map(segment => segment.normalize('NFC').replace(/[. ]+$/u, '').toLocaleLowerCase('en-US')).join('/');
}

function sortRecord<T>(record: Readonly<Record<string, T>>): Record<string, T> {
	return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
}

function unique(values: readonly string[]): string[] {
	return [...new Set(values)];
}

function fingerprint(value: unknown): string {
	return sha256HexV1(canonicalizeOperonSettingsBackupJson(value));
}

function deepFreeze<T>(value: T): T {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	Object.freeze(value);
	for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
	return value;
}
