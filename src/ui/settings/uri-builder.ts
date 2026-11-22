import { AbstractInputSuggest, type App, getIcon, Notice, Setting, type ButtonComponent } from 'obsidian';
import { getCurrentLang, t } from '../../core/i18n';
import type { OperonCommandEntry } from '../../core/operon-command-catalog';
import { buildOperonUri } from '../../core/operon-uri';
import type { OperonCommandLinks } from '../../systems/operon-command-links';

let nextListId = 0;

class CommandSuggest extends AbstractInputSuggest<OperonCommandEntry> {
	private readonly listId = `operon-uri-commands-${++nextListId}`;
	private optionList: HTMLElement | null = null;
	private activeOption: HTMLElement | null = null;
	private readonly selectionObserver = new MutationObserver(() => this.syncActiveOption());

	constructor(app: App, private readonly input: HTMLDivElement, private readonly links: OperonCommandLinks,
		private readonly choose: (entry: OperonCommandEntry) => void, private readonly status: HTMLElement) {
		super(app, input);
		this.limit = 0;
	}

	getSuggestions(query: string): OperonCommandEntry[] {
		const language = getCurrentLang();
		const words = query.toLocaleLowerCase(language).trim().split(/\s+/u).filter(Boolean);
		const results = words.length ? this.links.entries.filter(entry => {
			const text = ('Operon: ' + entry.name).toLocaleLowerCase(language);
			return words.every(word => text.includes(word));
		}) : this.links.entries;
		this.status.setText(words.length && !results.length ? t('settings', 'uriNoMatches') : '');
		return results;
	}

	renderSuggestion(entry: OperonCommandEntry, el: HTMLElement): void {
		const list = el.parentElement;
		if (list && this.optionList !== list) {
			this.selectionObserver.disconnect();
			this.optionList = list;
			list.id = this.listId;
			list.setAttribute('role', 'listbox');
			list.setAttribute('aria-label', t('settings', 'uriCommand'));
			// Obsidian owns keyboard and pointer navigation. Mirror its highlighted row.
			this.selectionObserver.observe(list, { subtree: true, attributes: true, attributeFilter: ['class'] });
		}
		el.id = `${this.listId}-${entry.id}`;
		el.setAttribute('role', 'option');
		el.setAttribute('aria-selected', 'false');
		el.setText(entry.name);
	}

	override open(): void {
		super.open();
		this.input.setAttribute('aria-controls', this.listId);
		this.input.setAttribute('aria-expanded', 'true');
		this.syncActiveOption();
	}

	private syncActiveOption(): void {
		const active = this.optionList?.querySelector<HTMLElement>('[role="option"].is-selected') ?? null;
		if (this.activeOption === active) return;
		this.activeOption?.setAttribute('aria-selected', 'false');
		this.activeOption = active;
		if (active) {
			active.setAttribute('aria-selected', 'true');
			this.input.setAttribute('aria-activedescendant', active.id);
		} else {
			this.input.removeAttribute('aria-activedescendant');
		}
	}

	override close(): void {
		this.selectionObserver.disconnect();
		this.optionList = null;
		this.activeOption = null;
		this.input.removeAttribute('aria-activedescendant');
		this.input.removeAttribute('aria-controls');
		this.input.setAttribute('aria-expanded', 'false');
		super.close();
	}

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
	const input = command.controlEl.createDiv({ cls: 'operon-uri-builder-field', attr: {
		contenteditable: 'plaintext-only', role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false', spellcheck: 'false',
		'data-placeholder': t('settings', 'uriSearch'), 'aria-label': t('settings', 'uriCommand'),
	} });
	const status = command.descEl;
	status.setAttribute('role', 'status');
	const result = new Setting(el).setName('URI');
	result.settingEl.addClass('operon-uri-builder-result');
	const output = result.controlEl.createDiv({ cls: 'operon-uri-builder-field', attr: {
		role: 'textbox', 'aria-readonly': 'true', 'aria-label': 'URI', tabindex: '0', dir: 'ltr',
	} });
	let selectedId: string | undefined;
	let copy: ButtonComponent;
	result.addButton(button => {
		copy = button;
		button.buttonEl.setAttribute('aria-label', t('settings', 'uriCopy'));
		button.setIcon('copy').setDisabled(true).onClick(async () => {
			refresh();
			const uri = output.textContent;
			if (!uri) return;
			try {
				await navigator.clipboard.writeText(uri);
				new Notice(t('notifications', 'linkCopied'));
			} catch {
				output.focus();
				output.ownerDocument.getSelection()?.selectAllChildren(output);
				new Notice(t('notifications', 'clipboardWriteFailed'));
			}
		});
	});
	function refresh(): void {
		const selected = selectedId ? links.entries.find(entry => entry.id === selectedId) : undefined;
		if (selected && input.textContent !== selected.name) input.setText(selected.name);
		if (selectedId && !selected) { selectedId = undefined; input.setText(''); }
		output.setText(selected ? buildOperonUri(app.vault.getName(), selected.target) : '');
		copy.setDisabled(!selected);
	}
	const suggest = new CommandSuggest(app, input, links, entry => {
		selectedId = entry.id;
		status.setText('');
		refresh();
	}, status);
	const onEdit = () => {
		selectedId = undefined;
		if (!input.textContent) input.empty(); // Browsers may leave a line break in an empty editable.
		refresh();
	};
	const onClick = () => {
		// Focus opens suggestions initially. Reopen on a second click after Escape as well.
		if (!input.textContent) input.dispatchEvent(new Event('input'));
	};
	const onBeforeInput = (event: InputEvent) => {
		if (event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak') event.preventDefault();
	};
	input.addEventListener('beforeinput', onBeforeInput);
	input.addEventListener('click', onClick);
	input.addEventListener('input', onEdit);
	const unsubscribe = links.subscribe(() => {
		refresh();
		suggest.close();
	});
	return { input, dispose() {
		unsubscribe();
		input.removeEventListener('beforeinput', onBeforeInput);
		input.removeEventListener('click', onClick);
		input.removeEventListener('input', onEdit);
		suggest.close();
	} };
}
