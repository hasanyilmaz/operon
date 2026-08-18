import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { FlowTimeCompletionAlertTracker } from '../src/systems/flow-time-completion-alerts';
import { buildOperonDataPackageFromSettings, composeOperonSettingsFromDataPackage } from '../src/storage/operon-data-package';
import { SETTINGS_BACKUP_GROUPS } from '../src/core/settings-backup-compatibility';
import { DEFAULT_SETTINGS, migrateSettings } from '../src/types/settings';
import { ReminderDeliveryController } from '../src/systems/reminder-delivery';
import { TFile } from 'obsidian';

let assertions = 0;

function equal<T>(actual: T, expected: T, message?: string): void {
	assert.equal(actual, expected, message);
	assertions += 1;
}

function observe(
	tracker: FlowTimeCompletionAlertTracker,
	kind: 'focus' | 'break',
	occurrenceKey: string,
	elapsedSeconds: number,
	targetSeconds: number,
	enabled: boolean,
): boolean {
	return tracker.observe({ kind, occurrenceKey, elapsedSeconds, targetSeconds, enabled });
}

async function run(): Promise<void> {
	const missing = migrateSettings({});
	equal(missing.flowTimePlayReminderSoundOnTargetReached, false, 'missing setting defaults to silent FlowTime completion');
	equal(
		migrateSettings({ flowTimePlayReminderSoundOnTargetReached: true }).flowTimePlayReminderSoundOnTargetReached,
		true,
		'explicit FlowTime completion sound opt-in is preserved',
	);
	equal(
		migrateSettings({ flowTimePlayReminderSoundOnTargetReached: 'true' }).flowTimePlayReminderSoundOnTargetReached,
		false,
		'invalid FlowTime completion sound settings fail closed',
	);

	const dataPackage = buildOperonDataPackageFromSettings(migrateSettings({
		flowTimePlayReminderSoundOnTargetReached: true,
	}));
	equal(dataPackage.settings.flowTimePlayReminderSoundOnTargetReached, true, 'data package retains sound opt-in');
	equal(
		composeOperonSettingsFromDataPackage(dataPackage, DEFAULT_SETTINGS).flowTimePlayReminderSoundOnTargetReached,
		true,
		'data-package compose preserves FlowTime sound opt-in',
	);
	equal(
		SETTINGS_BACKUP_GROUPS.some(group => group.settingKeys.includes('flowTimePlayReminderSoundOnTargetReached')),
		true,
		'settings backup includes the FlowTime sound setting',
	);

	const tracker = new FlowTimeCompletionAlertTracker();
	equal(observe(tracker, 'focus', 'focus-1', 59, 60, true), false, 'focus starts below target without sound');
	equal(observe(tracker, 'focus', 'focus-1', 60, 60, true), true, 'focus sounds exactly at zero');
	equal(observe(tracker, 'focus', 'focus-1', 61, 60, true), false, 'focus overtime never replays sound');
	equal(observe(tracker, 'focus', 'focus-2', 65, 60, true), false, 'opening on an already elapsed focus target stays silent');
	equal(observe(tracker, 'focus', 'focus-3', 59, 60, false), false, 'disabled focus sound remains silent before target');
	equal(observe(tracker, 'focus', 'focus-3', 60, 60, false), false, 'disabled focus sound remains silent at target');
	equal(observe(tracker, 'focus', 'focus-3', 61, 60, true), false, 'enabling sound after target does not replay it');

	tracker.sync({
		kind: 'focus',
		occurrenceKey: 'focus-4',
		elapsedSeconds: 90,
		targetSeconds: 60,
		enabled: true,
	});
	equal(observe(tracker, 'focus', 'focus-4', 91, 60, true), false, 'duration shortening that enters overtime does not retroactively sound');
	equal(observe(tracker, 'focus', 'focus-5', 59, 60, true), false, 'next focus occurrence starts independently');
	equal(observe(tracker, 'focus', 'focus-5', 60, 60, true), true, 'next focus occurrence sounds once');

	equal(observe(tracker, 'break', 'break-1', 59, 60, true), false, 'break starts below target without sound');
	equal(observe(tracker, 'break', 'break-1', 60, 60, true), true, 'break sounds exactly at zero');
	equal(observe(tracker, 'break', 'break-1', 61, 60, true), false, 'break overtime never replays sound');
	tracker.reset('break');
	equal(observe(tracker, 'break', 'break-2', 60, 60, true), false, 'newly observed elapsed break stays silent after an early break end or view close');

	const silentController = new ReminderDeliveryController({
		app: { vault: { getFileByPath: () => null } } as never,
		getSystemNotificationsEnabled: () => false,
		getSoundFilePath: () => '',
		onOpenTask: () => undefined,
		ownerWindow: {} as Window,
	});
	await silentController.playReminderSound();
	silentController.destroy();
	assertions += 1;
	const originalConsoleWarn = console.warn;
	const soundWarnings: unknown[][] = [];
	console.warn = (...args: unknown[]) => { soundWarnings.push(args); };
	try {
		const missingSoundController = new ReminderDeliveryController({
			app: { vault: { getFileByPath: () => null } } as never,
			getSystemNotificationsEnabled: () => false,
			getSoundFilePath: () => 'Sounds/missing.mp3',
			onOpenTask: () => undefined,
			ownerWindow: {} as Window,
		});
		await missingSoundController.playReminderSound();
		await missingSoundController.playReminderSound();
		missingSoundController.destroy();
		const unsupportedSoundController = new ReminderDeliveryController({
			app: { vault: { getFileByPath: () => Object.assign(Object.create(TFile.prototype) as TFile, {
				path: 'Sounds/unsupported.txt',
				name: 'unsupported.txt',
				basename: 'unsupported',
				extension: 'txt',
			}) } } as never,
			getSystemNotificationsEnabled: () => false,
			getSoundFilePath: () => 'Sounds/unsupported.txt',
			onOpenTask: () => undefined,
			ownerWindow: {} as Window,
		});
		await unsupportedSoundController.playReminderSound();
		unsupportedSoundController.destroy();
	} finally {
		console.warn = originalConsoleWarn;
	}
	equal(soundWarnings.length, 2, 'missing and unsupported Reminder sounds warn once without failing FlowTime completion');

	const pluginRoot = process.cwd();
	const [flowTimeSource, settingsSource, settingsRegistrySource, mainSource, reminderSource, englishLocale] = await Promise.all([
		readFile(path.join(pluginRoot, 'src/ui/flow-time-view.ts'), 'utf8'),
		readFile(path.join(pluginRoot, 'src/ui/settings-tab.ts'), 'utf8'),
		readFile(path.join(pluginRoot, 'src/ui/settings/settings-search-registry.ts'), 'utf8'),
		readFile(path.join(pluginRoot, 'main.ts'), 'utf8'),
		readFile(path.join(pluginRoot, 'src/systems/reminder-delivery.ts'), 'utf8'),
		readFile(path.join(pluginRoot, 'i18n/locales/en.json'), 'utf8'),
	]);
	assert.match(flowTimeSource, /this\.notifyIfTargetReached\(settings, active\);\s*this\.playReminderSoundIfTargetReached\(settings, active\);/u, 'notice and sound paths remain independent');
	assert.match(flowTimeSource, /kind: 'break'/u, 'FlowTime break uses the sound-boundary tracker');
	assert.doesNotMatch(flowTimeSource.match(/private playReminderSoundIfTargetReached[\s\S]*?(?=\n\tprivate )/u)?.[0] ?? '', /new Notice\(/u, 'break sound path never creates a notice');
	assert.match(settingsSource, /flowTimePlayReminderSoundOnTargetReached/u, 'FlowTime settings render the sound toggle');
	assert.match(settingsRegistrySource, /flowTimePlayReminderSoundOnTargetReached/u, 'settings search indexes the sound toggle');
	assert.match(mainSource, /playReminderSound: \(\) => this\.reminderDeliveryController\?\.playReminderSound\(\)/u, 'FlowTime receives the shared ReminderDeliveryController callback');
	assert.match(reminderSource, /async playReminderSound\(\): Promise<void>/u, 'ReminderDeliveryController exposes the shared sound channel');
	assert.match(englishLocale, /"flowTimePlayReminderSoundOnTargetReached": "Play reminder sound when FlowTime reaches zero"/u, 'English setting title matches the approved copy');
	assert.match(englishLocale, /"flowTimePlayReminderSoundOnTargetReachedDesc": "Play the audio file selected under Reminders → Reminder sound when a FlowTime session or break reaches zero\."/u, 'English setting description names the Reminder sound source');
	assertions += 9;

	console.log(`FlowTime completion alert tests passed: ${assertions} assertions`);
}

declare global {
	var __operonFlowTimeCompletionAlertsTestRun: Promise<void> | undefined;
}

globalThis.__operonFlowTimeCompletionAlertsTestRun = run();
