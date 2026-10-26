---
Notes: Desktop previews, editable file views, navigation controls, and background dimming
Icon: panels-top-left
Color: "#0891b2"
Updated: 2026-10-26T12:23:25+01:00
---

# Lightbox

A lightbox opens a link over the surface you are working in, so you can inspect a page, file, or image without rearranging your workspace tabs. On desktop, Operon shares this preview across supported task chips, Tables, task descriptions, and Description/Note popovers. Markdown notes, Bases, and Operon Tables use their normal editable views and save behavior inside the preview.

> **MEDIA-DOCS-151-1:** An editable Markdown note in the narrower lightbox frame, with the preview controls visible.

![MEDIA-DOCS-151-1 - Editable Markdown note in the lightbox](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-151-1.png)

## Where it works

The shared opening rules apply to supported links on:

- Inline tasks in Live Preview and Reading view, and standalone or embedded filters.
- Task Wikilink Overlays, Kanban cards, Task Cards in notes, Canvas, and Excalidraw.
- Real Operon task descriptions on Calendar and in its sidebar Task Pool.
- Standalone and embedded Table cells, including links inside Description and Note.
- The shared Description/Note text editor popover, using the link in the current draft.

This is not a global replacement for Obsidian links. General Markdown notes and the Creator/Task Editor's own field editors keep their existing behavior. Chips inside Task Finder, Pinned, Upcoming, time-tracking headings outside Time Session History, and other deliberately passive task lists do not become interactive link surfaces. Task Finder's result-opening choice is separate from chip interaction; see [[DOCS-027 Task Finder|Task Finder]]. Mobile navigation is unchanged.

Which chip or cell opens a preview is covered in [[DOCS-041 Task chips display and behavior|Task chips]] and [[DOCS-112 Table cells display and behavior|Table cells]]. Ordinary property values still open their pickers. A Text or List value must be a complete, existing wikilink to use the link exception; an HTTP address stored as ordinary Text remains a Text value.

## Open a link

| Action on a supported desktop link | Result |
|---|---|
| Click | Open in the lightbox |
| Enter or Space while the link itself is focused | Open in the lightbox |
| Cmd-click on macOS, or Ctrl-click on Windows/Linux | Open the same target in a focused Obsidian tab |
| Middle-click an HTTP/HTTPS link | Open in the system browser |

Middle-click is an external-browser shortcut for web links using this shared flow. It does not change local wikilinks, Source, Parent Task, or Task Image/Gallery media actions. It works even when Obsidian's Web Viewer is disabled.

> **MEDIA-DOCS-151-2:** A website in the Web Viewer lightbox, showing its navigation toolbar and the preview controls.

![MEDIA-DOCS-151-2 - Website in the lightbox](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-151-2.png)

Inside a text editor, ordinary Enter and Space remain editing keys. The link shortcut does not replace typing or line-break behavior.

Aliases change the visible label, not the destination. Relative paths are resolved from the source note; supported heading, block, PDF page, and Inline task line targets are retained. Missing local targets are not created by previewing them. Depending on the field, Operon returns to its picker or editor, or reports that the target could not be found.

## Open a task source

On desktop, the shared preview also opens a task's source from:

- A **Source** metadata chip or Table Source cell.
- The **Source action** on Inline Tasks, Filter Tasks, Kanban cards, Task Wikilink Overlays, and Task Cards. Its toggle and hover/focus visibility are separate from the metadata chip; see [[DOCS-041 Task chips display and behavior|Task chips and actions]].
- **Open Source** in the task's [[DOCS-042 Contextual menu actions|contextual menu]].
- Source navigation in [[DOCS-053 Time session history|Time Session History]], through its configured task-description action or the companion Source button.
- **Open Source** below a selected [[DOCS-141 Canvas Task Cards|Canvas]] or [[DOCS-147 Excalidraw Task Cards|Excalidraw]] task card.

Source chips, Table Source cells, Source actions, and card selection controls support Cmd/Ctrl-click for a focused Obsidian tab. Context-menu and Session History Source actions open the preview; use its **Open in new tab** control to continue in a tab.

For an Inline task, Operon resolves its current source position. In the editable Markdown view, the caret sits immediately after the description's last character, before trailing metadata, with no text selected. Source opening with Cmd/Ctrl and **Show source** in the [[DOCS-021 Task Editor|Task Editor workspace]] use the same position. A File task opens its source file normally. Opening Source itself does not change the task or create a missing file.

For a Markdown task, **Open Source** starts with only Markdown, regardless of the Task Editor's source-opening preferences. When a suitable task context is available, **Show task editor** adds its fields alongside the source. Browsing other notes does not open the editor automatically until you choose that button. An explicitly opened Inline task stays selected within its own source; Operon does not choose an arbitrary Inline task from a normal note.

These are specific navigation controls, not a change to every file link or task title. Other task-opening actions and mobile navigation retain their existing behavior.

## Supported content

| Content | Preview |
|---|---|
| HTTP/HTTPS page, other than a supported YouTube video link | Obsidian Web Viewer, with its navigation controls |
| Supported YouTube video link | The privacy-enhanced embedded player, including links from the Links field or task text |
| Markdown note | The normal Obsidian Markdown view, including editing |
| `.base` file | The native Bases view, including its supported edits |
| `.table` file | Operon's editable Table, including presets and the Gantt toggle |
| Supported image, video, or PDF reference | The shared media viewer with the relevant viewing controls |

Ordinary web-page previews and web tabs require the **Web Viewer** core plugin. Supported YouTube video links instead open the embedded player without Web Viewer, retain a supported start time, and do not autoplay. Cmd/Ctrl-click, middle-click, and the player's tab or split controls keep the original URL: Obsidian web tabs and splits require Web Viewer, while the system-browser shortcut does not. YouTube pages that do not identify a supported video keep the ordinary web-page route.

Bases require the **Bases** core plugin. If a required view is unavailable, Operon explains what is missing rather than enabling a plugin or silently opening another application.

> **MEDIA-DOCS-151-3:** A Base file in the wider lightbox frame, with its native view controls and the preview controls visible.

![MEDIA-DOCS-151-3 - Base file in the lightbox](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-151-3.png)

Existing files with no lightbox host, such as Canvas files, use the supported native file-opening fallback.

For media formats, image zoom and pan, playback, and gallery order, see [[DOCS-138 Task images and galleries|Task images and galleries]]. Opening a preview does not change a media field or reorder its gallery.

## Native Markdown and task fields

Markdown uses Obsidian's native view in **Reading**, **Live Preview**, and **Source** modes. Inside the lightbox, Properties and a closed YAML frontmatter block at the beginning of the file are hidden so you work with the body. The YAML remains in the file and is protected from body-editing gestures. A missing closing fence does not hide the entire note, and separators or code examples in the body remain visible.

This applies only to the lightbox view. The same file in a normal Obsidian tab retains its normal Properties and YAML editing. File task field changes and native file refreshes can still update the hidden frontmatter. To edit YAML directly, open the file in a normal tab.

The [[DOCS-026 Dynamic file task filter|Dynamic File Task Filter]] retains its top or bottom placement in Reading and Live Preview, including when Properties are hidden. It keeps its normal absence from Source mode.

For existing Markdown tasks on desktop, the [[DOCS-021 Task Editor|Task Editor]] can share the lightbox with the source. Its opening defaults, field synchronization, and task-following rules are described there. Hiding either panel preserves it in the current level, and the remaining panel stays usable. Phone/tablet editors, new-task forms, special recurrence-instance editors, and Excalidraw task sources keep their existing routes.

## Size and remembered preferences

Desktop previews choose their content profile before loading, so a Markdown note starts in its own frame rather than first appearing at Table width. These defaults apply until you change an axis for that profile:

| Profile | Default width | Default height |
|---|---|---|
| Markdown | Up to 1050px or 90% of the window, whichever is smaller | 90% of the window |
| Base | 90% of the window | 85% of the window |
| Operon Table | 90% of the window | 85% of the window |
| Video | The same wide frame as Base and Table | 85% of the window |
| YouTube | The same wide frame as Video | 85% of the window |
| Web | Up to 1200px or 90% of the window, whichever is smaller | 85% of the window |
| PDF | Up to 1200px or 90% of the window, whichever is smaller | 85% of the window |
| Image | Natural proportions within the window limits | Follows the image proportions and window limits |

Window limits can reduce the actual size to leave room for the controls. The video or image itself keeps its proportions inside a resized frame.

Use the **width controls below the content, centered horizontally**, to narrow or widen the preview, and the **height controls in the middle of the side control rail** to shorten or lengthen it. The rail follows the selected side as described below. Both axes use these percentages of the app window, not the underlying workspace pane:

**40 · 45 · 50 · 55 · 60 · 65 · 70 · 75 · 80 · 85 · 90**

Each button chooses the next smaller or larger step from the current size. For example, a width of 67% narrows to 65% or widens to 70%. A control becomes unavailable when there is no further usable step within the window limits. There is no numeric size indicator.

Each changed axis is saved separately for **Markdown, Base, Table, Web, PDF, Image, Video, and YouTube**. The next preview of that type starts with its saved size, including a different file or URL of the same type. Base and Table remain independent preferences even though their defaults match; Video and YouTube are also independent. Unchanged profiles and axes retain their defaults. Opening a preview or resizing the app window does not save a new preference.

With a Task Editor alongside Markdown, the editor keeps its preferred width and the source fits the remaining space. Both start at the same top edge; the editor may be shorter and scrolls internally when needed. Changing the source height also changes the editor's maximum height. An editor-only workspace keeps the same source-based top alignment, with its own height limit. Size controls are hidden while only the editor is visible.

If the window becomes too narrow for both panels, the source hides temporarily and **Show source** is disabled until enough space returns. The previous visibility returns when the window widens. Neither this adjustment nor a panel show/hide action saves a new size preference.

These preferences belong to the vault's Operon settings; another vault has its own preferences unless you transfer a settings backup. Size controls live on the preview, with no additional Settings menu. [[DOCS-134 Backup and restore settings|Settings backups]] include the saved sizes, and **Reset Settings** clears those overrides. A failed preference save reports the problem and leaves the current preview available.

## Window controls

**Task Editor position**, under **Settings → Operon → Interface → Task Editor → Layout and opening**, also chooses the side of the control rail on all desktop lightboxes with these buttons. Each new lightbox takes the current preference; already open levels keep theirs. Web, Base, Table, and media previews follow it too.

| Visible panels | Right preference | Left preference |
|---|---|---|
| Markdown and Task Editor | Markdown · controls · Editor | Editor · controls · Markdown |
| Only Markdown or another preview | Centered content; controls on its right | Centered content; controls on its left |
| Only Task Editor | Editor on the right; controls on its left | Editor on the left; controls on its right |

The upper group uses this order, omitting controls that do not apply. Hidden buttons leave no empty slots:

| Control | Action |
|---|---|
| Close | Return to the previous preview or the surface underneath |
| Show source / Hide source | Add or hide Markdown while keeping the Task Editor open |
| Show task editor / Hide task editor | Add or hide task fields while keeping Markdown open |
| Open in new tab | Move the current content into a focused Obsidian tab |
| Open to the right | Open the current content in a split to the right of the original tab |
| Open below | Open the current content in a split below the original tab |

The panel buttons appear only for a suitable task workspace, and the last visible panel cannot be hidden. Tab and split actions are offered for the source or preview, not an editor-only workspace. The middle of the rail holds **Increase height** above **Decrease height**. Width buttons remain below the source or preview, never below the Task Editor. Short windows compact or reposition controls to keep the groups apart.

Mirroring changes positions, not action meanings: **Open to the right** still opens a right split. The split controls use the tab from which the preview chain started, even if another tab later became active. If that tab is no longer available in the same window, the preview stays open with a short explanation. The content's supported view state and position carry over when it is opened in a tab or split.

The bottom of the same side rail contains **Moon** to darken the background and **Sun** to lighten it. These appear while the source or preview is visible and are hidden in an editor-only workspace. Each moves to the next available dimming setting and saves directly to **Lightbox background dimming** in Workspace Tweaks. There is no numeric indicator beside the preview; the dropdown shows the saved starting level. Dimming and preview size use separate sets of steps.

The full choice of levels, defaults, and nesting calculation is documented in [[DOCS-098 Workspace Tweaks|Workspace Tweaks]]. Task Creator, Finder, standalone Task Editor dialogs, and the standalone Dynamic Subtasks Filter also share that backdrop setting. The shared desktop Task Editor workspace uses the controls above; the other dialogs do not gain a lightbox rail.

The controls use neutral, theme-based backgrounds and borders, with 6 px corners matching the preview frame. With a pointer, they hide while you are over the content and appear when you move over the dimmed backdrop or a control's own area. As soon as the content is ready, Operon checks the pointer’s current position and applies this visibility rule immediately, without an additional hover delay. You do not need to move the pointer again after loading. Later pointer movement updates visibility directly. A control reached with **Tab** appears immediately with its focus ring, even over the content. The panel buttons use only the Operon hover tooltip.

Opening a preview does not automatically focus Close or another management button. Focus starts in the preview shell or its content; Inline Source opening retains the caret position described above. All available controls remain reachable by keyboard.

## Nested previews and returning

Opening another Operon-handled link or task editor from a preview can open a child level. The lower level remains visible beneath the dimming, but only the top level is interactive. Markdown and Task Editor together count as one level. Closing the child restores the previous view, including its position and any preserved task draft. A source Description/Note popover keeps its draft while its child preview is open. Native navigation inside a file or web view keeps its own behavior.

Use **Close**, the backdrop, or **Escape** to close only the top level, including a source-only lightbox. An open menu or picker receives Escape first; active text composition is not interrupted. An embedded web page may handle keys inside its own content, so Close remains available. Returning from a preview restores focus to the living source control, while opening a tab or split leaves focus at the destination.

## Editing and save protection

Markdown, Bases, and Tables keep their existing save paths; there is no second editor or separate Save system. Merely viewing a file does not request a task edit or a rewrite of the file. Your deliberate edits inside a native view are real edits to the original data.

Before closing or transferring an editable view, Operon waits for the relevant pending native or Table saves. In a shared Task Editor workspace, pending task-field edits are also saved, including edits in a hidden panel. Navigating to another note first settles the current Task Editor draft without waiting for the normal autosave delay. A failed save or a new task edit during that save keeps the current context available. Opening or closing a lightbox does not close or rearrange your existing workspace tabs.

A Description/Note popover is different from a native file view: opening a preview preserves its unsaved draft without dismissing or saving it. Finish the popover edit before using a new-tab or split action from that preview chain. Operon blocks that transfer while an unfinished popover draft remains. See [[DOCS-113 Text field editor popover|Text field editor popover]] for its normal dismissal and save behavior.

## Hover preview

- Local modifier-hover uses Obsidian's **Page Preview** when enabled, following the user's preview preferences.
- HTTP/HTTPS links retain their URL tooltip; there is no separate web hover browser.
- Task Image and Task Gallery keep their small normal-hover media preview. Click its header/open control or its image once to open the lightbox.
- For local media, an active modifier-hover Page Preview replaces the small media preview, so both do not appear together. With Page Preview disabled, the existing media preview remains available.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-021 Task Editor|Task Editor]]
- [[DOCS-041 Task chips display and behavior|Task chips: display and behavior]]
- [[DOCS-112 Table cells display and behavior|Table cells: display and behavior]]
- [[DOCS-098 Workspace Tweaks|Workspace Tweaks]]
- [[DOCS-113 Text field editor popover|Text field editor popover]]
- [[DOCS-138 Task images and galleries|Task images and galleries]]
- [[DOCS-114 Table files|Table files]]
- [[DOCS-042 Contextual menu actions|Contextual menu actions]]
- [[DOCS-053 Time session history|Time session history]]
