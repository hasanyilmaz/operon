---
Up:
  - "[[DOCS-020 Task Creator|Task Creator]]"
  - "[[DOCS-062 Field pickers overview|Field pickers overview]]"
  - "[[DOCS-039 Key mappings|Key mappings]]"
Notes: Walk through writing a task and triggering field pickers in the Task Creator
Icon: square-pen
Color: "#0F766E"
tags:
  - operon
  - taskcreator
  - capture
  - pickers
  - howto
Updated: 2026-06-25T16:47:21
---

# How to create a task with Task Creator

The [[DOCS-020 Task Creator|Task Creator]] is one of the surfaces you will use most, so it is worth knowing its flow well. The reference for the dialog is [[DOCS-020 Task Creator|Task Creator]]; this page is the how-to: how you actually write a task and add fields through pickers, step by step. The flow feels close to writing an inline task, with one difference: there is no free-text parsing here, so you name a field and pick its value rather than hoping the text is read for you.

> **MEDIA-DOCS-094-1:** The Task Creator with a description being typed and a field suggestion list open.

![MEDIA-DOCS-094-1 - The Task Creator with a description being typed and a field suggestion list open](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-094-1.png)

## Open the creator and pick a shape

Run **[[DOCS-084 Create New Operon Task|Create New Operon Task]]** to open the dialog, and choose whether the task is an [[DOCS-011 Inline tasks|inline task]] or a [[DOCS-013 File tasks|file task]]. You can change everything else as you go.

If you usually create file tasks, set **Default to File Task in Task Creator** in **Settings → Operon → Tasks → File Tasks → New File Task Creation Defaults**. Then this dialog opens with File selected instead of Inline. You can also set **Default file task template** there, so your usual template is already selected when the creator is in File mode.

## Step 1: Write the description

Type the task itself in the description field. This text is the task's words, the part you read later to know what to do. Write it as plainly as you would write a note to yourself.

## Step 2: Trigger a field by naming it

When you want to add a field, start typing its name inside the description. After **two letters** that begin a field's name, a suggestion list appears with the fields that match, plus tags. Move with the arrow keys and press Enter, or click, to choose one.

The name the suggestion matches is the field's **property name**, the one you see, not its canonical key. By default a field's property name is the same as its canonical key, so out of the box you type the start of the canonical name:

| Type the start of | Field | Picker that opens |
|---|---|---|
| `status` | status | [[DOCS-065 Status and priority picker\|Status and priority picker]] |
| `priority` | priority | [[DOCS-065 Status and priority picker\|Status and priority picker]] |
| `repeat` | repeat (recurrence) | [[DOCS-064 Recurrence picker\|Recurrence picker]] |
| `assignees` | assignees | [[DOCS-069 Task link and list pickers\|Task link and list pickers]] |
| `date` | a date field, such as dateDue or dateScheduled | [[DOCS-063 Date and time picker\|Date and time picker]] |

A short token is enough, so `stat` is plenty for status. Typing `date` lists the date fields so you can pick the one you mean.

## If you renamed a field, type its new name

This is the part that surprises people. The suggestion matches your **property name only**, never the canonical key. So if you renamed a field through [[DOCS-039 Key mappings|key mappings]], the canonical key no longer triggers the picker; you type the name you gave the field.

| Canonical key | If you renamed its property to | Type the start of |
|---|---|---|
| priority | Importance | `imp` |
| dateDue | Deadline | `dead` |
| status | Stage | `sta` |

So after renaming `priority` to `Importance`, typing `pri` brings up nothing for it; you type `imp`. The canonical key still lives in the stored data and on inline task lines, but in the creator you reach a field by the name you actually see. See [[DOCS-039 Key mappings|Key mappings]].

## Step 3: Pick the value

Choosing a field opens its picker, the same one Operon uses everywhere. Which picker opens is decided by the field, the dispatch explained in [[DOCS-062 Field pickers overview|Field pickers overview]]. Pick the value the picker offers and it is set.

This is where the no-parsing point matters: you do not write "next friday" into the description and expect a due date. You name the date field, its [[DOCS-063 Date and time picker|date picker]] opens, and you set the date there. The picker itself can accept natural-language input, but the description text is never parsed on its own.

> **MEDIA-DOCS-094-2:** A picker open over the Task Creator, with the toolbar of field buttons below the description.

![MEDIA-DOCS-094-2 - A picker open over the Task Creator, with the toolbar of field buttons below the description](https://raw.githubusercontent.com/hasanyilmaz/operon/main/docs/media/MEDIA-DOCS-094-2.png)

## Step 4: The value is set on the field

When you pick a value, it is stored on that field. The description text stays as the task's words; the value does not get written into it. Below the description is a **toolbar with a button for each field**, and that button reflects whether the field is set, so a glance tells you which fields the task already carries. Open a field again to change or clear it.

The toolbar is also a second way to add fields: instead of typing a name, you can click a field's button to open its picker directly. Typing the name and clicking the button reach the same pickers.

Repeat the loop as many times as you like: name a field (or click its button), choose it, and pick a value.

## Set a parent to inherit its fields

If you give the task a **parent**, by naming the `parentTask` field and picking a task, the parent's inheritable fields apply to your new task at once, and you can see them take effect on the toolbar as those field buttons become active. This follows Operon's [[DOCS-058 Operon inheritance rules|inheritance rules]].

Two things make this safe to use:

- **Your own choices are kept.** A field you set yourself before choosing the parent is treated as explicit and is not overwritten by inheritance. Only the fields you had not set pick up the parent's value.
- **Inherited values are still yours to change.** An inherited value behaves like any other: open the field and pick a new value to replace it. Clearing the parent later removes the values that came only from inheritance, while the ones you set yourself stay.

So you can set a couple of fields deliberately, attach a parent for the rest, and adjust anything the parent brought in.

A parent can also decide **where** an inline task is saved. With **Parent-Aware Inline Task Placement** turned on (Settings → Operon → Tasks → Inline Tasks), a new inline task that has a parent is written next to that parent: **below the parent** when the parent is an inline task, or **inside the parent file** when the parent is a file task, instead of your default inline save location. Left at the default, the task goes to your usual location and the parent link still holds. See [[DOCS-016 Parent and sub-tasks|Parent and sub-tasks]].

## Step 5: Inline or file, and how each is saved

You finish by choosing the task's shape with the **Inline** and **File** buttons at the bottom, and the two save differently:

- **Inline** creates the task directly as an [[DOCS-011 Inline tasks|inline task]] with the fields you set, following your inline-task settings for where it is placed. Nothing else is asked.
- **File** creates a [[DOCS-013 File tasks|file task]], a note of its own, from a **file-task template**. A template picker lets you choose which template to use, and the new note is created from it. See [[DOCS-024 Task templates|Task templates]].

If **Default to File Task in Task Creator** is enabled, the creator reaches this step with **File** already selected. If **Default file task template** is also set, that template is preselected; you can still change it for the current task before saving.

Either way, the canonical `{{key:: value}}` syntax is written for you, and the task appears in your views right away.

## Why the flow works this way

It keeps capture fast and deliberate. You stay in one place writing the task, and you reach for a field only when you mean to, without leaving the keyboard or memorizing syntax. Because every value comes from a picker, the data stays consistent across your vault.

## FAQ

**Do I type `{{key:: value}}` here?** No. The creator writes the syntax for you; you only name a field and pick its value.

**Why did no suggestion appear?** The field-name token needs at least two letters and must start an actual field name. Renamed fields use the name you gave them.

**Can I type a date in words?** Not in the description. Name the date field, and the date picker that opens accepts natural-language input there.

**Can I skip choosing File and a template every time?** Yes. Use **Default to File Task in Task Creator** and **Default file task template** in the File Tasks settings.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
