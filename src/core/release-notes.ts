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
	{
		version: '3.6.3',
		date: '2026-09-04',
		title: 'Operon 3.6.3 - Safer Planning, Better Touch, and Clearer Dates',
		showOnUpdate: true,
		bannerUrl: 'operon-3-6-3-dateformat.png',
		body: `
### New
- Added the **Date format** setting with YYYY-MM-DD, DD/MM/YYYY, and MM/DD/YYYY options. Supported task-date surfaces now follow your selected display format without changing stored ISO values.
- Added **Create daily note** and **Create weekly note** commands, available when the corresponding Operon periodic-note management setting is enabled.
- Added drag-and-drop editing to the Calendar **Due lane**, including transfers between the Due lane and Calendar grids while preserving independent task dates.

### Improved
- Improved touch and pen dragging across desktop-layout **Kanban**, **Calendar**, and **Gantt** surfaces, with clearer separation between scrolling and dragging while preserving mouse and trackpad behavior.
- Improved the Gantt **Today** position so more of the visible timeline is reserved for upcoming work.

### Fixed
- Fixed File Task routing changes moving unrelated, manually positioned, unmatched, or unsafely configured tasks.
- Fixed completed File Tasks with an active timer not entering the normal archive queue after the timer was stopped.
- Fixed Calendar completion of recurring Inline and File Tasks losing, skipping, or duplicating the next occurrence.
- Fixed overdue \`mode=done\` recurring tasks carrying stale scheduling offsets into their next occurrence.

### Updated Docs
- [[DOCS-028 Calendar overview|Calendar overview]]
- [[DOCS-033 Recurring tasks|Recurring tasks]]
- [[DOCS-063 Date and time picker|Date and time picker]]
- [[DOCS-136 Task Router|Task Router]]
- [[DOCS-139 Gantt view|Gantt view]]
- And 16 more updated docs.
`.trim(),
	},
	{
		version: '3.6.2',
		date: '2026-09-02',
		title: 'Operon 3.6.2 - Reliable Task Editing and Smarter Gantt Planning',
		showOnUpdate: true,
		body: `
### New
- Added the **After converting an inline task** setting, allowing you to keep the File Task link or remove the original inline task from any source note.
- Added the opt-in **Move open blocked tasks with their blockers** Gantt setting for shifting downstream dependency chains by the same number of days.
- Added direct dragging for Gantt **Start**, **Scheduled**, and **Due** date icons while preserving their existing date-picker action.

### Improved
- Improved Task Editor and Kanban feedback with clearer messages for stale sources, invalid task data, unapplied changes, uncertain outcomes, and pending view refreshes.
- Improved Gantt readability with hover-only bar endpoint icons and tooltips that remain inside the visible timeline near the pointer.

### Fixed
- Fixed everyday task actions—including Mark done, Cancel, status changes, Task Editor saves, and Kanban moves—depending on Runtime readiness on desktop and mobile.
- Fixed Task Editor terminal saves writing active timer changes twice.
- Fixed Task Editor deletion failures and stale Operon-owned relationships on desktop and Android.
- Fixed direct Markdown deletions being missed during internal-write suppression, which could leave ghost tasks in Inbox and other views.
- Fixed Task Editor replacing an explicitly selected first Finish Date with the current date.
- Fixed locale-dependent Runtime resource ordering rejecting valid multi-source mutation plans.
`.trim(),
	},
	{
		version: '3.6.1',
		date: '2026-08-31',
		title: 'Operon 3.6.1 - Mobile Reliability, Better Filters, and Safer Integrations',
		showOnUpdate: true,
		body: `
### New
- Added **Open Mobile Calendar** and **Open Mobile Kanban** commands for directly opening touch-friendly layouts without changing automatic layout behavior.
- Added **Task Data Type** FilterSet conditions for matching Inline and File Tasks.
- Added **Plain Checkboxes** conditions for finding tasks whose associated Markdown checkboxes have open items, are all closed, or exist.

### Changed
- Renamed the existing **Checkbox** filter condition label to **Operon Task**, clearly separating Operon task status from Plain Checkboxes.

### Fixed
- Fixed the context-menu **Mark done** action doing nothing on mobile. Inline and File Tasks now complete correctly while preserving workflow, timer, recurrence, and parent-progress behavior.
- Fixed recoverable **Developer API grants** remaining suspended after supported audit or consumer-version changes, while stale and inconsistent approval attempts remain blocked.
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
