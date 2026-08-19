import {
	resolvePeriodicNoteAnchorDateKey,
	resolvePeriodicNotePathFromDateKey,
	type PeriodicNoteKind,
} from './periodic-note-path';
import type { PeriodicNoteEffectiveConfig } from './periodic-note-config';

export type PeriodicNoteFileState =
	| { kind: 'missing' }
	| { kind: 'file'; content?: string }
	| { kind: 'other' };

export type PeriodicNoteCreateResult =
	| { status: 'created' }
	| { status: 'exists' }
	| { status: 'occupied' };

export type PeriodicNoteGuardedDeleteResult =
	| 'deleted'
	| 'missing'
	| 'changed'
	| 'failed';

export interface PeriodicNoteTemplateSnapshot {
	content: string;
	revision?: string;
}

export interface PeriodicNoteDeterministicRenderInput {
	kind: PeriodicNoteKind;
	dateKey: string;
	now: string;
	path: string;
	content: string;
	templatePath: string | null;
	templateRevision?: string;
	config: PeriodicNoteEffectiveConfig;
}

export type PeriodicNoteDeterministicRenderResult =
	| { ok: true; content: string }
	| { ok: false; message: string };

export interface PeriodicNoteTemplaterFinalPathInput {
	kind: PeriodicNoteKind;
	dateKey: string;
	now: string;
	path: string;
	content: string;
	templatePath: string;
	templateRevision?: string;
	config: PeriodicNoteEffectiveConfig;
}

export type PeriodicNoteTemplaterFinalPathResult =
	| {
		ok: true;
		/**
		 * Exact final content that this adapter wrote or verified as the result of
		 * its own successful final-path operation. Omitting it intentionally makes
		 * later registry-registration cleanup fail closed.
		 */
		operationOwnedContent?: string;
	}
	| {
		ok: false;
		message: string;
		/**
		 * The last content written by the adapter itself. Supplying this permits a
		 * guarded rollback after a partial Templater write. When omitted, rollback
		 * is allowed only while the original seed content is still present.
		 */
		rollbackExpectedContent?: string;
	};

export interface PeriodicNoteServicePorts {
	now(): string;
	inspect(path: string): Promise<PeriodicNoteFileState>;
	ensureParentDirectories(path: string): Promise<void>;
	createFileIfAbsent(path: string, content: string): Promise<PeriodicNoteCreateResult>;
	deleteFileIfContentMatches(path: string, expectedContent: string): Promise<PeriodicNoteGuardedDeleteResult>;
	loadTemplate(path: string): Promise<PeriodicNoteTemplateSnapshot | null>;
	renderDeterministic(input: PeriodicNoteDeterministicRenderInput): Promise<PeriodicNoteDeterministicRenderResult>;
	isTemplaterAvailable?: () => boolean | Promise<boolean>;
	templaterFinalPath?: (input: PeriodicNoteTemplaterFinalPathInput) => Promise<PeriodicNoteTemplaterFinalPathResult>;
}

export interface PeriodicNoteGetOrCreateRequest {
	kind: PeriodicNoteKind;
	dateKey: string;
	config: PeriodicNoteEffectiveConfig;
}

export type PeriodicNoteServiceErrorCode =
	| 'invalid-target'
	| 'path-occupied'
	| 'template-not-found'
	| 'template-read-failed'
	| 'deterministic-render-failed'
	| 'templater-unavailable'
	| 'templater-processing-failed'
	| 'rollback-failed'
	| 'parent-folder-failed'
	| 'create-failed'
	| 'inspect-failed';

export interface PeriodicNoteServiceError {
	code: PeriodicNoteServiceErrorCode;
	message: string;
	path?: string;
	recoveryRequired: boolean;
}

export type PeriodicNoteGetOrCreateResult =
	| {
		ok: true;
		status: 'existing';
		kind: PeriodicNoteKind;
		dateKey: string;
		path: string;
		source: PeriodicNoteEffectiveConfig['source'];
	}
	| {
		ok: true;
		status: 'created';
		kind: PeriodicNoteKind;
		dateKey: string;
		path: string;
		source: PeriodicNoteEffectiveConfig['source'];
		/** Immutable create-operation evidence for a later guarded registry rollback. */
		operationOwnedContent?: string;
	}
	| { ok: false; error: PeriodicNoteServiceError };

export interface PreparedPeriodicNotePlan {
	kind: PeriodicNoteKind;
	dateKey: string;
	now: string;
	path: string;
	config: PeriodicNoteEffectiveConfig;
	templatePath: string | null;
	templateRevision?: string;
	content: string;
	mode: 'deterministic' | 'templater-final-path';
}

export type PeriodicNotePrepareResult =
	| { status: 'existing'; result: Extract<PeriodicNoteGetOrCreateResult, { ok: true }> }
	| { status: 'prepared'; plan: PreparedPeriodicNotePlan }
	| { status: 'error'; result: Extract<PeriodicNoteGetOrCreateResult, { ok: false }> };

const TEMPLATER_SYNTAX = /<%/u;

export class PeriodicNoteService {
	private readonly inFlight = new Map<string, Promise<PeriodicNoteGetOrCreateResult>>();
	private readonly preparedPlanSnapshots = new WeakMap<PreparedPeriodicNotePlan, PreparedPeriodicNotePlan>();

	constructor(private readonly ports: PeriodicNoteServicePorts) {}

	/** Build a zero-write plan that a future Runtime adapter can inspect and seal. */
	async prepare(request: PeriodicNoteGetOrCreateRequest): Promise<PeriodicNotePrepareResult> {
		const target = this.resolveTarget(request);
		if (!target.ok) return { status: 'error', result: target.result };
		const result = await this.prepareResolved(target.request, target.path, this.ports.now());
		if (result.status !== 'prepared') return result;
		const config = Object.freeze({ ...result.plan.config });
		const sealedPlan = Object.freeze({ ...result.plan, config });
		this.preparedPlanSnapshots.set(sealedPlan, sealedPlan);
		return { status: 'prepared', plan: sealedPlan };
	}

	/** Commit a prepared plan with the same per-path single-flight used by getOrCreate. */
	async commit(plan: PreparedPeriodicNotePlan): Promise<PeriodicNoteGetOrCreateResult> {
		const sealedPlan = this.preparedPlanSnapshots.get(plan);
		if (!sealedPlan) {
			return this.error('invalid-target', 'The periodic note plan was not prepared by this service instance.');
		}
		this.preparedPlanSnapshots.delete(plan);
		const target = this.resolveTarget({
			kind: sealedPlan.kind,
			dateKey: sealedPlan.dateKey,
			config: sealedPlan.config,
		});
		if (!target.ok) return target.result;
		if (target.path !== sealedPlan.path || target.request.dateKey !== sealedPlan.dateKey) {
			return this.error('invalid-target', 'The prepared periodic note target is no longer canonical.');
		}
		const key = `${sealedPlan.kind}:${sealedPlan.path}`;
		const existing = this.inFlight.get(key);
		if (existing) return existing;
		const operation = this.commitPrepared(sealedPlan).finally(() => {
			if (this.inFlight.get(key) === operation) this.inFlight.delete(key);
		});
		this.inFlight.set(key, operation);
		return operation;
	}

	async getOrCreate(request: PeriodicNoteGetOrCreateRequest): Promise<PeriodicNoteGetOrCreateResult> {
		const target = this.resolveTarget(request);
		if (!target.ok) return target.result;
		const { path } = target;

		const key = `${request.kind}:${path}`;
		const existing = this.inFlight.get(key);
		if (existing) return existing;

		const now = this.ports.now();
		const operation = this.prepareAndCommit(target.request, path, now).finally(() => {
			if (this.inFlight.get(key) === operation) this.inFlight.delete(key);
		});
		this.inFlight.set(key, operation);
		return operation;
	}

	private async prepareResolved(
		request: PeriodicNoteGetOrCreateRequest,
		path: string,
		now: string,
	): Promise<PeriodicNotePrepareResult> {
		const dateKey = request.dateKey;

		const inspected = await this.inspect(path);
		if (!inspected.ok) return { status: 'error', result: inspected.result };
		if (inspected.state.kind === 'file') {
			return { status: 'existing', result: this.success('existing', { ...request, dateKey }, path) };
		}
		if (inspected.state.kind === 'other') {
			return {
				status: 'error',
				result: this.error('path-occupied', 'The periodic note target is occupied by a non-file entry.', path),
			};
		}

		const templatePath = request.config.template.trim() || null;
		let template: PeriodicNoteTemplateSnapshot = { content: '' };
		if (templatePath) {
			try {
				const loaded = await this.ports.loadTemplate(templatePath);
				if (!loaded) {
					return {
						status: 'error',
						result: this.error('template-not-found', 'The configured periodic note template was not found.', path),
					};
				}
				template = loaded;
			} catch (cause) {
				return {
					status: 'error',
					result: this.error('template-read-failed', errorMessage(cause, 'Failed to read the periodic note template.'), path),
				};
			}
		}

		if (TEMPLATER_SYNTAX.test(template.content)) {
			let templaterAvailable = false;
			try {
				templaterAvailable = !!(
					templatePath
					&& this.ports.templaterFinalPath
					&& this.ports.isTemplaterAvailable
					&& await this.ports.isTemplaterAvailable()
				);
			} catch {
				templaterAvailable = false;
			}
			if (!templaterAvailable || !templatePath) {
				return {
					status: 'error',
					result: this.error('templater-unavailable', 'The template requires a final-path Templater adapter.', path),
				};
			}
			return {
				status: 'prepared',
				plan: {
					kind: request.kind,
					dateKey,
					now,
					path,
					config: request.config,
					templatePath,
					templateRevision: template.revision,
					content: template.content,
					mode: 'templater-final-path',
				},
			};
		}

		try {
			const rendered = await this.ports.renderDeterministic({
				kind: request.kind,
				dateKey,
				now,
				path,
				content: template.content,
				templatePath,
				templateRevision: template.revision,
				config: request.config,
			});
			if (!rendered.ok) {
				return {
					status: 'error',
					result: this.error('deterministic-render-failed', rendered.message, path),
				};
			}
			return {
				status: 'prepared',
				plan: {
					kind: request.kind,
					dateKey,
					now,
					path,
					config: request.config,
					templatePath,
					templateRevision: template.revision,
					content: rendered.content,
					mode: 'deterministic',
				},
			};
		} catch (cause) {
			return {
				status: 'error',
				result: this.error('deterministic-render-failed', errorMessage(cause, 'Failed to render the periodic note.'), path),
			};
		}
	}

	private async commitPrepared(plan: PreparedPeriodicNotePlan): Promise<PeriodicNoteGetOrCreateResult> {
		const request = { kind: plan.kind, dateKey: plan.dateKey, config: plan.config };
		if (plan.templatePath && plan.templateRevision) {
			try {
				const currentTemplate = await this.ports.loadTemplate(plan.templatePath);
				if (!currentTemplate || currentTemplate.revision !== plan.templateRevision) {
					return this.error(
						'template-read-failed',
						'The periodic note template changed after preparation.',
						plan.path,
					);
				}
			} catch (cause) {
				return this.error(
					'template-read-failed',
					errorMessage(cause, 'Failed to revalidate the periodic note template.'),
					plan.path,
				);
			}
		}
		const beforeFolders = await this.inspect(plan.path);
		if (!beforeFolders.ok) return beforeFolders.result;
		if (beforeFolders.state.kind === 'file') return this.success('existing', request, plan.path);
		if (beforeFolders.state.kind === 'other') {
			return this.error('path-occupied', 'The periodic note target is occupied by a non-file entry.', plan.path);
		}

		try {
			await this.ports.ensureParentDirectories(plan.path);
		} catch (cause) {
			return this.error('parent-folder-failed', errorMessage(cause, 'Failed to prepare the periodic note folder.'), plan.path);
		}

		const beforeCreate = await this.inspect(plan.path);
		if (!beforeCreate.ok) return beforeCreate.result;
		if (beforeCreate.state.kind === 'file') return this.success('existing', request, plan.path);
		if (beforeCreate.state.kind === 'other') {
			return this.error('path-occupied', 'The periodic note target is occupied by a non-file entry.', plan.path);
		}

		let createResult: PeriodicNoteCreateResult;
		try {
			createResult = await this.ports.createFileIfAbsent(plan.path, plan.content);
		} catch (cause) {
			return this.error(
				'create-failed',
				errorMessage(cause, 'Failed to create the periodic note.'),
				plan.path,
				true,
			);
		}

		if (createResult.status !== 'created') {
			const raced = await this.inspect(plan.path);
			if (raced.ok && raced.state.kind === 'file') return this.success('existing', request, plan.path);
			if (createResult.status === 'occupied' || (raced.ok && raced.state.kind === 'other')) {
				return this.error('path-occupied', 'The periodic note target is occupied by a non-file entry.', plan.path);
			}
			return this.error('create-failed', 'The periodic note could not be created.', plan.path);
		}

		if (plan.mode === 'deterministic') {
			return this.success('created', request, plan.path, plan.content);
		}
		return this.commitTemplater(plan, request);
	}

	private async prepareAndCommit(
		request: PeriodicNoteGetOrCreateRequest,
		path: string,
		now: string,
	): Promise<PeriodicNoteGetOrCreateResult> {
		const prepared = await this.prepareResolved(request, path, now);
		if (prepared.status !== 'prepared') return prepared.result;
		return this.commitPrepared(prepared.plan);
	}

	private resolveTarget(request: PeriodicNoteGetOrCreateRequest):
		| { ok: true; request: PeriodicNoteGetOrCreateRequest; path: string }
		| { ok: false; result: Extract<PeriodicNoteGetOrCreateResult, { ok: false }> } {
		if (request.config.kind !== request.kind) {
			return {
				ok: false,
				result: this.error('invalid-target', 'The periodic note request and configuration kinds do not match.'),
			};
		}
		const dateKey = resolvePeriodicNoteAnchorDateKey(request.kind, request.dateKey);
		if (!dateKey) return { ok: false, result: this.error('invalid-target', 'The periodic note date is invalid.') };
		const path = resolvePeriodicNotePathFromDateKey(request.kind, dateKey, request.config);
		if (!path) return { ok: false, result: this.error('invalid-target', 'The periodic note target path is invalid.') };
		return { ok: true, request: { ...request, dateKey }, path };
	}

	private async commitTemplater(
		plan: PreparedPeriodicNotePlan,
		request: PeriodicNoteGetOrCreateRequest,
	): Promise<PeriodicNoteGetOrCreateResult> {
		const adapter = this.ports.templaterFinalPath;
		if (!adapter || !plan.templatePath) {
			return this.rollbackTemplaterFailure(plan, request, 'The final-path Templater adapter is unavailable.');
		}

		let failureMessage = 'Templater failed to process the periodic note.';
		let rollbackExpectedContent = plan.content;
		try {
			const processed = await adapter({
				kind: plan.kind,
				dateKey: plan.dateKey,
				now: plan.now,
				path: plan.path,
				content: plan.content,
				templatePath: plan.templatePath,
				templateRevision: plan.templateRevision,
				config: plan.config,
			});
			if (processed.ok) {
				const finalState = await this.inspect(plan.path);
				if (finalState.ok && finalState.state.kind === 'file') {
					return this.success('created', request, plan.path, processed.operationOwnedContent);
				}
				return this.error(
					'templater-processing-failed',
					'Templater completed without leaving the expected periodic note file.',
					plan.path,
					!finalState.ok || finalState.state.kind === 'other',
				);
			}
			failureMessage = processed.message;
			rollbackExpectedContent = processed.rollbackExpectedContent ?? plan.content;
		} catch (cause) {
			failureMessage = errorMessage(cause, failureMessage);
		}

		return this.rollbackTemplaterFailure(plan, request, failureMessage, rollbackExpectedContent);
	}

	private async rollbackTemplaterFailure(
		plan: PreparedPeriodicNotePlan,
		_request: PeriodicNoteGetOrCreateRequest,
		message: string,
		expectedContent = plan.content,
	): Promise<PeriodicNoteGetOrCreateResult> {
		let rollback: PeriodicNoteGuardedDeleteResult;
		try {
			rollback = await this.ports.deleteFileIfContentMatches(plan.path, expectedContent);
		} catch {
			rollback = 'failed';
		}
		const recoveryRequired = rollback === 'changed' || rollback === 'failed';
		return this.error(
			recoveryRequired ? 'rollback-failed' : 'templater-processing-failed',
			message,
			plan.path,
			recoveryRequired,
		);
	}

	private async inspect(path: string): Promise<
		| { ok: true; state: PeriodicNoteFileState }
		| { ok: false; result: Extract<PeriodicNoteGetOrCreateResult, { ok: false }> }
	> {
		try {
			return { ok: true, state: await this.ports.inspect(path) };
		} catch (cause) {
			return {
				ok: false,
				result: this.error('inspect-failed', errorMessage(cause, 'Failed to inspect the periodic note target.'), path),
			};
		}
	}

	private success(
		status: 'existing' | 'created',
		request: PeriodicNoteGetOrCreateRequest,
		path: string,
		operationOwnedContent?: string,
	): Extract<PeriodicNoteGetOrCreateResult, { ok: true }> {
		return {
			ok: true,
			status,
			kind: request.kind,
			dateKey: request.dateKey,
		path,
		source: request.config.source,
		...(status === 'created' && operationOwnedContent !== undefined ? { operationOwnedContent } : {}),
		};
	}

	private error(
		code: PeriodicNoteServiceErrorCode,
		message: string,
		path?: string,
		recoveryRequired = false,
	): Extract<PeriodicNoteGetOrCreateResult, { ok: false }> {
		return {
			ok: false,
			error: { code, message, ...(path ? { path } : {}), recoveryRequired },
		};
	}
}

function errorMessage(cause: unknown, fallback: string): string {
	return cause instanceof Error && cause.message.trim() ? cause.message : fallback;
}
