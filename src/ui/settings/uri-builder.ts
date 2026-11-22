import { AbstractInputSuggest, type App, getIcon, Notice, Setting, type ButtonComponent } from 'obsidian';
import { t } from '../../core/i18n';
import type { OperonCommandEntry } from '../../core/operon-command-catalog';
import { buildOperonUri } from '../../core/operon-uri';
import type { OperonCommandLinks } from '../../systems/operon-command-links';

class CommandSuggest extends AbstractInputSuggest<OperonCommandEntry> {
	constructor(app: App, input: HTMLInputElement, private readonly links: OperonCommandLinks,
		private readonly choose: (entry: OperonCommandEntry) => void, private readonly status: HTMLElement) {
		super(app, input);
	}

	getSuggestions(query: string): OperonCommandEntry[] {
		const words = query.toLocaleLowerCase().trim().split(/\s+/u).filter(Boolean);
		const results = words.length ? this.links.entries.filter(entry => {
			const text = ('Operon: ' + entry.name).toLocaleLowerCase();
			return words.every(word => text.includes(word));
		}) : [];
		this.status.setText(words.length && !results.length ? t('settings', 'uriNoMatches') : '');
		return results;
	}

	renderSuggestion(entry: OperonCommandEntry, el: HTMLElement): void { el.setText(entry.name); }

	selectSuggestion(entry: OperonCommandEntry): void {
		this.choose(entry);
		this.close();
	}
}

export function renderUriBuilder(app: App, el: HTMLElement, links: OperonCommandLinks) {
	const command = new Setting(el).setName(t('settings', 'uriCommand'));
	command.settingEl.addClass('operon-uri-builder-command');
	const icon = getIcon('search');
	if (icon) {
		icon.setAttribute('aria-hidden', 'true');
		command.controlEl.prepend(icon);
	}
	const input = command.controlEl.createEl('input', { type: 'search', attr: {
		autocomplete: 'off', spellcheck: 'false', placeholder: t('settings', 'uriSearch'), 'aria-label': t('settings', 'uriCommand'),
	} });
	const status = command.descEl;
	status.setAttribute('role', 'status');
	const result = new Setting(el).setName('URI');
	result.settingEl.addClass('operon-uri-builder-result');
	const output = result.controlEl.createEl('input', { type: 'text', attr: { readonly: '', 'aria-label': 'URI' } });
	let selectedId: string | undefined;
	let copy: ButtonComponent;
	result.addButton(button => {
		copy = button;
		button.setButtonText(t('settings', 'uriCopy')).setDisabled(true).onClick(async () => {
			refresh();
			if (!output.value) return;
			try {
				await navigator.clipboard.writeText(output.value);
				new Notice(t('notifications', 'linkCopied'));
			} catch {
				output.select();
				new Notice(t('notifications', 'clipboardWriteFailed'));
			}
		});
		const icon = getIcon('copy');
		if (icon) button.buttonEl.prepend(icon);
	});
	function refresh(): void {
		const selected = selectedId ? links.entries.find(entry => entry.id === selectedId) : undefined;
		if (selected) input.value = selected.name;
		else if (selectedId) { selectedId = undefined; input.value = ''; }
		output.value = selected ? buildOperonUri(app.vault.getName(), selected.target) : '';
		copy.setDisabled(!selected);
	}
	const suggest = new CommandSuggest(app, input, links, entry => {
		selectedId = entry.id;
		status.setText('');
		refresh();
	}, status);
	const onEdit = () => { selectedId = undefined; refresh(); };
	input.addEventListener('input', onEdit);
	const unsubscribe = links.subscribe(() => {
		refresh();
		suggest.close();
	});
	return { input, dispose() {
		unsubscribe();
		input.removeEventListener('input', onEdit);
		suggest.close();
	} };
}
