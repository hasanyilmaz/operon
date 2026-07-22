import {
	App,
	Notice,
	Platform,
	TFile,
	normalizePath,
	setIcon,
} from 'obsidian';
import type { IndexedTask } from '../types/fields';
import type { ReminderOccurrence } from '../core/reminder-scheduler-model';
import { t } from '../core/i18n';
import {
	isSupportedReminderSoundExtension,
	resolveReminderDeliveryChannel,
} from '../core/reminder-delivery-model';
import { getFocusedVisibleWorkspaceWindow } from '../core/dom-compat';

const REMINDER_SOUND_MAX_DURATION_MS = 10_000;
const REMINDER_SOUND_START_TIMEOUT_MS = 2_000;
const REMINDER_SYSTEM_NOTIFICATION_ACK_TIMEOUT_MS = 2_000;
const REMINDER_TEST_DESCRIPTION = 'That will be your task description here.';

interface ReminderNotificationConstructor {
	new(title: string, options?: NotificationOptions): Notification;
	readonly permission: NotificationPermission;
	requestPermission(): Promise<NotificationPermission>;
}

export interface ReminderDeliveryItem {
	occurrence: ReminderOccurrence;
	task: IndexedTask;
}

export interface ReminderDeliveryBatchResult {
	deliveredKeys: string[];
	deferredKeys: string[];
	retryKeys: string[];
}

export interface ReminderDeliveryPort {
	deliverBatch(items: readonly ReminderDeliveryItem[]): Promise<ReminderDeliveryBatchResult>;
	destroy(): void;
}

export interface ReminderDeliveryControllerOptions {
	app: App;
	getSystemNotificationsEnabled: () => boolean;
	getSoundFilePath: () => string;
	getNoticeDurationMs?: () => number;
	onOpenTask: (operonId: string) => void;
	ownerWindow?: Window;
	isDesktopApp?: () => boolean;
}

function getOwnerWindow(app: App, ownerWindow?: Window): Window {
	return ownerWindow
		?? app.workspace.containerEl.ownerDocument.defaultView
		?? window;
}

function getNotificationConstructor(ownerWindow: Window): ReminderNotificationConstructor | null {
	const candidate: unknown = Reflect.get(ownerWindow, 'Notification');
	if (typeof candidate !== 'function') return null;
	const metadata = candidate as unknown as {
		permission?: unknown;
		requestPermission?: unknown;
	};
	const permission = metadata.permission;
	const requestPermission = metadata.requestPermission;
	if ((permission !== 'default' && permission !== 'denied' && permission !== 'granted')
		|| typeof requestPermission !== 'function') return null;
	return candidate as ReminderNotificationConstructor;
}

export function getReminderSystemNotificationPermission(
	ownerWindow: Window = window,
): NotificationPermission | 'unsupported' {
	return getNotificationConstructor(ownerWindow)?.permission ?? 'unsupported';
}

export async function requestReminderSystemNotificationPermission(
	ownerWindow: Window = window,
): Promise<NotificationPermission> {
	const constructor = getNotificationConstructor(ownerWindow);
	if (!constructor || typeof constructor.requestPermission !== 'function') return 'denied';
	try {
		return await constructor.requestPermission();
	} catch {
		return 'denied';
	}
}

export function isSupportedReminderSoundFile(file: TFile): boolean {
	return isSupportedReminderSoundExtension(file.extension);
}

export type ReminderSoundPlayResult = 'played' | 'missing' | 'unsupported' | 'failed' | 'cancelled';

class ReminderSoundPlayer {
	private activeAudio: HTMLAudioElement | null = null;
	private stopTimer: number | null = null;
	private settlePendingStart: ((result: ReminderSoundPlayResult) => void) | null = null;

	constructor(
		private readonly app: App,
		private readonly ownerWindow: Window,
	) {}

	async play(rawPath: string): Promise<ReminderSoundPlayResult> {
		this.stop();
		const path = normalizePath(rawPath.trim().replace(/^\/+/, ''));
		if (!path) return 'missing';
		const file = this.app.vault.getFileByPath(path);
		if (!(file instanceof TFile)) return 'missing';
		if (!isSupportedReminderSoundFile(file)) return 'unsupported';

		try {
			const audio = this.ownerWindow.createEl('audio');
			audio.src = this.app.vault.getResourcePath(file);
			this.activeAudio = audio;
			audio.addEventListener('ended', this.handleEnded, { once: true });
			this.stopTimer = this.ownerWindow.setTimeout(() => this.stop(), REMINDER_SOUND_MAX_DURATION_MS);
			return await new Promise<ReminderSoundPlayResult>(resolve => {
				let settled = false;
				const settle = (result: ReminderSoundPlayResult): void => {
					if (settled) return;
					settled = true;
					this.ownerWindow.clearTimeout(startTimer);
					if (this.settlePendingStart === settle) this.settlePendingStart = null;
					if (result !== 'played' && this.activeAudio === audio) this.stop();
					resolve(result);
				};
				this.settlePendingStart = settle;
				const startTimer = this.ownerWindow.setTimeout(
					() => settle('failed'),
					REMINDER_SOUND_START_TIMEOUT_MS,
				);
				void audio.play().then(
					() => settle('played'),
					() => settle('failed'),
				);
			});
		} catch {
			this.stop();
			return 'failed';
		}
	}

	stop(): void {
		const settlePendingStart = this.settlePendingStart;
		this.settlePendingStart = null;
		settlePendingStart?.('cancelled');
		if (this.stopTimer !== null) {
			this.ownerWindow.clearTimeout(this.stopTimer);
			this.stopTimer = null;
		}
		if (!this.activeAudio) return;
		this.activeAudio.removeEventListener('ended', this.handleEnded);
		this.activeAudio.pause();
		this.activeAudio.removeAttribute('src');
		this.activeAudio.load();
		this.activeAudio = null;
	}

	private readonly handleEnded = (): void => this.stop();
}

export class ReminderSoundPreviewController {
	private readonly player: ReminderSoundPlayer;

	constructor(app: App, ownerWindow?: Window) {
		this.player = new ReminderSoundPlayer(app, getOwnerWindow(app, ownerWindow));
	}

	play(rawPath: string): Promise<ReminderSoundPlayResult> {
		return this.player.play(rawPath);
	}

	stop(): void {
		this.player.stop();
	}
}

export class ReminderDeliveryController implements ReminderDeliveryPort {
	private readonly ownerWindow: Window;
	private readonly soundPlayer: ReminderSoundPlayer;
	private readonly activeNotices = new Set<Notice>();
	private readonly activeSystemNotifications = new Set<Notification>();
	private readonly cleanupTimers = new Set<number>();
	private readonly pendingNotificationAcks = new Set<(shown: boolean) => void>();
	private readonly warnedSoundPaths = new Set<string>();
	private destroyed = false;

	constructor(private readonly options: ReminderDeliveryControllerOptions) {
		this.ownerWindow = getOwnerWindow(options.app, options.ownerWindow);
		this.soundPlayer = new ReminderSoundPlayer(options.app, this.ownerWindow);
	}

	async deliverBatch(items: readonly ReminderDeliveryItem[]): Promise<ReminderDeliveryBatchResult> {
		const result: ReminderDeliveryBatchResult = {
			deliveredKeys: [],
			deferredKeys: [],
			retryKeys: [],
		};
		if (this.destroyed || items.length === 0) return result;

		const foregroundWindow = getFocusedVisibleWorkspaceWindow(this.options.app, this.ownerWindow);
		const channel = this.resolveChannel(foregroundWindow);
		if (channel === 'deferred') {
			result.deferredKeys.push(...items.map(item => item.occurrence.key));
			return result;
		}
		if (channel === 'system') {
			const outcomes = await Promise.all(items.map(async item => {
				try {
					await this.showSystemNotification(item);
					return { item, delivered: true };
				} catch (error) {
					console.warn('Operon: reminder notification could not be shown', error);
					return { item, delivered: false };
				}
			}));
			for (const { item, delivered } of outcomes) {
				const target = delivered ? result.deliveredKeys : result.retryKeys;
				target.push(item.occurrence.key);
			}
		}

		if (channel === 'notice') for (const item of items) {
			try {
				this.showNotice(item, foregroundWindow ?? this.ownerWindow);
				result.deliveredKeys.push(item.occurrence.key);
			} catch (error) {
				console.warn('Operon: reminder notification could not be shown', error);
				result.retryKeys.push(item.occurrence.key);
			}
		}

		if (result.deliveredKeys.length > 0) {
			void this.playConfiguredSound().catch(error => {
				console.warn('Operon: reminder sound playback failed unexpectedly', error);
			});
		}
		return result;
	}

	previewInOperon(): void {
		if (this.destroyed) return;
		const fragment = this.ownerWindow.document.createRange().createContextualFragment('');
		const icon = this.ownerWindow.createSpan();
		icon.className = 'operon-reminder-notice-icon';
		icon.setAttribute('aria-hidden', 'true');
		setIcon(icon, 'bell-ring');
		fragment.append(icon, this.ownerWindow.document.createTextNode(' '));
		const label = this.ownerWindow.createEl('strong');
		label.textContent = REMINDER_TEST_DESCRIPTION;
		fragment.append(label, this.ownerWindow.document.createTextNode(` · ${this.formatLocalDatetime(new Date().toISOString())}`));
		const durationMs = this.options.getNoticeDurationMs?.() ?? 15_000;
		const notice = new Notice(fragment, durationMs);
		this.activeNotices.add(notice);
		const timer = this.ownerWindow.setTimeout(() => {
			this.cleanupTimers.delete(timer);
			this.activeNotices.delete(notice);
		}, durationMs);
		this.cleanupTimers.add(timer);
		void this.playConfiguredSound().catch(error => {
			console.warn('Operon: test reminder sound playback failed unexpectedly', error);
		});
	}

	async previewSystemNotification(): Promise<boolean> {
		if (this.destroyed || !(this.options.isDesktopApp?.() ?? Platform.isDesktopApp)
			|| !this.options.getSystemNotificationsEnabled()) return false;
		const constructor = getNotificationConstructor(this.ownerWindow);
		if (!constructor || constructor.permission !== 'granted') return false;
		try {
			const notification = new constructor(t('reminders', 'notificationTitle'), {
				body: `${REMINDER_TEST_DESCRIPTION} · ${this.formatLocalDatetime(new Date().toISOString())}`,
				tag: `operon-reminder-test-${Date.now()}`,
				silent: true,
			});
			this.activeSystemNotifications.add(notification);
			notification.onclick = () => { this.ownerWindow.focus(); notification.close(); };
			notification.onclose = () => this.activeSystemNotifications.delete(notification);
			void this.playConfiguredSound();
			return true;
		} catch (error) {
			console.warn('Operon: test system notification could not be shown', error);
			return false;
		}
	}

	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		for (const settle of this.pendingNotificationAcks) settle(false);
		this.pendingNotificationAcks.clear();
		for (const timer of this.cleanupTimers) this.ownerWindow.clearTimeout(timer);
		this.cleanupTimers.clear();
		for (const notice of this.activeNotices) notice.hide();
		this.activeNotices.clear();
		for (const notification of this.activeSystemNotifications) notification.close();
		this.activeSystemNotifications.clear();
		this.soundPlayer.stop();
	}

	private resolveChannel(foregroundWindow: Window | null): ReturnType<typeof resolveReminderDeliveryChannel> {
		return resolveReminderDeliveryChannel({
			documentVisible: foregroundWindow !== null,
			windowFocused: foregroundWindow !== null,
			isDesktopApp: this.options.isDesktopApp?.() ?? Platform.isDesktopApp,
			systemNotificationsEnabled: this.options.getSystemNotificationsEnabled(),
			systemNotificationPermission: getReminderSystemNotificationPermission(this.ownerWindow),
		});
	}

	private showNotice(item: ReminderDeliveryItem, targetWindow: Window): void {
		const targetDocument = targetWindow.document;
		const fragment = targetDocument.createRange().createContextualFragment('');
		const icon = targetWindow.createSpan();
		icon.className = 'operon-reminder-notice-icon';
		icon.setAttribute('aria-hidden', 'true');
		setIcon(icon, 'bell-ring');
		fragment.append(icon, targetDocument.createTextNode(' '));

		const openTask = (event: Event): void => {
			event.preventDefault();
			this.options.onOpenTask(item.occurrence.operonId);
		};
		const label = targetWindow.createEl('a');
		label.href = '#';
		label.addClass('operon-reminder-notice-task-link');
		label.textContent = item.task.description.trim() || t('reminders', 'untitledTask');
		label.addEventListener('click', openTask);
		fragment.append(label);
		fragment.append(targetDocument.createTextNode(` · ${this.formatLocalDatetime(item.occurrence.localDatetime)} `));

		const action = targetWindow.createEl('a');
		action.href = '#';
		action.textContent = t('reminders', 'openTask');
		action.addEventListener('click', openTask);
		fragment.append(action);

		const durationMs = this.options.getNoticeDurationMs?.() ?? 15_000;
		const notice = new Notice(fragment, durationMs);
		this.activeNotices.add(notice);
		const timer = this.ownerWindow.setTimeout(() => {
			this.cleanupTimers.delete(timer);
			this.activeNotices.delete(notice);
		}, durationMs);
		this.cleanupTimers.add(timer);
	}

	private async showSystemNotification(item: ReminderDeliveryItem): Promise<void> {
		const constructor = getNotificationConstructor(this.ownerWindow);
		if (!constructor || constructor.permission !== 'granted') {
			throw new Error('SYSTEM_NOTIFICATION_UNAVAILABLE');
		}
		const taskTitle = item.task.description.trim() || t('reminders', 'untitledTask');
		const notification = new constructor(t('reminders', 'notificationTitle'), {
			body: `${taskTitle} · ${this.formatLocalDatetime(item.occurrence.localDatetime)}`,
			tag: item.occurrence.key,
			silent: true,
		});
		this.activeSystemNotifications.add(notification);
		notification.onclick = () => {
			this.ownerWindow.focus();
			this.options.onOpenTask(item.occurrence.operonId);
			notification.close();
		};
		const shown = await new Promise<boolean>(resolve => {
			let settled = false;
			const settle = (value: boolean): void => {
				if (settled) return;
				settled = true;
				this.ownerWindow.clearTimeout(timer);
				this.cleanupTimers.delete(timer);
				this.pendingNotificationAcks.delete(settle);
				resolve(value);
			};
			this.pendingNotificationAcks.add(settle);
			notification.onshow = () => settle(true);
			notification.onerror = () => settle(false);
			notification.onclose = () => {
				this.activeSystemNotifications.delete(notification);
				settle(false);
			};
			const timer = this.ownerWindow.setTimeout(
				() => settle(false),
				REMINDER_SYSTEM_NOTIFICATION_ACK_TIMEOUT_MS,
			);
			this.cleanupTimers.add(timer);
		});
		if (!shown) {
			notification.close();
			this.activeSystemNotifications.delete(notification);
			throw new Error('SYSTEM_NOTIFICATION_FAILED');
		}
		notification.onclose = () => this.activeSystemNotifications.delete(notification);
	}

	private async playConfiguredSound(): Promise<void> {
		const rawPath = this.options.getSoundFilePath().trim();
		if (!rawPath) return;
		const status = await this.soundPlayer.play(rawPath);
		if (status === 'played' || status === 'cancelled' || this.warnedSoundPaths.has(rawPath)) return;
		this.warnedSoundPaths.add(rawPath);
		console.warn(`Operon: reminder sound could not be played (${status}): ${rawPath}`);
	}

	private formatLocalDatetime(localDatetime: string): string {
		return localDatetime.replace('T', ' ').slice(0, 16);
	}
}
