---
Notes: Install the plugin and turn it on
Icon: download
Color: "#16a34a"
Updated: 2026-07-23T16:45:34
---

# Install and enable Operon

Operon installs like a normal Obsidian community plugin. There is no task server to run and no required companion plugin. It works inside the vault, using Obsidian's plugin system and Markdown files as the base.

The plugin id is `operon`.

## Requirements

Operon requires Obsidian `1.7.2` or newer. It is not desktop-only, so it runs on both desktop and mobile. Some workflows are simply more comfortable on a larger screen: Calendar planning, Kanban boards, and the denser settings panels have more room to breathe on desktop.

**Get Operon:** [Operon on the Obsidian community plugins directory](https://community.obsidian.md/plugins/operon)

## Install from Community Plugins

1. Open Obsidian **Settings**.
2. Go to **Community Plugins**.
3. Browse for `Operon`.
4. Install the plugin.
5. Enable it.

That is the regular path. No separate beta installer or manual installation is needed. If you are testing a development build, follow the instructions for that build instead; this page covers the public user path.

## Confirm it loaded

After enabling Operon, open the command palette and search for `Operon`. You should see commands such as **Create New Operon Task**, **Create or edit inline task**, and **Create file task**. Seeing them is the quickest sign that the plugin is loaded and ready.

For a gentle first action, create one small inline task. A real workflow can wait. The first goal is just to confirm Operon can write and find a single task in your vault.

## Staying up to date

Operon can check GitHub for a newer compatible release once each time it starts, and shows a notice pointing you to Community Plugins when one is available. This is on by default; turn it off in **Settings → Operon → Core → General** if you would rather update on your own schedule. The check itself never installs anything, it only tells you an update exists.

## Compatibility

Operon does not require another community plugin. Some workflows lean on Obsidian core features: Daily Notes can support date-based capture, and Page Preview improves hover previews when task titles or wikilinks are shown.

There is one optional community-plugin integration. If the **Maps** plugin is enabled, location chips gain a visual map: the picker shows a **Map** tab and the chip can open a map preview popup. Location chips work fine without it, using place notes or manual coordinates; the Maps plugin only adds the visual map on top.

The main compatibility risk is another task plugin that also rewrites checkbox lines, renders task rows, manages recurrence, or adds planning views over the same tasks. Two plugins can share a vault, but they should not both try to own the same task lines. If you already use another task-management plugin, test Operon on a small set of notes first.

## FAQ

**What is the minimum Obsidian version?** Operon requires Obsidian `1.7.2` or newer.

**Does Operon work on mobile?** Yes. It is not desktop-only. Some workflows are easier on desktop, but mobile is supported.

**Do I need another plugin?** No. Operon stands on its own. It can optionally use Obsidian core features like Daily Notes and Page Preview, and the community **Maps** plugin, which adds a visual map preview to location chips.

**Does Operon update itself?** No. It can check GitHub on startup and notify you when a newer compatible release is out, but you still update it yourself through Community Plugins. See **Settings → Operon → Core → General** to turn the check off.

## Next step

Before you create a lot of tasks, set up a few basics. See [[DOCS-008 Essential settings to configure first|Essential settings to configure first]].

## Related

- [[DOCS-001 Operon Docs MOC|Operon Docs MOC]]
- [[DOCS-003 Getting started with Operon|Getting started with Operon]]
- [[DOCS-009 Create your first task|Create your first task]]
- [[DOCS-005 Operon core concepts|Operon core concepts]]
