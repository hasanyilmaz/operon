import { moment } from 'obsidian';
import { t } from '../../core/i18n';
import { formatPeriodicNoteTitleFromDateKey, normalizePeriodicNoteFormat, type PeriodicNoteKind } from '../../core/periodic-note-path';

export function miniCalendarWeek(monday: string, format: string, weekStart: 'monday' | 'sunday' = 'monday', resolveWeekStart?: (monday: string) => 'monday' | 'sunday'): { label: string; description: string } {
	const normalized = normalizePeriodicNoteFormat('weekly', format);
	const tokens = normalized.replace(/\[[^\]]*\]/gu, '');
	const local = tokens.includes('gggg') && tokens.includes('ww') && !tokens.includes('GGGG') && !tokens.includes('WW');
	const parse = moment as unknown as (value: string, format: string, strict: boolean) => { format: (pattern: string) => string };
	const date = parse(monday, 'YYYY-MM-DD', true);
	const label = date.format(local ? 'w' : 'W');
	const mondayTitle = formatPeriodicNoteTitleFromDateKey('weekly', monday, normalized) ?? monday;
	let title = mondayTitle;
	if (weekStart === 'sunday') {
		const sundayTitle = formatPeriodicNoteTitleFromDateKey('weekly', monday, normalized, 'sunday') ?? monday;
		if (sundayTitle !== mondayTitle && resolveWeekStart?.(monday) !== 'monday') title = sundayTitle;
	}
	return { label, description: t('calendar', 'miniCalendarOpenWeek', { week: date.format(local ? 'gggg-[W]ww' : 'GGGG-[W]WW'), title }) };
}

export interface MiniCalendarNoteRequest {
	kind: PeriodicNoteKind;
	dateKey: string;
	anchor: HTMLElement;
	isCurrent: () => boolean;
}

type PendingNote = { key: string; settled: boolean; request: MiniCalendarNoteRequest };

/** Serialize creation, coalesce repeats, and let only the latest live request open a view. */
export class MiniCalendarNoteOpener {
	private current: PendingNote | null = null;
	private pending: PendingNote | null = null;
	private running = false;

	constructor(private readonly open: (request: MiniCalendarNoteRequest) => Promise<void>, private readonly onError: (error: unknown) => void) {}

	request(kind: PeriodicNoteKind, dateKey: string, anchor: HTMLElement): void {
		const key = `${kind}:${dateKey}`;
		if (this.current?.key === key && !this.current.settled && this.current.request.isCurrent()) return;
		const doc = anchor.ownerDocument;
		const entry: PendingNote = { key, settled: false, request: { kind, dateKey, anchor,
			isCurrent: () => this.current === entry && anchor.isConnected && anchor.ownerDocument === doc && !doc.defaultView?.closed,
		} };
		this.current = entry;
		this.pending = entry;
		if (!this.running) void this.drain();
	}

	invalidate(): void { this.current = null; this.pending = null; }

	private async drain(): Promise<void> {
		this.running = true;
		try {
			while (this.pending) {
				const entry = this.pending;
				this.pending = null;
				try { if (entry.request.isCurrent()) await this.open(entry.request); }
				catch (error) { if (entry.request.isCurrent()) this.onError(error); }
				finally { entry.settled = true; }
			}
		} finally { this.running = false; }
	}
}
