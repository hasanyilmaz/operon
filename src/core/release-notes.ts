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
	{
		version: '3.6.0',
		date: '2026-08-29',
		title: 'Operon 3.6.0 - Gantt Planning, Task Trees, and Smoother Kanban',
		showOnUpdate: true,
		bannerUrl: 'operon-3-6-0-gantt-view.png',
		body: `
### New
- Added a complete **Gantt view for Operon Tables**, with Day–Week and Week–Month timelines, scheduling and resizing, dependency connections, linked-task creation, descendant movement, and stable virtualized scrolling.
- Added the **Task Tree** column for expandable parent-child hierarchies in workspace and embedded Tables.
- Added the opt-in **Automatically expand parent task date range** automation.

### Improved
- Improved **Kanban card movement and rendering** so affected cards and cells settle in place without rebuilding or blinking the board.
- Improved **Calendar hidden-time controls** with native 30-minute dropdowns.
- Improved desktop **Table scrolling** and standardized Table column-header alignment.

### Fixed
- Fixed intermittent **Kanban moves**, viewport shifts, custom-list swimlane transitions, recurrence settlement, and manual-order failures.
- Fixed Task Editor deletion leaving stale **parentTask**, **Blocking**, or **Blocked By** references.
- Fixed Table search and Group/Sort focus loss, unwanted **Default table.table** recreation, and blocked tasks rejecting Scheduled Date planning.

### New Docs
- [[DOCS-139 Gantt view|Gantt view]]

### Updated Docs
- [[DOCS-105 Table overview|Table overview]]
- [[DOCS-016 Parent and sub-tasks|Parent and sub-tasks]]
- [[DOCS-074 Kanban swimlanes|Kanban swimlanes]]
- [[DOCS-029 Calendar presets and time grid|Calendar presets and time grid]]
- [[DOCS-056 Calendar or Kanban rendering issues|Calendar or Kanban rendering issues]]
- And 13 more updated docs.
`.trim(),
	},
	{
		version: '3.5.3',
		date: '2026-08-25',
		title: 'Operon 3.5.3 - Media Previews, Calendar Clarity, and Kanban Stability',
		showOnUpdate: true,
		bannerUrl: 'operon-3-5-3-calendar-tracked-time.png',
		body: `
### New
- Added playable **video, PDF, and YouTube previews** to Task Image and Task Gallery, with a shared near-fullscreen lightbox for every supported media type.
- Added support for **named Markdown media links**, preserving user-assigned titles on chips and preview headers.

### Improved
- Improved completed sessions in the desktop **Calendar Time Tracker Grid** with a muted appearance and color-aware dashed borders.
- Standardized media hover previews with a full-width clickable header, easier pointer movement, consistent lightbox controls, and preserved image double-click opening.

### Fixed
- Fixed **Kanban drag-and-drop on tablets and mobile devices** refreshing before the task write completed.
- Fixed task edits causing the **Kanban viewport to shift or jump between swimlanes**.
- Fixed **Inline Task to File Task conversion** using stale editor content.
- Fixed Developer API adoption and multi-source Runtime workflows affected by authorization, new-source state, relationship indexing, and supported modified-time plugins.

### Security
- Hardened same-source relationship validation so invalid or ambiguous task identities cannot gain authority through stale index records.

### Updated Docs
- [[DOCS-138 Task images and galleries|Task images and galleries]]
- [[DOCS-029 Calendar presets and time grid|Calendar presets and time grid]]
- [[DOCS-012 Inline task syntax|Inline task syntax]]
- And 4 more updated docs.
`.trim(),
	},
	{
		version: '3.5.2',
		date: '2026-08-23',
		title: 'Operon 3.5.2 - Flexible Kanban Sorting and Workflow Reliability',
		showOnUpdate: true,
		bannerUrl: 'operon-3-5-2-kanban-column-sorting.png',
		body: `
### New
- Added **Pipeline column sorting** to Kanban presets. Individual pipeline columns can now use their own Automatic or Manual sorting configuration, while columns without an override continue to use Board sorting.
- Added **Project Serial sorting** to Kanban Board and Pipeline column rules. Serial prefixes sort alphabetically, assigned numbers sort numerically, and cards without a serial follow the selected First or Last placement.
- Added a lightweight **Task Image and Task Gallery lightbox** to media hover previews. Open it by double-clicking the image or using the zoom control, then zoom, pan, and close it without leaving the current view.

### Improved
- Improved **Kanban sorting settings** with native Automatic/Manual dropdowns, A–Z and Z–A direction controls, clearer Board and Pipeline column sections, consistent alignment, stable scroll position, and removable per-column configurations.

### Changed
- Changed **Table preset storage** so valid \`.table\` files are now the single source of authority. Obsolete Settings-based presets and legacy sidecar state are no longer used.

### Fixed
- Fixed stale, missing, or legacy **Table preset references** disabling healthy Table presets, Add Table Preset, and General Table Settings.
- Fixed **Kanban drag-and-drop** intermittently failing during status and swimlane transitions.
- Fixed Kanban **Created date/time** and **Modified date/time** sorting tasks from the same day without considering their complete timestamps.
- Fixed card movement between columns with different Manual and Automatic sorting configurations.
- Fixed the **plain checkbox popover** displaying the first indented checkbox level as a code block.
- Fixed local **Task Image and Task Gallery** previews using a different frame and size from HTTP images.
- Fixed manually relocated **File Tasks** being moved back when their routing had not changed.

### Updated Docs
- [[DOCS-030 Kanban overview|Kanban overview]]
- [[DOCS-031 Kanban manual order|Kanban manual order]]
- [[DOCS-109 Table presets|Table presets]]
- [[DOCS-114 Table files|Table files]]
- [[DOCS-138 Task images and galleries|Task images and galleries]]
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
