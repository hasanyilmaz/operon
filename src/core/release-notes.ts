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
		version: '1.2.0',
		date: '2026-06-08',
		title: 'Normal checkbox workflows and Day Picker',
		showOnUpdate: true,
		youtubeUrl: 'https://youtu.be/AOE4Z_qBspw',
		body: `
This release gives **normal markdown checkboxes** a clearer role inside Operon workflows. Lightweight checklists now show progress beside file tasks and inline tasks. The **mini editor** keeps small checklist work close without converting checkboxes into Operon tasks.

It also brings the **Operon Day Picker** into more date surfaces. Date picking should feel familiar wherever you are working in Operon.

## New
- Added the **Operon Day Picker** across date and datetime fields, so choosing dates feels the same whether you are editing a task, creating one, filtering, setting recurrence, or working directly in Live Preview, Reading View, and the Inline Task Bar.
- Added a lightweight **normal checkbox workflow** for file tasks and inline Operon tasks. Plain markdown checklists now show progress in task rows and overlays, and a small editor lets you add, review, complete, extend, pin, and save checkbox items while keeping them as ordinary markdown.

## Improved
- Improved **Date Picker** suggestions so upcoming dates are easier to reach first, typed dates do not repeat above the calendar, short entries like \`22 d\` and \`22 m\` still find useful matches, and past dates stay available when you ask for them.
- Improved **Filter rows** and **file task overlays** so Operon subtasks and plain checklist progress are easier to tell apart, with clearer chips, shorter tooltips, and per-surface **Open checkboxes** controls.

## Fixed
- Fixed **Task Finder** rows looking squeezed under themes with broad modal button styling, including Velocity.
- Fixed **Task Editor** file body chips looking uneven under themes with broad modal button styling, including Velocity.
- Fixed completed recurring task history continuing to show future projected entries in **Calendar** when there is no open task left in the series.
`.trim(),
	},
	{
		version: '1.1.7',
		date: '2026-06-06',
		title: 'Location Map support',
		showOnUpdate: true,
		youtubeUrl: 'https://youtu.be/Gq1SEPHrBmQ',
		body: `
This release makes location a real task surface in Operon. The new Map picker tab and location chip previews are powered by the **Obsidian Maps** plugin, so Maps needs to be enabled for interactive maps; Places and Manual entry remain available for storing \`lat, lng\` coordinates.

## New
- Added **Location Map** support for the canonical \`location\` task field, with \`lat, lng\` coordinate storage, Places/Map/Manual picking in Task Creator and Task Editor, **Obsidian Maps**-powered chip previews, saved place markers, light-map settings, place-note visuals, and desktop preview controls for resizing, moving, and pinning maps.
- Added a **Calendar day title action** setting, so clicking or tapping day headers can either create/open the daily note or do nothing.

## Improved
- Improved **Calendar Time Grid**, **Date Picker**, and **Filter editing** behavior around the Location Map release, keeping the surrounding planning views steadier while location-aware task workflows become available.

## Changed
- Changed the **Repeat picker** to use a Reference date for recurrence anchoring instead of treating that picker value as Scheduled Date.

## Fixed
- Fixed indented inline tasks losing their markdown indentation after updates from the **Task Editor**.
`.trim(),
	},
	{
		version: '1.1.6',
		date: '2026-06-04',
		title: 'French and German localization',
		showOnUpdate: true,
		bannerUrl: 'operon-1-1-6-localization',
		body: `
This release brings Operon into German and French, while also tightening language switching and Tasks emoji recurrence conversion so multilingual task workflows feel more native.

## New
- Added **German localization**, including explicit Settings language selection, translated UI strings, German repeat summaries, pinned task surfaces, Task Finder scopes, time tracking session terminology, filter materialization messages, and the pinned sidebar task editor label.
- Added **French localization**, including explicit Settings language selection, translated UI strings, French natural-language date parsing, Task Finder wording, time tracking session terminology, Kanban labels, and filter materialization messages.
- Added **Tasks emoji conversion** support for \`🔁 every ...\` recurrence rules, so supported recurrence syntax becomes Operon repeat fields in both single-line and selection conversion while unsupported syntax is still preserved in the leftovers note.

## Fixed
- Fixed the **Settings language selector** so changing languages saves safely without rebuilding the current Settings page into a blank screen.
- Fixed **Turkish Settings translations** so Core, Keymapping, Recurrence, Status Icons, and Task Chips use consistent Turkish wording.
- Fixed the update **release notes popup** showing only the newest unseen release; it now shows the latest five releases, matching the Settings release notes view.
`.trim(),
	},
	{
		version: '1.1.5',
		date: '2026-06-03',
		title: 'Daily Note defaults and steadier pinned tasks',
		showOnUpdate: true,
		bannerUrl: 'operon-1-1-5-daily-note-default-dates',
		body: `
This release makes Daily Note task capture smoother, gives Operon a built-in place to revisit recent updates, and makes pinned task state more reliable across old and new storage paths.

## New
- Added a **See what's new** entry at the top of **Operon Settings**, opening a recent-updates window so users can review the latest Operon improvements, fixes, banners, and videos at any time.
- Added **Daily Note defaults** for new Operon inline tasks, letting users automatically fill Start Date and/or Scheduled Date from the note date while preserving explicit task dates.

## Improved
- Improved **pinned task syncing** by storing pin state in Operon's canonical plugin data package with legacy fallback, conflict-aware merges, and automatic tombstone cleanup.

## Fixed
- Fixed pinned tasks not auto-unpinning immediately after completion in some Task Editor and status update flows.
- Fixed pinned task migration so a malformed old state file no longer blocks importing valid legacy pinned cache data.
- Fixed Reading View inline task rendering so task metadata resolves from source lines more reliably, preventing raw \`{{...}}\` fields from leaking on desktop preview in edge cases.
`.trim(),
	},
	{
		version: '1.1.4',
		date: '2026-06-02',
		title: 'Dynamic File Task Filters and link-aware planning views',
		showOnUpdate: true,
		youtubeUrl: 'https://youtu.be/Jf8bItQUaUM',
		body: `
This release makes file-task notes more useful on their own and makes planning views easier to read when tasks include links.

## New
- Added **Dynamic File Task Filter** for YAML file tasks, showing an automatic filter surface with a customizable visible name, descendant-aware search, and subtask auto-expand limit at the top or bottom of the file body in Reading View and Live Preview without writing filter blocks into notes.
- Added a **Task Editor** setting to hide source line numbers in the file body panel, so users can keep the editor cleaner when line references are not needed.

## Improved
- Improved the **Dynamic File Task Filter** settings section by removing redundant intro copy and making the first setting description carry the essential context.
- Improved **Calendar and Kanban task titles** so normal wiki-links are clickable with Page Preview support while file-task links stay visually lightweight.
- Improved the **Dynamic File Task Filter** default icon to better distinguish the automatic file-task filter from ordinary saved filters.
- Improved the filter editor icon picker so saved filters and **Dynamic File Task Filter** use the same stable icon picker modal as pipeline and priority settings.
- Improved filter editor button feedback with accent hover states for add actions and a red hover state for Cancel.
- Improved the filter editor layout with aligned name, grouping, and sort controls, and gave **Dynamic File Task Filter** a sensible default sort preset users can change.
- Improved filter search results so flat search mode respects each filter's configured sort order, including embedded and **Dynamic File Task Filter** surfaces.

## Fixed
- Fixed file task overlay progress counts lingering after the last subtask was deleted.
- Fixed file task overlay double-check markers so they only appear when the linked task itself is complete and all descendants are complete.
- Fixed Kanban preset deletion in Settings leaving an empty native settings page instead of returning to the populated Kanban settings.

## Validation
- Local validation passed \`npm run check:local\`, including strict linting, production build, release guard, and 785/785 Phase 5 regression checks.
`.trim(),
	},
	{
		version: '1.1.3',
		date: '2026-06-01',
		title: 'Custom views stay clear of LiveSync overlays',
		showOnUpdate: true,
		body: `
This release keeps Operon's custom planning surfaces usable in vaults that run Self-hosted LiveSync.

## Fixed
- Fixed remaining **Self-hosted LiveSync** status overlay interference in Operon custom views, including Kanban collapse controls and Calendar drag and drop.

## Validation
- Local validation passed \`npm run check:local\`, including strict linting, production build, release guard, and 761/761 Phase 5 regression checks.
`.trim(),
	},
	{
		version: '1.1.2',
		date: '2026-06-01',
		title: 'Mobile calendar polish and wiki-links in task rows',
		showOnUpdate: true,
		bannerUrl: 'operon-1-1-2-wikilinks-in-kanban',
		body: `
This release tightens mobile Calendar layout behavior and makes **wiki-links** inside task titles behave like links instead of plain text.

## New
- Added a mobile Calendar Day and 3 Days all-day collapse button, so phone users can temporarily give the time grid more room without changing Calendar settings.

## Fixed
- Fixed mobile Calendar Day and 3 Days views stopping short of the bottom of the panel by sharing the Agenda layout's bottom clearance behavior.
- Fixed Operon custom views being disrupted by **Self-hosted LiveSync**'s in-editor status overlay while keeping LiveSync sync behavior unchanged.
- Fixed the Task Editor **status picker** becoming unavailable after changing the status once.
- Fixed **wiki-links** in Filter view task titles rendering as plain text instead of Obsidian links with Page Preview support.
- Fixed file-task **wiki-link** overlays in Filter views and task rows so overlay chips, quick actions, status-colored icons, and escaped/code/embed-style wiki-links behave consistently.

## Validation
- Local validation passed \`npm run check:local\`, including strict linting, production build, release guard, and 759/759 Phase 5 regression checks.
`.trim(),
	},
	{
		version: '1.1.1',
		date: '2026-05-31',
		title: 'Blocked tasks and searchable settings',
		showOnUpdate: true,
		bannerUrl: 'operon-1-1-1-blocked-tasks',
		body: `
This release makes blocked dependencies easier to understand and brings Operon settings into Obsidian's searchable Settings experience.

## New
- Added a **blocked-task dialog** for dependency-blocked tasks, showing why a status change was prevented and offering quick actions for blocker tasks.
- Added **Obsidian 1.13 Settings Search** support for Operon settings while preserving the existing settings UI on older Obsidian versions.

## Improved
- Improved **dependency handling** so \`blocking\` and \`blockedBy\` stay synchronized, reject invalid self-links or cycles, repair missing inverse links after indexing, and appear consistently in chips, filters, Task Finder, file task overlays, and the mobile Task Editor.
- Improved Operon's **settings experience** with searchable native Settings pages, modal icon pickers, grouped sections, clearer wording, and consistent input styling across complex settings pages.
- Improved plugin storage handling by moving canonical settings, state, runtime, and cache data into Obsidian's plugin configuration area, with safer \`data.json\` reloads, legacy fallback, and manual \`.operon\` cleanup.
- Improved Calendar and Kanban preset editors with Save and Cancel actions, so draft changes can be reviewed or discarded consistently before updating views.
- Improved mobile Calendar Day and 3 Days empty-slot taps so they open the slot action dialog instead of jumping straight into Task Creator, matching desktop behavior and allowing task assignment or tracked-session creation first.
- Improved status and state icon controls with a more compact State Icons fallback dropdown and easier-to-scan status picker spacing.

## Changed
- Moved Operon's canonical plugin data from the legacy vault-root \`.operon\` folder into Obsidian's plugin configuration storage, leaving \`.operon\` as a read-only migration fallback.

## Fixed
- Fixed **dependency blocking** so active \`blockedBy\` predecessors prevent completion and workflow status changes from status cycling, checkbox completion, Task Editor saves, Live Preview updates, Kanban moves, and timer-start automation.
- Fixed dependency validation so multi-field edits, passive repairs, and Task Creator drafts reject invalid dependency graphs before writing files or inverse links.

## Validation
- Local validation passed \`npm run check:local\`, including strict linting, production build, release guard, and 754/754 Phase 5 regression checks.
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

export function getYoutubeVideoId(url: string): string | null {
	try {
		const parsedUrl = new URL(url);
		const hostname = parsedUrl.hostname.toLowerCase().replace(/\.+$/u, '');
		const pathname = parsedUrl.pathname;
		const searchParams = parsedUrl.searchParams;
		if (hostname === 'youtu.be') return pathname.slice(1) || null;
		if (hostname === 'youtube.com' || hostname.endsWith('.youtube.com')) {
			if (pathname === '/watch') return searchParams.get('v');
			if (pathname.startsWith('/embed/') || pathname.startsWith('/v/') || pathname.startsWith('/shorts/')) {
				return pathname.split('/')[2] ?? null;
			}
			if (pathname === '/playlist') return searchParams.get('v');
		}
		return null;
	} catch {
		return null;
	}
}

export function getYoutubeThumbnailUrl(videoId: string, quality: string): string {
	return `https://img.youtube.com/vi/${videoId}/${quality}`;
}
