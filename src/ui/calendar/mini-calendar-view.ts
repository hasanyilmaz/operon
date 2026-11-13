import { miniCalendarWeek, MiniCalendarNoteOpener, type MiniCalendarNoteRequest } from './mini-calendar-notes';
import { ItemView, type Workspace, type WorkspaceLeaf } from 'obsidian';
import { t } from '../../core/i18n';
import { toLocalDate } from '../../core/local-time';
import { getAppLocale } from '../../core/obsidian-app';
import type { OperonSettings } from '../../types/settings';
import { cleanupOperonHoverTooltips } from '../operon-hover-tooltip';
import { closeFloatingPanelsForRoot } from '../field-pickers/common';
import { showCalendarMonthPicker } from './calendar-month-picker';
import { renderMiniCalendar, shiftCalendarMonth } from './mini-calendar';

export const MINI_CALENDAR_VIEW_TYPE = 'operon-mini-calendar';
const pendingOpenings = new WeakMap<Workspace, Promise<void>>();

export async function openMiniCalendar(workspace: Workspace): Promise<void> {
	const pending = pendingOpenings.get(workspace);
	if (pending) return await pending;
	const opening = (async () => {
		const existing = workspace.getLeavesOfType(MINI_CALENDAR_VIEW_TYPE)[0];
		const leaf = existing ?? workspace.getLeftLeaf(false);
		if (!leaf) throw new Error('Mini Calendar sidebar is unavailable.');
		if (!existing) await leaf.setViewState({ type: MINI_CALENDAR_VIEW_TYPE, active: true });
		await leaf.loadIfDeferred();
		await workspace.revealLeaf(leaf);
		if (leaf.view instanceof MiniCalendarView) {
			leaf.view.render();
			leaf.view.focusCalendar();
		}
	})();
	pendingOpenings.set(workspace, opening);
	try {
		await opening;
	} finally {
		pendingOpenings.delete(workspace);
	}
}

export class MiniCalendarView extends ItemView {
	private anchorDate = '';
	private signature: string | null = null;
	private closed = true;
	private closeMonthPicker: (() => void) | null = null;
	private monthPickerAnchor: HTMLButtonElement | null = null;
	private stopWindowListeners: (() => void) | null = null;
	private stopMigration: (() => void) | null = null;
	private wakeTimer: number | null = null;
	private timerWindow: Window | null = null;
	private readonly noteOpener: MiniCalendarNoteOpener;

	constructor(leaf: WorkspaceLeaf, private readonly getSettings: () => OperonSettings,
		private readonly clock: () => Date = () => new Date(),
		openNote: (request: MiniCalendarNoteRequest) => Promise<void> = async () => {},
		onNoteError: (error: unknown) => void = error => { console.error('Operon: Mini Calendar opening failed', error); }) {
		super(leaf);
		this.noteOpener = new MiniCalendarNoteOpener(openNote, onNoteError);
	}

	getViewType(): string { return MINI_CALENDAR_VIEW_TYPE; }
	getDisplayText(): string { return t('calendar', 'miniCalendarTitle'); }
	getIcon(): string { return 'calendar-days'; }

	async onOpen(): Promise<void> {
		this.dispose();
		this.closed = false;
		this.anchorDate = toLocalDate(this.clock());
		this.signature = null;
		this.contentEl.addClass('operon-mini-calendar-view');
		this.contentEl.tabIndex = -1;
		this.bindWindowListeners();
		this.stopMigration = this.containerEl.onWindowMigrated?.(() => {
			this.noteOpener.invalidate();
			this.closePicker();
			this.bindWindowListeners();
			this.signature = null;
			this.render();
		}) ?? null;
		this.render();
	}

	async onClose(): Promise<void> {
		this.closed = true;
		this.dispose();
	}

	focusCalendar(): void { this.contentEl.focus({ preventScroll: true }); }

	render(): void {
		if (this.closed) return;
		const settings = this.getSettings();
		const today = toLocalDate(this.clock());
		const locale = getAppLocale(this.app);
		const signature = JSON.stringify([this.anchorDate, today, locale, settings.language,
			settings.dateDisplayFormat, settings.calendarWeekStart, settings.calendarSidebarShowWeekNumbers, settings.weeklyNoteFormat, this.getDisplayText()]);
		if (signature === this.signature) return;
		const root = this.contentEl;
		const active = root.ownerDocument.activeElement;
		const controls = Array.from(root.querySelectorAll<HTMLButtonElement>('button'));
		const focused = controls.find(button => button === active) ?? this.monthPickerAnchor;
		const focusKey = focused?.dataset.miniCalendarFocus;
		const restoreFocus = root.contains(active) || this.monthPickerAnchor !== null;
		this.closePicker();
		cleanupOperonHoverTooltips(root);
		root.empty();
		renderMiniCalendar(root, {
			dateKey: this.anchorDate, today, locale,
			dateDisplayFormat: settings.dateDisplayFormat,
			weekStart: settings.calendarWeekStart,
			showWeekNumbers: settings.calendarSidebarShowWeekNumbers,
			onToday: () => { this.noteOpener.invalidate(); this.selectDate(toLocalDate(this.clock())); },
			onShiftMonth: delta => { this.noteOpener.invalidate(); this.selectDate(shiftCalendarMonth(this.anchorDate, delta)); },
			onSelectDate: date => { this.selectDate(date); this.noteOpener.request('daily', date, this.contentEl); },
			weekNote: { describe: monday => miniCalendarWeek(monday, settings.weeklyNoteFormat),
				select: monday => this.noteOpener.request('weekly', monday, this.contentEl) },
			onChooseMonth: anchor => this.openMonthPicker(anchor),
		});
		const nextControls = Array.from(root.querySelectorAll<HTMLButtonElement>('button'));
		nextControls.forEach((button, index) => {
			button.dataset.miniCalendarFocus = button.dataset.dateKey ?? (button.dataset.weekDate ? `week-${button.dataset.weekDate}` : undefined)
				?? (button.classList.contains('operon-calendar-year-button') ? 'year'
					: button.classList.contains('operon-calendar-date-button') ? 'today' : `control-${index}`);
		});
		this.signature = signature;
		if (restoreFocus) {
			const target = nextControls.find(button => button.dataset.miniCalendarFocus === focusKey) ?? root;
			target.focus({ preventScroll: true });
		}
	}

	private selectDate(date: string): void {
		if (date !== this.anchorDate) this.noteOpener.invalidate();
		this.anchorDate = date;
		this.render();
	}

	private openMonthPicker(anchor: HTMLButtonElement): void {
		const wasOpen = this.monthPickerAnchor === anchor;
		this.closePicker();
		if (wasOpen) return;
		this.monthPickerAnchor = anchor;
		anchor.setAttribute('aria-expanded', 'true');
		this.closeMonthPicker = showCalendarMonthPicker(anchor, {
			dateKey: this.anchorDate, locale: getAppLocale(this.app),
			onSelect: date => this.selectDate(date),
			onClose: () => {
				this.closeMonthPicker = null;
				this.monthPickerAnchor = null;
				anchor.setAttribute('aria-expanded', 'false');
				if (anchor.isConnected && !this.closed) anchor.focus({ preventScroll: true });
			},
		});
	}

	private closePicker(): void {
		this.closeMonthPicker?.();
		this.closeMonthPicker = null;
		this.monthPickerAnchor = null;
		closeFloatingPanelsForRoot(this.contentEl);
	}

	private scheduleMidnight(): void {
		if (this.wakeTimer !== null) this.timerWindow?.clearTimeout(this.wakeTimer);
		this.wakeTimer = null;
		if (this.closed || !this.timerWindow) return;
		const now = this.clock();
		const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
		this.wakeTimer = this.timerWindow.setTimeout(() => {
			this.wakeTimer = null;
			this.render();
			this.scheduleMidnight();
		}, Math.max(1, midnight.getTime() - now.getTime()));
	}

	private bindWindowListeners(): void {
		this.stopWindowListeners?.();
		const doc = this.contentEl.ownerDocument;
		const win = doc.defaultView;
		this.timerWindow = win;
		const refresh = (): void => { this.render(); this.scheduleMidnight(); };
		const retainFocus = (): void => {
			if (!this.contentEl.contains(doc.activeElement)) this.focusCalendar();
		};
		this.contentEl.addEventListener('pointerdown', retainFocus);
		doc.addEventListener('visibilitychange', refresh);
		win?.addEventListener('focus', refresh);
		win?.addEventListener('pageshow', refresh);
		this.stopWindowListeners = () => {
			this.contentEl.removeEventListener('pointerdown', retainFocus);
			doc.removeEventListener('visibilitychange', refresh);
			win?.removeEventListener('focus', refresh);
			win?.removeEventListener('pageshow', refresh);
			if (this.wakeTimer !== null) win?.clearTimeout(this.wakeTimer);
			this.wakeTimer = null;
		};
		this.scheduleMidnight();
	}

	private dispose(): void {
		this.noteOpener.invalidate();
		this.stopMigration?.();
		this.stopMigration = null;
		this.stopWindowListeners?.();
		this.stopWindowListeners = null;
		this.timerWindow = null;
		this.closePicker();
		cleanupOperonHoverTooltips(this.contentEl);
	}
}
