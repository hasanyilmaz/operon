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
		version: '3.12.0',
		date: '2026-10-06',
		title: 'Operon 3.12.0 — Tasks Meet Excalidraw',
		showOnUpdate: true,
		bannerUrl: 'operon-3-12-0-excalidraw-integration.png',
		body: `
Bring your tasks into Excalidraw alongside sketches, handwritten notes, and connected ideas. Create and edit real Operon tasks without leaving your drawing.

### New

- **Excalidraw task cards** bring editable task fields, images, and automatic card sizing into your drawings while keeping tasks in their Markdown sources.
- **Task Pool and Property Value Pool** let you add existing tasks and drag property values onto cards, sharing your Canvas favorites and shortcuts.
- **Drawing and card shortcuts** give you quick access to Task Creator, pools, timers, pinning, Task Editor, and task sources.
- **Create tasks inside drawings**, or turn a drawing into a file task using Operon’s existing creation and parent rules.
- **Convert selected drawing text into a task.** Task Creator uses the first line as the description and the remaining lines as notes, with parent and inheritance settings visible before creation.
- **Create a task from an arrow’s free end.** The starting task is preselected as parent, and the new card connects to the existing arrow.
- **Edit parent–child and blocking relationships** from the center of a selected arrow. Relationship indicators remain visible when the arrow is not selected, including active and resolved blocker colors.

### Improved

- **Separate default card widths** for embedded cards, Canvas, and Excalidraw. New Excalidraw cards default to 375 px; existing drawing cards keep their sizes.
- **Canvas text conversion** is now available from a button below the selected card.
- **Property Pool status changes** follow file-task pipeline folder rules, including Undo and Redo.

### Fixed

- Table settings saves are no longer unnecessarily blocked after a rejected settings write, and save failures no longer produce duplicate notifications.
- Property Pool edits work correctly for file tasks outside their configured pipeline folders.
- Task Pool results refresh after task changes.
- Failed-write recovery no longer replaces newer saved content with an older backup.
- Settings respond more smoothly while preserving control alignment and multiline editor layouts.

### New Docs

- [[DOCS-147 Excalidraw Task Cards|Excalidraw Task Cards]]
- [[DOCS-148 Canvas and Excalidraw Task Pool|Canvas and Excalidraw Task Pool]]

### Updated Docs

- [[DOCS-145 Canvas and Excalidraw Property Value Pool|Canvas and Excalidraw Property Value Pool]]
- [[DOCS-141 Canvas Task Cards|Canvas Task Cards]]
- [[DOCS-142 Embedded Task Cards|Embedded Task Cards]]
- [[DOCS-023 Create tasks from selected text|Create tasks from selected text]]
- [[DOCS-041 Task chips display and behavior|Task chips display and behavior]]
- And 12 more updated docs.
`.trim(),
	},
	{
		version: '3.11.0',
		date: '2026-10-01',
		title: 'Operon 3.11.0 — Settings, Reorganized',
		showOnUpdate: true,
		bannerUrl: false,
		body: `
I have mixed feelings about Obsidian’s new approach to settings, and I still prefer parts of the old layout.

But it’s time to move on. Rather than maintain two interfaces, I’ve focused on making Operon’s new settings as clear and useful as possible. Starting with this release, the legacy settings interface will no longer be available.

### Improved

- **Settings throughout Operon** now have clearer headings and groups, contextual help links, and more consistent controls and spacing. Dependent options appear only when relevant, making pages easier to navigate on narrow and wide screens.
- **Settings search** has been expanded and reorganized, with over **600 separate search targets** in the default configuration. Find settings, actions, and configurable items more easily, and jump directly to the relevant control or section. Coverage varies with your configuration.

### Changed

- Operon now requires **Obsidian 1.13.7 or newer** and uses its native Settings pages and search. The legacy Settings interface for older Obsidian versions has been removed.

### Updated Docs

**57 documents** have been updated to reflect the revised Settings layout, navigation, and behavior.

- [[DOCS-043 Settings search|Settings search]]
- [[DOCS-008 Essential settings to configure first|Essential settings to configure first]]
- [[DOCS-039 Key mappings|Key mappings]]
- [[DOCS-042 Contextual menu actions|Contextual menu actions]]
- [[DOCS-134 Backup and restore settings|Backup and restore settings]]
- And 52 more updated docs.
`.trim(),
	},
	{
		version: '3.10.2',
		date: '2026-09-28',
		title: 'Operon 3.10.2 — Inline Tasks and Everyday Fixes',
		showOnUpdate: true,
		bannerUrl: false,
		body: `
This update improves inline task placement, checkbox ownership, and task pools, with fixes for conversions and Calendar interactions.

### New

- **Convert Checkboxes in Selection to Operon Tasks** converts normal and supported Tasks emoji checkboxes while leaving other selected content unchanged and preserving task hierarchy.
- **Pinned tasks** are now available in Calendar and Canvas Task Pools. Five equal icon buttons keep all categories in one compact row, and pinned tasks appear regardless of status.
- **Keep existing inline tasks with their parent** is a new Task Router option, off by default. Changing a task’s parent, or editing it in a different file from its parent, moves the task and its own checkboxes while leaving subtasks in place.
- **Developer API checkbox ownership operations** let integrations explicitly use the new behavior for filtering, creation, adoption, relocation, and Inline-to-File conversion. Existing integrations keep their current behavior.

### Improved

- **Ask Every Time** uses a compact searchable destination picker, prioritizing the active file, parent location, two recent destinations, and frequently used files.
- **Checkbox-to-task conversion** uses the owning inline task as parent and preserves indentation and parent–child relationships. New or moved subtasks are placed after the parent’s checkbox block.

### Changed

- **Inline checkbox ownership** now covers only the uninterrupted checkbox block immediately below the task, including nested checkboxes. A blank line, heading, other text, or another task ends ownership. File Task coverage stays unchanged, and existing notes are not rewritten.

### Fixed

- **Calendar task icons** follow your selected pipeline or completion cycle instead of opening Task Editor. A busy state prevents rapid clicks from displaying an unsaved task state.
- **Inline ↔ File conversion** no longer leaves duplicate task content or reports misleading failures. Templates using Operon ID placeholders preserve parent–child links.
- **Location Picker** right-click actions copy coordinates and save the default center or zoom without closing the picker. Saved defaults are used on the next opening.

### Updated Docs

- [[DOCS-017 Plain checkbox lists|Plain checkbox lists]]
- [[DOCS-136 Task Router|Task Router]]
- [[DOCS-023 Create tasks from selected text|Create tasks from selected text]]
- [[DOCS-095 Calendar Task Pool|Calendar Task Pool]]
- [[DOCS-141 Canvas Task Cards|Canvas Task Cards]]
- And 15 more updated docs.
`.trim(),
	},
	{
		version: '3.10.1',
		date: '2026-09-26',
		title: 'Operon 3.10.1 — Tracked Time and Smoother Tables',
		showOnUpdate: true,
		bannerUrl: 'operon-tracked-time-filter.png',
		body: `
Review recorded time by period, edit sessions directly in tables, and scroll more smoothly through detailed task lists.

### New

- **Tracked time** filters tasks by session start date and shows only the selected period’s records and durations across filtered views.

### Improved

- **Duration and Trackers** cells show readable session chips, compact totals, and hover breakdowns. Edit a session from its chip or add time from empty cell space.
- **Duration sessions** follow earliest-to-latest start time. The **Show total / Show sessions** toggle has its own section in the column menu.
- **Trackers filters** focus on record counts and presence checks. Existing saved text-matching conditions keep working.
- **Tables scroll more smoothly**, with improved **horizontal scrolling** in wide tables and smoother scrolling in embedded views with long time-tracking histories.
- **Startup preparation** does less work for unchanged presets and files without existing tasks.

### Updated Docs

- [[DOCS-073 Filter conditions and operators|Filter conditions and operators]]
- [[DOCS-034 Time tracking|Time tracking]]
- [[DOCS-106 Table columns|Table columns]]
- [[DOCS-112 Table cells display and behavior|Table cells: display and behavior]]
- [[DOCS-111 Export a table|Export a table]]
- And 7 more updated docs.
`.trim(),
	},
	{
		version: '3.10.0',
		date: '2026-09-23',
		title: 'Operon 3.10.0 — Canvas Planning and Calendar Weeks',
		showOnUpdate: true,
		bannerUrl: 'operon-3-10-0-canvas-property-value-pool.png',
		body: `
Bring more of your planning onto Canvas: find and apply property values, organize tasks with rule-based groups, and navigate your calendar in full weeks.

### New

- **Canvas Property Value Pool** lets you search and favorite property values, organize shortcuts, and drag values onto tasks with change previews and Undo/Redo. Includes dates, reminders, media, adjustable panel sizing, and tablet support.
- **Operon Groups** organize Canvas tasks using property rules. Create groups from the Value Pool, apply rules by moving tasks into groups, and extend list rules by dragging in values. Edit group titles manually and keep priority/status colors connected to Settings.
- **Automatic group routing** moves existing task cards into matching groups when their values change. Cards without a suitable destination appear in **Group Mismatches**.
- **Calendar week** brings optional full-week navigation to Time Grid and Time Tracker Grid on desktop and tablet, respecting your week start and weekend visibility settings.

### Improved

- Canvas responds more smoothly when updating tasks and panning across cards.
- Relationship controls explain unavailable actions in a tooltip before you click.

### Fixed

- Valid Canvas parent–child links are no longer incorrectly rejected.

### New Docs

- [[DOCS-145 Canvas Property Value Pool|Canvas Property Value Pool]]
- [[DOCS-146 Operon Groups in Canvas|Operon Groups in Canvas]]
- [[DOCS-144 Supporting Operon|Supporting Operon]]

### Updated Docs

- [[DOCS-141 Canvas Task Cards|Canvas Task Cards]]
- [[DOCS-022 Command palette reference|Command palette reference]]
- [[DOCS-016 Parent and sub-tasks|Parent and sub-tasks]]
- [[DOCS-029 Calendar presets and time grid|Calendar presets and time grid]]
- [[DOCS-060 Calendar layout toolbar and sidebar|Calendar layout toolbar and sidebar]]
- [[DOCS-096 Mobile Calendar|Mobile Calendar]]
- [[DOCS-037 Pipelines and statuses|Pipelines and statuses]]
- [[DOCS-038 Task priorities|Task priorities]]
- [[DOCS-134 Backup and restore settings|Backup and restore settings]]
- And 4 more updated guides and reference pages.
`.trim(),
	},
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
