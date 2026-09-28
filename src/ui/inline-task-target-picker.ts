import type { App } from 'obsidian';
import { t } from '../core/i18n';
import type { InlineTargetDestination, InlineTargetOption } from '../core/inline-task-targets';
import { openSettingsOptionPickerModal } from './settings/settings-option-picker-modal';

export function promptInlineTaskTarget(app: App, targets: readonly InlineTargetOption[]): Promise<InlineTargetDestination | null> {
	const reasons = {
		active: t('taskEditor', 'inlineTargetActive'), parent: t('taskEditor', 'inlineTargetParent'),
		recent: t('taskEditor', 'inlineTargetRecent'), frequent: t('taskEditor', 'inlineTargetFrequent'), other: '',
	};
	return new Promise(resolve => {
		openSettingsOptionPickerModal(app, {
			title: t('taskEditor', 'chooseInlineTaskTargetFile'), value: null,
			placeholder: t('taskEditor', 'chooseInlineTaskTargetFile'),
			ariaLabel: t('taskEditor', 'chooseInlineTaskTargetFile'),
			noMatchesText: t('taskEditor', 'noMatchingMarkdownFiles'),
			fuzzySearch: true, pageSize: 50,
			options: targets.map((option, index) => ({
				value: String(index), target: option.target,
				label: option.target.filePath.split('/').pop()?.replace(/\.md$/i, '') ?? option.target.filePath,
				description: [reasons[option.reason], option.target.filePath,
					option.target.kind === 'inline-parent' ? t('taskEditor', 'inlineTargetBelowParent') : option.target.headingKeyword,
				].filter(Boolean).join(' · '),
			})),
			getSearchText: option => `${option.label} ${option.target.filePath}`,
			onSelect: option => resolve(option.target), onCancel: () => resolve(null),
		});
	});
}
