import { IndexedTask } from './fields';

export type TrackerSource = 'editor' | 'command' | 'sidebar-search' | 'history-play' | 'status-bar' | 'flowtime';
export type TrackerStopReason = 'manual' | 'switch' | 'terminal-status' | 'obsidian-quit';
export type TimeTrackerTransitionKind = 'starting' | 'stopping';

export interface ActiveTrackerRecord {
	id: string;
	userId: string;
	userName: string;
	taskId: string | null;
	start: string;
	source: TrackerSource;
	createdAt: string;
	updatedAt: string;
}

export interface ActiveTrackersData {
	version: 1;
	active: ActiveTrackerRecord[];
}

export interface ActiveTrackerState {
	operonId: string | null;
	start: string;
	task: IndexedTask | null;
	elapsedSeconds: number;
	isUnassigned: boolean;
}

export interface TimeTrackerTransitionState {
	kind: TimeTrackerTransitionKind;
	taskId: string | null;
	start: string;
	source: TrackerSource;
	startedAtMs: number;
	previousActive?: ActiveTrackerState | null;
}

export interface TrackerSession {
	operonId: string;
	sessionIndex: number;
	start: string;
	end: string;
	durationSeconds: number;
	task: IndexedTask;
}

export interface TrackerHistoryDayGroup {
	date: string;
	label: string;
	totalSeconds: number;
	sessions: TrackerSession[];
}
