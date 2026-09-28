import { t } from '../core/i18n';
import type { InlineTargetDestination, InlineTargetOption } from '../core/inline-task-targets';
import { getActiveDocument, getOwnerWindow } from '../core/dom-compat';
import { snapshotFloatingRectAnchor } from './field-pickers/common';
import { showSearchableOptionPicker } from './field-pickers/searchable-option-picker';

export function promptInlineTaskTarget(targets: readonly InlineTargetOption[]): Promise<InlineTargetDestination | null> {
	const reasons = {
		active: t('taskEditor', 'inlineTargetActive'), parent: t('taskEditor', 'inlineTargetParent'),
		recent: t('taskEditor', 'inlineTargetRecent'), frequent: t('taskEditor', 'inlineTargetFrequent'), other: '',
	};
	// Commands have no persistent button anchor. Use a viewport point in the
	// active document, retaining the shared picker's own host and dismissal.
	const host = getActiveDocument().body;
	const win = getOwnerWindow(host);
	const width = Math.min(360, win.innerWidth - 16);
	const anchor = snapshotFloatingRectAnchor(host);
	anchor.x = Math.max(8, (win.innerWidth - width) / 2);
	anchor.y = Math.max(8, win.innerHeight * 0.15);
	anchor.width = 0;
	anchor.height = 0;
	return new Promise(resolve => {
		showSearchableOptionPicker(anchor, {
			value: null,
			variantClassName: 'operon-inline-target-picker',
			floatingHost: host, matchWidth: width,
			closeOnWindowResize: false, repositionOnWindowResize: true,
			placeholder: t('taskEditor', 'chooseInlineTaskTargetFile'),
			ariaLabel: t('taskEditor', 'chooseInlineTaskTargetFile'),
			noMatchesText: t('taskEditor', 'noMatchingMarkdownFiles'),
			fuzzySearch: true, pageSize: 50,
			options: targets.map((option, index) => ({
				value: String(index), target: option.target,
				label: option.target.filePath.split('/').pop()?.replace(/\.md$/i, '') ?? option.target.filePath,
				title: [reasons[option.reason],
					option.target.kind === 'inline-parent' ? t('taskEditor', 'inlineTargetBelowParent') : option.target.headingKeyword,
				].filter(Boolean).join(' · '),
			})),
			getSearchText: option => `${option.label} ${option.target.filePath}`,
			onSelect: option => resolve(option.target), onClose: () => resolve(null),
		});
	});
}
