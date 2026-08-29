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
	{
		version: '3.5.1',
		date: '2026-08-22',
		title: 'Operon 3.5.1 - Resilient Table Recovery',
		showOnUpdate: true,
		body: `
### Fixed
- Operon now continues loading when a legacy, missing, invalid, or conflicting Table configuration is found; Settings and non-Table workflows remain available.
- Duplicate Table IDs are repaired automatically by keeping the most recently modified valid file on the original ID and preserving every other valid file as an independent Table.
- Table configurations that cannot be repaired safely remain untouched and isolated for review instead of disabling Operon.
`.trim(),
	},
	{
		version: '3.5.0',
		date: '2026-08-21',
		title: 'Operon 3.5.0 - Task Router, Daily and Weekly Notes, and Task Images',
		showOnUpdate: true,
		bannerUrl: 'operon-3-5-0-kanban-task-images.png',
		body: `
### New
- Added a dedicated **Task Router** Settings area with configurable Inline Task destinations, heading placement, parent-aware routing, default and pipeline-specific File Task folders, delayed pipeline movement, pipeline-specific archives, and fallback routing.
- Added Operon-managed **Daily and Weekly Notes** with configurable formats, folders, templates, and task headings. Missing notes can be created from templates, eligible Operon containers establish parent-child relationships, existing plain Markdown notes remain unadopted, and scheduled-date changes realign periodic parents without physically moving the task.
- Added sealed **Daily and Weekly Note Runtime workflows** for safe preview, apply, replay, and recovery through Runtime V1 and the Developer API.
- Added the canonical **Task Type** field across task creation, editing, compact task surfaces, filters, Task Wikilink Overlay, Operon Tables, and Runtime V1.
- Added canonical **Task Image** and **Task Gallery** fields with vault paths, wikilinks, embeds, and HTTP/HTTPS references. Kanban presets can display Task Image or the first or last gallery item above each card.
- Added the read-only Table field **Task Data Type** for distinguishing Inline and File Tasks while keeping it separate from the user-controlled Task Type field.

### Improved
- Improved **New Operon Task** with Live Preview-style Markdown editing for Task Description and Additional Task Notes, including multiline notes with Shift+Enter.
- Improved **Kanban swimlane labels** with centered expanded titles, counts below the title, nested-tag wrapping, and consistent collapsed truncation.

### Changed
- Enabled **Blocking** and **Blocked By** Workflow Pickers by default for new installations while preserving existing users’ saved visibility choices.

### Fixed
- Fixed deleted Table preset files or folders leaving stale **Missing file** entries in Settings.
- Fixed **New Operon Task** template results repeating their information beneath every template name.

### New Docs
- [[DOCS-136 Task Router|Task Router]]
- [[DOCS-137 Daily and Weekly Notes|Daily and Weekly Notes]]
- [[DOCS-138 Task images and galleries|Task images and galleries]]

### Updated Docs
- [[DOCS-012 Inline task syntax|Inline task syntax]]
- [[DOCS-030 Kanban overview|Kanban overview]]
- [[DOCS-050 Daily Notes workflows|Daily Notes workflows]]
- [[DOCS-125 CLI contract and discovery reference|CLI contract and discovery reference]]
- [[DOCS-131 Developer API reads and typed mutations|Developer API reads and typed mutations]]
- And 28 more updated docs.
`.trim(),
	},
	{
		version: '3.4.0',
		date: '2026-08-18',
		title: 'Operon 3.4.0 - Flexible Tables, Task Notes, and Developer Adoption',
		showOnUpdate: true,
		bannerUrl: 'operon-3-4-0-tasknote-multiline-support.png',
		body: `
### New
- Added Brazilian Portuguese (\`pt-BR\`) localization, including a dedicated fail-closed natural-language date parser and downloadable locale pack.
- Added a configurable **default folder for new Operon Table files**, while preserving existing Table locations and allowing the vault root to be selected.
- Added a **default width for embedded Tables**, with 50%–250% choices and explicit \`width:\` values continuing to override the global setting.
- Added **multiline Task Notes editing** in Task Editor and the shared Notes pop-over: Shift+Enter inserts line breaks while inline tasks remain stored on one physical Markdown line.
- Added an opt-in **FlowTime completion sound** that uses the configured Reminder sound when a focus session or break reaches zero.
- Added the **Task Adoption Developer API** for companion plugins, with exact capability grants, opaque session-bound plans, durable same-plan recovery, and the existing fail-closed Runtime adoption path.

### Fixed
- Fixed incompatible legacy Table preset sidecar authority blocking startup when no usable \`.table\` file exists.
- Fixed \`dateStarted\`-only recurring tasks disappearing from the Calendar's All Day row when their materialized occurrence suppressed the corresponding projected occurrence.
- Fixed recurring task transitions being reported as successful before a unique open successor was verified in the index, preventing intermittent loss of timed Calendar recurrences after completion.
- Fixed identity-placeholder **File Task** apply stopping before its first source write because creation journals used invalid timestamp ordering.

### Updated Docs
- [[DOCS-007 Install and enable Operon|Install and enable Operon]]
- [[DOCS-012 Inline task syntax|Inline task syntax]]
- [[DOCS-021 Task Editor|Task Editor]]
- [[DOCS-035 FlowTime focus sessions|FlowTime focus sessions]]
- [[DOCS-046 Plugin data and state files|Plugin data and state files]]
- And 12 more updated docs.
`.trim(),
	}
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
