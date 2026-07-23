---
Notes: How a custom key's type decides which picker you get to fill it
Icon: sliders-horizontal
Color: "#db2777"
Updated: 2026-07-23T16:45:34
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

A `Checkbox` custom key is stored, but it does not get a picker surface yet, so it is not offered in the editor, creator, or chips. See [[DOCS-040 Custom keys|Custom keys]].

## Each type in practice

### Text

A text field opens a box where you type the value, with **suggestions** drawn from values already used for that field on other tasks. So a custom `Client` key learns your client names as you go, and you reuse them with a keystroke instead of retyping. Best for short labels and free text.

### Number

A number field takes a quantity. Best for counts, scores, or amounts. This is the same numeric control the built-in `estimate` uses. See [[DOCS-069 Task link and list pickers|Task link and list pickers]].

### Date and Date & time

A `Date` custom key opens the **same date picker** the built-in dates use, natural-language input and all, and a `Date & time` key opens the **date and time picker**. So a custom date behaves exactly like a due date: type "next friday" and it just works. See [[DOCS-063 Date and time picker|Date and time picker]].

### List

A list field opens a **list picker** you add several values to, building a list rather than a single value. Best when a field can have more than one entry, like multiple labels. It works like the built-in list fields. See [[DOCS-069 Task link and list pickers|Task link and list pickers]].

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

**My checkbox custom field has no control. Why?** Checkbox custom fields are stored but not surfaced in pickers yet.

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
