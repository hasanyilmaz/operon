---
Notes: Manage additional File and Inline Task properties, their declared types, supported surfaces, and safe editing
Icon: scan-search
Color: "#ca8a04"
Updated: 2026-10-29T18:42:56+01:00
---

# Vault Properties

Vault Properties let you work with additional data on a task without first defining a Custom Key. A File Task stores them in frontmatter; an Inline Task stores them on its task line. Examples include a book's `Author`, a project's `Budget`, or a `Reviewed` checkbox.

They participate in the same persistent task index as built-in and custom fields. Task Editor, supported template fields in Task Creator, and main and embedded Tables can use them. Their names, types, and editing rules still matter: shared indexing does not give every property every built-in task behavior.

See [[DOCS-018 Task properties|Task properties]] for the comparison with canonical keys, Custom Keys, and Key Mapping.

> **MEDIA-DOCS-115-1:** The Table column picker, with a "File task properties" group listing frontmatter properties discovered from the current scope.

![MEDIA-DOCS-115-1 - The column picker's File task properties group](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-115-1.png)

## Names and sources

A Vault Property keeps its source name. Operon resolves built-in and configured custom names through their mappings instead of presenting the same field again as an unrelated native property. Reserved names such as `aliases`, `cssclasses`, `position`, `tags`, `title`, and `pinned`, along with names beginning with `_`, are not ordinary editable Vault Properties.

On an Inline Task, the values belong to that individual task line, not automatically to every task in the containing note. On a File Task, they come from the task note's frontmatter. Main and embedded Table property catalogs can include declared supported properties as well as properties found on tasks; an offered column does not mean every row has a value.

Displaying an Operon Table column does not by itself add that property to the tasks. If a deleted custom key was only shown as a column, that display alone does not block recreating the name with a different type. Existing values, empty source properties, and dependent filters, sorts, groups, or summaries still matter. See [[DOCS-040 Custom keys|Custom keys]] for the full reuse rules.

## Types and read-only states

Native editing supports **Text, List, Number, Checkbox, Date, and Date & time**. Assign the property type in Obsidian's Properties controls. Obsidian's `Multitext` declaration corresponds to List. Operon also preserves the interpretation needed to read existing inline values safely.

Configured **Custom Keys** are an exception to manual type assignment: Operon fills missing Obsidian declarations when a new key is saved and for existing keys at startup. Separately assigned, incompatible Obsidian types are preserved. An explicit recreation of an unused deleted custom key may replace its retained type only after the checks in [[DOCS-040 Custom keys|Custom keys]]. Ordinary Vault Properties still need a declared type, and all values must remain compatible with it.

| State | What it means |
|---|---|
| Supported declared type and compatible value | The supported native control can edit it |
| Automatic or no declared type | No verified native editing type; the property remains read-only |
| Conflicting aliases or types | Operon cannot safely choose one interpretation |
| Unsupported or incompatible value | Operon preserves the source instead of coercing it into another value |
| Source not ready or no longer current | Editing waits for a valid source or requires a refreshed view |

Automatic properties can remain visible in Task Editor with a red shield and an explanation. Read-only warnings also apply to empty Table cells. A display or filter type inferred from a value is not permission to write that value through the native editor.

Nested objects and unsupported list members do not become editable merely because the property is indexed. Correct the type or source value deliberately rather than expecting Operon to discard the unsupported part.

## Where you can use them

| Surface | Support |
|---|---|
| Task Editor desktop layout | Additional combines custom and Vault Properties. Existing empty properties can appear as header shortcuts. Supported values can be edited; protected values explain their read-only state. |
| Task Creator | Supported template properties, including empty fields, are prepared before creating either a File or Inline Task. User edits are retained through template changes. Unsupported fields follow the creation mode's restrictions. |
| Main and embedded Tables | File and Inline property values can be displayed and edited through supported cells, with Table search, sorting, grouping, and summaries appropriate to the type. |
| Other filter surfaces | Existing File Task frontmatter conditions remain available in filters used by Filter View, Calendar, Kanban, and their supported previews and embeds. Do not assume native Inline Table support extends the same property to every Filter View, Calendar, or Kanban query. |
| Kanban columns and swimlanes | Suitable declared Text, Number, Date, Date & time, Checkbox, and List properties can be selected for either axis. Inline values belong to each task line; File Task values come from its frontmatter. See [[DOCS-153 Kanban presets\|Kanban presets]]. |
| Task chips | A Vault Property does not automatically create a chip. Configured Custom Key chip surfaces retain their own limits. |

The desktop Task Editor layout also runs on phones when selected. The separate existing mobile layout keeps its own controls; do not assume desktop Additional support changes that layout. See [[DOCS-101 Mobile General|Mobile General]].

### Which properties are offered

Additional and Creator's property selection include eligible active custom keys even if no note uses them yet, along with supported normal properties used in the vault. Properties on the current task, supplied by a template, or already in a draft remain available. A leftover type declaration alone does not make a deleted, unused field reappear. Type checks and surface visibility preferences still apply.

This does not narrow Table's column catalogs to the same list. A declared property can still be offered as a Table column without being automatically offered as an unused field in Creator or Additional.

### Field icons

If a native property matches an active Custom Key by canonical or visible name, Creator, Task Editor, and native Table controls use its configured icon. Without a configured custom icon, normal property-type icons remain the fallback. A read-only warning remains visible when applicable, and Checkbox value indicators follow the rules below.

## Editing and removing values

Open a supported property control to change its value. Its type determines whether you get text, numeric, date, datetime, list, or Checkbox editing. A Table cell's **Remove property** action deletes the property from that task's source; clearing an editable value and removing the property are different operations.

On desktop Tables, a complete, existing wikilink in a **Text** value or individual text **List** item opens the [[DOCS-151 Lightbox|lightbox]]. Plain text, mixed text, HTTP Text values, and missing targets retain the normal editor or picker. List members are evaluated separately; other native member types are not converted to links. The cell area outside the link remains the editing entry point. This changes navigation, not the property's source name, type, or save path.

Supported Text pickers show the current value above an empty search field. Click the current value to edit it; supported multiline values use the shared text editor and retain their content. Text and List controls in Task Editor and Task Creator reuse the shared value pool, including compatible Inline Task and frontmatter values. Native list suggestions preserve member types and separators; opening a picker does not write a value. See [[DOCS-070 Custom field pickers|Custom field pickers]] and [[DOCS-112 Table cells display and behavior|Table cells]].

These distinctions matter:

- `false` is a saved Checkbox value, not an absent property.
- `0` is a saved Number value, not an empty value.
- Missing, null, empty text, and an empty list are different source states, even when their compact display looks similar.
- Native lists preserve order and repeated members. They can distinguish a number from quoted numeric text and an empty list from a list containing an empty string.

For native inline syntax and quoted list members, see [[DOCS-012 Inline task syntax|Inline task syntax]]. Creation rules can omit empty Inline template fields; that is separate from interpreting an existing task's stored values.

## Checkbox icons

The default property-type icon is a **dashed square**. A configured type icon is retained. Value controls show a **checked box for true** and an **empty box for false**. A missing value is not false. Table headers describe the property type rather than the boolean value of any one row.

This also applies to existing supported Checkbox value displays; it does not register Checkbox as a new general Custom Key picker or chip surface.

## Conflicts and saved views

Editing checks the source so an outdated value cannot silently overwrite a newer one. If the source or its type changed, refresh and review the current value before trying again. A read-only explanation takes priority over a shortened-value tooltip.

Saved property rules can outlive the values currently in scope. A missing property and a property whose type changed need different treatment: retain the saved rule, but review a type-change warning rather than assuming the old comparison still means the same thing. See [[DOCS-073 Filter conditions and operators|Filter conditions and operators]].

## Choosing a Custom Key instead

Use a Custom Key when you want its configured field identity and supported surface preferences. Keep a property native when Additional, template preparation, and Table controls meet your needs. Neither choice moves task values into the index as their only copy: Markdown remains the source; the persistent index supports loading and queries.

## FAQ

**Do I need to create a Custom Key first?** No. A supported property declaration and compatible source value are sufficient for native editing on the supported surfaces.

**Can an Inline Task have Vault Properties?** Yes. They belong to its inline fields, independently of the containing note's frontmatter.

**Why is my property read-only?** Check for Automatic, a type conflict, an unsupported value, or an unavailable source. The control explains the applicable reason.

**Does indexing it make it available everywhere?** No. Table, Editor, Creator, chips, and filter surfaces have distinct support. Use the surface table above.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-018 Task properties|Task properties]]
- [[DOCS-039 Key mappings|Key mappings]]
- [[DOCS-040 Custom keys|Custom keys]]
- [[DOCS-070 Custom field pickers|Custom field pickers]]
- [[DOCS-020 Task Creator|Task Creator]]
- [[DOCS-021 Task Editor|Task Editor]]
- [[DOCS-106 Table columns|Table columns]]
- [[DOCS-107 Table grouping and sorting|Table grouping and sorting]]
- [[DOCS-108 Table summaries|Table summaries]]
- [[DOCS-073 Filter conditions and operators|Filter conditions and operators]]
