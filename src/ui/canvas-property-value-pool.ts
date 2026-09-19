import { propertyPoolDateViewContext, matchesPropertyPoolDateSearch } from '../core/property-pool-dates';
import { renderPropertyPoolValueVisual } from './property-pool-value-visual';
import { Component, Notice, setIcon } from 'obsidian';
import { t } from '../core/i18n';
import { getOwnerWindow } from '../core/dom-compat';
import { propertyPoolFields, propertyPoolFavoriteId, readPropertyPoolPreferences, searchPropertyPoolFields, type PropertyPoolEdit, type PropertyPoolValue, type PropertyPoolFavorite } from '../core/property-value-pool';
import { invalidateLocationPlaceIndex } from '../core/location-source-resolver';
import { invalidateCustomFieldValueCandidateCache } from './custom-field-surfaces';
import { PropertyPoolValueSession } from './property-value-pool-values';
import type { CanvasTaskIntegration, TaskCanvasView } from './canvas-task-adapter';
import { bindOperonHoverTooltip, cleanupOperonHoverTooltips } from './operon-hover-tooltip';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import { scrollChildIntoView } from './field-pickers/common';
import type { PropertyPoolTaskBridge } from '../core/property-pool-task-operation';
import { CanvasPropertyValueDrop } from './canvas-property-value-drop';
import type { CanvasTaskHistory } from './canvas-task-history';

export interface CanvasPropertyValuePoolPreferences {
	tasks?: PropertyPoolTaskBridge;
	edit(edit: PropertyPoolEdit, expected: unknown): Promise<void>;
	subscribe(listener: () => void): () => void;
}

/** View-owned UI; only preference edits are allowed here, never task or Canvas mutations. */
export class CanvasPropertyValuePool extends Component {
	private group: HTMLElement | null = null;
	private button: HTMLButtonElement | null = null;
	private panel: HTMLElement | null = null;
	private list: HTMLElement | null = null;
	private shortcuts: HTMLElement | null = null;
	private search: HTMLInputElement | null = null;
	private searchIcon: HTMLElement | null = null;
	private summary: HTMLElement | null = null;
	private pinButton: HTMLButtonElement | null = null;
	private session: Component | null = null;
	private values: PropertyPoolValueSession | null = null;
	private active = false;
	private pinned = false;
	private touchInput = false;
	private panelPoint: { x: number; y: number } | null = null;
	private panelFile: TaskCanvasView['file'] = null;
	private cancelPanelDrag: (() => void) | null = null;
	private query = '';
	private scope: string | null = null;
	private allValues = false;
	private limit = 25;
	private selection = 0;
	private selectedValue: PropertyPoolFavorite | null = null;
	private selectedProperty: string | null = null;
	private busy = false;
	private generation = 0;
	private searchTimer: number | null = null;
	private sourceTimer: number | null = null;
	private shortcutSignature = '';
	private drop: CanvasPropertyValueDrop | null = null;
	constructor(private view: TaskCanvasView, private owner: CanvasTaskIntegration, private preferences: CanvasPropertyValuePoolPreferences, private history?: CanvasTaskHistory) { super(); }
	private get win() { return getOwnerWindow(this.view.contentEl); }
	private get settings() { return this.owner.deps.cards.deps.getSettings(); }
	private current(): boolean { return this.active && this.owner.isCurrent(this.view) && this.view.file === this.panelFile; }

	onload(): void {
		this.active = true;
		if (this.preferences.tasks && this.history) {
			this.drop = this.addChild(new CanvasPropertyValueDrop(this.view, this.history, this.preferences.tasks, () => this.active && this.owner.isCurrent(this.view)));
		}
		this.register(this.preferences.subscribe(() => { this.drop?.invalidate(); if (this.values && !this.values.matchesSettings(this.settings)) this.values = null; this.refresh(); }));
		this.register(this.owner.deps.cards.onRefresh(() => this.invalidateSources()));
		const app = this.owner.deps.app;
		this.registerEvent(app.metadataCache.on('changed', () => this.invalidateSources()));
		this.registerEvent(app.vault.on('create', () => this.invalidateSources()));
		this.registerEvent(app.vault.on('delete', () => this.invalidateSources()));
		this.registerEvent(app.vault.on('rename', () => this.invalidateSources()));
		this.sync();
	}

	sync(): void {
		if (!this.active) return;
		const controls = this.view.canvas.canvasControlsEl;
		if (!controls?.isConnected || !this.view.canvas.wrapperEl?.isConnected) { this.close(); this.group?.remove(); return; }
		if (!this.group || !controls.contains(this.group)) {
			if (this.button) cleanupOperonHoverTooltips(this.button);
			this.group?.remove();
			this.group = controls.createDiv('canvas-control-group mod-raised operon-canvas-property-pool-tools');
			this.button = this.group.createEl('button', { cls: 'canvas-control-item', attr: { type: 'button', 'aria-expanded': String(!!this.panel) } });
			setIcon(this.button, 'list-filter');
			setAccessibleLabelWithoutTooltip(this.button, t('settings', 'propertyPoolTitle'));
			bindOperonHoverTooltip(this.button, { title: t('settings', 'propertyPoolTitle'), taskColor: null, shouldOpen: () => !this.panel });
			this.button.onpointerdown = event => { this.touchInput = event.pointerType === 'touch'; };
			this.button.onkeydown = () => { this.touchInput = false; };
			this.button.onclick = event => { event.stopPropagation(); if (this.panel) this.close(); else this.open(); };
		}
		const taskPool = controls.querySelector('.operon-canvas-task-pool-tools');
		if (taskPool && taskPool.nextElementSibling !== this.group) controls.insertBefore(this.group, taskPool.nextSibling);
		if (this.panel && !this.current()) this.close();
		else this.position();
	}

	private iconButton(host: HTMLElement, icon: string, label: string, action: () => void, tooltip = true, iconClass?: string): HTMLButtonElement {
		const button = host.createEl('button', { attr: { type: 'button' } });
		setIcon(iconClass ? button.createSpan(iconClass) : button, icon); setAccessibleLabelWithoutTooltip(button, label);
		if (tooltip) bindOperonHoverTooltip(button, { title: label, taskColor: null });
		button.onpointerdown = event => {
			this.touchInput = event.pointerType === 'touch';
			if (this.touchInput && this.search === button.ownerDocument.activeElement) event.preventDefault();
		};
		button.onkeydown = () => { this.touchInput = false; };
		button.onclick = event => { event.stopPropagation(); action(); };
		return button;
	}

	private open(): void {
		if (!this.active || !this.owner.isCurrent(this.view) || !this.button || this.panel) return;
		this.panelFile = this.view.file; this.scope = null; this.allValues = false; this.query = ''; this.limit = 25; this.selection = 0; this.selectedValue = null; this.selectedProperty = null;
		this.pinned = false; this.panelPoint = null; this.values = null; this.busy = false; this.generation++;
		const session = this.session = new Component(); this.addChild(session);
		const panel = this.panel = this.view.contentEl.ownerDocument.body.createDiv('operon-canvas-property-pool');
		panel.setAttribute('role', 'dialog'); panel.tabIndex = -1; setAccessibleLabelWithoutTooltip(panel, t('settings', 'propertyPoolTitle'));
		this.button.setAttribute('aria-expanded', 'true');
		const header = panel.createDiv('operon-canvas-property-pool-header');
		header.createEl('strong', { text: t('settings', 'propertyPoolTitle') });
		this.pinButton = this.iconButton(header, 'pin', t('settings', 'canvasTaskPoolPin'), () => {
			if (this.pinned) this.closeAndFocus(); else { this.pinned = true; this.updatePin(); }
		});
		this.updatePin();
		session.registerDomEvent(header, 'pointerdown', event => this.startPanelDrag(event));
		this.shortcuts = panel.createDiv('operon-canvas-property-pool-shortcuts');
		session.registerDomEvent(panel, 'keydown', event => this.handleShortcutKey(event), { capture: true });
		const searchWrap = panel.createDiv('operon-canvas-property-pool-search');
		this.searchIcon = searchWrap.createSpan('operon-canvas-property-pool-search-icon');
		this.search = searchWrap.createEl('input', { attr: { type: 'text', spellcheck: 'false' } });
		const search = this.search;
		this.iconButton(searchWrap, 'x', t('buttons', 'clear'), () => { const focus = !this.touchInput || search === search.ownerDocument.activeElement; this.selectScope(null, focus); });
		session.registerDomEvent(search, 'input', () => {
			this.query = search.value; this.selection = 0; this.selectedValue = null; this.selectedProperty = null; this.clearSearchTimer();
			this.searchTimer = this.win.setTimeout(() => { this.searchTimer = null; this.resetResults(); }, 120);
		});
		session.registerDomEvent(search, 'keydown', event => this.handleSearchKey(event));
		this.list = panel.createDiv('operon-canvas-property-pool-list');
		this.summary = panel.createDiv('operon-canvas-property-pool-summary'); this.summary.setAttribute('role', 'status');
		session.registerDomEvent(this.list, 'scroll', () => {
			const list = this.list;
			if (list && list.scrollTop + list.clientHeight >= list.scrollHeight - 48 && Number(list.dataset.total) > this.limit) { this.limit += 25; this.refresh(); }
		});
		session.registerDomEvent(panel, 'pointerdown', event => event.stopPropagation());
		session.registerDomEvent(panel.ownerDocument, 'pointerdown', event => {
			const target = event.target as HTMLElement;
			if (!this.pinned && !this.cancelPanelDrag && !this.drop?.dragging && !panel.contains(target) && !this.group?.contains(target) && !target.closest?.('.operon-contextual-hover-menu, .operon-floating-panel')) this.close();
		});
		session.registerDomEvent(panel, 'keydown', event => {
			if (event.key === 'Escape' && !event.defaultPrevented && !event.isComposing) { event.preventDefault(); event.stopPropagation(); this.closeAndFocus(); }
		});
		session.registerDomEvent(panel.ownerDocument, 'keydown', event => {
			const otherPool = (event.target as HTMLElement)?.closest?.('.operon-canvas-task-pool, .operon-canvas-property-pool');
			if (otherPool && otherPool !== panel) return;
			if (event.key === 'Escape' && !event.defaultPrevented && !event.isComposing) { event.preventDefault(); this.closeAndFocus(); }
		});
		const reposition = () => { this.drop?.invalidate(); this.cancelPanelDrag?.(); this.position(); };
		session.registerDomEvent(this.win, 'resize', reposition);
		const viewport = this.win.visualViewport;
		if (viewport) {
			const position = reposition;
			viewport.addEventListener('resize', position); viewport.addEventListener('scroll', position);
			session.register(() => { viewport.removeEventListener('resize', position); viewport.removeEventListener('scroll', position); });
		}
		const Resize = (this.win as Window & { ResizeObserver: typeof ResizeObserver }).ResizeObserver;
		const observer = new Resize(() => this.position()); observer.observe(this.view.contentEl); observer.observe(panel);
		session.register(() => observer.disconnect());
		let dateContext = propertyPoolDateViewContext();
		let timer: number | null = null;
		const checkDate = () => {
			if (!this.current() || this.session !== session) return;
			const next = propertyPoolDateViewContext();
			if (next !== dateContext) { dateContext = next; this.drop?.invalidate(); this.values?.refreshDates(); this.refresh(); }
		};
		const scheduleDateCheck = () => {
			if (!this.current() || this.session !== session) return;
			const now = new Date();
			const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
			timer = this.win.setTimeout(() => { checkDate(); scheduleDateCheck(); }, Math.min(60_000, Math.max(1, midnight - now.getTime())));
		};
		session.registerDomEvent(this.win, 'focus', checkDate);
		session.registerDomEvent(panel.ownerDocument, 'visibilitychange', checkDate);
		session.register(() => { if (timer !== null) this.win.clearTimeout(timer); });
		scheduleDateCheck();
		this.refresh(); (this.touchInput ? panel : search).focus({ preventScroll: true });
	}

	private invalidateSources(): void {
		this.drop?.invalidate();
		this.values = null;
		invalidateLocationPlaceIndex(this.owner.deps.app); invalidateCustomFieldValueCandidateCache(this.owner.deps.app);
		if (!this.panel || this.sourceTimer !== null) return;
		this.sourceTimer = this.win.setTimeout(() => {
			this.sourceTimer = null;
			this.values = null; this.refresh();
		}, 120);
	}
	private clearSearchTimer(): void { if (this.searchTimer !== null) this.win.clearTimeout(this.searchTimer); this.searchTimer = null; }
	private resetResults(): void { this.clearSearchTimer(); this.limit = 25; this.selection = 0; this.selectedValue = null; this.selectedProperty = null; if (this.list) this.list.scrollTop = 0; this.refresh(); }
	private selectScope(key: string | null, focus = !this.touchInput || this.search === this.panel?.ownerDocument.activeElement, allValues = false, preserveQuery = false): void {
		this.scope = key; this.allValues = allValues; this.query = preserveQuery ? this.search?.value ?? this.query : ''; if (this.search) this.search.value = this.query;
		this.resetResults(); if (focus) {
			this.search?.focus({ preventScroll: true });
			if (preserveQuery) this.search?.setSelectionRange(this.query.length, this.query.length);
		}
	}
	private handleShortcutKey(event: KeyboardEvent): void {
		if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
		const buttons = Array.from(this.shortcuts?.querySelectorAll<HTMLButtonElement>('button') ?? []);
		const current = buttons.indexOf(this.panel?.ownerDocument.activeElement as HTMLButtonElement);
		if (current < 0) return;
		if (!['ArrowLeft', 'ArrowRight', 'ArrowDown', 'Enter', ' '].includes(event.key)) return;
		event.preventDefault(); event.stopPropagation();
		if (event.key === 'ArrowDown') {
			this.search?.focus({ preventScroll: true });
			this.search?.setSelectionRange(this.search.value.length, this.search.value.length);
		} else if (event.key === 'Enter' || event.key === ' ') {
			if (!event.repeat) this.selectScope(buttons[current].dataset.poolScope || null, true, buttons[current].dataset.poolAll === 'true', true);
		} else {
			const next = buttons[(current + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length];
			this.selectScope(next.dataset.poolScope || null, false, next.dataset.poolAll === 'true', true);
			this.shortcuts?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')?.focus({ preventScroll: true });
		}
	}
	private handleSearchKey(event: KeyboardEvent): void {
		if (event.isComposing || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
		if (event.key === 'Backspace' && !event.repeat && (this.scope || this.allValues) && this.search?.value === '') {
			event.preventDefault(); event.stopPropagation(); this.selectScope(null, true); return;
		}
		if (['ArrowLeft', 'ArrowRight'].includes(event.key) && this.search?.value === '') {
			const buttons = Array.from(this.shortcuts?.querySelectorAll<HTMLButtonElement>('button') ?? []);
			if (!buttons.length) return;
			event.preventDefault(); event.stopPropagation();
			const current = buttons.findIndex(button => button.getAttribute('aria-pressed') === 'true');
			const next = current < 0 ? 0 : (current + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
			this.selectScope(buttons[next].dataset.poolScope || null, true, buttons[next].dataset.poolAll === 'true'); return;
		}
		if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
		event.preventDefault(); event.stopPropagation();
		if (this.searchTimer !== null) this.resetResults();
		if (event.key === 'Enter') {
			if (event.repeat) return;
			if (this.selectedProperty) { this.selectScope(this.selectedProperty, true); return; }
			if (this.selectedValue) {
				const value = this.selectedValue;
				const saved = readPropertyPoolPreferences(this.settings.propertyValuePool).preferences.favorites.some(item => propertyPoolFavoriteId(item) === propertyPoolFavoriteId(value));
				void this.toggleFavorite(value, !saved);
			}
			return;
		}
		if (event.key === 'ArrowUp' && this.selection === 0) {
			const buttons = Array.from(this.shortcuts?.querySelectorAll<HTMLButtonElement>('button') ?? []);
			(buttons.find(button => button.getAttribute('aria-pressed') === 'true') ?? buttons[0])?.focus({ preventScroll: true });
			return;
		}
		const count = Number(this.list?.dataset.total ?? 0);
		if (!count) return;
		this.selectedValue = null; this.selectedProperty = null;
		this.selection = Math.max(0, Math.min(count - 1, this.selection + (event.key === 'ArrowDown' ? 1 : -1)));
		this.limit = Math.max(this.limit, this.selection + 1); this.refresh();
		const selected = this.list?.children[this.selection]; if (selected && this.list) scrollChildIntoView(this.list, selected as HTMLElement);
	}

	private refresh(): void {
		if (!this.panel || !this.list || !this.search || !this.summary) return;
		if (!this.current()) { this.close(); return; }
		if (this.searchTimer !== null) return;
		const settings = this.settings;
		const fields = propertyPoolFields(settings);
		const field = fields.find(item => item.key === this.scope);
		const prefs = readPropertyPoolPreferences(settings.propertyValuePool);
		const placeholder = this.allValues ? t('settings', 'propertyPoolSearchAllValues') : this.scope ? t('settings', 'propertyPoolSearchValues', { property: field?.label ?? this.scope }) : t('settings', 'propertyPoolSearchProperties');
		this.search.placeholder = placeholder; setAccessibleLabelWithoutTooltip(this.search, placeholder);
		if (this.searchIcon) { this.searchIcon.empty(); setIcon(this.searchIcon, this.allValues ? 'layers' : field?.icon ?? 'search'); setAccessibleLabelWithoutTooltip(this.searchIcon, field?.label ?? placeholder); }
		const scroll = this.list.scrollTop;
		const active = this.panel.ownerDocument.activeElement as HTMLElement | null;
		const focusedId = active?.dataset.poolFavoriteId;
		cleanupOperonHoverTooltips(this.list); this.list.empty();
		let count = 0, scrollSelection = false;
		const hint = (text: string) => this.list?.createDiv({ cls: 'operon-canvas-property-pool-empty', text });
		const matches = !this.scope ? searchPropertyPoolFields(settings, this.query) : [];
		const indexState = this.owner.deps.cards.deps.getIndexState();
		const ids = new Set(prefs.preferences.favorites.map(propertyPoolFavoriteId));
		let results: Array<{ value: PropertyPoolFavorite & Partial<PropertyPoolValue>; available: boolean }> = [];
		if (indexState === 'ready' && (prefs.writable || this.scope || this.allValues)) {
			this.values ??= new PropertyPoolValueSession(this.owner.deps.app, settings, this.owner.deps.cards.getAllTasks());
			const tokens = this.query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
			results = this.scope || this.allValues
				? (this.allValues ? this.values.allValues(this.query) : this.values.values(this.scope!, this.query)).map(value => ({ value, available: true })).sort((a, b) => Number(ids.has(propertyPoolFavoriteId(b.value))) - Number(ids.has(propertyPoolFavoriteId(a.value))))
				: prefs.preferences.favorites.map((favorite): { value: PropertyPoolFavorite & Partial<PropertyPoolValue>; available: boolean } => { const resolved = this.values?.resolveFavorite(favorite); return { value: resolved ?? favorite, available: !!resolved }; })
					.filter(({ value }) => value.type === 'date' ? matchesPropertyPoolDateSearch(`${value.label} ${value.searchText ?? ''}`, this.query) : tokens.every(token => `${value.label} ${value.value}`.toLocaleLowerCase().includes(token)))
					.sort((a, b) => Number(b.available) - Number(a.available));
		}
		const seen = new Set<string>();
		results = results.filter(({ value }) => { const id = propertyPoolFavoriteId(value); if (seen.has(id)) return false; seen.add(id); return true; });
		count = results.length + matches.length;
		const valueOffset = this.allValues ? matches.length : 0;
		const propertyOffset = this.allValues ? 0 : results.length;
		const propertyIndex = this.selectedProperty ? matches.findIndex(item => item.key === this.selectedProperty) : -1;
		const valueIndex = this.selectedValue ? results.findIndex(item => propertyPoolFavoriteId(item.value) === propertyPoolFavoriteId(this.selectedValue!)) : -1;
		const retained = valueIndex >= 0 ? valueOffset + valueIndex : propertyIndex >= 0 ? propertyOffset + propertyIndex : -1;
		scrollSelection = retained >= 0 && retained !== this.selection && active === this.search;
		if (retained >= 0) this.selection = retained;
		this.selection = Math.min(this.selection, Math.max(0, count - 1));
		this.selectedValue = results[this.selection - valueOffset]?.value ?? null;
		this.selectedProperty = matches[this.selection - propertyOffset]?.key ?? null;
		this.limit = Math.max(this.limit, this.selection + 1);
		const renderProperties = () => {
			for (const [index, match] of matches.slice(0, Math.max(0, this.limit - propertyOffset)).entries()) {
				const button = this.iconButton(this.list!, match.icon, match.label, () => this.selectScope(match.key, true), false, 'operon-canvas-property-pool-value-icon');
				button.classList.add('operon-canvas-property-pool-property');
				button.createSpan({ cls: 'operon-canvas-property-pool-value', text: match.label });
				button.classList.toggle('is-active', propertyOffset + index === this.selection);
				button.classList.toggle('is-property-section-start', index === 0 && propertyOffset > 0);
			}
		};
		if (this.allValues) renderProperties();
		for (const [index, result] of results.slice(0, Math.max(0, this.limit - valueOffset)).entries()) {
			const value = result.value, id = propertyPoolFavoriteId(value), saved = ids.has(id);
			const row = this.list.createDiv('operon-canvas-property-pool-row'); row.classList.toggle('is-unavailable', !result.available);
			row.classList.toggle('is-active', valueOffset + index === this.selection);
			const surface = row.createDiv('operon-canvas-property-pool-drag-surface');
			if (result.available && this.drop) {
				row.classList.add('is-draggable');
				surface.onpointerdown = event => this.drop?.start(event, value, () => !!this.panel && this.current());
			}
			surface.dataset.poolIcon = fields.find(item => item.key === value.key)?.icon ?? 'text';
			renderPropertyPoolValueVisual(surface, value, surface.dataset.poolIcon);
			const text = surface.createDiv('operon-canvas-property-pool-value'); text.createDiv({ text: value.label });
			if (value.type === 'date' && result.available) text.createEl('small', { text: value.resolvedDate ?? '' });
			if (!result.available) text.createEl('small', { text: t('settings', 'propertyPoolValueUnavailable') });
			const star = this.iconButton(row, 'star', t('settings', saved ? 'propertyPoolRemoveFavorite' : 'propertyPoolAddFavorite'), () => { void this.toggleFavorite(value, !saved); }, false);
			star.classList.toggle('is-favorite', saved); star.setAttribute('aria-pressed', String(saved));
			star.dataset.poolFavoriteId = id; star.disabled = !prefs.writable; star.setAttribute('aria-disabled', String(this.busy || !prefs.writable));
			if (focusedId === id) star.focus({ preventScroll: true });
		}
		if (!this.allValues) renderProperties();
		if (!count) {
			if (indexState !== 'ready') hint(t('errors', indexState === 'loading' ? 'taskCard_loading' : 'taskCard_error'));
			else if (!prefs.writable && !this.scope && !this.allValues) hint(t('settings', 'propertyPoolUnavailable'));
			else hint(t('settings', this.scope || this.allValues || this.query.trim() ? 'propertyPoolNoValues' : 'propertyPoolEmpty'));
		}
		if (focusedId && !Array.from(this.list.querySelectorAll<HTMLButtonElement>('button')).some(button => button.dataset.poolFavoriteId === focusedId && !button.disabled)) {
			const next = this.list.querySelector<HTMLButtonElement>('button:not(:disabled)');
			(next ?? this.search).focus({ preventScroll: true });
		}
		this.list.dataset.total = String(count); this.list.scrollTop = scroll;
		if (scrollSelection && this.list.children[this.selection]) scrollChildIntoView(this.list, this.list.children[this.selection] as HTMLElement);
		this.summary.setText(t('settings', 'propertyPoolSummary', { visible: String(Math.min(count, this.limit)), total: String(count) }));
		this.position();
	}

	private async toggleFavorite(favorite: PropertyPoolFavorite, saved: boolean): Promise<void> {
		if (this.busy || !this.panel || !this.current()) return;
		const raw = this.settings.propertyValuePool;
		if (!readPropertyPoolPreferences(raw).writable || (saved && !this.values?.resolveFavorite(favorite))) return;
		const generation = this.generation;
		const { key, type, value, label, priorityId, pipelineId, statusId } = favorite;
		const storedFavorite: PropertyPoolFavorite = { key, type, value, label,
			...(priorityId ? { priorityId } : {}), ...(pipelineId ? { pipelineId } : {}), ...(statusId ? { statusId } : {}) };
		this.busy = true; this.refresh();
		try { await this.preferences.edit({ kind: 'favorite', favorite: storedFavorite, saved }, raw); }
		catch (error) { new Notice(t('settings', 'propertyPoolSaveFailed')); console.error('Operon: Property Value Pool save failed', error); }
		finally { if (generation === this.generation) { this.busy = false; this.refresh(); } }
	}

	private renderShortcuts(width: number): void {
		if (!this.shortcuts) return;
		const prefs = readPropertyPoolPreferences(this.settings.propertyValuePool).preferences;
		const fields = propertyPoolFields(this.settings);
		if (!this.shortcuts.firstElementChild) this.iconButton(this.shortcuts, 'star', t('settings', 'propertyPoolFavorites'), () => this.selectScope(null, undefined, false, true));
		const buttonWidth = this.shortcuts.firstElementChild?.getBoundingClientRect().width || 28;
		const gap = Number.parseFloat(this.win.getComputedStyle?.(this.shortcuts).columnGap ?? '') || 4;
		const slots = Math.max(2, Math.floor((width - 24 + gap) / (buttonWidth + gap)));
		const visible = prefs.shortcuts.filter(item => item.visible).slice(0, slots - 2);
		const signature = JSON.stringify([visible, fields, this.scope, this.allValues]);
		if (signature === this.shortcutSignature) return;
		this.shortcutSignature = signature;
		cleanupOperonHoverTooltips(this.shortcuts); this.shortcuts.empty();
		const all = this.iconButton(this.shortcuts, 'star', t('settings', 'propertyPoolFavorites'), () => this.selectScope(null, undefined, false, true));
		all.setAttribute('aria-pressed', String(!this.scope && !this.allValues));
		const combined = this.iconButton(this.shortcuts, 'layers', t('settings', 'propertyPoolAllValues'), () => this.selectScope(null, !this.touchInput || this.search === this.panel?.ownerDocument.activeElement, true, true));
		combined.dataset.poolAll = 'true'; combined.setAttribute('aria-pressed', String(this.allValues));
		for (const shortcut of visible) {
			const field = fields.find(item => item.key === shortcut.key);
			if (!field) continue;
			const button = this.iconButton(this.shortcuts, field.icon, field.label, () => this.selectScope(field.key, undefined, false, true));
			button.dataset.poolScope = field.key;
			button.setAttribute('aria-pressed', String(this.scope === field.key));
		}
	}

	private position(): void {
		if (!this.panel || !this.button) return;
		const bounds = this.view.contentEl.getBoundingClientRect(), anchor = this.button.getBoundingClientRect(), viewport = this.win.visualViewport;
		const leftEdge = Math.max(bounds.left, viewport?.offsetLeft ?? 0), topEdge = Math.max(bounds.top, viewport?.offsetTop ?? 0);
		const rightEdge = Math.min(bounds.right, (viewport?.offsetLeft ?? 0) + (viewport?.width ?? this.win.innerWidth));
		const bottomEdge = Math.min(bounds.bottom, (viewport?.offsetTop ?? 0) + (viewport?.height ?? this.win.innerHeight));
		const width = Math.max(0, Math.min(320, rightEdge - leftEdge - 16));
		this.panel.style.width = `${width}px`; this.panel.style.maxHeight = `${Math.max(0, bottomEdge - topEdge - 16)}px`;
		this.panel.style.left = `${Math.max(leftEdge + 8, Math.min(this.panelPoint?.x ?? anchor.left - width - 8, rightEdge - width - 8))}px`;
		this.panel.style.top = `${Math.max(topEdge + 8, Math.min(this.panelPoint?.y ?? anchor.top, bottomEdge - this.panel.offsetHeight - 8))}px`;
		this.renderShortcuts(width);
	}
	private updatePin(): void {
		if (!this.pinButton) return;
		cleanupOperonHoverTooltips(this.pinButton);
		const title = t('settings', this.pinned ? 'canvasTaskPoolUnpin' : 'canvasTaskPoolPin');
		this.pinButton.empty();
		setIcon(this.pinButton, this.pinned ? 'pin-off' : 'pin'); setAccessibleLabelWithoutTooltip(this.pinButton, title);
		bindOperonHoverTooltip(this.pinButton, { title, taskColor: null }); this.pinButton.setAttribute('aria-pressed', String(this.pinned));
	}
	private startPanelDrag(event: PointerEvent): void {
		if (!this.panel || event.isPrimary === false || event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
		this.cancelPanelDrag?.();
		const doc = this.panel.ownerDocument, rect = this.panel.getBoundingClientRect(), x = event.clientX, y = event.clientY;
		let moved = false;
		const move = (next: PointerEvent): void => {
			if (next.pointerId !== event.pointerId) return;
			if (event.pointerType !== 'touch' && (next.buttons & 1) === 0) { cancel(); return; }
			if (!moved && Math.hypot(next.clientX - x, next.clientY - y) < 5) return;
			next.preventDefault();
			if (!moved) { moved = true; this.pinned = true; this.updatePin(); }
			this.panelPoint = { x: rect.left + next.clientX - x, y: rect.top + next.clientY - y }; this.position();
		};
		const cancel = (): void => {
			doc.removeEventListener('pointermove', move); doc.removeEventListener('pointerup', up); doc.removeEventListener('pointercancel', up);
			doc.removeEventListener('pointerdown', additional, true); this.win.removeEventListener('blur', cancel); doc.removeEventListener('visibilitychange', visibility); this.cancelPanelDrag = null;
		};
		const up = (next: PointerEvent): void => { if (next.pointerId === event.pointerId) cancel(); };
		const additional = (): void => cancel();
		const visibility = () => { if (doc.visibilityState !== 'visible') cancel(); };
		this.cancelPanelDrag = cancel; event.preventDefault(); event.stopPropagation();
		doc.addEventListener('pointermove', move, { passive: false }); doc.addEventListener('pointerup', up); doc.addEventListener('pointercancel', up);
		doc.addEventListener('pointerdown', additional, true); this.win.addEventListener('blur', cancel); doc.addEventListener('visibilitychange', visibility);
	}
	private closeAndFocus(): void { this.close(); this.button?.focus({ preventScroll: true }); }
	private close(): void {
		this.drop?.invalidate();
		this.generation++; this.cancelPanelDrag?.(); this.clearSearchTimer();
		if (this.sourceTimer !== null) this.win.clearTimeout(this.sourceTimer); this.sourceTimer = null;
		if (this.session) this.removeChild(this.session); this.session = null;
		if (this.panel) cleanupOperonHoverTooltips(this.panel);
		this.panel?.remove(); this.panel = this.list = this.shortcuts = this.searchIcon = this.summary = null;
		this.search = this.pinButton = null; this.values = null; this.shortcutSignature = ''; this.pinned = false; this.panelPoint = null;
		this.button?.setAttribute('aria-expanded', 'false');
	}
	onunload(): void { this.active = false; this.close(); if (this.button) cleanupOperonHoverTooltips(this.button); this.group?.remove(); }
}
