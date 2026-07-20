export type ReminderDeliveryChannel = 'notice' | 'system' | 'deferred';

const SUPPORTED_REMINDER_SOUND_EXTENSIONS = new Set(['mp3', 'wav', 'm4a', 'aac', 'ogg']);

export interface ReminderDeliveryChannelInput {
	documentVisible: boolean;
	windowFocused: boolean;
	isDesktopApp: boolean;
	systemNotificationsEnabled: boolean;
	systemNotificationPermission: NotificationPermission | 'unsupported';
}

export function resolveReminderDeliveryChannel(input: ReminderDeliveryChannelInput): ReminderDeliveryChannel {
	if (input.documentVisible && input.windowFocused) return 'notice';
	if (input.isDesktopApp
		&& input.systemNotificationsEnabled
		&& input.systemNotificationPermission === 'granted') return 'system';
	return 'deferred';
}

export function isSupportedReminderSoundExtension(extension: string): boolean {
	return SUPPORTED_REMINDER_SOUND_EXTENSIONS.has(extension.trim().toLowerCase().replace(/^\./, ''));
}
