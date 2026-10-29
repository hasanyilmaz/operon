---
Notes: How a custom key's type decides which picker you get to fill it
Icon: sliders-horizontal
Color: "#db2777"
Updated: 2026-10-29T18:42:56+01:00
---

# Custom field pickers

A [[DOCS-040 Custom keys|custom key]] has no purpose-built picker the way `status` or `dateDue` does. Instead, Operon gives it a picker by its **property type**. The type you choose when you create the key decides how you will fill that field from then on, so it is worth choosing with the picker in mind. This page maps each type to the picker you get, so you know what you are signing up for.

## Type decides the picker

When you create a custom key you pick one of these types. Here is the control each one gives you on a task:

| Property type | What the picker is | Single or many |
|---|---|---|
| Text | A text box with suggestions from values already used | One value |
| Number | A numeric entry | One value |
| Date | The same date picker the built-in dates use | One value |
| Date & time | The same date and time picker | One value |
| List | A list picker you add several entries to | Many values |

This table describes the **general Custom Key picker path**. Its selectable types exclude Checkbox. Native Checkbox controls in Task Editor Additional, supported template fields in Task Creator, and Tables are a separate path; their availability does not mean Checkbox has been added to every Custom Key surface. See [[DOCS-115 File task property columns|Vault Properties]].

Canonical fields may have dedicated controls, Custom Keys use their configured types, and Vault Properties require compatible property declarations and values. Sharing an index does not make every picker available for every field. See [[DOCS-018 Task properties|Task properties]] for the comparison.

## Each type in practice

### Text

On supported editing paths, including Task Creator, Task Editor, task chips, and Tables, a Text picker shows its **current value above an empty search field**, with **suggestions** drawn from the shared values for that field. An empty field has no current-value control. You can search all suggestions immediately without clearing the old value. Click the current-value control to load it into the input with the text selected for editing. So a custom `Client` key learns your client names as you go, and you reuse them with a keystroke instead of retyping. Best for short labels and free text.

A supported multiline current value opens the [[DOCS-113 Text field editor popover|shared text editor]] instead of flattening it into one input line. The same current-value pattern is used for Task Type and supported Vault Property Text editing. Long and multiline values use the existing source-save and conflict checks.

### Number

A number field takes a quantity. Best for counts, scores, or amounts. A numeric property stores a number; built-in time fields such as `estimate` also have their own units and behavior. See [[DOCS-069 Task link and list pickers|Task link and list pickers]].

### Date and Date & time

A `Date` custom key opens the **same date picker** the built-in dates use, natural-language input and all, and a `Date & time` key opens the **date and time picker**. So a custom date behaves exactly like a due date: type "next friday" and it just works. See [[DOCS-063 Date and time picker|Date and time picker]].

### List

A list field opens a **list picker** you add several values to, building a list rather than a single value. Best when a field can have more than one entry, like multiple labels. It works like the built-in list fields. See [[DOCS-069 Task link and list pickers|Task link and list pickers]].

## One value pool across editing surfaces

Task Creator and Task Editor use the shared Text and List suggestion pool also used by task-chip and Table pickers. It combines ready Inline Task values with compatible vault frontmatter values. For example, if two Inline Tasks use `Client` values `Acme` and `Northwind`, both names can be offered when creating another task or editing that field in Task Editor, even if no File Task uses them.

Configured canonical and visible names resolve to the same field. Native property controls keep their declared type: list members containing separators or wikilinks are preserved, and numeric members are not silently changed into quoted text. Repeated suggestions are merged; empty, incompatible, or ambiguous values are not offered. A source that is not ready can contribute suggestions after indexing finishes and the picker is reopened.

Opening a picker only offers choices. In Task Creator, selecting a value changes the draft; the task is written when you submit Inline or File. Task Editor keeps its normal save behavior. This shared pool does not give an unsupported field a new editing surface or change the field's source format.

## Empty-search suggestions for Text and List

With no search text, the general custom-key **Text** and **List** picker path uses the same [[DOCS-062 Field pickers overview|task-based suggestion order]] as the supported built-in fields: a value from the latest eligible created task, a different value from the latest eligible modified task, then values used by the most tasks. A List field contributes at most one value to each leading suggestion.

Each custom field is counted independently. Values used for `Client` do not influence suggestions for a different custom field. Typing keeps the normal search behavior, and clearing the search restores the suggestions. The separate current-value control does not prefilter the search; the empty-search suggestions are available as soon as the picker opens.

Native property controls keep their own candidate ordering; sharing the pool does not require every surface to rank suggestions identically. Number, Date, and Date & time controls are unchanged.

## Existing wikilinks on chips and Tables

On interactive desktop task chips and Tables, a Text value that is a **complete, existing wikilink** opens the [[DOCS-151 Lightbox|lightbox]] instead of the picker. List items are tested separately. Plain text, mixed text, raw HTTP Text values, and missing targets keep their picker; previewing does not create the missing note.

Use Task Editor to change an existing linked value, or click the editable Table cell area outside its link. Creator and Task Editor field controls remain editors; Task Finder chips remain passive. See [[DOCS-041 Task chips display and behavior|Task chips]] and [[DOCS-112 Table cells display and behavior|Table cells]] for the surface rules.

## Choosing a type with the picker in mind

Because the type is the picker, choose it for how you will fill the field, not just what it holds:

- Need natural-language date entry? Use **Date** or **Date & time**.
- Want one value with reuse suggestions? Use **Text**.
- Want to add several values? Use **List**.
- Counting or measuring something? Use **Number**.

The type is set when you create the key and shapes every entry after, so decide it deliberately. See [[DOCS-040 Custom keys|Custom keys]].

## FAQ

**Why does my custom date field behave like a due date?** Because a `Date` custom key uses the same date picker. The behavior follows the type, not the field name.

**Can a custom field hold more than one value?** Yes, if its type is List. Text, Number, Date, and Date & time hold a single value.

**My Checkbox Custom Key has no general picker option. Why?** The general Custom Key surface selector excludes Checkbox. Native Checkbox editing and existing value-dependent icons do not enable that selector or add new surfaces. See [[DOCS-115 File task property columns|Vault Properties]] for supported native controls.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
