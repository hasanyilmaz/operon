import { App } from 'obsidian';
import { generateRepeatSeriesId } from '../core/id-generator';
import { RepeatSeriesNamingConfig } from '../systems/recurring-file-naming';
import { WriteQueue } from './write-queue';
import { preserveInvalidJsonFile, writeJsonSafely } from './storage-file-ops';
import { buildOperonPluginStoragePath } from './operon-storage-paths';

const REPEAT_SERIES_FILE_NAME = 'repeat-series.json';
const CURRENT_REPEAT_SERIES_VERSION = 5;
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/u;
const TIME_RE = /^\d{2}:\d{2}(?::\d{2})?$/u;

export type RepeatTemporalMode = 'timed' | 'allDay';
export type InlineRepeatCompletionMode = 'keep-completed' | 'replace-completed';
export const DEFAULT_INLINE_REPEAT_COMPLETION_MODE: InlineRepeatCompletionMode = 'keep-completed';

export interface RepeatTemporalTemplate {
	mode: RepeatTemporalMode;
	dateShiftDays: number;
	startDateShiftDays: number;
	endDateShiftDays: number;
	startTime: string | null;
	endTime: string | null;
	estimate: string | null;
}

export interface RepeatSingleOccurrenceOverride {
	occurrenceDate: string;
	scheduledDate: string;
	mode: RepeatTemporalMode;
	startDateShiftDays: number;
	endDateShiftDays: number;
	startTime: string | null;
	endTime: string | null;
	estimate: string | null;
	updatedAt: string;
}

export interface RepeatFollowingOverride {
	effectiveFrom: string;
	dateShiftDays: number;
	mode: RepeatTemporalMode;
	startDateShiftDays: number;
	endDateShiftDays: number;
	startTime: string | null;
	endTime: string | null;
	estimate: string | null;
	updatedAt: string;
}

export interface RepeatSeriesOverrides {
	single: Record<string, RepeatSingleOccurrenceOverride>;
	following: RepeatFollowingOverride[];
}

export interface RepeatSeriesEntry {
	seriesId: string;
	sourceTaskId: string;
	sourceFormat: 'inline' | 'yaml';
	baseTitle: string | null;
	lastMaterializedTitle: string | null;
	naming: RepeatSeriesNamingConfig | null;
	skipDates: string[];
	yamlPropertyValueRemovalConfigured: boolean;
	yamlPropertyValueRemovals: string[];
	baseTemporalTemplate: RepeatTemporalTemplate | null;
	inlineCompletionMode: InlineRepeatCompletionMode;
	createdAt: string;
	updatedAt: string;
	overrides: RepeatSeriesOverrides;
}

interface RepeatSeriesData {
	version: number;
	series: Record<string, RepeatSeriesEntry>;
}

export interface EnsureRepeatSeriesInput {
	seriesId?: string | null;
	sourceTaskId: string;
	sourceFormat: 'inline' | 'yaml';
	baseTitle: string | null;
	lastMaterializedTitle?: string | null;
	naming?: RepeatSeriesNamingConfig | null;
	baseTemporalTemplate?: RepeatTemporalTemplate | null;
	inlineCompletionMode?: InlineRepeatCompletionMode | null;
	now: string;
}

function normalizeOptionalText(value: unknown): string | null {
	const trimmed = typeof value === 'string' ? value.trim() : '';
	return trimmed || null;
}

export function normalizeYamlPropertyValueRemovals(values: Iterable<string>): string[] {
	const unique = new Set<string>();
	for (const value of values) {
		const trimmed = value.trim();
		if (!trimmed) continue;
		unique.add(trimmed);
	}
	return [...unique];
}

function normalizeDateKey(value: unknown): string {
	const trimmed = typeof value === 'string' ? value.trim() : '';
	return DATE_KEY_RE.test(trimmed) ? trimmed : '';
}

function normalizeTime(value: unknown): string | null {
	const trimmed = typeof value === 'string' ? value.trim() : '';
	if (!TIME_RE.test(trimmed)) return null;
	return trimmed.length === 5 ? `${trimmed}:00` : trimmed;
}

function normalizeEstimate(value: unknown): string | null {
	const trimmed = typeof value === 'string' ? value.trim() : '';
	return trimmed || null;
}

export function normalizeInlineCompletionMode(value: unknown): InlineRepeatCompletionMode {
	return value === 'replace-completed'
		? 'replace-completed'
		: DEFAULT_INLINE_REPEAT_COMPLETION_MODE;
}

function normalizeDateShiftDays(value: unknown): number {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return Math.trunc(value);
	}
	if (typeof value === 'string') {
		const parsed = Number.parseInt(value, 10);
		if (Number.isFinite(parsed)) return Math.trunc(parsed);
	}
	return 0;
}

function normalizeSpanShiftDays(value: unknown, fallback = 0): number {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return Math.trunc(value);
	}
	if (typeof value === 'string') {
		const parsed = Number.parseInt(value, 10);
		if (Number.isFinite(parsed)) return Math.trunc(parsed);
	}
	return fallback;
}

function cloneTemporalTemplate(template: RepeatTemporalTemplate | null): RepeatTemporalTemplate | null {
	if (!template) return null;
	return {
		mode: template.mode,
		dateShiftDays: template.dateShiftDays,
		startDateShiftDays: template.startDateShiftDays,
		endDateShiftDays: template.endDateShiftDays,
		startTime: template.startTime,
		endTime: template.endTime,
		estimate: template.estimate,
	};
}

function normalizeRepeatTemporalTemplate(raw: unknown): RepeatTemporalTemplate | null {
	if (!raw || typeof raw !== 'object') return null;
	const src = raw as Record<string, unknown>;
	const mode = src.mode === 'timed' ? 'timed' : src.mode === 'allDay' ? 'allDay' : null;
	if (!mode) return null;
	return {
		mode,
		dateShiftDays: normalizeDateShiftDays(src.dateShiftDays),
		startDateShiftDays: normalizeSpanShiftDays(src.startDateShiftDays, normalizeDateShiftDays(src.dateShiftDays)),
		endDateShiftDays: normalizeSpanShiftDays(src.endDateShiftDays, normalizeDateShiftDays(src.dateShiftDays)),
		startTime: normalizeTime(src.startTime),
		endTime: normalizeTime(src.endTime),
		estimate: normalizeEstimate(src.estimate),
	};
}

function normalizeSingleOverride(raw: unknown): RepeatSingleOccurrenceOverride | null {
	if (!raw || typeof raw !== 'object') return null;
	const src = raw as Record<string, unknown>;
	const occurrenceDate = normalizeDateKey(src.occurrenceDate);
	const scheduledDate = normalizeDateKey(src.scheduledDate);
	const mode = src.mode === 'timed' ? 'timed' : src.mode === 'allDay' ? 'allDay' : null;
	const updatedAt = typeof src.updatedAt === 'string' ? src.updatedAt : '';
	if (!occurrenceDate || !scheduledDate || !mode || !updatedAt) return null;
	return {
		occurrenceDate,
		scheduledDate,
		mode,
		startDateShiftDays: normalizeSpanShiftDays(src.startDateShiftDays, normalizeDateShiftDays(dateDiffDays(occurrenceDate, scheduledDate))),
		endDateShiftDays: normalizeSpanShiftDays(src.endDateShiftDays, normalizeDateShiftDays(dateDiffDays(occurrenceDate, scheduledDate))),
		startTime: normalizeTime(src.startTime),
		endTime: normalizeTime(src.endTime),
		estimate: normalizeEstimate(src.estimate),
		updatedAt,
	};
}

function normalizeFollowingOverride(raw: unknown): RepeatFollowingOverride | null {
	if (!raw || typeof raw !== 'object') return null;
	const src = raw as Record<string, unknown>;
	const effectiveFrom = normalizeDateKey(src.effectiveFrom);
	const mode = src.mode === 'timed' ? 'timed' : src.mode === 'allDay' ? 'allDay' : null;
	const updatedAt = typeof src.updatedAt === 'string' ? src.updatedAt : '';
	if (!effectiveFrom || !mode || !updatedAt) return null;
	return {
		effectiveFrom,
		dateShiftDays: normalizeDateShiftDays(src.dateShiftDays),
		mode,
		startDateShiftDays: normalizeSpanShiftDays(src.startDateShiftDays, normalizeDateShiftDays(src.dateShiftDays)),
		endDateShiftDays: normalizeSpanShiftDays(src.endDateShiftDays, normalizeDateShiftDays(src.dateShiftDays)),
		startTime: normalizeTime(src.startTime),
		endTime: normalizeTime(src.endTime),
		estimate: normalizeEstimate(src.estimate),
		updatedAt,
	};
}

function parseDateKey(value: string): Date | null {
	if (!DATE_KEY_RE.test(value)) return null;
	const [year, month, day] = value.split('-').map(Number);
	return new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
}

function dateDiffDays(leftDate: string, rightDate: string): number {
	const left = parseDateKey(leftDate);
	const right = parseDateKey(rightDate);
	if (!left || !right) return 0;
	return Math.round((right.getTime() - left.getTime()) / 86400000);
}

function normalizeOverrides(raw: unknown): RepeatSeriesOverrides {
	const single: Record<string, RepeatSingleOccurrenceOverride> = {};
	const following: RepeatFollowingOverride[] = [];

	if (raw && typeof raw === 'object') {
		const src = raw as Record<string, unknown>;
		if (src.single && typeof src.single === 'object') {
			for (const [occurrenceDate, value] of Object.entries(src.single as Record<string, unknown>)) {
				const normalized = normalizeSingleOverride(value);
				if (!normalized) continue;
				single[normalizeDateKey(occurrenceDate) || normalized.occurrenceDate] = normalized;
			}
		}
		if (Array.isArray(src.following)) {
			for (const value of src.following) {
				const normalized = normalizeFollowingOverride(value);
				if (normalized) following.push(normalized);
			}
		}
	}

	following.sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom));
	return { single, following };
}

function normalizeNamingConfig(raw: unknown): RepeatSeriesNamingConfig | null {
	if (!raw || typeof raw !== 'object') return null;
	const src = raw as Record<string, unknown>;
	const mode = src.mode === 'plain'
		|| src.mode === 'dateToken'
		|| src.mode === 'weekToken'
		|| src.mode === 'dateWeekToken'
		|| src.mode === 'literal'
		? src.mode
		: null;
	const template = typeof src.template === 'string' ? src.template.trim() : '';
	const weekTokenCase = src.weekTokenCase === 'upper'
		? 'upper'
		: src.weekTokenCase === 'lower'
			? 'lower'
			: null;
	if (!mode || !template) return null;
	return {
		mode,
		template,
		weekTokenCase,
	};
}

function sortUniqueDates(values: Iterable<string>): string[] {
	return [...new Set([...values].map(normalizeDateKey).filter(Boolean))].sort();
}

export class RepeatSeriesStore {
	private app: App;
	private writeQueue: WriteQueue;
	private data: RepeatSeriesData = {
		version: CURRENT_REPEAT_SERIES_VERSION,
		series: {},
	};
	private mutationQueue: Promise<void> = Promise.resolve();
	private readonly filePath: string;

	constructor(app: App, writeQueue: WriteQueue, filePath?: string) {
		this.app = app;
		this.writeQueue = writeQueue;
		this.filePath = filePath ?? buildOperonPluginStoragePath(app.vault.configDir, 'state', REPEAT_SERIES_FILE_NAME);
	}

	async load(): Promise<void> {
		const adapter = this.app.vault.adapter;
		const loadPath = await this.resolveLoadPath();
		if (!loadPath) {
			this.data = {
				version: CURRENT_REPEAT_SERIES_VERSION,
				series: {},
			};
			return;
		}

		let raw = '';
		try {
			raw = await adapter.read(loadPath);
			const parsed = JSON.parse(raw) as Partial<RepeatSeriesData>;
			this.data = {
				version: CURRENT_REPEAT_SERIES_VERSION,
				series: this.normalizeSeries(parsed.series),
			};
			if (loadPath !== this.filePath) {
				await this.writeData();
			}
		} catch {
			console.warn('Operon: Failed to parse repeat-series.json, preserving invalid file as backup and starting empty');
			if (loadPath === this.filePath) {
				try {
					await preserveInvalidJsonFile(adapter, this.filePath, raw);
				} catch {
					console.warn('Operon: Failed to preserve invalid repeat-series.json backup');
				}
			}
			this.data = {
				version: CURRENT_REPEAT_SERIES_VERSION,
				series: {},
			};
		}
	}

	getEntry(seriesId: string | null | undefined): RepeatSeriesEntry | null {
		if (!seriesId) return null;
		const entry = this.data.series[seriesId];
		return entry ? this.cloneEntry(entry) : null;
	}

	getAllEntries(): RepeatSeriesEntry[] {
		return Object.values(this.data.series).map(entry => this.cloneEntry(entry));
	}

	getSkipDates(seriesId: string | null | undefined): string[] {
		return [...(this.data.series[seriesId ?? '']?.skipDates ?? [])];
	}

	getAllSeriesIds(): Set<string> {
		return new Set(Object.keys(this.data.series));
	}

	async ensureSeries(input: EnsureRepeatSeriesInput): Promise<RepeatSeriesEntry> {
		return await this.mutate(async () => {
			const resolvedId = input.seriesId?.trim() || generateRepeatSeriesId(this.getAllSeriesIds());
			const existing = this.data.series[resolvedId];
			if (existing) {
				const next: RepeatSeriesEntry = {
					...existing,
					sourceTaskId: existing.sourceTaskId || input.sourceTaskId,
					sourceFormat: existing.sourceFormat || input.sourceFormat,
					baseTitle: existing.baseTitle ?? input.baseTitle,
					lastMaterializedTitle: existing.lastMaterializedTitle ?? normalizeOptionalText(input.lastMaterializedTitle),
					naming: existing.naming ?? normalizeNamingConfig(input.naming),
					baseTemporalTemplate: cloneTemporalTemplate(existing.baseTemporalTemplate),
					inlineCompletionMode: normalizeInlineCompletionMode(existing.inlineCompletionMode),
					updatedAt: input.now,
				};
				await this.commit(next);
				return this.cloneEntry(next);
			}

			const created: RepeatSeriesEntry = {
				seriesId: resolvedId,
				sourceTaskId: input.sourceTaskId,
				sourceFormat: input.sourceFormat,
				baseTitle: input.baseTitle,
				lastMaterializedTitle: normalizeOptionalText(input.lastMaterializedTitle),
				naming: normalizeNamingConfig(input.naming),
				skipDates: [],
				yamlPropertyValueRemovalConfigured: false,
				yamlPropertyValueRemovals: [],
				baseTemporalTemplate: cloneTemporalTemplate(input.baseTemporalTemplate ?? null),
				inlineCompletionMode: normalizeInlineCompletionMode(input.inlineCompletionMode),
				createdAt: input.now,
				updatedAt: input.now,
				overrides: {
					single: {},
					following: [],
				},
			};
			await this.commit(created);
			return this.cloneEntry(created);
		});
	}

	async updateBaseTemporalTemplate(
		seriesId: string,
		template: RepeatTemporalTemplate,
		now: string,
	): Promise<void> {
		await this.mutate(async () => {
			const existing = this.data.series[seriesId];
			if (!existing) return;
			await this.commit({
				...existing,
				baseTemporalTemplate: cloneTemporalTemplate(template),
				updatedAt: now,
			});
		});
	}

	async updateInlineCompletionMode(
		seriesId: string,
		mode: InlineRepeatCompletionMode,
		now: string,
	): Promise<void> {
		await this.mutate(async () => {
			const existing = this.data.series[seriesId];
			if (!existing) return;
			await this.commit({
				...existing,
				inlineCompletionMode: normalizeInlineCompletionMode(mode),
				updatedAt: now,
			});
		});
	}

	async updateSkipDates(seriesId: string, skipDates: string[], now: string): Promise<void> {
		await this.mutate(async () => {
			const existing = this.data.series[seriesId];
			if (!existing) return;
			await this.commit({
				...existing,
				skipDates: sortUniqueDates(skipDates),
				updatedAt: now,
			});
		});
	}

	async updateYamlPropertyValueRemovals(seriesId: string, rawYamlKeys: string[], now: string): Promise<void> {
		await this.mutate(async () => {
			const existing = this.data.series[seriesId];
			if (!existing) return;
			await this.commit({
				...existing,
				yamlPropertyValueRemovalConfigured: true,
				yamlPropertyValueRemovals: normalizeYamlPropertyValueRemovals(rawYamlKeys),
				updatedAt: now,
			});
		});
	}

	async clearYamlPropertyValueRemovalRule(seriesId: string, now: string): Promise<void> {
		await this.mutate(async () => {
			const existing = this.data.series[seriesId];
			if (!existing) return;
			await this.commit({
				...existing,
				yamlPropertyValueRemovalConfigured: false,
				yamlPropertyValueRemovals: [],
				updatedAt: now,
			});
		});
	}

	async updateLastMaterializedTitle(seriesId: string, title: string | null | undefined, now: string): Promise<void> {
		await this.mutate(async () => {
			const existing = this.data.series[seriesId];
			if (!existing) return;
			await this.commit({
				...existing,
				lastMaterializedTitle: normalizeOptionalText(title),
				updatedAt: now,
			});
		});
	}

	async skipOccurrence(seriesId: string, occurrenceDate: string, now: string): Promise<void> {
		await this.mutate(async () => {
			const existing = this.data.series[seriesId];
			if (!existing) return;
			const normalizedDate = normalizeDateKey(occurrenceDate);
			if (!normalizedDate) return;
			const nextSingle = { ...existing.overrides.single };
			delete nextSingle[normalizedDate];
			await this.commit({
				...existing,
				skipDates: sortUniqueDates([...existing.skipDates, normalizedDate]),
				overrides: {
					single: nextSingle,
					following: [...existing.overrides.following],
				},
				updatedAt: now,
			});
		});
	}

	async upsertSingleOverride(
		seriesId: string,
		override: RepeatSingleOccurrenceOverride,
		now: string,
	): Promise<void> {
		await this.mutate(async () => {
			const existing = this.data.series[seriesId];
			if (!existing) return;
			const normalized = normalizeSingleOverride(override);
			if (!normalized) return;
			await this.commit({
				...existing,
				skipDates: existing.skipDates.filter(date => date !== normalized.occurrenceDate),
				overrides: {
					single: {
						...existing.overrides.single,
						[normalized.occurrenceDate]: normalized,
					},
					following: [...existing.overrides.following],
				},
				updatedAt: now,
			});
		});
	}

	async upsertFollowingOverride(
		seriesId: string,
		override: RepeatFollowingOverride,
		now: string,
	): Promise<void> {
		await this.mutate(async () => {
			const existing = this.data.series[seriesId];
			if (!existing) return;
			const normalized = normalizeFollowingOverride(override);
			if (!normalized) return;

			const nextFollowing = existing.overrides.following
				.filter(entry => entry.effectiveFrom < normalized.effectiveFrom)
				.concat(normalized)
				.sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom));

			const nextSingle: Record<string, RepeatSingleOccurrenceOverride> = {};
			for (const [occurrenceDate, value] of Object.entries(existing.overrides.single)) {
				if (occurrenceDate < normalized.effectiveFrom) {
					nextSingle[occurrenceDate] = value;
				}
			}

			await this.commit({
				...existing,
				skipDates: existing.skipDates.filter(date => date < normalized.effectiveFrom),
				overrides: {
					single: nextSingle,
					following: nextFollowing,
				},
				updatedAt: now,
			});
		});
	}

	async deleteSeries(seriesId: string): Promise<void> {
		await this.mutate(async () => {
			if (!this.data.series[seriesId]) return;
			delete this.data.series[seriesId];
			await this.writeData();
		});
	}

	async reconcileSeriesEntries(materializedSeriesIds: Set<string>): Promise<void> {
		await this.mutate(async () => {
			let changed = false;
			for (const seriesId of Object.keys(this.data.series)) {
				const entry = this.data.series[seriesId];
				if (entry?.yamlPropertyValueRemovalConfigured) continue;
				if (materializedSeriesIds.has(seriesId)) continue;
				delete this.data.series[seriesId];
				changed = true;
			}
			if (changed) {
				await this.writeData();
			}
		});
	}

	async drain(): Promise<void> {
		await this.mutationQueue;
	}

	private normalizeSeries(raw: unknown): Record<string, RepeatSeriesEntry> {
		if (!raw || typeof raw !== 'object') return {};
		const out: Record<string, RepeatSeriesEntry> = {};
		for (const [seriesId, entry] of Object.entries(raw as Record<string, unknown>)) {
			if (!entry || typeof entry !== 'object') continue;
			const src = entry as Record<string, unknown>;
			const sourceTaskId = typeof src.sourceTaskId === 'string' ? src.sourceTaskId.trim() : '';
			const sourceFormat = src.sourceFormat === 'yaml' ? 'yaml' : src.sourceFormat === 'inline' ? 'inline' : null;
			const createdAt = typeof src.createdAt === 'string' ? src.createdAt : '';
			const updatedAt = typeof src.updatedAt === 'string' ? src.updatedAt : createdAt;
			if (!seriesId || !sourceTaskId || !sourceFormat || !createdAt) continue;
			out[seriesId] = {
				seriesId,
				sourceTaskId,
				sourceFormat,
				baseTitle: normalizeOptionalText(src.baseTitle),
				lastMaterializedTitle: normalizeOptionalText(src.lastMaterializedTitle),
				naming: normalizeNamingConfig(src.naming),
				skipDates: Array.isArray(src.skipDates)
					? sortUniqueDates(src.skipDates.filter((value): value is string => typeof value === 'string'))
					: [],
				yamlPropertyValueRemovalConfigured: src.yamlPropertyValueRemovalConfigured === true
					|| (
						Array.isArray(src.yamlPropertyValueRemovals)
						&& src.yamlPropertyValueRemovals.some(value => typeof value === 'string' && value.trim())
					),
				yamlPropertyValueRemovals: Array.isArray(src.yamlPropertyValueRemovals)
					? normalizeYamlPropertyValueRemovals(src.yamlPropertyValueRemovals.filter((value): value is string => typeof value === 'string'))
					: [],
				baseTemporalTemplate: normalizeRepeatTemporalTemplate(src.baseTemporalTemplate),
				inlineCompletionMode: normalizeInlineCompletionMode(src.inlineCompletionMode),
				createdAt,
				updatedAt,
				overrides: normalizeOverrides(src.overrides),
			};
		}
		return out;
	}

	private cloneEntry(entry: RepeatSeriesEntry): RepeatSeriesEntry {
		return {
			...entry,
			skipDates: [...entry.skipDates],
			yamlPropertyValueRemovalConfigured: entry.yamlPropertyValueRemovalConfigured,
			yamlPropertyValueRemovals: [...entry.yamlPropertyValueRemovals],
			lastMaterializedTitle: entry.lastMaterializedTitle,
			naming: entry.naming ? { ...entry.naming } : null,
			baseTemporalTemplate: cloneTemporalTemplate(entry.baseTemporalTemplate),
			overrides: {
				single: Object.fromEntries(
					Object.entries(entry.overrides.single).map(([date, value]) => [date, { ...value }]),
				),
				following: entry.overrides.following.map(value => ({ ...value })),
			},
		};
	}

	private async commit(entry: RepeatSeriesEntry): Promise<void> {
		this.data.series[entry.seriesId] = this.cloneEntry(entry);
		await this.writeData();
	}

	private async writeData(): Promise<void> {
		const snapshot = {
			version: CURRENT_REPEAT_SERIES_VERSION,
			series: this.data.series,
		};
		await this.writeQueue.enqueue(this.filePath, async () => {
			await writeJsonSafely(this.app.vault.adapter, this.filePath, snapshot);
		});
	}

	private async resolveLoadPath(): Promise<string | null> {
		const adapter = this.app.vault.adapter;
		if (await adapter.exists(this.filePath)) return this.filePath;
		return null;
	}

	private async mutate<T>(operation: () => Promise<T>): Promise<T> {
		const run = this.mutationQueue.then(operation);
		this.mutationQueue = run.then(() => undefined, () => undefined);
		return await run;
	}
}
