export interface OperonReleaseNote {
	version: string;
	date: string;
	title?: string;
	showOnUpdate?: boolean;
	bannerUrl?: boolean | string;
	youtubeUrl?: string;
	body: string;
}

const OPERON_RAW_GITHUB_BASE_URL = 'https://raw.githubusercontent.com/hasanyilmaz/operon/main';
const RELEASE_NOTE_LIMIT = 5;

export const OPERON_RELEASE_NOTES: OperonReleaseNote[] = [
	{
		version: '3.9.3',
		date: '2026-09-20',
		title: 'Operon 3.9.3 — Integration and Recurring Task Fixes',
		showOnUpdate: true,
		bannerUrl: false,
		body: `
This update restores integration controls, fixes recurring File Tasks, and makes Task Editor more comfortable in narrow windows.

### Improved

- **Task Editor** shows task controls first in narrow windows. File content opens automatically alongside them when at least 480 px is available for its panel. Unsaved text is preserved when resizing.

### Fixed

- **Developer API integrations** can once again be approved, rejected, and revoked from General settings and Settings Search. Security audit controls are also restored, with a readable layout in Obsidian 1.13 and later.
- **Recurring File Tasks** complete correctly when YAML color or icon values differ in formatting from their indexed values.
- **Task Creator** waits for fresh indexing and repeat-series registration when creating recurring File Tasks and file subtasks. Incomplete follow-up work is reported without creating the file again.
`.trim(),
	},
	{
		version: '3.9.2',
		date: '2026-09-18',
		title: 'Operon 3.9.2 — Faster Tables and Everyday Fixes',
		showOnUpdate: true,
		bannerUrl: false,
		body: `
This update restores smooth Table performance and fixes several everyday interactions across task creation, editing, Calendar, and Kanban.

### Improved

- **Tables** switch, scroll, and refresh faster, including large task collections.

### Fixed

- **Table visuals** keep unchanged Assignee photos, hovered row styling, and active-cell borders steady during task saves and timer updates.
- **Task Creator** now follows Escape behavior when its command is repeated, protecting unsaved drafts and preventing disrupted keyboard input.
- **Task Editor** immediately reflects checkbox popover saves while preserving unsaved body edits. Checkbox context menus and submenus appear above the popover.
- **Calendar Task Pool** supports dragging directly without an extra focus click.
- **Kanban** keeps the quick-add button centered in scrolled cells and closes the hover context menu when clicking a status icon moves the card to another column.
`.trim(),
	},
	{
		version: '3.9.1',
		date: '2026-09-15',
		title: 'Operon 3.9.1 — Settings Protection',
		showOnUpdate: true,
		bannerUrl: false,
		body: `
This update adds safeguards for your settings and keeps cleared parent task dates under your control.

### New

- **Automatic settings backups** preserve your existing settings before startup changes on version transitions. Operon keeps up to two backups in the background.

### Changed

- **Parent date expansion** now adjusts only dates already set on the parent. Clearing a start or due date keeps that field empty, even when automatic expansion is enabled.

### Fixed

- **Settings protection** stops saves when existing settings cannot be read reliably, have changed externally, or cannot be verified after saving.

### Removed

- **General settings** no longer show developer integration and security audit controls.
`.trim(),
	},
	{
		version: '3.9.0',
		date: '2026-09-15',
		title: 'Operon 3.9.0 — A Smoother Everyday Workflow',
		showOnUpdate: true,
		bannerUrl: 'operon-3-9-0-inline-subtask-indentation.png',
		body: `
Small improvements across task creation, planning, navigation, and everyday interactions make Operon more consistent and comfortable to use.

### New

- **Assignee images** bring person-note photos into task chips and Tables. Choose the source property in General Chip Settings; the usual icon remains when an image is unavailable.
- **Parent linking inheritance** can fill empty properties and add missing list values when linking an existing task to a parent. It is optional and off by default, and existing values stay intact.
- **Copy task wikilink** in Task Editor copies a ready-to-use link to an Inline or File Task.

### Improved

- **Inline subtasks** created beneath an inline parent now use native Markdown indentation across Live Preview, Reading View, and Source Mode. Existing tasks are not automatically reformatted.
- **Task pickers** suggest values from the most recently created task, then the most recently modified task with a different eligible value, followed by the most widely used values. This applies to Parent Task, Assignees, Tags, Contexts, Task Type, and custom list/text fields only when search is empty.
- **Links chips** open web pages in a desktop lightbox; Command/Ctrl-click opens a Web Viewer tab. Detailed Table links include icons and truncate long labels, while empty cell space still opens the picker.
- **Task chips and Tables** keep unchanged content, assignee images, and hover borders steady during saves and timer updates. This includes inline tasks, filters, and Task Wikilink Overlay Chips.
- **Calendar** keeps grids, cards, hover time indicators, and Task Pool results steady during background updates, with more consistent scrolling and touch interactions on mobile.
- **Filter controls** offer searchable filter selection in Table and Kanban, while preserving the preset’s other settings.
- **Task Editor and Reading View** have clearer time controls and more consistent action-button states. Context menus give long labels more room, and Canvas Task Pool supports arrow-key navigation and Enter selection.
- **Settings Search** finds File Tasks, Inline Tasks, and Task Router sections, including Daily and Weekly Notes. Italian translation has also been improved.

### Fixed

- The last icon-only chip in filter rows expands on hover when space is available; tooltips remain available in narrow rows.
- Kanban scrollbars stay steady when moving cards or changing task status.
- Releasing a drag inside Calendar Task Pool no longer schedules the task on a hidden grid day.
- Pasted links no longer show unrelated picker suggestions, so Enter adds the intended link and label.

### New Docs

- [[DOCS-143 How to show assignee images|How to show assignee images]]

### Updated Docs

- [[DOCS-016 Parent and sub-tasks|Parent and sub-tasks]]
- [[DOCS-021 Task Editor|Task Editor]]
- [[DOCS-041 Task chips display and behavior|Task chips display and behavior]]
- [[DOCS-062 Field pickers overview|Field pickers overview]]
- [[DOCS-112 Table cells display and behavior|Table cells display and behavior]]
- And 8 more updated guides.
`.trim(),
	},
	{
		version: '3.8.0',
		date: '2026-09-12',
		title: 'Operon 3.8.0 — Canvas and Embedded Task Cards',
		showOnUpdate: true,
		bannerUrl: 'operon-3-8-0-canvas-task-cards.png',
		body: `
Bring your tasks onto Canvas and into your notes, with smoother planning and more reliable everyday actions.

### New

- **Canvas Task Cards** bring interactive tasks to Canvas. Find work in the Canvas Task Pool, turn text cards into tasks, and build parent–child and blocking relationships independently of arrow direction. Customize card images, fields, progress, and actions while keeping each card connected to its source task.
- **Embedded Task Cards** place interactive tasks inside your notes. Copy an embed from Task Editor, choose its layout and text wrapping, and work with the same task from your project notes and dashboards.
- **Regenerate ID** helps repair incompatible Inline and File Task IDs. Tasks remain visible, and attempting an action offers ID regeneration or Cancel.

### Improved

- **Calendar** opens on local today at your configured starting hour. Once open, it keeps your working position while you switch Task Pool groups or timed layouts. Use Today whenever you want to refocus.
- **Media Lightbox** no longer shows a redundant URL tooltip when opening task images.

### Fixed

- **Calendar Task Pool and grid** stay steady during task saves and moves, without list flickering or a brief jump to midnight.
- **Due lane** drops follow your pointer and update only the Due date when you drop on the lane.
- **Mobile task actions** work reliably when completing recurring tasks, deleting tasks, converting Inline and File Tasks or plain checkboxes, and updating Gantt dependency dates.
- **Reading mode** renders inline tasks more reliably and refreshes their content as the task index becomes ready or changes.
- **Embedded filters** continue updating after document refreshes.

### New Docs

- [[DOCS-141 Canvas Task Cards|Canvas Task Cards]]
- [[DOCS-142 Embedded Task Cards|Embedded Task Cards]]

### Updated Docs

- [[DOCS-029 Calendar presets and time grid|Calendar presets and time grid]]
- [[DOCS-095 Calendar Task Pool|Calendar Task Pool]]
- [[DOCS-015 Task identity and operonId|Task identity and ID repair]]
- [[DOCS-041 Task chips display and behavior|Task chips and card controls]]
- [[DOCS-042 Contextual menu actions|Contextual menu actions]]
- And 12 more updated docs.
`.trim(),
	},
	{
		version: '3.7.0',
		date: '2026-09-08',
		title: "Operon 3.7.0 \u2014 Upcoming Tasks and Countdowns",
		showOnUpdate: true,
		bannerUrl: 'operon-3-7-0-upcoming-tasks.png',
		body: `
### New

- **Upcoming Tasks sidebar** brings Scheduled and Due tasks into daily groups, with countdowns, tracking controls, and configurable colors and contextual menus.
- **Upcoming task status bar** shows the next timed task. Click to start tracking, open the Task Editor, or jump to the task. Choose whether expired countdowns stay at zero or continue with the next task.
- **Countdown columns** bring remaining time to tables and embeds. Choose Earlier date, Scheduled, or Due, switch between compact and detailed formats, and hover for a live countdown with seconds.
- **Task icon click action** lets you follow the pipeline or cycle through Open, Finished, and Cancelled. The existing pipeline behavior remains the default.

### Improved

- **Contextual menus** stay open and update as task statuses change, preventing blinking during saves.

### New Docs

- [[DOCS-140 Upcoming Tasks|Upcoming Tasks]]

### Updated Docs

- [[DOCS-099 State Icons|Task icon behavior, icons, and colors]]
- [[DOCS-042 Contextual menu actions|Contextual menu actions]]
- [[DOCS-103 Task Wikilink Overlay|Task Wikilink Overlay]]
- [[DOCS-106 Table columns|Table columns and Countdown targets]]
- [[DOCS-112 Table cells display and behavior|Table cells, countdown formats, and tooltips]]
- And 6 more updated docs.
`.trim(),
	},

];

export function getLatestReleaseNotes(limit = RELEASE_NOTE_LIMIT): OperonReleaseNote[] {
	return OPERON_RELEASE_NOTES.slice(0, Math.max(0, limit));
}

export function getReleaseNotesForManualView(): OperonReleaseNote[] {
	return getLatestReleaseNotes();
}

export function getReleaseNotesForUpdate(lastShownVersion: string, currentVersion: string): OperonReleaseNote[] {
	if (!currentVersion) return [];
	const normalizedLastShown = lastShownVersion.trim();
	if (normalizedLastShown === currentVersion) return [];

	const candidates = OPERON_RELEASE_NOTES.filter(note =>
		compareVersions(note.version, currentVersion) <= 0
		&& note.showOnUpdate !== false);

	return candidates.slice(0, RELEASE_NOTE_LIMIT);
}

export function compareVersions(v1: string, v2: string): number {
	const parts1 = v1.split('.').map(part => Number.parseInt(part, 10));
	const parts2 = v2.split('.').map(part => Number.parseInt(part, 10));
	const length = Math.max(parts1.length, parts2.length);
	for (let i = 0; i < length; i += 1) {
		const a = Number.isFinite(parts1[i]) ? parts1[i] : 0;
		const b = Number.isFinite(parts2[i]) ? parts2[i] : 0;
		if (a > b) return 1;
		if (a < b) return -1;
	}
	return 0;
}

export function getReleaseBannerUrl(bannerUrl: boolean | string | undefined, version: string): string | null {
	if (!bannerUrl) return null;
	const rawSource = bannerUrl === true
		? `operon-${version.replace(/\./g, '-')}`
		: bannerUrl.trim();
	if (!rawSource) return null;
	if (/^https?:\/\//iu.test(rawSource)) return rawSource;
	const source = /\.[A-Za-z0-9]+$/u.test(rawSource) ? rawSource : `${rawSource}.jpg`;
	return `${OPERON_RAW_GITHUB_BASE_URL}/images/version-banners/${source}`;
}
