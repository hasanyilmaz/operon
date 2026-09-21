import { acquirePropertyPoolSources } from './property-pool-sources';
import { propertyPoolDateViewContext, matchesPropertyPoolDateSearch } from '../core/property-pool-dates';
import { renderPropertyPoolValueVisual } from './property-pool-value-visual';
import { Component, Notice, setIcon } from 'obsidian';
import { t } from '../core/i18n';
import { getOwnerWindow } from '../core/dom-compat';
import { propertyPoolScopeKey, propertyPoolScopeField, propertyPoolFields, propertyPoolFavoriteId, readPropertyPoolPreferences, searchPropertyPoolFields, type PropertyPoolEdit, type PropertyPoolValue, type PropertyPoolFavorite } from '../core/property-value-pool';
import type { PropertyPoolValueSession } from './property-value-pool-values';
import type { CanvasTaskIntegration, TaskCanvasView } from './canvas-task-adapter';
import { bindOperonHoverTooltip, cleanupOperonHoverTooltips } from './operon-hover-tooltip';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import { scrollChildIntoView } from './field-pickers/common';
import type { PropertyPoolTaskBridge } from '../core/property-pool-task-operation';
import { CanvasPropertyValueDrop } from './canvas-property-value-drop';
import type { CanvasGroups } from './canvas-groups';
import type { CanvasTaskHistory } from './canvas-task-history';

export interface PoolGroupSelection {
 current(): boolean;
 supports(key: string): boolean;
 accepts(value: PropertyPoolFavorite): boolean;
 select(value: PropertyPoolFavorite, sourceCurrent: () => boolean): Promise<'created' | 'retry' | 'closed'>;
 close(): void;
}

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
 private sources: ReturnType<typeof acquirePropertyPoolSources> | null = null;
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
 private groupSelection: PoolGroupSelection | null = null;
 private restorePool: (() => void) | null = null;
 private selectionBusy = false;

 openForGroup(context: PoolGroupSelection): boolean {
  if (!this.active || this.busy || this.groupSelection || !this.button || !context.current()) return false;
  const previous = this.panel ? {
   file: this.panelFile, path: this.panelFile?.path, canvas: this.view.canvas, query: this.search?.value ?? this.query, scope: this.scope,
   allValues: this.allValues, limit: this.limit, selection: this.selection, selectedValue: this.selectedValue,
   selectedProperty: this.selectedProperty, scroll: this.list?.scrollTop ?? 0, pinned: this.pinned, point: this.panelPoint,
  } : null;
  this.close(); this.groupSelection = context;
  this.restorePool = previous ? () => {
   if (!this.active || !this.owner.isCurrent(this.view) || this.view.file !== previous.file || this.view.file?.path !== previous.path || this.view.canvas !== previous.canvas) return;
   this.open();
   if (!this.panel || !this.search || !this.list) return;
   this.query = this.search.value = previous.query; this.scope = previous.scope; this.allValues = previous.allValues;
   this.limit = previous.limit; this.selection = previous.selection; this.selectedValue = previous.selectedValue;
   this.selectedProperty = previous.selectedProperty; this.pinned = previous.pinned; this.panelPoint = previous.point;
   this.updatePin(); this.refresh(); this.list.scrollTop = previous.scroll; this.position();
  } : null;
  this.open();
  if (!this.panel) { this.close(); return false; }
  return true;
 }
 cancelGroup(context: PoolGroupSelection): void { if (this.groupSelection === context) this.close(); }
 private resolveGroupValue(value: PropertyPoolFavorite): PropertyPoolFavorite | null {
  if (!this.panel || !this.current() || this.owner.deps.cards.deps.getIndexState() !== 'ready') return null;
  const resolved = this.sources?.snapshot().values.resolveFavorite(value);
  return resolved && propertyPoolFavoriteId(resolved) === propertyPoolFavoriteId(value) && resolved.value === value.value ? resolved : null;
 }
 private async chooseGroup(value: PropertyPoolFavorite): Promise<void> {
  const context = this.groupSelection;
  if (!context || this.selectionBusy) return;
  if (!this.current()) { this.close(); return; }
  const resolved = this.owner.deps.cards.deps.getIndexState() === 'ready' ? this.sources?.snapshot().values.resolveFavorite(value) : null;
  if (!resolved || propertyPoolFavoriteId(resolved) !== propertyPoolFavoriteId(value) || resolved.value !== value.value || !context.accepts(resolved)) {
   new Notice(t('settings', 'propertyPoolValueUnavailable')); this.refresh(); return;
  }
  this.selectionBusy = true;
  try {
   const result = await context.select(resolved, () => !!this.resolveGroupValue(resolved));
   if (this.groupSelection === context && result !== 'retry') this.close();
  } catch (error) {
   console.error('Operon: group selection failed', error);
   new Notice(t('notifications', 'canvasGroupSaveFailed'));
   if (this.groupSelection === context) this.close();
  } finally { this.selectionBusy = false; }
 }

	constructor(private view: TaskCanvasView, private owner: CanvasTaskIntegration, private preferences: CanvasPropertyValuePoolPreferences, private history?: CanvasTaskHistory, private groups?: CanvasGroups) { super(); }
	private get win() { return getOwnerWindow(this.view.contentEl); }
	private get settings() { return this.owner.deps.cards.deps.getSettings(); }
	private current(): boolean { return this.active && this.owner.isCurrent(this.view) && this.view.file === this.panelFile && (!this.groupSelection || this.groupSelection.current()); }

	onload(): void {
		this.active = true;
		if (this.preferences.tasks && this.history) {
			this.drop = this.addChild(new CanvasPropertyValueDrop(this.view, this.history, this.preferences.tasks, () => this.active && this.owner.isCurrent(this.view), (value, point) => {
    const resolved = this.resolveGroupValue(value);
    return this.groups?.prepareCreate(resolved ?? value, point, () => !!this.resolveGroupValue(value), true) ?? null;
   }));
		}
		this.register(this.preferences.subscribe(() => { this.drop?.invalidate(); if (this.values && !this.values.matchesSettings(this.settings)) this.values = null; this.refresh(); }));
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
  this.sources = acquirePropertyPoolSources(this.owner.deps.app, this.owner.deps.cards, () => this.invalidateSources());
		const panel = this.panel = this.view.contentEl.ownerDocument.body.createDiv('operon-canvas-property-pool');
		panel.setAttribute('role', 'dialog'); panel.tabIndex = -1; setAccessibleLabelWithoutTooltip(panel, t('settings', this.groupSelection ? 'propertyPoolCreateGroup' : 'propertyPoolTitle'));
		this.button.setAttribute('aria-expanded', 'true');
		const header = panel.createDiv('operon-canvas-property-pool-header');
		header.createEl('strong', { text: t('settings', this.groupSelection ? 'propertyPoolCreateGroup' : 'propertyPoolTitle') });
  if (this.groupSelection) panel.createDiv({ cls: 'operon-canvas-property-pool-summary', text: t('settings', 'propertyPoolCreateGroupHint') });
		this.pinButton = this.iconButton(header, 'pin', t('settings', 'canvasTaskPoolPin'), () => {
			if (this.pinned) this.closeAndFocus(); else { this.pinned = true; this.updatePin(); }
		});
		this.updatePin();
  this.pinButton.disabled = !!this.groupSelection;
		session.registerDomEvent(header, 'pointerdown', event => this.startPanelDrag(event));
		this.shortcuts = panel.createDiv('operon-canvas-property-pool-shortcuts');
		session.registerDomEvent(panel, 'keydown', event => this.handleShortcutKey(event), { capture: true });
		const searchWrap = panel.createDiv('operon-canvas-property-pool-search');
		this.searchIcon = searchWrap.createSpan('operon-canvas-property-pool-search-icon');
		this.search = searchWrap.createEl('input', { attr: { type: 'text', spellcheck: 'false' } });
		const search = this.search;
		this.iconButton(searchWrap, 'x', t('buttons', 'clear'), () => { const focus = !this.touchInput || search === search.ownerDocument.activeElement; this.selectDefaultScope(focus); });
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
		if (this.groupSelection) { this.selectScope(null, true, true); search.focus({ preventScroll: true }); }
  else { this.selectDefaultScope(false); (this.touchInput ? panel : search).focus({ preventScroll: true }); }
	}

	private invalidateSources(): void {
		this.drop?.invalidateSources();
		this.values = null;
		if (!this.panel || this.sourceTimer !== null) return;
		this.sourceTimer = this.win.setTimeout(() => {
			this.sourceTimer = null;
			this.values = null; this.refresh();
		}, 120);
	}
	private clearSearchTimer(): void { if (this.searchTimer !== null) this.win.clearTimeout(this.searchTimer); this.searchTimer = null; }
	private resetResults(): void { this.clearSearchTimer(); this.limit = 25; this.selection = 0; this.selectedValue = null; this.selectedProperty = null; if (this.list) this.list.scrollTop = 0; this.refresh(); }
	private selectDefaultScope(focus: boolean): void {
  if (this.groupSelection) { this.selectScope(null, focus, true); return; }
		this.position();
		const first = this.shortcuts?.querySelector<HTMLButtonElement>('button');
		this.selectScope(first?.dataset.poolScope || null, focus, first?.dataset.poolAll === 'true');
	}
	private selectScope(key: string | null, focus = !this.touchInput || this.search === this.panel?.ownerDocument.activeElement, allValues = false, preserveQuery = false): void {
		this.scope = key; this.allValues = allValues; this.query = preserveQuery ? this.search?.value ?? this.query : ''; if (this.search) this.search.value = this.query;
		this.resetResults(); if (focus) {
			this.search?.focus({ preventScroll: true });
			if (preserveQuery) this.search?.setSelectionRange(this.query.length, this.query.length);
		}
	}
	private handleShortcutKey(event: KeyboardEvent): void {
		if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
		const buttons = Array.from(this.shortcuts?.querySelectorAll<HTMLButtonElement>('button') ?? []).filter(button => !button.disabled);
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
		if (event.key === 'Backspace' && !event.repeat && this.search?.value === '') {
			event.preventDefault(); event.stopPropagation(); this.selectDefaultScope(true); return;
		}
		if (['ArrowLeft', 'ArrowRight'].includes(event.key) && this.search?.value === '') {
			const buttons = Array.from(this.shortcuts?.querySelectorAll<HTMLButtonElement>('button') ?? []).filter(button => !button.disabled);
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
			if (this.selectedProperty) { this.selectScope(propertyPoolScopeKey(this.selectedProperty), true); return; }
			if (this.selectedValue) {
				const value = this.selectedValue;
    if (this.groupSelection) { void this.chooseGroup(value); return; }
				const saved = readPropertyPoolPreferences(this.settings.propertyValuePool).preferences.favorites.some(item => propertyPoolFavoriteId(item) === propertyPoolFavoriteId(value));
				void this.toggleFavorite(value, !saved);
			}
			return;
		}
		if (event.key === 'ArrowUp' && this.selection === 0) {
			const buttons = Array.from(this.shortcuts?.querySelectorAll<HTMLButtonElement>('button') ?? []).filter(button => !button.disabled);
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
		const field = this.scope === '@dates' ? { label: t('settings', 'propertyPoolDates'), icon: 'calendar-days' } : fields.find(item => item.key === propertyPoolScopeField(this.scope ?? ''));
		const prefs = readPropertyPoolPreferences(settings.propertyValuePool);
		const placeholder = this.allValues ? t('settings', 'propertyPoolSearchAllValues') : this.scope ? t('settings', 'propertyPoolSearchValues', { property: field?.label ?? this.scope }) : t('settings', 'propertyPoolSearchProperties');
		this.search.placeholder = placeholder; setAccessibleLabelWithoutTooltip(this.search, placeholder);
		if (this.searchIcon) { this.searchIcon.empty(); setIcon(this.searchIcon, this.allValues ? 'layers' : field?.icon ?? 'search'); setAccessibleLabelWithoutTooltip(this.searchIcon, field?.label ?? placeholder); }
		const scroll = this.list.scrollTop;
		const active = this.panel.ownerDocument.activeElement as HTMLElement | null;
		const focusedId = active?.dataset.poolFavoriteId;
  const focusedGroupValue = active?.dataset.poolGroupValueId;
		cleanupOperonHoverTooltips(this.list); this.list.empty();
		let count = 0, scrollSelection = false;
		const hint = (text: string) => this.list?.createDiv({ cls: 'operon-canvas-property-pool-empty', text });
		const matches = !this.groupSelection && !this.scope ? searchPropertyPoolFields(settings, this.query) : [];
		const indexState = this.owner.deps.cards.deps.getIndexState();
		const ids = new Set(prefs.preferences.favorites.map(propertyPoolFavoriteId));
		let results: Array<{ value: PropertyPoolFavorite & Partial<PropertyPoolValue>; available: boolean }> = [];
		if (indexState === 'ready' && (prefs.writable || this.scope || this.allValues)) {
			this.values = this.sources!.snapshot().values;
			const tokens = this.query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
			results = this.scope || this.allValues
				? (this.allValues ? this.values.allValues(this.query) : this.scope === '@dates' ? this.values.dateValues(this.query) : this.values.values(propertyPoolScopeField(this.scope!), this.query)).map(value => ({ value, available: true })).sort((a, b) => Number(ids.has(propertyPoolFavoriteId(b.value))) - Number(ids.has(propertyPoolFavoriteId(a.value))))
				: prefs.preferences.favorites.map((favorite): { value: PropertyPoolFavorite & Partial<PropertyPoolValue>; available: boolean } => { const resolved = this.values?.resolveFavorite(favorite); return { value: resolved ?? favorite, available: !!resolved }; })
					.filter(({ value }) => value.type === 'date' || value.key === 'reminderRules' ? matchesPropertyPoolDateSearch(`${value.label} ${value.searchText ?? ''}`, this.query) : tokens.every(token => `${value.label} ${value.value}`.toLocaleLowerCase().includes(token)))
					.sort((a, b) => Number(b.available) - Number(a.available));
		}
		if (this.groupSelection) results = results.filter(({ value, available }) => available && this.groupSelection!.accepts(value));
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
				const button = this.iconButton(this.list!, match.icon, match.label, () => this.selectScope(propertyPoolScopeKey(match.key), true), false, 'operon-canvas-property-pool-value-icon');
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
			if (!this.groupSelection && result.available && this.drop) {
				row.classList.add('is-draggable');
				surface.onpointerdown = event => this.drop?.start(event, value, () => !!this.panel && this.current());
			}
			surface.dataset.poolIcon = fields.find(item => item.key === value.key)?.icon ?? 'text';
			renderPropertyPoolValueVisual(surface, value, surface.dataset.poolIcon);
			const text = surface.createDiv('operon-canvas-property-pool-value'); text.createDiv({ text: value.label });
			if (value.type === 'date' && result.available) text.createEl('small', { text: value.resolvedDate ?? '' });
			if (!result.available) text.createEl('small', { text: t('settings', 'propertyPoolValueUnavailable') });
			if (this.groupSelection) {
    surface.setAttribute('role', 'button'); surface.tabIndex = 0; surface.dataset.poolGroupValueId = id;
    setAccessibleLabelWithoutTooltip(surface, value.label);
    surface.onclick = event => { event.stopPropagation(); void this.chooseGroup(value); };
    surface.onkeydown = event => {
     if (!event.isComposing && !event.repeat && !event.altKey && !event.ctrlKey && !event.metaKey && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault(); event.stopPropagation(); void this.chooseGroup(value);
     }
    };
    continue;
   }
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
		if (focusedGroupValue) {
   const target = Array.from(this.list.querySelectorAll<HTMLElement>('[data-pool-group-value-id]')).find(element => element.dataset.poolGroupValueId === focusedGroupValue);
   (target ?? this.search).focus({ preventScroll: true });
  }
		this.list.dataset.total = String(count); this.list.scrollTop = scroll;
		if (scrollSelection && this.list.children[this.selection]) scrollChildIntoView(this.list, this.list.children[this.selection] as HTMLElement);
		this.summary.setText(t('settings', 'propertyPoolSummary', { visible: String(Math.min(count, this.limit)), total: String(count) }));
		this.position();
	}

	private async toggleFavorite(favorite: PropertyPoolFavorite, saved: boolean): Promise<void> {
		if (this.groupSelection || this.busy || !this.panel || !this.current()) return;
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
		const fields = [...propertyPoolFields(this.settings).map(field => ({ ...field, key: propertyPoolScopeKey(field.key) })), { key: '@dates', label: t('settings', 'propertyPoolDates'), icon: 'calendar-days' }];
		const probe = !this.shortcuts.firstElementChild ? this.iconButton(this.shortcuts, 'star', t('settings', 'propertyPoolFavorites'), () => {}) : null;
		const buttonWidth = this.shortcuts.firstElementChild?.getBoundingClientRect().width || 28;
		if (probe) { cleanupOperonHoverTooltips(probe); probe.remove(); }
		const gap = Number.parseFloat(this.win.getComputedStyle?.(this.shortcuts).columnGap ?? '') || 4;
		const slots = Math.max(0, Math.floor((width - 26 + gap) / (buttonWidth + gap)));
		const configured = prefs.shortcuts.filter(item => item.visible && (item.key === '@all' || item.key === '@favorites' || fields.some(field => field.key === item.key)));
  const choices = this.groupSelection ? [...configured] : configured;
  if (this.groupSelection) for (const key of ['@all', '@favorites']) if (!choices.some(item => item.key === key)) choices.unshift({ key, visible: true });
  const visible = choices.slice(0, this.groupSelection ? Math.max(2, slots) : slots);
  if (this.groupSelection) for (const key of ['@all', '@favorites']) if (!visible.some(item => item.key === key)) {
   let index = visible.length - 1;
   while (index >= 0 && (visible[index].key === '@all' || visible[index].key === '@favorites')) index--;
   if (index >= 0) visible.splice(index, 1);
   visible.push({ key, visible: true });
  }
		const signature = JSON.stringify([visible, fields, this.scope, this.allValues, this.groupSelection ? fields.map(field => this.groupSelection!.supports(propertyPoolScopeField(field.key))) : null]);
		if (signature === this.shortcutSignature) return;
		this.shortcutSignature = signature;
		cleanupOperonHoverTooltips(this.shortcuts); this.shortcuts.empty();
		for (const shortcut of visible) {
			if (shortcut.key === '@all' || shortcut.key === '@favorites') {
				const combined = shortcut.key === '@all';
				const button = this.iconButton(this.shortcuts, combined ? 'layers' : 'star', t('settings', combined ? 'propertyPoolAllValues' : 'propertyPoolFavorites'), () => this.selectScope(null, undefined, combined, true));
				if (combined) button.dataset.poolAll = 'true';
				button.setAttribute('aria-pressed', String(combined ? this.allValues : !this.scope && !this.allValues));
				continue;
			}
			const field = fields.find(item => item.key === shortcut.key);
			if (!field) continue;
			const button = this.iconButton(this.shortcuts, field.icon, field.label, () => this.selectScope(field.key, undefined, false, true));
			button.dataset.poolScope = field.key;
   button.disabled = !!this.groupSelection && !this.groupSelection.supports(propertyPoolScopeField(field.key));
   button.setAttribute('aria-disabled', String(button.disabled));
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
		if (this.groupSelection || !this.panel || event.isPrimary === false || event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
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
	private closeAndFocus(): void { this.close(); (this.search ?? this.button)?.focus({ preventScroll: true }); }
	private close(): void {
  const context = this.groupSelection, restore = this.restorePool;
  this.groupSelection = null; this.restorePool = null;
		this.drop?.resetGroupSession();
  this.sources?.release(); this.sources = null;
		this.generation++; this.cancelPanelDrag?.(); this.clearSearchTimer();
		if (this.sourceTimer !== null) this.win.clearTimeout(this.sourceTimer); this.sourceTimer = null;
		if (this.session) this.removeChild(this.session); this.session = null;
		if (this.panel) cleanupOperonHoverTooltips(this.panel);
		this.panel?.remove(); this.panel = this.list = this.shortcuts = this.searchIcon = this.summary = null;
		this.search = this.pinButton = null; this.values = null; this.shortcutSignature = ''; this.pinned = false; this.panelPoint = null;
		this.button?.setAttribute('aria-expanded', 'false');
  context?.close(); restore?.();
	}
	onunload(): void { this.active = false; this.close(); if (this.button) cleanupOperonHoverTooltips(this.button); this.group?.remove(); }
}
