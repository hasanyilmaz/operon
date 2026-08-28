import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { TableGanttSettings } from '../src/types/table';
import {
	createTableGanttSessionState,
	resolveTableGanttViewportRenderWidth,
} from '../src/ui/table/table-gantt-split';
import {
	buildTableGanttTimelineLayout,
	resolveTableGanttCenterAnchoredScrollLeft,
	resolveTableGanttViewportCenterAnchor,
} from '../src/ui/table/table-gantt-renderer';

let assertions = 0;

function equal<T>(actual: T, expected: T, message?: string): void {
	assert.equal(actual, expected, message);
	assertions += 1;
}

function close(actual: number, expected: number, message?: string): void {
	assert.ok(Math.abs(actual - expected) < 0.001, message ?? `${actual} should equal ${expected}`);
	assertions += 1;
}

function matches(actual: string, expected: RegExp, message?: string): void {
	assert.match(actual, expected, message);
	assertions += 1;
}

function doesNotMatch(actual: string, expected: RegExp, message?: string): void {
	assert.doesNotMatch(actual, expected, message);
	assertions += 1;
}

function gantt(
	scale: TableGanttSettings['scale'],
	unitWidthMultiplier: TableGanttSettings['unitWidthMultiplier'],
): TableGanttSettings {
	return {
		enabled: true,
		splitPercent: 70,
		scale,
		unitWidthMultiplier,
		barColorMode: 'noColor',
		weekendVisibility: 'show',
	};
}

async function run(): Promise<void> {
	const session = createTableGanttSessionState();
	equal(resolveTableGanttViewportRenderWidth(0, session.timelineInitialized), 400);
	session.timelineInitialized = true;
	equal(resolveTableGanttViewportRenderWidth(0, session.timelineInitialized), null);
	equal(resolveTableGanttViewportRenderWidth(720, session.timelineInitialized), 720);

	const multipliers = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;
	for (const scale of ['day', 'week'] as const) {
		for (const unitWidthMultiplier of multipliers) {
			const original = buildTableGanttTimelineLayout({
				items: [],
				gantt: gantt(scale, unitWidthMultiplier),
				calendarWeekStart: 'monday',
				viewportWidth: 900,
				today: '2026-08-28',
				anchorDate: '2026-11-13',
			});
			const requestedAnchor = { date: '2026-11-13', dayOffsetRatio: 0.37 };
			const anchor = resolveTableGanttViewportCenterAnchor(
				original,
				resolveTableGanttCenterAnchoredScrollLeft(original, requestedAnchor),
			);
			const resized = buildTableGanttTimelineLayout({
				items: [],
				gantt: gantt(scale, unitWidthMultiplier),
				calendarWeekStart: 'sunday',
				viewportWidth: 540,
				today: '2026-08-28',
				anchorDate: anchor.date,
			});
			const restored = resolveTableGanttViewportCenterAnchor(
				resized,
				resolveTableGanttCenterAnchoredScrollLeft(resized, anchor),
			);
			equal(restored.date, anchor.date, `${scale} ${unitWidthMultiplier} keeps the center date`);
			close(restored.dayOffsetRatio, anchor.dayOffsetRatio, `${scale} ${unitWidthMultiplier} keeps the day offset`);
		}
	}

	const rootDir = process.cwd();
	const workspaceSource = await readFile(path.join(rootDir, 'src/ui/table/operon-table-view.ts'), 'utf8');
	const embeddedSource = await readFile(path.join(rootDir, 'src/ui/embed-table-processor.ts'), 'utf8');
	for (const source of [workspaceSource, embeddedSource]) {
		matches(source, /resolveTableGanttViewportRenderWidth\(/);
		matches(source, /timelineViewportRestorePending = true/);
		matches(source, /\|\| .*timelineViewportRestorePending/);
		matches(source, /!programmaticScroll && [^]*ganttTimelineLayout/);
		matches(source, /timelineViewportAnchorDate = viewportAnchor\.date/);
		doesNotMatch(source, /const viewportWidth = bodyScroller\.clientWidth \|\| 400/);
	}

	console.log(`Table Gantt viewport retention tests passed (${assertions} assertions).`);
}

declare global {
	var __operonTableGanttViewportRetentionTestRun: Promise<void> | undefined;
}

globalThis.__operonTableGanttViewportRetentionTestRun = run();
