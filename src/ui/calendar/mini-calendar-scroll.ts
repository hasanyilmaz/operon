import { cleanupOperonHoverTooltips } from '../operon-hover-tooltip';
import { isMutedMiniCalendarMonth, renderMiniCalendarWeek, type MiniCalendarOptions } from './mini-calendar';

const DAY = 86400000;
const WINDOW_WEEKS = 1024;

/** Calendar-day ordinals avoid local DST durations and JavaScript's years 0–99 shorthand. */
export function miniCalendarDay(key: string): number {
	const [year, month, day] = key.split('-').map(Number);
	const date = new Date(0);
	date.setUTCFullYear(year, month - 1, day);
	date.setUTCHours(0, 0, 0, 0);
	return Math.floor(date.getTime() / DAY);
}
export function miniCalendarDate(day: number): string {
	const date = new Date(day * DAY);
	return `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}
export const MINI_CALENDAR_MIN_DAY = miniCalendarDay('0001-01-01');
export const MINI_CALENDAR_MAX_DAY = miniCalendarDay('9999-12-31');
export function miniCalendarWeekStart(day: number, start: 'monday' | 'sunday'): number {
	const weekday = new Date(day * DAY).getUTCDay();
	return day - (start === 'sunday' ? weekday : (weekday + 6) % 7);
}
export interface MiniCalendarScrollPosition { week: number; fraction: number }

/** A bounded native scroll runway, with only the visible weeks and one viewport on each side in the DOM. */
export class MiniCalendarScroller {
	readonly element: HTMLElement;
	private readonly canvas: HTMLElement;
	private readonly win: Window;
	private readonly rows = new Map<number, HTMLElement>();
	private readonly firstWeek: number;
	private readonly totalWeeks: number;
	private readonly resizeObserver: ResizeObserver;
	private windowStart = 0;
	private readonly windowCount: number;
	private pitch = 42;
	private height = 0;
	private drawnRange = '';
	private highlightedDay: HTMLButtonElement | null = null;
	private referenceDate = '';
	private hoverDate = '';
	private hoverRow: HTMLElement | null = null;
	private position: MiniCalendarScrollPosition;
	private expectedScroll: number | null = null;
	private frame: number | null = null;
	private settleTimer: number | null = null;
	private pointerCount = 0;
	private disposed = false;

	constructor(container: HTMLElement, private options: MiniCalendarOptions,
		private readonly onReference: (date: string, displayDate: string) => void,
		private readonly onUserScroll: () => void, position?: MiniCalendarScrollPosition) {
		this.win = container.ownerDocument.defaultView!;
		this.firstWeek = miniCalendarWeekStart(MINI_CALENDAR_MIN_DAY, options.weekStart);
		this.totalWeeks = Math.floor((MINI_CALENDAR_MAX_DAY - this.firstWeek) / 7) + 1;
		this.windowCount = Math.min(WINDOW_WEEKS, this.totalWeeks);
		this.position = position ?? { week: miniCalendarWeekStart(miniCalendarDay(options.dateKey), options.weekStart), fraction: 0.5 };
		this.element = container.createDiv({ cls: 'operon-mini-calendar-scroll', attr: { tabindex: '-1' } });
		this.canvas = this.element.createDiv('operon-mini-calendar-scroll-canvas');
		this.rebase();
		this.draw();
		this.resizeObserver = new (this.win as Window & { ResizeObserver: typeof ResizeObserver }).ResizeObserver(() => this.measure());
		this.resizeObserver.observe(this.element);
		const [row] = this.rows.values();
		if (row) this.resizeObserver.observe(row);
		this.element.addEventListener('pointerover', this.pointerOver);
		this.element.addEventListener('pointerleave', this.clearHover);
		this.element.addEventListener('scroll', this.onScroll, { passive: true });
		this.element.addEventListener('pointerdown', this.pointerDown, { passive: true });
		this.win.addEventListener('pointerup', this.pointerUp);
		this.win.addEventListener('pointercancel', this.pointerUp);
		this.win.addEventListener('blur', this.pointerReset);
		this.measure();
	}

	private index(): number { return Math.max(0, Math.min(this.totalWeeks - 1, Math.round((this.position.week - this.firstWeek) / 7))); }
	private padding(): number { return Math.max(0, (this.height - this.pitch) / 2); }
	private rebase(): void { this.windowStart = Math.max(0, Math.min(this.totalWeeks - this.windowCount, this.index() - Math.floor(this.windowCount / 2))); }
	private targetTop(): number { return this.padding() + (this.index() - this.windowStart + this.position.fraction) * this.pitch - this.height / 2; }

	getPosition(): MiniCalendarScrollPosition { return { ...this.position }; }

	center(date: string): void {
		this.position = { week: miniCalendarWeekStart(miniCalendarDay(date), this.options.weekStart), fraction: 0.5 };
		this.rebase();
		this.restore();
	}

	update(options: MiniCalendarOptions): void {
		const previous = this.options;
		this.options = options;
		if (previous.today === options.today
			&& (previous.selectedDate ?? previous.dateKey) === (options.selectedDate ?? options.dateKey)) return;
		for (const row of this.rows.values()) {
			for (const button of Array.from(row.querySelectorAll<HTMLButtonElement>('[data-date-key]'))) {
				button.classList.toggle('is-anchor', button.dataset.dateKey === (options.selectedDate ?? options.dateKey));
				button.classList.toggle('is-today', button.dataset.dateKey === options.today);
				button.classList.toggle('is-muted-month', isMutedMiniCalendarMonth(button.dataset.dateKey!, options.today));
			}
		}
		this.updateReference();
	}

	private measure(): void {
		if (this.disposed || this.element.clientHeight <= 0 || this.element.clientWidth <= 0) return;
		const [row] = this.rows.values();
		const pitch = row?.getBoundingClientRect().height || this.pitch;
		const height = this.element.clientHeight;
		if (Math.abs(pitch - this.pitch) < 0.1 && height === this.height) return;
		this.pitch = pitch;
		this.height = height;
		this.restore();
	}

	private restore(): void {
		this.draw();
		const target = Math.max(0, this.targetTop());
		if (Math.abs(this.element.scrollTop - target) >= 0.5) {
			this.element.scrollTop = target;
			this.expectedScroll = this.element.scrollTop;
		}
		this.updateReference();
	}

	private readonly onScroll = (): void => {
		if (this.disposed || !this.height) return;
		if (this.expectedScroll !== null && Math.abs(this.element.scrollTop - this.expectedScroll) < 1) {
			this.expectedScroll = null;
			return;
		}
		this.expectedScroll = null;
		this.capturePosition();
		this.onUserScroll();
		if (this.frame === null) this.frame = this.win.requestAnimationFrame(() => {
			this.frame = null;
			this.capturePosition();
			this.draw();
			this.updateReference();
		});
		this.scheduleSettle();
	};

	private capturePosition(): void {
		const coordinate = (this.element.scrollTop + this.height / 2 - this.padding()) / this.pitch;
		const localIndex = Math.floor(coordinate);
		const index = Math.max(0, Math.min(this.totalWeeks - 1, this.windowStart + localIndex));
		this.position = { week: this.firstWeek + index * 7, fraction: coordinate - localIndex };
	}
	private updateReference(): void {
		const selected = miniCalendarDay(this.options.selectedDate ?? this.options.dateKey);
		const offset = selected - miniCalendarWeekStart(selected, this.options.weekStart);
		const date = miniCalendarDate(Math.max(MINI_CALENDAR_MIN_DAY, Math.min(MINI_CALENDAR_MAX_DAY, this.position.week + offset)));
		if (date === this.referenceDate) return;
		this.referenceDate = date;
		this.updateDisplayedDay();
	}

	private updateDisplayedDay(): void {
		const date = this.hoverDate || this.referenceDate;
		const row = this.hoverRow ?? this.rows.get(this.index());
		const button = row?.querySelector<HTMLButtonElement>(`button[data-date-key="${date}"]`) ?? null;
		if (button !== this.highlightedDay) {
			this.highlightedDay?.classList.remove('is-displayed-day');
			button?.classList.add('is-displayed-day');
			this.highlightedDay = button;
		}
		this.onReference(this.referenceDate, date);
	}

	private setHover(button: HTMLButtonElement | null): void {
		const date = button?.dataset.dateKey ?? '';
		if (this.hoverDate === date) return;
		const center = this.rows.get(this.index());
		const previous = this.hoverRow ?? center;
		this.hoverDate = date;
		this.hoverRow = button?.closest('.operon-mini-calendar-week') ?? null;
		const next = this.hoverRow ?? center;
		if (previous !== next) {
			previous?.classList.remove('is-centered-week');
			next?.classList.add('is-centered-week');
		}
		this.updateDisplayedDay();
	}

	private readonly pointerOver = (event: PointerEvent): void => {
		const target = event.target as Element | null;
		this.setHover(event.pointerType === 'mouse' ? target?.closest('button[data-date-key]:enabled') ?? null : null);
	};
	private readonly clearHover = (): void => this.setHover(null);
	private readonly pointerDown = (): void => { this.pointerCount++; };
	private readonly pointerUp = (): void => { this.pointerCount = Math.max(0, this.pointerCount - 1); this.scheduleSettle(); };
	private readonly pointerReset = (): void => { this.pointerCount = 0; this.clearHover(); this.scheduleSettle(); };
	private scheduleSettle(): void {
		if (this.settleTimer !== null) this.win.clearTimeout(this.settleTimer);
		this.settleTimer = this.win.setTimeout(() => {
			this.settleTimer = null;
			if (this.pointerCount || this.disposed || !this.height) return;
			const offset = this.index() - this.windowStart;
			if (offset > this.windowCount / 4 && offset < this.windowCount * 3 / 4) return;
			const previous = this.windowStart;
			this.rebase();
			if (previous !== this.windowStart) this.restore();
		}, 160);
	}

	private draw(): void {
		const count = Math.max(1, Math.ceil(this.height / this.pitch));
		const center = this.index();
		const start = Math.max(this.windowStart, center - Math.ceil(count * 1.5));
		const end = Math.min(this.windowStart + this.windowCount, center + Math.ceil(count * 1.5) + 1);
		const top = this.targetTop() - this.padding();
		const firstVisible = Math.floor((top + 0.5) / this.pitch) + this.windowStart;
		const lastVisible = Math.ceil((top + this.height - 0.5) / this.pitch) - 1 + this.windowStart;
		const canvasHeight = `${this.windowCount * this.pitch + this.padding() * 2}px`;
		if (this.canvas.style.height !== canvasHeight) this.canvas.style.height = canvasHeight;
		const range = [start, end, center, firstVisible, lastVisible, this.pitch, this.windowStart].join(':');
		if (range === this.drawnRange) return;
		this.drawnRange = range;
		const active = this.element.ownerDocument.activeElement;
		for (const [index, row] of this.rows) {
			if (index >= start && index < end) continue;
			if (row.contains(active)) this.element.focus({ preventScroll: true });
			cleanupOperonHoverTooltips(row);
			this.resizeObserver?.unobserve(row);
			if (row === this.hoverRow) this.clearHover();
			row.remove();
			this.rows.delete(index);
		}
		let before = this.canvas.firstElementChild;
		for (let index = start; index < end; index++) {
			let row = this.rows.get(index);
			if (!row) {
				row = this.canvas.createDiv('operon-mini-calendar-week operon-calendar-sidebar-month-grid');
				row.classList.toggle('has-week-numbers', this.options.showWeekNumbers);
				row.dataset.weekStart = miniCalendarDate(this.firstWeek + index * 7);
				const date = new Date(0);
				const utc = new Date((this.firstWeek + index * 7) * DAY);
				date.setFullYear(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
				date.setHours(12, 0, 0, 0);
				renderMiniCalendarWeek(row, date, this.options, true);
				this.rows.set(index, row);
				this.resizeObserver?.observe(row);
			}
			row.classList.toggle('is-centered-week', this.hoverRow ? row === this.hoverRow : index === center);
			// The canvas midpoint includes the viewport inset, so resizing moves retained rows through layout alone.
			const offset = (index - this.windowStart - this.windowCount / 2) * this.pitch;
			const position = `calc(50% ${offset < 0 ? '-' : '+'} ${Math.abs(offset)}px)`;
			if (row.style.top !== position) row.style.top = position;
			const visible = this.height > 0 && index >= firstVisible && index <= lastVisible;
			if (row.dataset.tabbable !== String(visible)) {
				row.dataset.tabbable = String(visible);
				for (const button of Array.from(row.querySelectorAll<HTMLButtonElement>('button'))) button.tabIndex = visible && !button.disabled ? 0 : -1;
			}
			// Keep DOM/tab order chronological when scrolling back into earlier weeks.
			if (row !== before) this.canvas.insertBefore(row, before);
			before = row.nextElementSibling;
		}
	}

	dispose(): void {
		this.disposed = true;
		this.resizeObserver.disconnect();
		if (this.frame !== null) this.win.cancelAnimationFrame(this.frame);
		if (this.settleTimer !== null) this.win.clearTimeout(this.settleTimer);
		this.element.removeEventListener('pointerover', this.pointerOver);
		this.element.removeEventListener('pointerleave', this.clearHover);
		this.element.removeEventListener('scroll', this.onScroll);
		this.element.removeEventListener('pointerdown', this.pointerDown);
		this.win.removeEventListener('pointerup', this.pointerUp);
		this.win.removeEventListener('pointercancel', this.pointerUp);
		this.win.removeEventListener('blur', this.pointerReset);
		cleanupOperonHoverTooltips(this.element);
	}
}
