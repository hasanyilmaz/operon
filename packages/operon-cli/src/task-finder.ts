import type {
	ContextRevisionV1,
	OperonCatalogV1,
	TaskContextV1,
	TaskGetResultV1,
	ContextHydrationKeyV1,
	TaskFinderProjectModeV1,
	TaskFinderRequestV1,
	TaskFinderResultV1 as RuntimeTaskFinderResultV1,
	TaskFinderScopeV1,
	TaskQueryFiltersV1,
	TaskSelectorV1,
	TaskSourceLocatorV1,
} from '../../../src/agent-runtime/contracts/v1';
import { sanitizeTerminalTextV1 } from './terminal-text';
import type { InteractiveTerminalPortV1 } from './terminal-port';

const FINDER_PAGE_SIZE = 10;
const FINDER_PAGE_LIMIT = 5;
const DISPLAY_LIMIT = 100;
const PATH_LIMIT = 72;

export type TaskFinderPurposeV1 = 'read' | 'mutation-target';

export interface TaskFinderRuntimeSuccessV1<T> {
	ok: true;
	value: T;
	opaque: unknown;
}

export interface TaskFinderRuntimeFailureV1 {
	ok: false;
	failure: unknown;
	code?: string;
}

export type TaskFinderRuntimeResponseV1<T> =
	| TaskFinderRuntimeSuccessV1<T>
	| TaskFinderRuntimeFailureV1;

export type TaskFinderQueryV1 = Omit<
	TaskFinderRequestV1,
	'contractVersion' | 'requestId' | 'kind' | 'consistency'
>;

export interface TaskFinderRuntimePortV1 {
	finder(request: TaskFinderQueryV1): Promise<TaskFinderRuntimeResponseV1<RuntimeTaskFinderResultV1>>;
	read(
		selector: TaskSelectorV1,
		include?: ContextHydrationKeyV1[],
	): Promise<TaskFinderRuntimeResponseV1<TaskGetResultV1>>;
	catalog(): Promise<TaskFinderRuntimeResponseV1<OperonCatalogV1>>;
}

export type TaskFinderResultV1 =
	| {
		status: 'selected';
		selector: Extract<TaskSelectorV1, { kind: 'exact-locator' }>;
		task: TaskContextV1;
		queryContextRevision: ContextRevisionV1;
		verifiedContextRevision: ContextRevisionV1;
		opaque: unknown;
	}
	| { status: 'cancelled'; message: string }
	| { status: 'failed'; failure: unknown };

export interface TaskFinderOptionsV1 {
	port: InteractiveTerminalPortV1;
	runtime: TaskFinderRuntimePortV1;
	initialQuery?: string;
	purpose?: TaskFinderPurposeV1;
	readInclude?: ContextHydrationKeyV1[];
}

interface FinderStateV1 {
	query: string;
	filters: TaskQueryFiltersV1;
	representations?: Array<'inline' | 'file'>;
	scope: TaskFinderScopeV1;
	project?: { mode: TaskFinderProjectModeV1; rootOperonId?: string };
	pages: RuntimeTaskFinderResultV1[];
	pageIndex: number;
	staleCursorRestarted: boolean;
	catalog?: Extract<OperonCatalogV1, { ok: true }>;
}

export async function runGuidedTaskFinderV1(
	options: TaskFinderOptionsV1,
): Promise<TaskFinderResultV1> {
	const purpose = options.purpose ?? 'read';
	const initialQuery = await resolveInitialSearch(options.port, options.initialQuery);
	if (initialQuery === null) return cancelled();
	const state: FinderStateV1 = {
		query: initialQuery,
		filters: filtersFor(initialQuery, ['open']),
		scope: 'normal',
		pages: [],
		pageIndex: 0,
		staleCursorRestarted: false,
	};
	while (true) {
		if (state.pages.length === 0) {
			const loaded = await loadPage(options.port, options.runtime, state);
			if (loaded.status === 'failed') return loaded;
			if (loaded.status === 'restart') continue;
		}
		const page = state.pages[state.pageIndex];
		renderPage(options.port, state, page);
		const answer = await options.port.ask(finderPrompt(state, page));
		if (answer === null || isCancel(answer)) return cancelled();
		const normalized = answer.trim().toLowerCase();
		if (normalized === 's') {
			const nextQuery = await resolveInitialSearch(options.port);
			if (nextQuery === null) return cancelled();
			state.query = nextQuery;
			state.filters = { ...state.filters, ...(nextQuery ? { text: nextQuery } : {}) };
			if (!nextQuery) delete state.filters.text;
			if (nextQuery) state.scope = 'normal';
			resetPages(state);
			continue;
		}
		if (normalized === 'a') {
			if (state.filters.checkbox) {
				state.filters.checkbox = undefined;
				if (state.scope === 'overdue' || state.scope === 'happens-today') {
					state.scope = 'normal';
				}
			} else {
				state.filters.checkbox = ['open'];
			}
			resetPages(state);
			continue;
		}
		if (normalized === 'r') {
			const representation = await chooseRepresentation(options.port, state.representations);
			if (representation === null) return cancelled();
			state.representations = representation;
			resetPages(state);
			continue;
		}
		if (normalized === 'v') {
			const scope = await chooseScope(options.port, state.scope);
			if (scope === null) return cancelled();
			state.scope = scope;
			if (scope === 'overdue' || scope === 'happens-today') {
				state.filters.checkbox = ['open'];
			}
			resetPages(state);
			continue;
		}
		if (normalized === 'j') {
			const project = await chooseProjectMode(options.port, state.project?.mode);
			if (project === null) return cancelled();
			state.project = project ? { mode: project } : undefined;
			resetPages(state);
			continue;
		}
		if (normalized === 'f') {
			const filtered = await editFilters(options, state);
			if (filtered.status === 'failed') return filtered;
			if (filtered.status === 'cancelled') return cancelled();
			if (filtered.changed) resetPages(state);
			continue;
		}
		if (normalized === 'p') {
			if (state.pageIndex > 0) state.pageIndex -= 1;
			else options.port.write('Already at the first page.\n');
			continue;
		}
		if (normalized === 'n') {
			if (state.pageIndex + 1 < state.pages.length) {
				state.pageIndex += 1;
				continue;
			}
			if (state.pages.length >= FINDER_PAGE_LIMIT) {
				options.port.write('The 50-task browse limit was reached; refine the search or filters.\n');
				continue;
			}
			if (!page.ok || !page.page.nextCursor) {
				options.port.write('No additional task page is available.\n');
				continue;
			}
			const loaded = await loadPage(options.port, options.runtime, state, page.page.nextCursor);
			if (loaded.status === 'failed') return loaded;
			if (loaded.status === 'restart') continue;
			state.pageIndex += 1;
			continue;
		}
		const selectedIndex = parseSelection(normalized, page);
		if (selectedIndex === null) {
			options.port.write('Choose a visible row number or one of n, p, s, a, f, r, v, j, or q.\n');
			continue;
		}
		if (!page.ok) continue;
		const selectedRow = page.rows[selectedIndex];
		if (!selectedRow) continue;
		if (selectedRow.kind === 'project') {
			if (
				selectedRow.task.identity.validity !== 'canonical'
				|| !selectedRow.task.identity.mutationAllowed
			) {
				options.port.write(
					`That project cannot define an exact task scope (${display(selectedRow.task.identity.validity)}).\n`,
				);
				continue;
			}
			state.project = {
				mode: state.project?.mode ?? 'direct',
				rootOperonId: selectedRow.task.identity.operonId,
			};
			resetPages(state);
			continue;
		}
		const selected = selectedRow.task;
		if (purpose === 'mutation-target' && !selected.identity.mutationAllowed) {
			options.port.write(
				`That task cannot be used as a mutation target (${display(selected.identity.validity)}).\n`,
			);
			continue;
		}
		const selector: Extract<TaskSelectorV1, { kind: 'exact-locator' }> = {
			kind: 'exact-locator',
			locator: structuredClone(selected.locator),
			...(selected.identity.validity === 'legacy-invalid'
				? {}
				: { expectedOperonId: selected.identity.operonId }),
		};
		const verified = await options.runtime.read(selector, options.readInclude);
		if (!verified.ok) return { status: 'failed', failure: verified.failure };
		if (
			!verified.value.ok
			|| verified.value.task.identity.operonId !== selected.identity.operonId
			|| !sameLocator(verified.value.task.locator, selected.locator)
		) {
			options.port.write(
				'The selected task changed or moved before exact verification. The result list was refreshed.\n',
			);
			resetPages(state);
			continue;
		}
		if (purpose === 'mutation-target' && !verified.value.task.identity.mutationAllowed) {
			options.port.write(
				`That task is no longer mutation-eligible (${display(verified.value.task.identity.validity)}).\n`,
			);
			resetPages(state);
			continue;
		}
		return {
			status: 'selected',
			selector,
			task: verified.value.task,
			queryContextRevision: page.contextRevision,
			verifiedContextRevision: verified.value.contextRevision,
			opaque: verified.opaque,
		};
	}
}

async function loadPage(
	port: InteractiveTerminalPortV1,
	runtime: TaskFinderRuntimePortV1,
	state: FinderStateV1,
	cursor?: string,
): Promise<{ status: 'loaded' | 'restart' } | { status: 'failed'; failure: unknown }> {
	const { text: _text, ...filters } = state.filters;
	const response = await runtime.finder({
		...(state.query ? { text: state.query } : {}),
		...(Object.keys(filters).length > 0 ? { filters } : {}),
		...(state.representations ? { representations: state.representations } : {}),
		scope: state.scope,
		...(state.project ? { project: state.project } : {}),
		limit: FINDER_PAGE_SIZE,
		...(cursor ? { cursor } : {}),
	});
	if (!response.ok) {
		if (response.code === 'stale-cursor' && cursor && !state.staleCursorRestarted) {
			state.pages = [];
			state.pageIndex = 0;
			state.staleCursorRestarted = true;
			port.write('The live task index changed; results restarted from page 1.\n');
			return { status: 'restart' };
		}
		return { status: 'failed', failure: response.failure };
	}
	if (!response.value.ok) {
		if (response.value.error.code === 'stale-cursor' && cursor && !state.staleCursorRestarted) {
			state.pages = [];
			state.pageIndex = 0;
			state.staleCursorRestarted = true;
			port.write('The live task index changed; results restarted from page 1.\n');
			return { status: 'restart' };
		}
		return { status: 'failed', failure: response.opaque };
	}
	state.pages.push(response.value);
	return { status: 'loaded' };
}

async function editFilters(
	options: TaskFinderOptionsV1,
	state: FinderStateV1,
): Promise<
	| { status: 'done'; changed: boolean }
	| { status: 'cancelled' }
	| { status: 'failed'; failure: unknown }
> {
	if (!state.catalog) {
		const response = await options.runtime.catalog();
		if (!response.ok) return { status: 'failed', failure: response.failure };
		if (!response.value.ok) return { status: 'failed', failure: response.opaque };
		state.catalog = response.value;
		const ambiguousPipelines = state.catalog.taxonomy.pipelines
			.filter(item => item.identityStatus !== 'resolved').length;
		const ambiguousStatuses = state.catalog.taxonomy.pipelines
			.flatMap(item => item.statuses)
			.filter(item => item.identityStatus !== 'resolved').length;
		const ambiguousPriorities = state.catalog.taxonomy.priorities
			.filter(item => item.identityStatus !== 'resolved').length;
		if (ambiguousPipelines + ambiguousStatuses + ambiguousPriorities > 0) {
			options.port.write(
				`${ambiguousPipelines + ambiguousStatuses + ambiguousPriorities} ambiguous taxonomy definition(s) were excluded from exact filters.\n`,
			);
		}
	}
	const before = JSON.stringify(state.filters);
	while (true) {
		options.port.write([
			'',
			'Task Finder filters',
			`Current: ${filterSummary(state)}`,
			'1. Checkbox states',
			'2. Pipelines',
			'3. Statuses',
			'4. Priorities',
			'5. Due date range',
			'r. Reset to open tasks',
			'b. Apply and return',
			'q. Cancel finder',
			'',
		].join('\n'));
		const answer = await options.port.ask('Filter choice: ');
		if (answer === null || isCancel(answer)) return { status: 'cancelled' };
			switch (answer.trim().toLowerCase()) {
			case '1': {
				const selected = await chooseCheckboxes(options.port, state.filters.checkbox);
				if (selected === null) return { status: 'cancelled' };
				state.filters.checkbox = selected;
				if (
					state.scope === 'overdue' || state.scope === 'happens-today'
				) {
					const includesTerminal = !selected
						|| selected.includes('done')
						|| selected.includes('cancelled');
					if (includesTerminal) state.scope = 'normal';
				}
				break;
			}
			case '2': {
				const selected = await chooseTaxonomy(
					options.port,
					state.catalog.taxonomy.pipelines
						.filter(item => item.identityStatus === 'resolved')
						.map(item => ({
							id: item.id,
							label: item.name,
							description: item.description,
						})),
					state.filters.pipelineIds,
					'pipelines',
				);
				if (selected === null) return { status: 'cancelled' };
				state.filters.pipelineIds = selected;
				const allowedStatusIds = new Set(
					resolvedPipelines(state).flatMap(pipeline => (
						pipeline.statuses
							.filter(status => status.identityStatus === 'resolved')
							.map(status => status.id)
					)),
				);
				const retained = state.filters.statusIds?.filter(id => allowedStatusIds.has(id));
				if (retained?.length !== state.filters.statusIds?.length) {
					options.port.write('Status filters outside the selected pipelines were removed.\n');
				}
				state.filters.statusIds = retained?.length ? retained : undefined;
				break;
			}
			case '3': {
				const selected = await chooseTaxonomy(
					options.port,
					resolvedPipelines(state).flatMap(pipeline => (
						pipeline.statuses
							.filter(status => status.identityStatus === 'resolved')
							.map(status => ({
								id: status.id,
								label: `${pipeline.name} / ${status.label}`,
							}))
					)),
					state.filters.statusIds,
					'statuses',
				);
				if (selected === null) return { status: 'cancelled' };
				state.filters.statusIds = selected;
				break;
			}
			case '4': {
				const selected = await chooseTaxonomy(
					options.port,
					state.catalog.taxonomy.priorities
						.filter(item => item.identityStatus === 'resolved')
						.map(item => ({
							id: item.id,
							label: item.label,
							description: item.description,
						})),
					state.filters.priorityIds,
					'priorities',
				);
				if (selected === null) return { status: 'cancelled' };
				state.filters.priorityIds = selected;
				break;
			}
			case '5': {
				const due = await chooseDueRange(options.port, state.filters.due);
				if (due === null) return { status: 'cancelled' };
				state.filters.due = due;
				break;
			}
			case 'r':
				state.filters = filtersFor(state.query, ['open']);
				break;
			case 'b':
				return { status: 'done', changed: before !== JSON.stringify(state.filters) };
			default:
				options.port.write('Choose 1-5, r, b, or q.\n');
		}
	}
}

async function chooseCheckboxes(
	port: InteractiveTerminalPortV1,
	current?: TaskQueryFiltersV1['checkbox'],
): Promise<TaskQueryFiltersV1['checkbox'] | null> {
	const values = [
		{ id: 'open', label: 'Open' },
		{ id: 'done', label: 'Done' },
		{ id: 'cancelled', label: 'Cancelled' },
	] as const;
	const selected = await chooseMany(port, values, current, 'checkbox states');
	return selected as TaskQueryFiltersV1['checkbox'] | null;
}

async function chooseRepresentation(
	port: InteractiveTerminalPortV1,
	current?: Array<'inline' | 'file'>,
): Promise<Array<'inline' | 'file'> | undefined | null> {
	const currentLabel = !current ? 'All' : current.length === 1 && current[0] === 'inline' ? 'Inline' : 'File';
	port.write([
		'',
		`Representation (${currentLabel})`,
		'1. All',
		'2. Inline tasks',
		'3. File Tasks',
		'',
	].join('\n'));
	const answer = await port.ask('Representation (Enter keeps current, q cancels): ');
	if (answer === null || isCancel(answer)) return null;
	switch (answer.trim()) {
	case '': return current;
	case '1': return undefined;
	case '2': return ['inline'];
	case '3': return ['file'];
	default:
		port.write('Choose 1-3, Enter, or q.\n');
		return await chooseRepresentation(port, current);
	}
}

async function chooseScope(
	port: InteractiveTerminalPortV1,
	current: TaskFinderScopeV1,
): Promise<TaskFinderScopeV1 | null> {
	port.write([
		'',
		`Finder view (${scopeLabel(current)})`,
		'1. Normal',
		'2. Overdue',
		'3. Happens Today',
		'4. Recent',
		'',
	].join('\n'));
	const answer = await port.ask('View (Enter keeps current, q cancels): ');
	if (answer === null || isCancel(answer)) return null;
	return ({
		'': current,
		'1': 'normal',
		'2': 'overdue',
		'3': 'happens-today',
		'4': 'recent',
	} as const)[answer.trim()] ?? await retryScope(port, current);
}

async function retryScope(
	port: InteractiveTerminalPortV1,
	current: TaskFinderScopeV1,
): Promise<TaskFinderScopeV1 | null> {
	port.write('Choose 1-4, Enter, or q.\n');
	return await chooseScope(port, current);
}

async function chooseProjectMode(
	port: InteractiveTerminalPortV1,
	current?: TaskFinderProjectModeV1,
): Promise<TaskFinderProjectModeV1 | undefined | null> {
	port.write([
		'',
		`Project scope (${current === 'direct' ? 'Project Tasks' : current === 'tree' ? 'Project Tree' : 'Off'})`,
		'1. Off',
		'2. Project Tasks (direct children)',
		'3. Project Tree (all descendants)',
		'',
	].join('\n'));
	const answer = await port.ask('Project scope (Enter keeps current, q cancels): ');
	if (answer === null || isCancel(answer)) return null;
	switch (answer.trim()) {
	case '': return current;
	case '1': return undefined;
	case '2': return 'direct';
	case '3': return 'tree';
	default:
		port.write('Choose 1-3, Enter, or q.\n');
		return await chooseProjectMode(port, current);
	}
}

async function chooseTaxonomy(
	port: InteractiveTerminalPortV1,
	values: Array<{ id: string; label: string; description?: string }>,
	current: string[] | undefined,
	label: string,
): Promise<string[] | undefined | null> {
	return await chooseMany(port, values, current, label);
}

async function chooseMany(
	port: InteractiveTerminalPortV1,
	values: ReadonlyArray<{ id: string; label: string; description?: string }>,
	current: readonly string[] | undefined,
	label: string,
): Promise<string[] | undefined | null> {
	let page = 0;
	const selected = new Set(current ?? []);
	const pageCount = Math.max(1, Math.ceil(values.length / 20));
	while (true) {
		const offset = page * 20;
		const visible = values.slice(offset, offset + 20);
		port.write(`\nSelect ${label} with comma-separated numbers. Page ${page + 1}/${pageCount}.\n`);
		visible.forEach((item, index) => {
			const marker = selected.has(item.id) ? ' [selected]' : '';
			port.write(`${index + 1}. ${display(item.label)} [${display(item.id)}]${marker}\n`);
			if (item.description) port.write(`   ${display(item.description)}\n`);
		});
		const answer = await port.ask(`${label} (+numbers toggles, n/p pages, b applies, - clears, q cancels): `);
		if (answer === null || isCancel(answer)) return null;
		const trimmed = answer.trim();
		if (!trimmed || trimmed === 'b') return selected.size ? [...selected] : undefined;
		if (trimmed === '-') return undefined;
		if (trimmed === 'n' && page + 1 < pageCount) {
			page += 1;
			continue;
		}
		if (trimmed === 'p' && page > 0) {
			page -= 1;
			continue;
		}
		const toggles = trimmed.startsWith('+');
		const rawIndexes = toggles ? trimmed.slice(1) : trimmed;
		const indexes = rawIndexes.split(',').map(value => Number(value.trim()) - 1);
		if (
			indexes.length > 0
			&& indexes.every(index => Number.isInteger(index) && index >= 0 && index < visible.length)
		) {
			const ids = indexes.map(index => visible[index].id);
			if (!toggles) return [...new Set(ids)];
			for (const id of ids) {
				if (selected.has(id)) selected.delete(id);
				else selected.add(id);
			}
			continue;
		}
		port.write('Enter visible option numbers, +numbers, n, p, b, -, or q.\n');
	}
}

function resolvedPipelines(state: FinderStateV1) {
	const pipelines = state.catalog?.taxonomy.pipelines
		.filter(item => item.identityStatus === 'resolved') ?? [];
	return state.filters.pipelineIds?.length
		? pipelines.filter(item => state.filters.pipelineIds?.includes(item.id))
		: pipelines;
}

async function chooseDueRange(
	port: InteractiveTerminalPortV1,
	current?: TaskQueryFiltersV1['due'],
): Promise<TaskQueryFiltersV1['due'] | null> {
	const from = await askDate(port, 'Due from', current?.from);
	if (from === null) return null;
	const to = await askDate(port, 'Due to', current?.to);
	if (to === null) return null;
	if (from && to && from > to) {
		port.write('Due from cannot be after due to; the existing range was kept.\n');
		return current;
	}
	return from || to ? { ...(from ? { from } : {}), ...(to ? { to } : {}) } : undefined;
}

async function askDate(
	port: InteractiveTerminalPortV1,
	label: string,
	current?: string,
): Promise<string | undefined | null> {
	while (true) {
		const answer = await port.ask(`${label}${current ? ` [${current}]` : ''} (YYYY-MM-DD, - clears): `);
		if (answer === null || isCancel(answer)) return null;
		const trimmed = answer.trim();
		if (!trimmed) return current;
		if (trimmed === '-') return undefined;
		if (isLocalDate(trimmed)) return trimmed;
		port.write('Use a valid YYYY-MM-DD date, Enter, or -.\n');
	}
}

function renderPage(
	port: InteractiveTerminalPortV1,
	state: FinderStateV1,
	page: RuntimeTaskFinderResultV1,
): void {
	if (!page.ok) return;
	port.write([
		'',
		'Operon Task Finder',
		`Search: ${state.query ? display(state.query) : '(all open tasks)'}`,
		`Filters: ${filterSummary(state)}`,
		`Page ${state.pageIndex + 1} · ${page.page.returnedCount}/${page.page.actualCount} tasks`,
		'',
	].join('\n'));
	page.rows.forEach((row, index) => {
		const task = row.task;
		const status = task.workflow?.status.label ?? task.checkbox;
		const priority = task.priority?.label ?? '-';
		const due = task.dates.due ? ` · due ${display(task.dates.due)}` : '';
		const mutation = task.identity.mutationAllowed ? '' : ` · read-only ${display(task.identity.validity)}`;
		const project = row.kind === 'project'
			? ` · ${row.visibleDirectTaskCount} visible incl. root, ${row.directTaskCount} direct children`
				+ ` · ${row.visibleTreeTaskCount} visible incl. root, ${row.treeTaskCount} descendants`
			: '';
		port.write(
			`${index + 1}. ${display(task.description)}\n`
			+ `   ${display(status)} · ${display(priority)}${due}${project}${mutation}\n`
			+ `   ${display(task.identity.operonId)} · ${display(task.representation)} · ${formatLocator(task.locator)}\n`,
		);
	});
	if (page.rows.length === 0) port.write('No tasks matched the current search and filters.\n');
}

function finderPrompt(state: FinderStateV1, page: RuntimeTaskFinderResultV1): string {
	const count = page.ok ? page.rows.length : 0;
	const choices = [
		count ? `1-${count}` : '',
		page.ok && page.page.nextCursor ? 'n next' : '',
		state.pageIndex > 0 ? 'p previous' : '',
		's search',
		'a open/all',
		'f filters',
		'r representation',
		'v view',
		'j project',
		'q cancel',
	].filter(Boolean).join(', ');
	return `Choose ${choices}: `;
}

function filterSummary(state: FinderStateV1): string {
	const parts = [
		state.filters.checkbox?.length ? state.filters.checkbox.join('+') : 'all states',
	];
	if (state.filters.pipelineIds?.length) parts.push(`${state.filters.pipelineIds.length} pipeline`);
	if (state.filters.statusIds?.length) parts.push(`${state.filters.statusIds.length} status`);
	if (state.filters.priorityIds?.length) parts.push(`${state.filters.priorityIds.length} priority`);
	if (state.filters.due) parts.push(`due ${state.filters.due.from ?? '…'}..${state.filters.due.to ?? '…'}`);
	parts.push(`representation ${!state.representations ? 'all' : state.representations.join('+')}`);
	parts.push(`view ${scopeLabel(state.scope)}`);
	if (state.project) {
		parts.push(
			state.project.rootOperonId
				? `${state.project.mode} project ${state.project.rootOperonId}`
				: `${state.project.mode} project selection`,
		);
	}
	return parts.join(', ');
}

function filtersFor(
	query: string,
	checkbox: TaskQueryFiltersV1['checkbox'],
): TaskQueryFiltersV1 {
	return { checkbox, ...(query ? { text: query } : {}) };
}

async function askSearch(port: InteractiveTerminalPortV1): Promise<string | null> {
	const answer = await port.ask('Search (blank shows current open tasks, q cancels): ');
	if (answer === null || isCancel(answer)) return null;
	return answer.trim();
}

async function resolveInitialSearch(
	port: InteractiveTerminalPortV1,
	initial?: string,
): Promise<string | null> {
	let query = initial?.trim() ?? await askSearch(port);
	while (query !== null && !isValidFinderSearch(query)) {
		port.write('Search requires 2-4,096 characters including a letter or number.\n');
		query = await askSearch(port);
	}
	return query;
}

function isValidFinderSearch(query: string): boolean {
	return query.length === 0 || (
		query.length >= 2
		&& query.length <= 4_096
		&& /[\p{L}\p{N}]/u.test(query)
	);
}

function parseSelection(value: string, page: RuntimeTaskFinderResultV1): number | null {
	if (!page.ok || !/^\d+$/u.test(value)) return null;
	const index = Number(value) - 1;
	return Number.isSafeInteger(index) && index >= 0 && index < page.rows.length ? index : null;
}

function scopeLabel(scope: TaskFinderScopeV1): string {
	return scope === 'happens-today'
		? 'Happens Today'
		: scope.charAt(0).toUpperCase() + scope.slice(1);
}

function resetPages(state: FinderStateV1): void {
	state.pages = [];
	state.pageIndex = 0;
	state.staleCursorRestarted = false;
}

function sameLocator(left: TaskSourceLocatorV1, right: TaskSourceLocatorV1): boolean {
	return left.representation === right.representation
		&& left.filePath === right.filePath
		&& (
			left.representation === 'file'
			|| (right.representation === 'inline' && left.lineNumber === right.lineNumber)
		);
}

function formatLocator(locator: TaskSourceLocatorV1): string {
	return display(
		locator.representation === 'inline'
			? `${locator.filePath}:${locator.lineNumber + 1}`
			: locator.filePath,
		PATH_LIMIT,
	);
}

function display(
	value: string | number | boolean | null | undefined,
	limit: number = DISPLAY_LIMIT,
): string {
	const safe = sanitizeTerminalTextV1(String(value ?? '')).replace(/\s+/gu, ' ').trim();
	const characters = [...safe];
	return characters.length > limit ? `${characters.slice(0, limit - 1).join('')}…` : safe;
}

function isCancel(value: string): boolean {
	return value.trim().toLowerCase() === 'q';
}

function cancelled(): TaskFinderResultV1 {
	return {
		status: 'cancelled',
		message: 'Task Finder cancelled; no task, plan, or mutation was changed.',
	};
}

function isLocalDate(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
	const [year, month, day] = value.split('-').map(Number);
	const date = new Date(Date.UTC(year, month - 1, day));
	return date.getUTCFullYear() === year
		&& date.getUTCMonth() === month - 1
		&& date.getUTCDate() === day;
}

export const TASK_FINDER_LIMITS_V1 = Object.freeze({
	pageSize: FINDER_PAGE_SIZE,
	pageCount: FINDER_PAGE_LIMIT,
});
