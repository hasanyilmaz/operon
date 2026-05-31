import { App, TFile, normalizePath } from 'obsidian';
import { FilterSet, KeyMapping, OperonSettings } from '../types/settings';
import { localNow, localToday, toLocalDate } from './local-time';

const OPERON_DEMO_WORKSPACE_FOLDER = 'Operon/Demo Workspace';

export const OPERON_BASICS_PROJECT_PATH = `${OPERON_DEMO_WORKSPACE_FOLDER}/Operon Basics Project.md`;
export const OPERON_COMMAND_PALETTE_PATH = `${OPERON_DEMO_WORKSPACE_FOLDER}/Operon Command Palette.md`;
export const OPERON_SETUP_PROJECT_PATH = `${OPERON_DEMO_WORKSPACE_FOLDER}/Set Up Your Obsidian Vault with Operon.md`;

const LEGACY_OPERON_BASICS_PROJECT_PATHS = [
	'Operon/Operon Basics Project.md',
	'Operon/Tasks/Operon Basics Project.md',
] as const;
const LEGACY_OPERON_COMMAND_PALETTE_PATHS = [
	'Operon/Operon Command Palette.md',
	'Operon/Tasks/Operon Command Palette.md',
] as const;
const LEGACY_OPERON_SETUP_PROJECT_PATHS = [
	'Operon/Set Up Your Obsidian Vault with Operon.md',
	'Operon/Tasks/Set Up Your Obsidian Vault with Operon.md',
] as const;
const OPERON_DEMO_WORKSPACE_ARTIFACT_PATHS = [
	OPERON_BASICS_PROJECT_PATH,
	OPERON_COMMAND_PALETTE_PATH,
	OPERON_SETUP_PROJECT_PATH,
	...LEGACY_OPERON_BASICS_PROJECT_PATHS,
	...LEGACY_OPERON_COMMAND_PALETTE_PATHS,
	...LEGACY_OPERON_SETUP_PROJECT_PATHS,
] as const;
export const OPERON_BASICS_ROOT_ID = 'l1dk70s';
export const OPERON_BASICS_FILTER_ID = 'fs_2pv2ls9';
export const OPERON_SETUP_ROOT_ID = 'bui5bdb';
export const OPERON_SETUP_FILTER_ID = 'fs_qhfyh5w0';
export const OPERON_BASICS_SECTION_PARENT_IDS = [
	'j9svbz2',
	'48dankx',
	'su51jgp',
	'pnqei6v',
	'qaafddt',
	'vqhq2hy',
	'4u53i5n',
	'ndus7fz',
	'vbm1g5y',
	'knvcrmd',
	'eqt8ryo',
] as const;
export const OPERON_SETUP_DAY_PARENT_IDS = [
	'qg2t2tx',
	'dt0s583',
	'bco2vgu',
	'fzqn0nb',
	'2vgf4ge',
	'v0a5bww',
	'vi8fh1k',
] as const;
export const OPERON_DEMO_AGGREGATE_PARENT_IDS = [
	OPERON_BASICS_ROOT_ID,
	...OPERON_BASICS_SECTION_PARENT_IDS,
	OPERON_SETUP_ROOT_ID,
	...OPERON_SETUP_DAY_PARENT_IDS,
] as const;

const OPERON_SETUP_FILTER_GROUP_ID = 'fg_3snb5eb9';
const OPERON_SETUP_FILTER_CONDITION_ID = 'cond_hzxpr929';

interface BasicsWorkspaceFilterStore {
	getById(filterId: string): FilterSet | null;
	upsert(filterSet: FilterSet): Promise<void>;
}

export interface BasicsWorkspaceStore {
	filters: BasicsWorkspaceFilterStore;
}

export interface BasicsWorkspaceResult {
	file: TFile;
	fileCreated: boolean;
	commandPaletteFile: TFile;
	commandPaletteFileCreated: boolean;
	setupProjectFile: TFile;
	setupProjectFileCreated: boolean;
	filterCreated: boolean;
	filterRepaired: boolean;
	setupFilterCreated: boolean;
	setupFilterRepaired: boolean;
}

interface DemoTaskDefinition {
	id: string;
	description: string;
	status?: string;
	priority?: string;
	tags?: string[];
	fields?: Record<string, string>;
	completed?: boolean;
}

interface DemoSectionDefinition {
	title: string;
	id: string;
	icon: string;
	color: string;
	note?: string;
	children: DemoTaskDefinition[];
}

interface SetupDayDefinition extends DemoSectionDefinition {
	dateScheduled: string;
	priority: string;
	note: string;
}

function addDays(baseDate: string, days: number): string {
	const [year, month, day] = baseDate.split('-').map(Number);
	const date = new Date(year, month - 1, day);
	date.setDate(date.getDate() + days);
	return toLocalDate(date);
}

function getWriteKey(canonicalKey: string, keyMappings: KeyMapping[]): string {
	const mapping = keyMappings.find(candidate =>
		candidate.canonicalKey === canonicalKey
		&& candidate.visiblePropertyName.trim()
	);
	return mapping?.visiblePropertyName.trim() || canonicalKey;
}

function escapeInlineValue(value: string): string {
	let result = '';
	for (let i = 0; i < value.length; i++) {
		const ch = value[i];
		if (ch === '\\') {
			result += '\\\\';
		} else if (ch === '}' && value[i + 1] === '}') {
			result += '\\}';
		} else if (ch === '{' && value[i + 1] === '{') {
			result += '\\{';
		} else {
			result += ch;
		}
	}
	return result;
}

function inlineField(canonicalKey: string, value: string, keyMappings: KeyMapping[]): string {
	const keyName = getWriteKey(canonicalKey, keyMappings);
	const escaped = escapeInlineValue(value);
	return escaped ? `{{${keyName}:: ${escaped}}}` : `{{${keyName}::}}`;
}

function yamlField(canonicalKey: string, value: string, keyMappings: KeyMapping[]): string {
	const keyName = getWriteKey(canonicalKey, keyMappings);
	const renderedValue = value.startsWith('#') ? `"${value}"` : value;
	return `${keyName}: ${renderedValue}`;
}

function renderTaskLine(
	task: DemoTaskDefinition,
	parentTaskId: string,
	section: Pick<DemoSectionDefinition, 'icon' | 'color'>,
	now: string,
	keyMappings: KeyMapping[],
	indent = '',
): string {
	const checkbox = task.completed ? 'x' : ' ';
	const status = task.status ?? (task.completed ? 'Project.Finished' : 'Project.Planned');
	const priority = task.priority ?? 'C';
	const tags = ['operon-demo', ...(task.tags ?? [])].map(tag => `#${tag}`).join(' ');
	const fields: string[] = [
		inlineField('operonId', task.id, keyMappings),
		inlineField('status', status, keyMappings),
		inlineField('priority', priority, keyMappings),
		inlineField('taskIcon', section.icon, keyMappings),
		inlineField('taskColor', section.color, keyMappings),
		...Object.entries(task.fields ?? {}).map(([key, value]) => inlineField(key, value, keyMappings)),
		inlineField('parentTask', parentTaskId, keyMappings),
		inlineField('datetimeCreated', now, keyMappings),
		inlineField('datetimeModified', now, keyMappings),
	];
	return `${indent}- [${checkbox}] ${task.description} ${tags} ${fields.join(' ')}`;
}

function buildSections(today: string): DemoSectionDefinition[] {
	const tomorrow = addDays(today, 1);
	const nextWeek = addDays(today, 7);
	return [
		{
			title: 'Start Here',
			id: OPERON_BASICS_SECTION_PARENT_IDS[0],
			icon: 'compass',
			color: '2563EB',
			note: 'Gives you a low-risk place to open, edit, and complete real Operon tasks before using your own work.',
			children: [
				{ id: 'wpc09ju', description: 'Open this task in the Task Editor', fields: { note: 'Shows where a task\'s full context lives when the inline line is too small for real planning.' } },
				{ id: 'w55g8jk', description: 'Adjust this task priority', fields: { note: 'Makes priority feel like a decision tool, not just a label sitting beside the task.' } },
				{ id: '9m01gqg', description: 'Complete this task from the inline controls', fields: { note: 'Shows the fastest path from action to done without opening a full editor.' } },
			],
		},
		{
			title: 'Capture And Edit Tasks',
			id: OPERON_BASICS_SECTION_PARENT_IDS[1],
			icon: 'pen-line',
			color: '7C3AED',
			note: 'Shows how quick thoughts become manageable tasks without leaving the note you are already using.',
			children: [
				{ id: '1s0c0kl', description: 'Create a new inline task below this section', fields: { note: 'Turns a small captured thought into a real task that can be filtered, planned, and completed later.' } },
				{ id: '86kj7zc', description: 'Edit this task description in the Task Editor', fields: { note: 'Keeps the task wording clear enough that the next action is still obvious later.' } },
				{ id: '552w7i9', description: 'Add a note to this task', fields: { note: 'Keeps the reason behind the task close to the task, so your future self does not have to rebuild the context.' } },
			],
		},
		{
			title: 'Organize With Fields',
			id: OPERON_BASICS_SECTION_PARENT_IDS[2],
			icon: 'sliders-horizontal',
			color: '0F766E',
			note: 'Connects task metadata to decisions about urgency, size, and workflow state.',
			children: [
				{ id: 'mrcqyel', description: 'Set a due date for this task', priority: 'B', fields: { dateDue: nextWeek, note: 'Turns a loose commitment into something Operon can surface before it becomes easy to miss.' } },
				{ id: '3i150bn', description: 'Add an estimate to this task', priority: 'B', fields: { estimate: '1800', note: 'Makes the size of the work visible before it quietly takes more room than expected.' } },
				{ id: '4n62215', description: 'Change this task\'s workflow status', status: 'Project.Brainstorming', fields: { note: 'Shows how status can describe the real stage of work instead of leaving every task in the same bucket.' } },
			],
		},
		{
			title: 'Plan On The Calendar',
			id: OPERON_BASICS_SECTION_PARENT_IDS[3],
			icon: 'calendar-days',
			color: 'EA580C',
			note: 'Turns task lists into time-aware planning without forcing every task onto the calendar.',
			children: [
				{ id: '3nutws8', description: 'Reschedule this task from the Calendar', priority: 'B', tags: ['calendar'], fields: { dateScheduled: tomorrow, dateDue: nextWeek, note: 'Shows how planned work can move when the day changes without losing the task itself.' } },
				{ id: 'u2jsba0', description: 'Move this timed task to another time block', priority: 'A', tags: ['calendar'], fields: { dateScheduled: addDays(today, 3), datetimeStart: `${addDays(today, 3)}T09:00:00`, datetimeEnd: `${addDays(today, 3)}T10:00:00`, estimate: '3600', note: 'Shows how scheduled work can move with the day instead of becoming stale the moment plans change.' } },
				{ id: '40g6s5s', description: 'Clear the scheduled date from this task', tags: ['calendar'], fields: { dateScheduled: addDays(today, 4), note: 'Separates useful planning from forced scheduling when a task no longer needs a calendar slot.' } },
			],
		},
		{
			title: 'Move Work On Kanban',
			id: OPERON_BASICS_SECTION_PARENT_IDS[4],
			icon: 'columns-3',
			color: 'DB2777',
			note: 'Shows how task status becomes a visible board for project movement and bottlenecks.',
			children: [
				{ id: '57xf8ic', description: 'Move this card from Planned to InProgress', priority: 'B', tags: ['kanban'], fields: { note: 'Connects task status to visible project movement, so the board reflects what is actually happening.' } },
				{ id: 'q56gr8c', description: 'Move this active card to Finished', status: 'Project.InProgress', priority: 'A', tags: ['kanban'], fields: { note: 'Makes completion visible in the same workflow where active work is managed.' } },
				{ id: 'hzrwz86', description: 'Pause this task from the Kanban board', status: 'Project.Paused', tags: ['kanban'], fields: { note: 'Keeps paused work honest instead of letting it pretend to be active.' } },
			],
		},
		{
			title: 'Work With Subtasks',
			id: OPERON_BASICS_SECTION_PARENT_IDS[5],
			icon: 'git-branch',
			color: '16A34A',
			note: 'Makes larger work easier to understand by connecting child actions to their parent outcome.',
			children: [
				{ id: '5dzjvve', description: 'Open the parent task and review its subtasks', fields: { note: 'Makes the project structure visible, so individual actions stay connected to the larger outcome.' } },
				{ id: 'y8nw5tu', description: 'Add a new subtask under this project', fields: { note: 'Shows how new work can be captured under the right parent instead of becoming an orphan task.' } },
				{ id: 'speq64q', description: 'Review project progress after completing a child task', priority: 'B', fields: { note: 'Shows how small completed actions roll up into a clearer picture of project progress.' } },
			],
		},
		{
			title: 'Use Dependencies',
			id: OPERON_BASICS_SECTION_PARENT_IDS[6],
			icon: 'workflow',
			color: 'DC2626',
			note: 'Makes task order and handoffs explicit when one piece of work depends on another.',
			children: [
				{ id: '2ygfo2l', description: 'Complete the blocking setup task first', priority: 'A', tags: ['dependencies'], fields: { blocking: 'w9adqqw', note: 'Shows how one task can intentionally unlock the next piece of work.' } },
				{ id: 'w9adqqw', description: 'Start this blocked task after setup is finished', priority: 'B', tags: ['dependencies'], fields: { blockedBy: '2ygfo2l', blocking: '9guoq4z', note: 'Makes waiting work visible without asking you to remember why it cannot move yet.' } },
				{ id: '9guoq4z', description: 'Review the final handoff after dependencies clear', tags: ['dependencies'], fields: { blockedBy: 'w9adqqw', note: 'Shows how a chain of dependent tasks can end with a clean review point.' } },
			],
		},
		{
			title: 'Try Recurrence',
			id: OPERON_BASICS_SECTION_PARENT_IDS[7],
			icon: 'repeat-2',
			color: '0891B2',
			note: 'Turns repeated work into a maintained rhythm instead of a task you recreate by hand.',
			children: [
				{ id: 'dj1nluj', description: 'Complete this weekly review task', tags: ['recurring'], fields: { dateScheduled: nextWeek, repeat: 'weekly', note: 'Shows how a repeated commitment can keep returning without being manually rebuilt.' } },
				{ id: 'g74e80o', description: 'Review the next generated occurrence', tags: ['recurring'], fields: { dateScheduled: addDays(today, 8), note: 'Builds trust that recurring work creates the next visible step instead of disappearing after completion.' } },
				{ id: 'lp4hnck', description: 'Change the recurrence rule on this task', tags: ['recurring'], fields: { repeat: 'daily', note: 'Shows how rhythm can be adjusted when a task needs a different cadence.' } },
			],
		},
		{
			title: 'Track Time',
			id: OPERON_BASICS_SECTION_PARENT_IDS[8],
			icon: 'timer',
			color: 'CA8A04',
			note: 'Connects task planning with the real time spent doing the work.',
			children: [
				{ id: '46atgsk', description: 'Start the timer on this task', priority: 'B', tags: ['time-tracking'], fields: { estimate: '900', note: 'Turns an estimate into an active work session you can compare against later.' } },
				{ id: 'mms7r60', description: 'Stop the timer and review the tracked session', priority: 'B', tags: ['time-tracking'], fields: { estimate: '900', note: 'Shows how tracked time becomes useful feedback instead of just another clock running.' } },
				{ id: '6boruje', description: 'Try this task in FlowTime mode', tags: ['time-tracking'], fields: { estimate: '1500', note: 'Gives focused work a lightweight timer flow without turning the task into a separate system.' } },
			],
		},
		{
			title: 'Find And Filter Tasks',
			id: OPERON_BASICS_SECTION_PARENT_IDS[9],
			icon: 'search',
			color: '4F46E5',
			note: 'Shows how tasks remain findable after they spread across notes, filters, and project files.',
			children: [
				{ id: 'au1u1fb', description: 'Search for demo tasks in Task Finder', fields: { note: 'Builds confidence that tasks can be found from one place, even after they spread across different notes.' } },
				{ id: 'rxso54t', description: 'Open the Operon Basics Project filter', fields: { note: 'Shows how a saved filter can turn one project tree into a reusable working view.' } },
				{ id: 'eo26anb', description: 'Review this completed demo item in finished filters', completed: true, fields: { dateCompleted: today, note: 'Shows that finished work stays visible when you need review history, without cluttering active lists.' } },
			],
		},
		{
			title: 'Finish The Demo',
			id: OPERON_BASICS_SECTION_PARENT_IDS[10],
			icon: 'badge-check',
			color: '64748B',
			note: 'Closes the basics loop by checking the main views after using real task interactions.',
			children: [
				{ id: '90yeobz', description: 'Complete three demo tasks', priority: 'B', fields: { note: 'Turns the demo from reading into muscle memory by making a few real state changes.' } },
				{ id: 'gzb4dsu', description: 'Open demo tasks on the Kanban board', fields: { note: 'Connects the same tasks to a board view so status changes become easier to scan.' } },
				{ id: 'q2zbadp', description: 'Open scheduled demo tasks on the Calendar', fields: { note: 'Connects scheduled tasks to time planning so dates and timed blocks feel practical, not decorative.' } },
			],
		},
	];
}

function buildBasicsProjectContent(settings: Pick<OperonSettings, 'keyMappings'>): string {
	const now = localNow();
	const today = localToday();
	const keyMappings = settings.keyMappings;
	const sections = buildSections(today);
	const lines: string[] = [
		'---',
		yamlField('operonId', OPERON_BASICS_ROOT_ID, keyMappings),
		yamlField('status', 'Project.Planned', keyMappings),
		yamlField('priority', 'B', keyMappings),
		yamlField('dateScheduled', today, keyMappings),
		yamlField('dateDue', addDays(today, 7), keyMappings),
		yamlField('taskIcon', 'sparkles', keyMappings),
		yamlField('taskColor', '#111827', keyMappings),
		yamlField('datetimeCreated', now, keyMappings),
		yamlField('datetimeModified', now, keyMappings),
		'---',
		'',
		'# [[Operon Basics Project]]',
		'',
		'This is a working basics project for exploring Operon. Every checklist item below is a real Operon task, grouped under a parent task for each section. The whole tree belongs to this file task. For command reference, open [[Operon Command Palette]].',
		'',
	];

	for (const section of sections) {
		lines.push(`## ${section.title}`, '');
		lines.push(renderTaskLine({
			id: section.id,
			description: section.title,
			priority: 'B',
			tags: ['operon-demo-section'],
			fields: section.note ? { note: section.note } : undefined,
		}, OPERON_BASICS_ROOT_ID, section, now, keyMappings));
		for (const child of section.children) {
			lines.push(renderTaskLine(child, section.id, section, now, keyMappings, '  '));
		}
		lines.push('');
	}

	lines.push(
		'---',
		'',
		'```operon',
		`filterId: "${OPERON_BASICS_FILTER_ID}"`,
		'```',
	);

	return `${lines.join('\n')}\n`;
}

function buildSetupDays(today: string): SetupDayDefinition[] {
	const day1 = addDays(today, 1);
	const day2 = addDays(today, 2);
	const day3 = addDays(today, 3);
	const day4 = addDays(today, 4);
	const day5 = addDays(today, 5);
	const day6 = addDays(today, 6);
	const day7 = addDays(today, 7);

	return [
		{
			title: 'Day 1 - Configure Operon Foundations',
			id: OPERON_SETUP_DAY_PARENT_IDS[0],
			icon: 'settings-2',
			color: '2563eb',
			dateScheduled: day1,
			priority: 'A',
			note: 'Builds a clean foundation so every task created later uses the right language, location, and workflow.',
			children: [
				{ id: '6iadtu8', description: 'Review your Operon key mappings', priority: 'A', tags: ['settings'], fields: { dateScheduled: day1, estimate: '1800', note: 'Aligns Operon fields with the property names you want to see before tasks begin spreading across notes.' } },
				{ id: 'j0wllky', description: 'Choose the priority levels you will actually use', priority: 'A', tags: ['settings'], fields: { dateScheduled: day1, estimate: '1800', note: 'Keeps priority meaningful so important work does not become hidden inside another crowded list.' } },
				{ id: 'zn8m4ng', description: 'Review your project workflow pipeline', priority: 'A', tags: ['settings'], fields: { dateScheduled: day1, estimate: '2400', note: 'Makes statuses match the way you think about work from planning through active work and completion.' } },
				{ id: 'ta21a77', description: 'Set where new inline tasks should be created', priority: 'B', tags: ['settings'], fields: { dateScheduled: day1, estimate: '1200', note: 'Gives quick tasks a predictable home so small commitments do not scatter across random notes.' } },
				{ id: 'gc9gfty', description: 'Set where new file tasks should be created', priority: 'B', tags: ['settings'], fields: { dateScheduled: day1, estimate: '1200', note: 'Gives larger outcomes a stable folder before they become full working notes with context and subtasks.' } },
				{ id: 'em0p2lt', description: 'Decide which task fields should stay visible', priority: 'B', tags: ['settings'], fields: { dateScheduled: day1, estimate: '1800', note: 'Keeps task surfaces readable while preserving the metadata that actually helps you decide what to do.' } },
			],
		},
		{
			title: 'Day 2 - Build Core Filters',
			id: OPERON_SETUP_DAY_PARENT_IDS[1],
			icon: 'funnel',
			color: '7c3aed',
			dateScheduled: day2,
			priority: 'A',
			note: 'Creates reusable views before Calendar and Kanban work so the user knows which tasks matter first.',
			children: [
				{ id: '3ffnwip', description: 'Create a daily focus filter', priority: 'A', tags: ['filters'], fields: { dateScheduled: day2, estimate: '2400', note: 'Shows only the work that matters today and reduces dashboard noise before the day begins.' } },
				{ id: 'idzw9r2', description: 'Create a weekly planning filter', priority: 'A', tags: ['filters'], fields: { dateScheduled: day2, estimate: '2400', note: 'Gives a practical view for deciding what can realistically fit inside the current week.' } },
				{ id: 'jicdgin', description: 'Create an overdue review filter for the last 3 or 7 days', priority: 'A', tags: ['filters'], fields: { dateScheduled: day2, estimate: '1800', note: 'Catches slipped commitments before they disappear into old notes or become silent backlog.' } },
				{ id: 'm2gi815', description: 'Create an active projects filter', priority: 'B', tags: ['filters'], fields: { dateScheduled: day2, estimate: '1800', note: 'Makes ongoing project work visible without manually browsing folders or remembering every note path.' } },
				{ id: 'd5qyfon', description: 'Create a high-priority open tasks filter', priority: 'B', tags: ['filters'], fields: { dateScheduled: day2, estimate: '1800', note: 'Helps important unfinished work surface before it becomes buried under easier tasks.' } },
				{ id: 'nqmmi1b', description: 'Advanced - create an Eisenhower matrix filter with contexts or tags', priority: 'C', tags: ['filters', 'advanced'], fields: { dateScheduled: day2, estimate: '2700', note: 'Separates urgent, important, delegated, and low-value work so attention follows decision quality instead of list order.' } },
			],
		},
		{
			title: 'Day 3 - Connect Projects To Work',
			id: OPERON_SETUP_DAY_PARENT_IDS[2],
			icon: 'folder-tree',
			color: '0f766e',
			dateScheduled: day3,
			priority: 'B',
			note: 'Turns loose actions into project-aware work that can be found, filtered, and reviewed in context.',
			children: [
				{ id: 'sxawf2x', description: 'Identify one active outcome that deserves a project file task', priority: 'A', tags: ['projects'], fields: { dateScheduled: day3, estimate: '1800', note: 'Helps distinguish a real project from a small action so larger work gets enough context.' } },
				{ id: 'saeaded', description: 'Create a project file task for that outcome', priority: 'A', tags: ['projects'], fields: { dateScheduled: day3, estimate: '2400', note: 'Gives the outcome a dedicated note where decisions, context, and child tasks can live together.' } },
				{ id: 'bdezwyz', description: 'Add project-specific tasks under that project', priority: 'B', tags: ['projects'], fields: { dateScheduled: day3, estimate: '2700', note: 'Keeps related actions connected to the outcome they support instead of scattering them through the vault.' } },
				{ id: '2y0zajg', description: 'Practice finding existing work with Task Finder', priority: 'B', tags: ['task-finder'], fields: { dateScheduled: day3, estimate: '1800', note: 'Builds confidence that any task can be found quickly without remembering where it was written.' } },
				{ id: 'g80q0jb', description: 'Create a project filter for the active outcome', priority: 'B', tags: ['filters'], fields: { dateScheduled: day3, estimate: '1800', note: 'Gives the project its own reusable command center instead of relying on one global task list.' } },
				{ id: 'e8n9syy', description: 'Embed the project filter inside the project note', priority: 'C', tags: ['filters'], fields: { dateScheduled: day3, estimate: '1200', note: 'Lets a project note become both the source of context and a live view of the work it owns.' } },
			],
		},
		{
			title: 'Day 4 - Plan Work Across Time',
			id: OPERON_SETUP_DAY_PARENT_IDS[3],
			icon: 'calendar-days',
			color: 'ea580c',
			dateScheduled: day4,
			priority: 'A',
			note: 'Turns filtered work into a realistic weekly plan without filling the Calendar with vague intentions.',
			children: [
				{ id: 'p2aiva9', description: 'Have you checked your pinned focus tasks today', priority: 'A', tags: ['pinned'], fields: { dateScheduled: day4, estimate: '900', note: 'Keeps the few tasks that deserve attention visible while you move through notes, filters, and planning views.' } },
				{ id: 'sxt6flq', description: 'Choose which tasks deserve calendar time this week', priority: 'A', tags: ['calendar'], fields: { dateScheduled: day4, estimate: '1800', note: 'Protects the Calendar from clutter by scheduling only the work that benefits from time commitment.' } },
				{ id: '4eyp4he', description: 'Reserve focus blocks for the highest-value tasks', priority: 'A', tags: ['calendar'], fields: { dateScheduled: day4, datetimeStart: `${day4}T09:00:00`, datetimeEnd: `${day4}T10:30:00`, estimate: '5400', note: 'Turns important work into protected time instead of letting it compete with a loose list.' } },
				{ id: 'upbc24k', description: 'Review unscheduled work after planning the week', priority: 'B', tags: ['calendar'], fields: { dateScheduled: day4, estimate: '1800', note: 'Keeps lower-priority work visible without forcing every task onto the Calendar.' } },
				{ id: 's23wbms', description: 'Adjust the weekly plan after seeing available capacity', priority: 'B', tags: ['calendar'], fields: { dateScheduled: day4, estimate: '1800', note: 'Helps you plan realistically instead of overcommitting and carrying silent failure into the next day.' } },
			],
		},
		{
			title: 'Day 5 - Operate From Kanban',
			id: OPERON_SETUP_DAY_PARENT_IDS[4],
			icon: 'columns-3',
			color: 'db2777',
			dateScheduled: day5,
			priority: 'B',
			note: 'Turns project work into a board that shows movement, friction, and decisions across the week.',
			children: [
				{ id: 'crrlnxx', description: 'Create a Kanban view for active project work', priority: 'B', tags: ['kanban'], fields: { dateScheduled: day5, estimate: '2400', note: 'Shows how work moves through statuses across the vault without requiring a separate board system.' } },
				{ id: 'odzx6bd', description: 'Review active paused and blocked work separately', priority: 'A', tags: ['kanban'], fields: { dateScheduled: day5, estimate: '1800', note: 'Makes stalled work easier to notice before it quietly becomes forgotten work.' } },
				{ id: 'vk5l5zm', description: 'Use statuses to keep project state honest', priority: 'B', tags: ['kanban'], fields: { dateScheduled: day5, estimate: '1800', note: 'Keeps filters, Kanban, Calendar, and project progress aligned around the same source of truth.' } },
				{ id: 'e7rr9vp', description: 'Decide what should move forward before the week ends', priority: 'B', tags: ['kanban'], fields: { dateScheduled: day5, estimate: '1800', note: 'Turns the board into a planning surface where the next useful action becomes clear.' } },
			],
		},
		{
			title: 'Day 6 - Add Rhythm',
			id: OPERON_SETUP_DAY_PARENT_IDS[5],
			icon: 'repeat-2',
			color: '0891b2',
			dateScheduled: day6,
			priority: 'B',
			note: 'Converts one-time setup work into repeatable maintenance habits that keep the system useful.',
			children: [
				{ id: '7gcfkdi', description: 'Create a recurring weekly review task', priority: 'A', tags: ['recurring'], fields: { dateScheduled: day6, estimate: '1800', repeat: 'weekly', note: 'Makes system maintenance repeatable so the vault does not depend on memory or motivation.' } },
				{ id: 'uzjjm1e', description: 'Create a recurring inbox cleanup task', priority: 'B', tags: ['recurring'], fields: { dateScheduled: day6, estimate: '1200', repeat: 'weekly', note: 'Keeps capture surfaces from becoming a second forgotten backlog.' } },
				{ id: 'ljoz60i', description: 'Review tasks missing priority, date, or parent', priority: 'B', tags: ['review'], fields: { dateScheduled: day6, estimate: '1800', note: 'Improves task quality so filters, Calendar, and project views stay useful over time.' } },
				{ id: 'ltqfqus', description: 'Capture follow-up work from this setup project', priority: 'B', tags: ['review'], fields: { dateScheduled: day6, estimate: '1800', note: 'Prevents setup insights from disappearing after the first pass and turns them into next actions.' } },
			],
		},
		{
			title: 'Day 7 - Review The System',
			id: OPERON_SETUP_DAY_PARENT_IDS[6],
			icon: 'badge-check',
			color: '64748b',
			dateScheduled: day7,
			priority: 'B',
			note: 'Closes the adaptation week by turning what worked into a simple operating rhythm for the next week.',
			children: [
				{ id: 'hoxds0s', description: 'Review what changed in the vault this week', priority: 'A', tags: ['review'], fields: { dateScheduled: day7, estimate: '1800', note: 'Makes the value of the Operon setup visible as a concrete before and after instead of an abstract system tweak.' } },
				{ id: '8ivau6r', description: 'Move unfinished setup work into next week', priority: 'B', tags: ['review'], fields: { dateScheduled: day7, estimate: '1200', note: 'Keeps momentum without pretending every part of the system must be finished immediately.' } },
				{ id: 'pefj40h', description: 'Cancel or archive setup tasks that no longer matter', priority: 'C', tags: ['review'], fields: { dateScheduled: day7, estimate: '1200', note: 'Protects the system from stale commitments before the demo project becomes clutter.' } },
				{ id: 'ntn044n', description: 'Write a short weekly operating rhythm', priority: 'B', tags: ['review'], fields: { dateScheduled: day7, estimate: '1800', note: 'Turns the first-week setup into a repeatable personal workflow that can survive normal busy weeks.' } },
				{ id: 'vr079k6', description: 'Celebrate your first Operon-powered week', priority: 'C', tags: ['review'], fields: { dateScheduled: day7, estimate: '600', note: 'You gave your existing workflow a new layer of structure and visibility. That deserves coffee, cake, a tiny dance, or at least a very smug checkbox.' } },
			],
		},
	];
}

function buildSetupVaultProjectContent(settings: Pick<OperonSettings, 'keyMappings'>): string {
	const now = localNow();
	const today = localToday();
	const startDate = addDays(today, 1);
	const endDate = addDays(today, 7);
	const keyMappings = settings.keyMappings;
	const days = buildSetupDays(today);
	const lines: string[] = [
		'---',
		yamlField('operonId', OPERON_SETUP_ROOT_ID, keyMappings),
		yamlField('status', 'Project.Planned', keyMappings),
		yamlField('priority', 'A', keyMappings),
		yamlField('dateScheduled', startDate, keyMappings),
		yamlField('dateDue', endDate, keyMappings),
		yamlField('taskIcon', 'vault', keyMappings),
		yamlField('taskColor', '#0f766e', keyMappings),
		yamlField('note', 'A one week realistic adaptation project for shaping an Obsidian vault around Operon workflows', keyMappings),
		yamlField('datetimeCreated', now, keyMappings),
		yamlField('datetimeModified', now, keyMappings),
		'---',
		'',
		'# [[Set Up Your Obsidian Vault with Operon]]',
		'',
		'This demo project is a realistic first-week adaptation path for a user who wants to make Operon part of their Obsidian workflow. The task names describe the work to do. Each task note describes the practical gain from doing it.',
		'',
	];

	for (const day of days) {
		lines.push(`## ${day.title}`, '');
		lines.push(renderTaskLine({
			id: day.id,
			description: day.title,
			priority: day.priority,
			tags: ['vault-setup'],
			fields: {
				dateScheduled: day.dateScheduled,
				note: day.note,
			},
		}, OPERON_SETUP_ROOT_ID, day, now, keyMappings));
		for (const child of day.children) {
			lines.push(renderTaskLine(child, day.id, day, now, keyMappings));
		}
		lines.push('');
	}

	lines.push(
		'---',
		'',
		'```operon',
		`filterId: "${OPERON_SETUP_FILTER_ID}"`,
		'```',
	);

	return `${lines.join('\n')}\n`;
}

function buildCommandPaletteContent(): string {
	const lines: string[] = [
		'# [[Operon Command Palette]]',
		'',
		"This note is a quick reference for Operon commands available from Obsidian's Command Palette. Use it as a companion to [[Operon Basics Project]] when learning the plugin.",
		'',
		'Some Operon commands are context-aware. The same command can behave differently depending on where you run it: selected text, an empty line, an inline task, a normal note, a file task, or a task view.',
		'',
		'## Task Creation',
		'',
		'### Create New Operon Task',
		'',
		'Opens the full task creator. This is the safest starting point when you want Operon to guide you through creating a task.',
		'',
		'Useful when:',
		'- You do not want to write task syntax by hand.',
		'- You want to create a task from anywhere, not only at the cursor.',
		'- You want to choose fields such as status, priority, dates, parent task, estimate, recurrence, or links.',
		'',
		'### Create or edit inline task',
		'',
		'This command can do different things depending on your current cursor position, selected text, or task line. Use it when you want Operon to understand the note context for you.',
		'',
		'Possible usages:',
		'- Use it on selected text to turn that text into a new inline task.',
		'- Use it on an existing Operon task to open that task in the Task Editor.',
		'- Use it on a normal Markdown checkbox to upgrade it into an Operon task.',
		'- Use it on a normal text line to convert that line into an Operon task.',
		'- Use it on an empty line to create a new blank Operon task.',
		'',
		'### Create file task',
		'',
		'Creates a task that lives as its own note. The command can start from a normal context, selected text, or an existing inline task.',
		'',
		'Possible usages:',
		'- Use it on an inline task to turn that task into its own note.',
		'- Use it with selected text to start the new file task from that text.',
		'- Use it with no special cursor context to open the file task template picker.',
		'',
		'## Task Editing And Conversion',
		'',
		'### Edit or convert to file task',
		'',
		'Works on the note you currently have open. It can either edit an existing file task or convert a normal note into one.',
		'',
		'Possible usages:',
		'- Use it in an existing Operon file task to open the Task Editor.',
		'- Use it in a note that already has Operon task fields at the top to edit those fields.',
		'- Use it in a normal note to convert that note into an Operon file task.',
		'',
		'### Convert file task to inline task',
		'',
		'Moves a file task back into inline task form. The insertion target can depend on where your cursor is and your default inline task settings.',
		'',
		'Possible usages:',
		'- Use it to choose a file task from Task Finder and convert it into an inline task.',
		'- Use it with a clear cursor target to place the new inline task at that location.',
		'- Use it without a good cursor target to send the inline task to your default inline task location.',
		'- Use it when you are ready to move the old file task to trash after confirmation.',
		'',
		'### Convert Tasks emoji line to inline task',
		'',
		'Converts a task written in the Obsidian Tasks plugin emoji format into an Operon inline task.',
		'',
		'Useful when:',
		'- You are migrating old Tasks-plugin tasks.',
		'- You have lines with due, scheduled, priority, or recurrence emoji metadata.',
		'- You want scheduled, completed, and cancelled dates to use your configured workflow statuses.',
		'- You want Operon fields instead of Tasks emoji syntax.',
		'',
		'### Convert Selection to Operon Tasks',
		'',
		'Converts selected Markdown list items into Operon inline tasks. It supports checkbox lines, Tasks emoji lines, bullet items, and numbered items.',
		'',
		'When the selection contains an indented list, Operon preserves that outline as a real task tree. Each converted indented item is linked to the nearest converted or existing Operon task above it at a lower indentation level, so nested list items become child tasks instead of a flat list.',
		'',
		'Useful when:',
		'- You want to migrate a checklist or outline in one command.',
		'- You want selected indentation to become Operon parent-child task links.',
		'- You want supported Tasks emoji metadata to become Operon fields, including scheduled, completed, and cancelled dates using your configured workflow statuses.',
		'- You want unsupported lines skipped instead of guessed.',
		'',
		'## Finding And Moving Tasks',
		'',
		'### Task Finder',
		'',
		'Opens the task search and selection interface. Use it to quickly find tasks across the vault.',
		'',
		'Useful when:',
		'- You remember the task text but not the file.',
		'- You want to inspect a task without browsing folders.',
		'- You want to use task actions from a central search surface.',
		'',
		'### Move an inline task here',
		'',
		'Moves an existing inline task to the current cursor line. It uses Task Finder to choose the source task, then uses your current note position as the destination.',
		'',
		'Possible usages:',
		'- Use it on an empty line where you want the task to appear.',
		'- Use Task Finder to choose the inline task you want to move.',
		'- Use it to reorganize inline tasks without manually cutting and pasting task metadata.',
		'',
		'## Task State And Time',
		'',
		'### Toggle task completion',
		'',
		'Toggles the task at the cursor between open and done. The exact update depends on whether Operon can fully recognize the task from the current view or only from the current line.',
		'',
		'Possible usages:',
		'- Use it on a normal Operon task to complete or reopen it through your workflow.',
		'- Use it on a readable inline task line to update the checkbox and completion date directly.',
		'',
		'### Start/stop time tracker',
		'',
		'Starts or stops the timer for the task at the cursor. It changes behavior based on whether that task is already being tracked.',
		'',
		'Possible usages:',
		'- Use it on an untracked Operon task to start a timer.',
		'- Use it on the active tracked task to stop the timer.',
		'- Use it on another Operon task when you want to switch tracked work through the command flow.',
		'',
		'## Views',
		'',
		'### Operon Filter View',
		'',
		'Opens the default Operon filter view. Use this for filtered task lists and saved filter sets.',
		'',
		'### Operon Calendar',
		'',
		'Opens the Calendar view. Use this for scheduled tasks, due markers, timed blocks, recurrence projections, and calendar planning.',
		'',
		'### Operon Kanban',
		'',
		'Opens the Kanban view. Use this for moving tasks through workflow statuses and swimlanes.',
		'',
		'### Toggle Pinned Tasks dock',
		'',
		'Shows or hides the floating pinned task dock.',
		'',
		'### Open Time Session History panel',
		'',
		'Opens the time session history panel. Use it to review and edit tracked work sessions.',
		'',
		'### Open FlowTime panel',
		'',
		'Opens the FlowTime panel for focused work sessions.',
		'',
		'## Maintenance',
		'',
		'### Rebuild full index',
		'',
		'Runs a full Operon task index rebuild across the vault.',
		'',
		'Use this when:',
		'- Tasks are not appearing where expected.',
		'- A file was edited outside Obsidian.',
		'- You suspect the task index is stale.',
		'',
		'### Show index stats',
		'',
		'Shows a quick notice with task index counts, including total tasks, open tasks, due-today tasks, and overdue tasks.',
		'',
		'### Open duplicate operonId manager',
		'',
		'Opens the duplicate `operonId` manager. Use this when Operon detects multiple tasks sharing the same id.',
		'',
		'### Update External Calendars',
		'',
		'Refreshes configured external calendar sources.',
		'',
		'Use this when:',
		'- External calendar events are stale.',
		'- You added or edited an external calendar source.',
		'- You want to force a calendar sync before planning.',
	];
	return `${lines.join('\n')}\n`;
}

function buildProjectFilterSet(
	filterId: string,
	name: string,
	rootId: string,
	groupId: string,
	conditionId: string,
): FilterSet {
	return {
		id: filterId,
		name,
		icon: 'lucide-git-pull-request-closed',
		rootGroup: {
			id: groupId,
			logic: 'all',
			children: [
				{
					id: conditionId,
					field: 'operonId',
					fieldType: 'text',
					operator: 'is',
					value: rootId,
				},
			],
		},
		sorts: [{ field: 'priority', order: 'asc' }],
		matchLogic: 'all',
		conditions: [
			{
				id: conditionId,
				field: 'operonId',
				fieldType: 'text',
				operator: 'is',
				value: rootId,
			},
		],
		sortBy: 'priority',
		sortOrder: 'asc',
	};
}

export function buildBasicsFilterSet(): FilterSet {
	return buildProjectFilterSet(
		OPERON_BASICS_FILTER_ID,
		'Operon Basics Project',
		OPERON_BASICS_ROOT_ID,
		'fg_j5ln18ve',
		'cond_7e4d9z5s',
	);
}

export function buildSetupVaultFilterSet(): FilterSet {
	return buildProjectFilterSet(
		OPERON_SETUP_FILTER_ID,
		'Set Up Your Obsidian Vault with Operon',
		OPERON_SETUP_ROOT_ID,
		OPERON_SETUP_FILTER_GROUP_ID,
		OPERON_SETUP_FILTER_CONDITION_ID,
	);
}

async function ensureFolderPath(app: App, filePath: string): Promise<void> {
	const folderPath = filePath.split('/').slice(0, -1).join('/');
	if (!folderPath) return;

	let currentPath = '';
	for (const segment of folderPath.split('/')) {
		currentPath = currentPath ? `${currentPath}/${segment}` : segment;
		if (!(await app.vault.adapter.exists(currentPath))) {
			await app.vault.createFolder(currentPath);
		}
	}
}

function findExistingFileByPath(app: App, filePaths: readonly string[]): TFile | null {
	for (const filePath of filePaths) {
		const existing = app.vault.getAbstractFileByPath(normalizePath(filePath));
		if (existing instanceof TFile) return existing;
	}
	return null;
}

async function createFileIfMissing(
	app: App,
	filePath: string,
	content: string,
	legacyFilePaths: readonly string[] = [],
): Promise<{ file: TFile; created: boolean }> {
	const normalizedPath = normalizePath(filePath);
	const existing = app.vault.getAbstractFileByPath(normalizedPath);

	if (existing instanceof TFile) {
		return { file: existing, created: false };
	}
	if (existing) {
		throw new Error(`Operon demo workspace path is not a file: ${normalizedPath}`);
	}

	const legacyFile = findExistingFileByPath(app, legacyFilePaths);
	if (legacyFile) {
		return { file: legacyFile, created: false };
	}

	await ensureFolderPath(app, normalizedPath);
	return {
		file: await app.vault.create(normalizedPath, content),
		created: true,
	};
}

async function ensureBundledFilter(
	store: BasicsWorkspaceStore,
	filterId: string,
	buildFilterSet: () => FilterSet,
): Promise<{ created: boolean; repaired: boolean }> {
	const inStore = store.filters.getById(filterId);
	if (inStore) {
		return { created: false, repaired: false };
	}

	await store.filters.upsert(buildFilterSet());
	return { created: true, repaired: false };
}

async function ensureBasicsFilter(store: BasicsWorkspaceStore): Promise<{ created: boolean; repaired: boolean }> {
	return ensureBundledFilter(store, OPERON_BASICS_FILTER_ID, buildBasicsFilterSet);
}

async function ensureSetupVaultFilter(store: BasicsWorkspaceStore): Promise<{ created: boolean; repaired: boolean }> {
	return ensureBundledFilter(store, OPERON_SETUP_FILTER_ID, buildSetupVaultFilterSet);
}

export async function hasBasicsWorkspaceArtifact(app: App, store: BasicsWorkspaceStore): Promise<boolean> {
	if (findExistingFileByPath(app, OPERON_DEMO_WORKSPACE_ARTIFACT_PATHS)) return true;
	if (store.filters.getById(OPERON_BASICS_FILTER_ID)) return true;
	return false;
}

export async function createOrRepairBasicsWorkspace(
	app: App,
	store: BasicsWorkspaceStore,
	settings: Pick<OperonSettings, 'keyMappings'>,
): Promise<BasicsWorkspaceResult> {
	const basicsProject = await createFileIfMissing(
		app,
		OPERON_BASICS_PROJECT_PATH,
		buildBasicsProjectContent(settings),
		LEGACY_OPERON_BASICS_PROJECT_PATHS,
	);
	const commandPalette = await createFileIfMissing(
		app,
		OPERON_COMMAND_PALETTE_PATH,
		buildCommandPaletteContent(),
		LEGACY_OPERON_COMMAND_PALETTE_PATHS,
	);
	const setupProject = await createFileIfMissing(
		app,
		OPERON_SETUP_PROJECT_PATH,
		buildSetupVaultProjectContent(settings),
		LEGACY_OPERON_SETUP_PROJECT_PATHS,
	);

	const filterResult = await ensureBasicsFilter(store);
	const setupFilterResult = await ensureSetupVaultFilter(store);
	return {
		file: basicsProject.file,
		fileCreated: basicsProject.created,
		commandPaletteFile: commandPalette.file,
		commandPaletteFileCreated: commandPalette.created,
		setupProjectFile: setupProject.file,
		setupProjectFileCreated: setupProject.created,
		filterCreated: filterResult.created,
		filterRepaired: filterResult.repaired,
		setupFilterCreated: setupFilterResult.created,
		setupFilterRepaired: setupFilterResult.repaired,
	};
}
