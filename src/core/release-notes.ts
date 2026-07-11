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
		version: '2.1.0',
		date: '2026-07-11',
		title: 'Smoother Systems, Safer Workflows',
		showOnUpdate: true,
		bannerUrl: 'operon-2-1-0-doc-path.png',
		body: `
This is one of those releases where many small changes started adding up to something much bigger.

The visible additions are easy to describe. Underneath them, though, a lot of work went into making everyday workflows faster, safer, and more consistent. Especially around Calendar, pipelines, priorities, and task editing.

### New
- Added an **Operon Docs folder** setting, so you can choose where the official Operon documentation lives inside your vault.
- Added Core Templates-compatible \`{{title}}\`, \`{{date}}\`, and \`{{time}}\` variables for Daily Notes and task templates.
- Added **Pipeline** grouping, subgrouping, and sorting to Operon Table without requiring another task property.

### Improved
- **Calendar:** Faster rendering, smoother task-pool search, clearer task-color indicators, better touch interaction, and more efficient external calendar syncing.
- **Pipelines and priorities:** More predictable workflow ordering, safer pipeline lifecycle handling, consistent priority matching, and automatic recovery for malformed priority data.
- **Table and Filter:** Clearer Group & Sort controls, Pipeline-aware organization, faster nested sorting, calmer searchable pickers, and better mobile keyboard behavior.
- **Task editing and pickers:** More responsive controls, shared keyboard-friendly priority selection, reduced background work, and more reliable focus and interaction behavior.

### Fixed
This release also includes a large set of fixes across Task Editor, recurring tasks, pipeline migrations, external calendars, mobile pickers, Calendar navigation, optimistic updates, default priorities, and demo workspace setup.

A lot of edge cases. A lot of cleanup. Operon should simply feel more dependable now.

### Updated Docs
- [[DOCS-037 Pipelines and statuses|Pipelines and statuses]]
- [[DOCS-107 Table grouping and sorting|Table grouping and sorting]]
- [[DOCS-106 Table columns|Table columns]]
- [[DOCS-024 Task templates|Task templates]]
- [[DOCS-050 Daily Notes workflows|Daily Notes workflows]]
- And 4 more updated docs.
`.trim(),
	},
	{
		version: '2.0.1',
		date: '2026-07-09',
		title: 'Operon 2.0.1 - Table and Tooltip Fixes',
		showOnUpdate: true,
		body: `
### New
- Added **Project Serial** as a readonly Operon Table column, so saved tables can show project serial identities with detailed chips, compact icons, search, grouping, sorting, and export support.
- Added **Settings support actions** for GitHub Sponsors and Buy Me a Coffee, making it easier to support ongoing Operon development.
- Added default-on **Calendar** and **Kanban** settings that let users turn off hover add buttons when they prefer less visual interruption while keeping other task creation paths available.

### Improved
- Improved the **release notes popup** with a coffee support button and a calmer release heading card.
- Improved **related-view launchers** so new Calendar, Kanban, and Table views created with a saved filter use that filter's name while still avoiding duplicate preset names.

### Fixed
- Fixed **Operon Table** Markdown export so task values with backslashes before pipe characters stay inside the intended table cell.
- Fixed **Operon Table** picker cells so the first click after activating a Table leaf from another pane opens the picker instead of being swallowed or disappearing.
- Fixed an Obsidian CSS compatibility warning in **Operon Table** admin headers.
- Fixed **Operon Table** editable cells, Table controls, and Operon controls across filters, pickers, popovers, settings, and modals showing accessibility labels or native Obsidian hover tooltips, so only Operon's own tooltips appear while accessible labels stay intact.
- Fixed **Kanban** card drops so post-drop refreshes preserve the board scroll position instead of jumping back to the top.

### Updated Docs
- [[DOCS-112 Table cells display and behavior|Table cells: display and behavior]]
- [[DOCS-106 Table columns|Table columns]]
- [[DOCS-105 Table overview|Table overview]]
- [[DOCS-097 Project serials|Project serials]]
- [[DOCS-030 Kanban overview|Kanban overview]]
- And 2 more updated docs.
`.trim(),
	},
	{
		version: '2.0.0',
		date: '2026-07-07',
		title: 'Operon Table: A Unified View for Inline and File Tasks',
		showOnUpdate: true,
		bannerUrl: 'operon-2-0-0-tables.png',
		body: `
Operon 2 introduces **Operon Table**, a unified view for managing inline tasks and file tasks side by side. It gives you one configurable place to scan your tasks, adjust fields, build saved views, and embed the result in notes.

### New
- Added **Operon Table**, a new workspace view and embeddable note block for inline and file tasks, with saved presets, filter/search scopes, configurable columns, grouping and subgrouping, multi-sort, summaries, picker-backed cell editing, admin columns, exports, and compact chips/date accents.
- Added **Task Icon Color Source** in the renamed **Task Icon Fallbacks and Colors** settings section, so the main status-cycle task icon can use Status, Task, Priority, or No color instead of relying on a fixed fallback.
- Added **Kanban card progress tracks** for subtasks and plain checkboxes, with shared segmented bars, preset-aware colors, a subtask track between the task title and chips, default-on General Kanban Settings toggles, and tooltip details on each slim card bar.
- Added **Kanban note previews** with an off-by-default setting that shows compact two-line task notes on main cards.
- Added **Text Field Popovers** for quick Notes and Description editing from Kanban note previews and Operon Table text cells, including icon-only text cells.
- Added **Russian localization**, including Settings language selection, translated UI strings, Russian date parsing, repeat summaries, calendar wording, task editing labels, and filter surfaces.

### Improved
- Improved the **Filter editor** so nested condition groups show automatic serial numbers and a temporary expand/collapse control, making long grouped filters easier to scan without adding saved filter metadata.
- Improved **Filter field selection** with searchable grouped field pickers, so long field lists are easier to browse without changing existing filter rules.
- Improved **Calendar Task Pool** task row coloring so sidebar tasks follow the active Calendar preset's task color source, matching the grid for Task, Status, Priority, or No color modes.
- Improved the **Color Picker** so pasting or typing a HEX color into the existing search field previews that exact color and lets it be chosen without adding a separate input.
- Improved **Task Editor** geometry with tighter, more consistent corners across the modal, editor cards, controls, workflow fields, and the file-body panel.
- Improved **Calendar and Kanban** headings so planning view titles use the same calmer treatment, with a matching Kanban title icon for easier surface recognition.
- Improved **related view navigation** with desktop-only \`external-link\` menus placed beside the Operon Table, Calendar, and Kanban titles, so matching Filter, Calendar, Kanban, and Table presets can be opened or created from the same filter context, with Add New wording that calls out when the current filter will be inherited.
- Improved **Kanban performance and refresh stability** across large boards, pop-out windows, drag/drop updates, collapse state persistence, optimistic card moves, progress-track refreshes, status cycling, and tab title synchronization.
- Improved **Kanban search controls** with broader default task scopes, Task Finder-style help, a Recently Modified scope, and cleaner scope cleanup when boards close or move between windows.
- Improved **Keymapping** property editing so multiple property names can be changed from the same open settings page without only the first change persisting.
- Improved the **plain checkbox popover** so its outer frame stays neutral while inner focus and save actions use the task color when available, falling back to the standard accent color.

### Changed
- Retired automatic **Estimate Reallocation** from Relationships settings; estimate changes now stay manual through the Task Editor's Subtract Delta action.

### Fixed
- Fixed **file task conversion** so an existing \`title\` frontmatter property is preserved as user metadata instead of being dropped when a normal note is converted to a file task.
- Fixed **Task Editor** Escape handling so pressing Esc saves pending edits and closes the editor consistently across task surfaces, while keeping the editor open if the save is rejected.
- Fixed **Task Wikilink Overlay** cleanup so Reading View and Live Preview remove hover tooltip and contextual menu listeners when overlay controls are torn down, reducing memory growth during repeated rerenders.

### New Docs
- [[DOCS-105 Table overview|Table overview]]
- [[DOCS-106 Table columns|Table columns]]
- [[DOCS-107 Table grouping and sorting|Table grouping and sorting]]
- [[DOCS-108 Table summaries|Table summaries]]
- [[DOCS-109 Table presets|Table presets]]
- And 4 more new docs.

### Updated Docs
- [[DOCS-001 Operon Docs MOC|Operon Docs]]
- [[DOCS-004 Operon system map|Operon system map]]
- [[DOCS-005 Operon core concepts|Operon core concepts]]
- [[DOCS-025 Filter View|Filter View]]
- [[DOCS-099 State Icons|State Icons]]
- And 8 more updated docs.
`.trim(),
	},
	{
		version: '1.9.1',
		date: '2026-07-01',
		title: 'Scorecard Warning Cleanup',
		showOnUpdate: true,
		body: `
This small maintenance release clears Operon's Obsidian Community scorecard warning scan and makes that same scan reproducible locally, without changing task behavior.

### Improved
- Improved **Obsidian Community scorecard validation** by aligning TypeScript standard library checks with the APIs Operon already uses.
- Added a dedicated **scorecard lint check** so scorecard warnings can be caught locally before release.
`.trim(),
	},
	{
		version: '1.9.0',
		date: '2026-07-01',
		title: 'Kanban as a Planning Surface',
		showOnUpdate: true,
		youtubeUrl: 'https://youtu.be/9YjQEgOSoWQ',
		body: `
This release turns Kanban into a more capable planning surface, not just a place to move cards between columns. Task Chips now bring key task context directly onto Kanban cards, while the board, headers, actions, and Calendar task visuals have been refined into a cleaner, more focused interface.

### New
- Added **Kanban Task Chips** to main Kanban cards, with configurable compact metadata, interactive desktop chips, read-only mobile chips, and Project Serial identity chips when available.
- Added a dedicated **Kanban Task Chips** settings surface, so Kanban cards can use their own chip visibility, ordering, and action-chip preferences.
- Added **Kanban Task Actions** for timer, pin, note, subtask, and checkbox actions, with note indicators shown by default when a task has notes.

### Improved
- Improved **Kanban cards and task chips** with calmer neutral surfaces, task-color border emphasis, outline-style chips, pinned-style task icons, trailing action chips, and a Stop state while a card timer is already running.
- Improved **Kanban column and swimlane headers** with transparent board structure, border-only axis highlighting, cleaner count buttons, and swimlane labels that hide wikilink brackets and wrap long names.
- Improved **Calendar desktop task visuals** with clearer task icon borders, calmer lane-label focus states, balanced all-day spacing, tighter timed-task corners, and consistent task edges across hover, focus, and editing states.
- Improved **contextual task menus** and **Task Editor** relationship cards so resting surfaces stay neutral and task-color emphasis appears only on hover or keyboard focus.

### Changed
- Changed **Calendar and Kanban preset color sources** so Accent color is no longer offered; existing Calendar Accent presets fall back to Task color, while existing Kanban Accent presets fall back to No color.
- Changed **Kanban Task Chips** so hidden-field overflow counts are no longer shown on desktop or mobile cards, reducing metadata noise on dense boards.

### Fixed
- Fixed **icon-only task chips** flickering near tight row edges by keeping them collapsed and showing their label in an Operon tooltip when there is not enough room to expand inline.

### Updated Docs
- [[DOCS-030 Kanban overview|Kanban overview]]
- [[DOCS-097 Project serials|Project serials]]
- [[DOCS-041 Task chips display and behavior|Task chips display and behavior]]
- [[DOCS-100 Mobile Kanban|Mobile Kanban]]
`.trim(),
	},
	{
		version: '1.8.0',
		date: '2026-06-29',
		title: 'Task Wikilink Overlay',
		showOnUpdate: true,
		bannerUrl: 'operon-1-8-0-task-wikilink-overlay.png',
		body: `
Inline and file-task wikilinks now share the same overlay controls, Task Finder can insert task links directly, source-opening behaves more like a browser across planning views, and Japanese localization opens Operon to another language workflow.

### New
- Added an **Add Task Wikilink Overlay** command that opens Task Finder and inserts a task link at the cursor, using normal file-task links for file tasks and \`[[File#-operonId]]\` links for inline tasks.
- Extended **Task Wikilink Overlay** to render inline task links written as \`[[File#-operonId]]\`, including embedded \`![[File#-operonId]]\` links, so Task Finder-inserted inline links can use the same overlay controls as file-task links.
- Added browser-style modifier-click source opening for materialized tasks in **Calendar**, **Kanban**, and **Pinned Tasks**: Cmd-click on macOS or Ctrl-click on Windows/Linux opens the task source in a new Obsidian tab while normal clicks still open Task Editor.
- Added **Japanese localization**, including Settings language selection, translated UI strings, Japanese date parsing, repeat summaries, calendar wording, task editing labels, and filter surfaces.

### Improved
- Improved **Calendar Task Pool** task rows with neutral default cards and task-color hover emphasis, reducing visual noise while keeping priority context available on interaction.
- Improved **Calendar Task Pool** status icons with pinned-style spacing, making the icon border feel less cramped while keeping the compact sidebar layout.

### Changed
- Renamed **File Task Overlay** settings to **Task Wikilink Overlay**, while migrating existing overlay chip and action preferences to the new setting names.

### Updated Docs
**New Docs**
- [[DOCS-103 Task Wikilink Overlay|Task Wikilink Overlay]]
- [[DOCS-104 Add Task Wikilink Overlay|Add Task Wikilink Overlay]]

**Updated Docs**
- [[DOCS-032 Pinned Task Dock|Pinned Task Dock]]
- [[DOCS-030 Kanban overview|Kanban overview]]
- [[DOCS-028 Calendar overview|Calendar overview]]
- [[DOCS-093 How to migrate from TaskNotes|How to migrate from TaskNotes]]
- [[DOCS-080 FAQ for TaskNotes users|FAQ for TaskNotes users]]
- And 7 more updated docs.
`.trim(),
	},
	{
		version: '1.7.1',
		date: '2026-06-28',
		title: 'Smoother Repeatable Workflows',
		showOnUpdate: true,
		body: `
This release smooths a few busy edges after 1.7.0. Template variables are more useful for repeatable task creation, planning views have more room on desktop, docs auto-update timing is clearer, and inline task rows recover more cleanly after edits.

### New
- Added **Template Variables** for \`{{status}}\` and \`{{priority}}\`, so file task templates and pasted inline snippets can fill the current default workflow status and priority automatically.

### Improved
- Improved **Kanban, Calendar, and Filter View** on desktop by hiding Obsidian's duplicate native view header in the main workspace, giving planning and filtering surfaces more room while keeping Operon's own controls in place.
- Improved **Operon Docs auto-update** so it refreshes docs after Operon version updates instead of checking on every startup, matching the setting description more closely.
- Improved **Pinned Tasks** polish with clearer description hover color in dark themes and sidebar spacing that keeps the first pinned task from sitting tight against the top and left edges.
- Improved **Task Finder** search field styling so its border, background, and focus shadow match the calmer Task Creator description field.

### Changed
- Changed **Operon storage** to use canonical plugin storage only, removing the old vault-root \`.operon\` fallback and Settings cleanup prompt after multiple releases on the new storage layout.

### Fixed
- Fixed **inline task rendering** briefly showing raw \`{{...}}\` metadata after Task Editor saves, checkbox conversion, Tasks emoji conversion, or inline task creation, so updated task rows settle back into the rendered Operon view without requiring an extra click.

### Updated Docs
- [[DOCS-061 operonId template variables|operonId template variables]]
- [[DOCS-012 Inline task syntax|Inline task syntax]]
- [[DOCS-024 Task templates|Task templates]]
- [[DOCS-028 Calendar overview|Calendar overview]]
- [[DOCS-030 Kanban overview|Kanban overview]]
- And 3 more updated docs.
`.trim(),
	},
	{
		version: '1.7.0',
		date: '2026-06-25',
		title: 'Official Operon Wiki in Your Vault',
		showOnUpdate: true,
		bannerUrl: 'operon-1-7-0-official-operon-wiki.png',
		body: `
This update focuses on making Operon easier to understand and reuse inside a real vault. The official docs wiki can now be downloaded into \`Operon/Docs\` and kept aligned with your local settings, giving both humans and agents a clearer reference point for working with tasks, templates, and configured properties.

### New
- Added **Operon Docs download settings** in Core > General, so the official docs wiki can be downloaded or kept updated inside \`Operon/Docs\` with local property-name mapping.
- Added a **Calendar Task Pool filter toggle** so the sidebar Task Pool can follow the active Calendar preset filter; new installs enable it by default while existing users keep their current global-pool behavior unless they turn it on.
- Added **New File Task Creation Defaults** so Task Creator can optionally open in File Task mode and preselect a chosen file-task template without changing the inline-first default.
- Added **Template Placeholders** for Operon file task templates: \`{{date}}\`, \`{{datetime}}\`, \`{{taskDescription}}\`, \`{{note}}\`, \`{{dateStarted}}\`, \`{{dateScheduled}}\`, and \`{{dateDue}}\`, plus direct \`{{date}}\` and \`{{datetime}}\` resolution in pasted inline task snippets.

### Improved
- Improved **Priority** and **Pipeline** color controls in Settings so status and priority colors use Operon's searchable color picker instead of the native browser picker.

### Fixed
- Fixed **Convert to file** in Live Preview for inline tasks with carried-over checkboxes, so the source line updates atomically and no longer leaves a blank file-task label until the next click or refresh.
- Fixed Obsidian 1.6.5 CSS compatibility warning for file task overlay nested wikilinks while keeping their subtle dotted link affordance.
- Fixed **Convert to file** in Live Preview for task titles containing wikilinks, so the new file-task overlay label appears immediately without requiring a page refresh.
`.trim(),
	},
	{
		version: '1.6.2',
		date: '2026-06-23',
		title: 'Recurring Tasks at a Glance',
		showOnUpdate: true,
		bannerUrl: 'operon-1-6-2-recurrence-chips',
		body: `
This is a small workflow polish release for recurring tasks and file-task conversion. Recurring work is easier to scan directly from task rows, inline-to-file conversion preserves more checklist context, and file-task wikilinks render more cleanly across Live Preview and Reading View.

### New
- Added a **Recurrence compact chip** for recurring tasks, showing the recurrence summary in inline and filter task rows with a cleaner next-occurrence tooltip when available.
- Added **plain checkbox carryover for Convert to file**, so inline tasks can bring their scoped checkboxes into the new file task by default, with a File Task Conversion setting to keep the previous behavior when needed.

### Improved
- Improved **file task overlay** labels so nested wikilinks keep a lighter, consistent visual affordance without the heavy underline treatment.

### Fixed
- Fixed **Convert to file** in Live Preview so the new file-task link label refreshes immediately after conversion instead of appearing only after the next editor interaction.
- Fixed **Calendar Task Pool** scrolling on Windows desktop so long task pools no longer get trapped at the top of the sidebar.
- Fixed **file task overlays** so task titles that contain wikilinks render those inner links cleanly instead of letting nested wikilinks break the overlay label.
- Fixed **Reading View file task overlays** so recovering a nested wikilink artifact replaces only the broken link text and preserves surrounding paragraph text.
`.trim(),
	},
	{
		version: '1.6.1',
		date: '2026-06-21',
		title: 'A Middle Ground for Mobile Calendar',
		showOnUpdate: true,
		bannerUrl: 'operon-1-6-1-mobile-calendar',
		body: `
Phone calendars have less room for theory.

The previous release brought external calendar and tracked-time columns into Time Tracker Grid. That made the **Day** view much more useful, especially when you want to compare planned work with what actually happened. But on a phone, the same extra context can become too tight too quickly.

This update adds a **2 Days** mobile Calendar mode and per-mode Calendar presets, so each view can have a different job. Day can stay focused on planned, external, and tracked time, while 2 Days or 3 Days can use a cleaner planning preset when you need more range and less detail.

### New
- Added a **2 Days** option to the mobile Calendar view cycle, giving Time Tracker Grid and dense mobile calendars a middle ground between Day and 3 Days.
- Added per-mode mobile Calendar preset settings, so Agenda, Day, 2 Days, and 3 Days can each open with their own chosen Calendar preset.
- Added mobile Calendar cycle toggles, so Agenda, Day, 2 Days, and 3 Days can be included or skipped while keeping at least one mobile mode available.
- Added **Convert to file** and **Convert to inline** contextual menu actions, making inline/file task conversion available directly from task surfaces, including existing Kanban and Time Session History menus after migration.
- Added **Pipeline descriptions** in settings, so each workflow can carry human-readable and agent-friendly guidance for task creation.
- Added **Priority descriptions** in settings, so each priority level can explain when humans and agents should use it during task creation and planning.

### Fixed
- Fixed **Calendar** background refreshes so Time Tracker Grid and sidebar state updates no longer steal focus while typing in notes, Task Creator, Task Finder, or Calendar search fields.
- Fixed **Log as tracked** so Calendar timed blocks keep their exact planned start and end times instead of snapping tracked sessions to the visible grid interval.
- Fixed **Mobile Calendar** timed task moves so dropped tasks persist, and kept the time grid from jumping after timed moves or slot-created tasks refresh.
- Fixed **Reading View inline task** styling so rendered task rows keep Live Preview-aligned spacing without using CSS flagged by Obsidian's compatibility checks.
`.trim(),
	},
	{
		version: '1.6.0',
		date: '2026-06-19',
		title: 'Planning Time Meets Tracked Time',
		showOnUpdate: true,
		youtubeUrl: 'https://www.youtube.com/watch?v=hDduQEnnnHU',
		body: `
Planning time and tracking time now sit closer together.

This release introduces **Time Tracker Grid**, a Calendar preset built for comparing planned work, external calendar blocks, and completed tracked time in the same day view. It also expands Operon's multilingual surface with Chinese localization and tightens several task creation, reading, and calendar interactions around the new planning workflow.

### New
- Added **Chinese localization** for Simplified and Traditional Chinese, including Settings language selection, translated UI strings, Chinese date parsing, repeat summaries, calendar wording, task editing labels, and filter surfaces.
- Added **Time Tracker Grid** as a Calendar preset for desktop and mobile Day/3 Days views, showing planned tasks, external calendar events, and tracked sessions in separate per-day lanes.
- Added **Time Tracker Grid** daily totals for planned, external, and completed tracked time, making it easier to compare what was planned with what was actually tracked.
- Added tracked-session editing directly from **Time Tracker Grid**, including session selection, move/resize editing, edit and delete modal access, stale-session feedback, and read-only handling for active or unassigned timers.
- Added **Log as tracked** actions for past planned blocks, so planned Calendar time can be recorded as tracked time without rewriting existing tracker history.
- Added mobile and future-day behavior for **Time Tracker Grid**, including contained narrow columns, lane headers, read-only external events, active timer visibility, and automatic hiding of tracked-time lanes on future dates.

### Improved
- Improved **Parent-Child task inheritance** so native task tags can be added as an optional inherited field, while seed tags from Calendar, Kanban, and Task Creator remain preserved.
- Improved **Calendar** and **Kanban** preset controls so Task color source selectors, buttons, and dropdowns use a more consistent compact style.
- Improved **Date Picker** result rows so ISO dates have a little more room and no longer truncate before the weekday column.
- Improved **Calendar** day highlighting with calmer today and weekend treatment while keeping today's day text and lane labels easy to spot.
- Improved **Task Creator** and **Task Editor** focus styling so description, note, and editor fields follow the task color when available.
- Improved the **Task Editor** Core controls so date/time, Estimate, and Subtract Delta controls follow the more compact Add Recurrence Rule height.
- Improved tracker session editing reliability across Calendar, Time Session History, and Task Editor with safer edits, clearer context, and cleaner recovery when persistence fails.

### Fixed
- Fixed **Reading View inline tasks** so Project Serial chips stay with metadata chips, stale indexes no longer expose raw \`{{...}}\` task fields, wikilink overlays stay stable, and rendered task rows keep normal Obsidian list spacing.
- Fixed first generated **when-done recurring inline tasks** keeping the previous start date when the source task only had a start date.
- Fixed **Calendar inline task creation** so choosing a parent task in Task Creator places the new task through the parent-aware flow before using the Calendar save target.
- Fixed **Calendar task status icons** so normal scheduled, timed, due, finished, and mobile task items can be clicked again while projected future occurrences and active tracker blocks remain read-only.
`.trim(),
	},
	{
		version: '1.5.0',
		date: '2026-06-17',
		title: 'When Tasks Become Projects',
		showOnUpdate: true,
		youtubeUrl: 'https://www.youtube.com/watch?v=LdxtmszDNm8',
		body: `
Some tasks stay small. Some become projects.

This release improves the second case. Operon now has better tools for seeing project structure, creating subtasks with the right context, and opening nested work without rebuilding your view by hand.

**Project Serials** add readable parent IDs to task trees. They make project relationships visible in the interface while keeping Operon's stable task IDs untouched.

**Selectable inheritance rules** make child tasks more predictable. You decide which parent fields should flow into new subtasks, and Status can either follow the parent pipeline or start from the default pipeline.

The contextual menu now understands more of the work around a task. **Subtasks**, **Create subtask**, **Checkboxes**, and especially **Dynamic Subtasks Filter** make it easier to open the right project layer from the task you are already looking at.

### New
- Added **Spanish localization**, including Settings language selection, translated UI strings, Spanish date parsing, calendar wording, task editing labels, and filter surfaces.
- Added **Project Serials** for parent task trees, showing read-only visual serial chips without changing real Operon task IDs; serial display refreshes when settings change, prefixes can be renamed inline, and numbers removed from the end of a series can be reused while middle gaps remain reserved.
- Added **Parent-Child task inheritance** as a separate Relationships section with compact single-line field rows and Workflow Picker-style field tokens, so child tasks can inherit only the parent fields you choose while Status can start from either the parent pipeline or the default pipeline.
- Added **Subtasks**, **Create subtask**, and **Checkboxes** contextual menu actions, with migration for existing custom menus so the new actions appear in the intended order where supported.
- Added **Dynamic Subtasks Filter** as a centered contextual window for tasks that already have subtasks, with its own auto-expand limit, open-only toggle, locked filter template, higher desktop placement, page-preview layering, and a single close button.

### Fixed
- Fixed **Calendar toolbar** controls picking up preset dropdown styling, so navigation icons stay centered and the preset selector keeps its compact chevron on hover.
- Fixed **Kanban contextual Checkboxes** opening with leftover hover-menu text or tooltip fragments visible behind the checkbox popover.
`.trim(),
	},
	{
		version: '1.4.1',
		date: '2026-06-15',
		title: 'Calendar, Presets, and Visual Polish',
		showOnUpdate: true,
		bannerUrl: 'operon-1-4-1-calendar-multiweek',
		body: `
This release is a compact visual consistency pass for Operon's busiest surfaces. It reduces theme-related button noise across editors, pickers, calendars, sidebars, and tracking controls while adding a couple of practical improvements to file-task creation and saved preset filters.

### Improved
- Improved **Create file task** so running it without selected text, a source line, or an inline task opens Task Creator in File mode instead of immediately creating a placeholder file task.
- Improved **Calendar** and **Kanban** preset filter controls with compact Create, Edit, Choose, and Clear actions, making saved filters easier to build and adjust from preset settings while keeping the preset panel easier to scan.

### Fixed
- Fixed Obsidian theme button backgrounds showing gray fills over Operon's newer transparent bordered styling across Task Editor, Calendar toolbar, sidebars, lane controls, pickers, tracking session controls, and the tracked session editor modal.
`.trim(),
	},
	{
		version: '1.4.0',
		date: '2026-06-13',
		title: 'Color Picker, Workspace Tweaks, and Editor Polish',
		showOnUpdate: true,
		youtubeUrl: 'https://www.youtube.com/watch?v=rfjE2iPARiM',
		body: `
This update centers on the new **Color Picker** and **Color Palette** settings. Colors are now easier to find, compare, and adjust: searchable named colors, tone and hue controls, custom previews, copyable hex values, localized names, and a curated default palette make Operon's colors work for both quick search and manual tuning.

It also tightens the everyday interface surfaces where repeated task work happens: Calendar sidebars, Filter Builder, shared pickers, and the Task Editor.

## New
- Added a new **Color Picker** and **Color Palette** settings experience, with searchable named colors, tone and hue controls, custom color preview, copyable hex values, localized color names, and a curated default palette for Operon's 28 named colors.
- Added **Workspace Tweaks** settings for optional scrollbar hiding, Properties collapsing, and compact sidebar tab icons, so small Obsidian workspace refinements can be managed from Operon.
- Added a **Task Editor autosave delay** setting, so users can choose how quickly typing edits autosave after they pause while closing the editor still saves immediately.

## Improved
- Improved Calendar **Calendars** and **Task Pool** controls with a denser preset layout, a new **Finished Tasks** mode, clearer search feedback, remembered pool mode, and better keyboard behavior.
- Improved **Filter Builder** condition field selection with a searchable picker, making long canonical and custom key lists easier to scan.
- Improved Operon's **pickers** with bordered controls, clearer selected and hover states, and more consistent action styling across date, status, priority, repeat, list, relationship, estimate, icon, and custom field pickers.
- Improved the **Task Editor** with updated header controls, workflow fields, tracking sessions, duration summaries, description and notes sections, parent/subtask context, checkbox progress, localized progress labels, and a clearer dirty-state save indicator.

## Fixed
- Fixed **Task Editor file body** layout issues so file-body panels no longer start clipped or shifted when opened from file tasks or inline tasks.
`.trim(),
	},
	{
		version: '1.3.0',
		date: '2026-06-11',
		title: 'Custom Keys across Operon',
		showOnUpdate: true,
		bannerUrl: 'operon-1-3-0-compact-ui.png',
		body: `
This release makes **Custom Keys** a much more powerful part of Operon. You can now define your own task keys in Settings and use them across the places where real task work happens: Task Editor, Task Creator, compact chips, filters, search, embedded filters, Kanban sorting, and Kanban swimlanes.

It also continues the calmer Operon interface direction from the previous release. Task editing, creation, picker controls, Pinned Tasks, FlowTime, Task Finder, and contextual menus now share more of the same compact, bordered, tool-like visual language.

## New
- Added **Custom Keys** management in Settings, giving user-defined task keys their own Core page with field types, icons, descriptions, usage indicators, ordering, and safer delete confirmation.
- Added support for **Custom Keys** across Task Editor, Task Creator, Live Preview field menus, compact task chips, Filter Builder, task search, embedded filter search, Kanban sorting, and Kanban swimlanes.
- Added dedicated **Custom Key pickers** for text, list, number, date, and datetime fields, so user-defined keys can be edited with controls that match their field type.
- Added **Custom Key suggestions** from existing vault frontmatter values, so text and list pickers can reuse values already present in matching properties, not only values indexed from Operon tasks.
- Added wikilink-aware **Custom Key** display, including plain labels, Page Preview support, and linked-note opening for wikilink-backed custom values where the chip is interactive.
- Added a **Kanban swimlane visibility** toggle for Custom Keys, so user-defined keys only appear as swimlane grouping options when explicitly enabled.
- Added a **mobile context menu auto-hide** setting so touch menus can close automatically after a user-defined delay.

## Improved
- Improved **Task Editor file body** spacing so heading collapse chevrons stay easier to see and click inside the embedded editor.
- Improved **Task Editor workflow pickers** with a compact icon rail, letting workflow fields open from field icons while existing values stay visible below.
- Improved **Task Editor workflow picker spacing** so the new icon rail is grouped more clearly with the Core section and has better separation from surrounding fields.
- Improved **New Operon Task** toolbar icons with hover tooltips that follow the selected task color or fall back to the accent color, making icon-only task fields easier to identify without changing the compact creator layout.
- Improved **New Operon Task**, **Task Finder**, **Kanban search scope**, **FlowTime**, **contextual task menus**, **Pinned Tasks**, and **plain checkbox list editor** controls with calmer bordered styling and clearer selected states.
- Improved **Time Session History** rows with hover-revealed secondary actions, finished-task replay buttons, softer finished-task borders, aligned task icons, centered task titles, calmer session counters, and clearer edit targets.
- Improved **Inline Tasks settings** spacing and active-row highlighting so conditional save-location fields feel cleaner and less crowded.
- Improved **Priority settings** with a bordered editor frame that matches Pipeline settings and keeps the Add Priority action visually grouped with the priority list.
- Improved **Settings Search** coverage for Location Map, Mobile Calendar, Mobile Kanban, Relationships, Recurrence, Tracker, and Pinned Dock settings in Obsidian 1.13.
- Improved table-like settings pages so State Icons, Task Finder, Context Menu, Task Editor, and Mobile Task Editor keep their stable native page rendering for custom rows, matrices, and picker lists.
- Improved **Recurrence settings** layout so YAML cleanup rules have clearer spacing, a cleaner section title, and a less crowded Add Property Cleanup Rule action.
- Improved task **note action** icons so Live Preview, Reading View, Filter rows, and file task overlays use the task color when available and fall back to the accent color.

## Changed
- Changed first-run **Pinned Tasks** defaults so pinned cards start without task-color tinting and active timer tasks are pinned automatically.
- Changed the new-user default for **Task Editor line numbers** to off, giving the file body panel a cleaner first-run editing view while keeping the setting available.

## Fixed
- Fixed **Pinned Tasks** sidebar mode so the floating dock hides immediately, stays hidden after restart, and the pinned tasks command opens the configured surface instead of reviving the dock.
- Fixed **Settings Search** subpages in Obsidian 1.13 so Keymapping, Interface, and Mobile settings open through stable native page shells instead of occasionally rendering blank or missing sections.
- Fixed **Kanban** optimistic card previews for multi-value swimlanes, so moving one tag, context, assignee, or Custom Key list value follows the same lane behavior as the saved write.

## Validation
- Local validation passed \`npm run check:local\` and \`git diff --check\`, including strict linting, production build, release guard, and 919/919 Phase 5 regression checks.
`.trim(),
	},
	{
		version: '1.2.1',
		date: '2026-06-09',
		title: 'A calmer visual direction for Operon',
		showOnUpdate: true,
		bannerUrl: 'operon-1-2-1-ui-polish-chips',
		body: `
I used this release to start tightening Operon's visual language. **Linear** has been one of the references in my head: calm, compact, structured, and very much a tool rather than a decorative app.

The first visible result is the new **task chip** direction, plus smaller polish passes across **Kanban**, **Calendar**, **filters**, **pickers**, and **menus**. Obsidian themes can make this tricky, so I am taking it gradually: a few elements per bump, tested against real workflows instead of chasing a huge redesign.

## Improved
- Refined Operon's **interface polish** across Task Chips settings, chips, pickers, Kanban, Calendar, Filter views, Task Creator, Task Finder, FlowTime, Time Session History, tooltips, and action menus with calmer colors, more structured corners, cleaner guide lines, better-aligned controls, consistent chip hover behavior, and focused subpages for dense chip settings.
- Improved **task contextual menus** on mobile with steadier long-press timing and shared behavior across task surfaces, so touch actions like **Unschedule** stay easier to reach.
- Improved **Dynamic File Task Filter** grouping and sorting so the current file task stays visible at the top, direct subtasks can be grouped below it, descendants stay nested under their parent, **Happens on** works as a sortable date field, and custom sort rules apply inside expanded subtask trees.

## Fixed
- Fixed remaining **Dynamic File Task Filter** and compact chip polish issues, including Live Preview width alignment after pane geometry changes, mobile Location Map chip previews, and duplicate compact chip CSS declarations.
`.trim(),
	},
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
