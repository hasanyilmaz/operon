import { Setting, setIcon } from 'obsidian';
import { bindOperonHoverTooltip } from '../operon-hover-tooltip';
import { settingsAsyncHandler } from './async-settings-action';
import {
	createSettingsListCard,
	createSettingsListCardActionButton,
	createSettingsListCardChip,
} from './settings-list-ui';
import { setAccessibleLabelWithoutTooltip } from '../accessibility-label';

export interface InterfaceIconToggleButtonOptions {
	containerEl: HTMLElement;
	icon: string;
	label: string;
	className: string;
	active?: boolean;
	disabled?: boolean;
	locked?: boolean;
	tooltip?: string;
	pressed?: boolean | null;
	onClick?: () => void | Promise<void>;
	errorContext?: string;
}

export interface InterfaceIconToggleSectionItem<TKey extends string> {
	key: TKey;
	visible: boolean;
	iconOnly?: boolean;
}

export interface InterfaceIconActionToggle {
	visible: boolean;
	icon: string;
	label: string;
	searchTargetId?: string;
	onToggle: () => Promise<void>;
}

export interface InterfaceManagedSurfaceItem {
	key: string;
	visible: boolean;
	icon: string;
	label: string;
	canonicalLabel: string;
	onToggle: () => Promise<void>;
	showReorderControls?: boolean;
	canMoveUp?: boolean;
	canMoveDown?: boolean;
	onMoveUp?: () => Promise<void>;
	onMoveDown?: () => Promise<void>;
}

export type InterfaceIconRowSelection = { key: string } | { action: number };

export interface InterfaceIconToggleSectionOptions<
	TKey extends string,
	TItem extends InterfaceIconToggleSectionItem<TKey>,
> {
	containerEl: HTMLElement;
	layout?: 'legacy' | 'row-list';
	singleRow?: InterfaceIconRowSelection;
	onReorder?: () => void;
	description: string;
	toggleTitle: string;
	iconOnlyTitle?: string;
	reorderTitle: string;
	moveUpLabel: string;
	moveDownLabel: string;
	getItems: () => TItem[];
	setItems: (items: TItem[]) => void;
	getManagedItems?: () => InterfaceManagedSurfaceItem[];
	getLabel: (key: TKey) => string;
	getIcon: (key: TKey) => string;
	canMoveUp?: (item: TItem, index: number, items: TItem[]) => boolean;
	canMoveDown?: (item: TItem, index: number, items: TItem[]) => boolean;
	save: () => Promise<void>;
	getActionToggles?: () => InterfaceIconActionToggle[];
	actionTogglesTitle?: string;
	iconOnlyButtonLabel?: string;
	descriptionSearchTargetId?: string;
	getCanonicalLabel?: (key: TKey) => string;
	getVisibilityToggleLabel?: (label: string) => string;
	getIconOnlyToggleLabel?: (label: string) => string;
	visibilityErrorContext: string;
	iconOnlyErrorContext: string;
	actionErrorContext: string;
}

export interface InterfaceMatrixButtonOptions {
	containerEl: HTMLElement;
	icon: string;
	label: string;
	className: string;
	tooltip?: string;
	active?: boolean;
	locked?: boolean;
	lockedTooltip?: string;
	onClick?: () => void | Promise<void>;
	errorContext?: string;
}

export interface InterfaceMatrixHeaderIconOptions {
	containerEl: HTMLElement;
	icon: string;
	label: string;
	className: string;
	tooltip?: string;
}

function bindInterfaceTooltip(targetEl: HTMLElement, content: string): void {
	bindOperonHoverTooltip(targetEl, {
		content,
		taskColor: null,
	});
}

function applyExtraButtonTooltip(button: { extraSettingsEl?: HTMLElement }, content: string): void {
	if (!button.extraSettingsEl) return;
	setAccessibleLabelWithoutTooltip(button.extraSettingsEl, content);
	bindInterfaceTooltip(button.extraSettingsEl, content);
}

function moveInterfaceItem<TItem extends object>(
	items: TItem[],
	fromIndex: number,
	toIndex: number,
): TItem[] {
	const next = items.map(item => ({ ...item }));
	const [moved] = next.splice(fromIndex, 1);
	if (!moved) return next;
	next.splice(toIndex, 0, moved);
	return next;
}

interface ScrollSnapshot {
	element: Element;
	scrollLeft: number;
	scrollTop: number;
}

function captureScrollSnapshot(anchorEl: HTMLElement): ScrollSnapshot | null {
	const scrollEl = findScrollableAncestor(anchorEl);
	if (!scrollEl) return null;
	return {
		element: scrollEl,
		scrollLeft: scrollEl.scrollLeft,
		scrollTop: scrollEl.scrollTop,
	};
}

function findScrollableAncestor(anchorEl: HTMLElement): Element | null {
	let current: HTMLElement | null = anchorEl;
	while (current) {
		const style = getComputedStyle(current);
		if (current.scrollHeight > current.clientHeight && /auto|scroll|overlay/u.test(style.overflowY)) {
			return current;
		}
		current = current.parentElement;
	}
	return anchorEl.ownerDocument.scrollingElement;
}

function restoreScrollSnapshot(snapshot: ScrollSnapshot | null): void {
	if (!snapshot) return;
	const restore = (): void => {
		snapshot.element.scrollTop = snapshot.scrollTop;
		snapshot.element.scrollLeft = snapshot.scrollLeft;
	};
	restore();
	snapshot.element.ownerDocument.defaultView?.requestAnimationFrame(restore);
}

function rerenderRowsPreservingScroll(anchorEl: HTMLElement, renderRows: () => void): void {
	const snapshot = captureScrollSnapshot(anchorEl);
	const row = anchorEl.closest<HTMLElement>('[data-operon-chip-row]');
	const page = row?.closest('.setting-page');
	const focused = anchorEl.ownerDocument.activeElement;
	const buttonIndex = row && focused ? Array.from(row.querySelectorAll('button')).indexOf(focused as HTMLButtonElement) : -1;
	renderRows();
	restoreScrollSnapshot(snapshot);
	if (row && buttonIndex >= 0) {
		const currentRow = row.isConnected ? row : Array.from((page?.isConnected ? page : anchorEl.ownerDocument).querySelectorAll<HTMLElement>('[data-operon-chip-row]')).find(candidate => candidate.dataset.operonChipRow === row.dataset.operonChipRow);
		currentRow?.querySelectorAll('button')[buttonIndex]?.focus({ preventScroll: true });
	}
}

export function createInterfaceIconToggleButton(options: InterfaceIconToggleButtonOptions): HTMLButtonElement {
	const buttonEl = options.containerEl.createEl('button', {
		cls: `operon-interface-icon-toggle-button ${options.className}`.trim(),
		attr: {
			type: 'button',
		},
	});
	setIcon(buttonEl, options.icon);
	setAccessibleLabelWithoutTooltip(buttonEl, options.label);
	bindInterfaceTooltip(buttonEl, options.tooltip ?? options.label);

	if (options.active) buttonEl.addClass('is-active');
	if (options.disabled) buttonEl.addClass('is-disabled');
	if (options.locked) {
		buttonEl.addClass('is-locked');
		buttonEl.setAttribute('aria-disabled', 'true');
	}
	if (options.pressed !== null) {
		buttonEl.setAttribute('aria-pressed', String(options.pressed ?? options.active === true));
	}
	if (options.disabled) {
		buttonEl.disabled = true;
		buttonEl.setAttribute('aria-disabled', 'true');
	}

	const onClick = options.onClick;
	if (onClick && !options.disabled && !options.locked) {
		buttonEl.addEventListener('click', settingsAsyncHandler(options.errorContext ?? 'settings interface action failed', async () => {
			await onClick();
		}));
	}

	return buttonEl;
}

export function renderInterfaceIconToggleSection<
	TKey extends string,
	TItem extends InterfaceIconToggleSectionItem<TKey>,
>(options: InterfaceIconToggleSectionOptions<TKey, TItem>): void {
	if (options.layout === 'row-list') {
		renderInterfaceIconRowListSection(options);
		return;
	}

	const description = options.containerEl.createEl('p', {
		text: options.description,
	});
	description.addClass('operon-settings-section-desc');

	const section = options.containerEl.createDiv('operon-settings-task-creator-toolbar');
	const toggleLabel = section.createDiv('operon-settings-task-creator-toolbar-label');
	toggleLabel.setText(options.toggleTitle);
	const toggleGrid = section.createDiv('operon-settings-task-creator-toolbar-grid');

	let iconOnlyGrid: HTMLElement | null = null;
	if (options.iconOnlyTitle) {
		const iconOnlyLabel = section.createDiv('operon-settings-task-creator-toolbar-label');
		iconOnlyLabel.setText(options.iconOnlyTitle);
		iconOnlyGrid = section.createDiv('operon-settings-task-creator-toolbar-grid');
	}

	const reorderDetails = section.createEl('details', {
		cls: 'operon-settings-task-creator-toolbar-reorder',
	});
	const reorderSummary = reorderDetails.createEl('summary', {
		text: options.reorderTitle,
	});
	reorderSummary.addClass('operon-settings-task-creator-toolbar-summary');
	const reorderList = reorderDetails.createDiv('operon-settings-task-creator-toolbar-reorder-list');

	const renderRows = (): void => {
		const items = options.getItems();
		toggleGrid.empty();
		iconOnlyGrid?.empty();
		reorderList.empty();

		items.forEach((item, index) => {
			const label = options.getLabel(item.key);
			const icon = options.getIcon(item.key);
			createInterfaceIconToggleButton({
				containerEl: toggleGrid,
				icon,
				label,
				className: 'operon-settings-task-creator-toolbar-icon',
				active: item.visible,
				pressed: item.visible,
				errorContext: options.visibilityErrorContext,
				onClick: async () => {
					options.setItems(items.map((entry, entryIndex) =>
						entryIndex === index ? { ...entry, visible: !entry.visible } : entry,
					));
					await options.save();
					rerenderRowsPreservingScroll(section, renderRows);
				},
			});

			if (iconOnlyGrid) {
				createInterfaceIconToggleButton({
					containerEl: iconOnlyGrid,
					icon,
					label,
					className: 'operon-settings-task-creator-toolbar-icon',
					active: item.iconOnly === true,
					disabled: !item.visible,
					pressed: item.iconOnly === true,
					errorContext: options.iconOnlyErrorContext,
					onClick: async () => {
						if (!item.visible) return;
						options.setItems(items.map((entry, entryIndex) =>
							entryIndex === index ? { ...entry, iconOnly: !entry.iconOnly } : entry,
						));
						await options.save();
						rerenderRowsPreservingScroll(section, renderRows);
					},
				});
			}

			const setting = new Setting(reorderList)
				.setName(label);
			setting.settingEl.addClass('operon-interface-icon-reorder-row');

			setting.addExtraButton(button => {
				button.setIcon('arrow-up');
				applyExtraButtonTooltip(button, options.moveUpLabel);
				const canMoveUp = index > 0 && (options.canMoveUp?.(item, index, items) ?? true);
				button.setDisabled(!canMoveUp);
				button.onClick(async () => {
					if (!canMoveUp) return;
					options.setItems(moveInterfaceItem(items, index, index - 1));
					await options.save();
					rerenderRowsPreservingScroll(section, renderRows);
				});
			});

			setting.addExtraButton(button => {
				button.setIcon('arrow-down');
				applyExtraButtonTooltip(button, options.moveDownLabel);
				const canMoveDown = index < items.length - 1 && (options.canMoveDown?.(item, index, items) ?? true);
				button.setDisabled(!canMoveDown);
				button.onClick(async () => {
					if (!canMoveDown) return;
					options.setItems(moveInterfaceItem(items, index, index + 1));
					await options.save();
					rerenderRowsPreservingScroll(section, renderRows);
				});
			});
		});

		for (const item of options.getManagedItems?.() ?? []) {
			createInterfaceIconToggleButton({
				containerEl: toggleGrid,
				icon: item.icon,
				label: item.label,
				className: 'operon-settings-task-creator-toolbar-icon is-custom-field',
				active: item.visible,
				pressed: item.visible,
				errorContext: options.visibilityErrorContext,
				onClick: async () => {
					await item.onToggle();
					rerenderRowsPreservingScroll(section, renderRows);
				},
			});

			if (item.showReorderControls === true) {
				const setting = new Setting(reorderList)
					.setName(item.label);
				setting.settingEl.addClass('operon-interface-icon-reorder-row');
				setting.settingEl.addClass('is-custom-field');
				setting.addExtraButton(button => {
					button.setIcon('arrow-up');
					applyExtraButtonTooltip(button, options.moveUpLabel);
					button.setDisabled(item.canMoveUp !== true || !item.onMoveUp);
					button.onClick(async () => {
						if (item.canMoveUp !== true || !item.onMoveUp) return;
						await item.onMoveUp();
						rerenderRowsPreservingScroll(section, renderRows);
					});
				});
				setting.addExtraButton(button => {
					button.setIcon('arrow-down');
					applyExtraButtonTooltip(button, options.moveDownLabel);
					button.setDisabled(item.canMoveDown !== true || !item.onMoveDown);
					button.onClick(async () => {
						if (item.canMoveDown !== true || !item.onMoveDown) return;
						await item.onMoveDown();
						rerenderRowsPreservingScroll(section, renderRows);
					});
				});
			}
		}

		for (const action of options.getActionToggles?.() ?? []) {
			createInterfaceIconToggleButton({
				containerEl: toggleGrid,
				icon: action.icon,
				label: action.label,
				className: 'operon-settings-task-creator-toolbar-icon',
				active: action.visible,
				pressed: action.visible,
				errorContext: options.actionErrorContext,
				onClick: async () => {
					await action.onToggle();
					rerenderRowsPreservingScroll(section, renderRows);
				},
			});
		}
	};

	renderRows();
}

function renderInterfaceIconRowListSection<
	TKey extends string,
	TItem extends InterfaceIconToggleSectionItem<TKey>,
>(options: InterfaceIconToggleSectionOptions<TKey, TItem>): void {
	if (!options.singleRow) {
		const description = options.containerEl.createEl('p', {
			text: options.description,
		});
		description.addClass('operon-settings-section-desc');
		if (options.descriptionSearchTargetId) {
			description.dataset.operonSettingsSearchId = options.descriptionSearchTargetId;
		}

	}
	const sectionEl = options.containerEl.createDiv('operon-compact-chip-row-editor');
	const listEl = sectionEl.createDiv('operon-compact-chip-row-list');
	const actionListEl = sectionEl.createDiv('operon-compact-chip-action-list');
	const showIconOnlyToggle = !!options.iconOnlyTitle || !!options.iconOnlyButtonLabel;
	const iconOnlyButtonLabel = options.iconOnlyButtonLabel ?? 'Icon Only';

	const renderRows = (): void => {
		const items = options.getItems();
		listEl.empty();
		actionListEl.empty();

		items.forEach((item, index) => {
			if (options.singleRow && (!('key' in options.singleRow) || options.singleRow.key !== item.key)) return;
			const label = options.getLabel(item.key);
			const icon = options.getIcon(item.key);
			const row = createSettingsListCard({
				containerEl: listEl,
				icon,
				title: label,
				className: 'operon-compact-chip-row',
				metaClassName: 'operon-compact-chip-row-meta',
				actionsClassName: 'operon-compact-chip-row-actions',
				renderMeta: metaEl => {
					createSettingsListCardChip({
						containerEl: metaEl,
						label: options.getCanonicalLabel?.(item.key) ?? item.key,
						className: 'operon-compact-chip-canonical-chip',
					});
				},
			});

			createSettingsListCardActionButton({
				containerEl: row.actionsEl,
				label: options.moveUpLabel,
				tooltip: options.moveUpLabel,
				icon: 'arrow-up',
				disabled: index === 0 || !(options.canMoveUp?.(item, index, items) ?? true),
				errorContext: options.visibilityErrorContext,
				onClick: async () => {
					const items = options.getItems();
					const index = items.findIndex(current => current.key === item.key);
					if (index < 0) return;
					if (index === 0 || !(options.canMoveUp?.(item, index, items) ?? true)) return;
					options.setItems(moveInterfaceItem(items, index, index - 1));
					await options.save();
					rerenderRowsPreservingScroll(sectionEl, options.onReorder ?? renderRows);
				},
			});

			createSettingsListCardActionButton({
				containerEl: row.actionsEl,
				label: options.moveDownLabel,
				tooltip: options.moveDownLabel,
				icon: 'arrow-down',
				disabled: index >= items.length - 1 || !(options.canMoveDown?.(item, index, items) ?? true),
				errorContext: options.visibilityErrorContext,
				onClick: async () => {
					const items = options.getItems();
					const index = items.findIndex(current => current.key === item.key);
					if (index < 0) return;
					if (index >= items.length - 1 || !(options.canMoveDown?.(item, index, items) ?? true)) return;
					options.setItems(moveInterfaceItem(items, index, index + 1));
					await options.save();
					rerenderRowsPreservingScroll(sectionEl, options.onReorder ?? renderRows);
				},
			});

			if (showIconOnlyToggle) {
				createSettingsListCardActionButton({
					containerEl: row.actionsEl,
					label: iconOnlyButtonLabel,
					ariaLabel: options.getIconOnlyToggleLabel?.(label) ?? `${iconOnlyButtonLabel}: ${label}`,
					tooltip: options.getIconOnlyToggleLabel?.(label) ?? `${iconOnlyButtonLabel}: ${label}`,
					text: iconOnlyButtonLabel,
					active: item.iconOnly === true,
					disabled: !item.visible,
					wide: true,
					className: 'operon-compact-chip-icon-only-toggle',
					errorContext: options.iconOnlyErrorContext,
					onClick: async () => {
						const items = options.getItems();
						const current = items.find(entry => entry.key === item.key);
						if (!current?.visible) return;
						options.setItems(items.map(entry =>
							entry.key === item.key ? { ...entry, iconOnly: !entry.iconOnly } : entry,
						));
						await options.save();
						rerenderRowsPreservingScroll(sectionEl, renderRows);
					},
				});
			}

			createSettingsListCardActionButton({
				containerEl: row.actionsEl,
				label: options.getVisibilityToggleLabel?.(label) ?? label,
				ariaLabel: options.getVisibilityToggleLabel?.(label) ?? label,
				tooltip: options.getVisibilityToggleLabel?.(label) ?? label,
				icon,
				active: item.visible,
				className: 'operon-compact-chip-visibility-toggle',
				errorContext: options.visibilityErrorContext,
				onClick: async () => {
					const items = options.getItems();
					if (!items.some(entry => entry.key === item.key)) return;
					options.setItems(items.map(entry =>
						entry.key === item.key ? { ...entry, visible: !entry.visible } : entry,
					));
					await options.save();
					rerenderRowsPreservingScroll(sectionEl, renderRows);
				},
			});
		});

		for (const item of options.getManagedItems?.() ?? []) {
			if (options.singleRow && (!('key' in options.singleRow) || options.singleRow.key !== item.key)) continue;
			const row = createSettingsListCard({
				containerEl: listEl,
				icon: item.icon,
				title: item.label,
				className: 'operon-compact-chip-row is-custom-field',
				metaClassName: 'operon-compact-chip-row-meta',
				actionsClassName: 'operon-compact-chip-row-actions',
				renderMeta: metaEl => {
					createSettingsListCardChip({
						containerEl: metaEl,
						label: item.canonicalLabel,
						className: 'operon-compact-chip-canonical-chip',
					});
				},
			});

			if (item.showReorderControls === true) {
				createSettingsListCardActionButton({
					containerEl: row.actionsEl,
					label: options.moveUpLabel,
					tooltip: options.moveUpLabel,
					icon: 'arrow-up',
					disabled: item.canMoveUp !== true || !item.onMoveUp,
					errorContext: options.visibilityErrorContext,
					onClick: async () => {
						if (item.canMoveUp !== true || !item.onMoveUp) return;
						await item.onMoveUp();
						rerenderRowsPreservingScroll(sectionEl, renderRows);
					},
				});

				createSettingsListCardActionButton({
					containerEl: row.actionsEl,
					label: options.moveDownLabel,
					tooltip: options.moveDownLabel,
					icon: 'arrow-down',
					disabled: item.canMoveDown !== true || !item.onMoveDown,
					errorContext: options.visibilityErrorContext,
					onClick: async () => {
						if (item.canMoveDown !== true || !item.onMoveDown) return;
						await item.onMoveDown();
						rerenderRowsPreservingScroll(sectionEl, renderRows);
					},
				});
			}

			createSettingsListCardActionButton({
				containerEl: row.actionsEl,
				label: options.getVisibilityToggleLabel?.(item.label) ?? item.label,
				ariaLabel: options.getVisibilityToggleLabel?.(item.label) ?? item.label,
				tooltip: options.getVisibilityToggleLabel?.(item.label) ?? item.label,
				icon: item.icon,
				active: item.visible,
				className: 'operon-compact-chip-visibility-toggle',
				errorContext: options.visibilityErrorContext,
				onClick: async () => {
					await item.onToggle();
					rerenderRowsPreservingScroll(sectionEl, renderRows);
				},
			});
		}

		const actions = options.getActionToggles?.() ?? [];
		if (actions.length > 0 && !options.singleRow) {
			actionListEl.createDiv({
				text: options.actionTogglesTitle ?? '',
				cls: 'operon-compact-chip-action-title',
			});
		}
		for (const [index, action] of actions.entries()) {
			if (options.singleRow && (!('action' in options.singleRow) || options.singleRow.action !== index)) continue;
			const row = createSettingsListCard({
				containerEl: actionListEl,
				icon: action.icon,
				title: action.label,
				className: 'operon-compact-chip-action-row',
				actionsClassName: 'operon-compact-chip-row-actions',
			});
			if (action.searchTargetId) {
				row.cardEl.dataset.operonSettingsSearchId = action.searchTargetId;
			}
			createSettingsListCardActionButton({
				containerEl: row.actionsEl,
				label: options.getVisibilityToggleLabel?.(action.label) ?? action.label,
				ariaLabel: options.getVisibilityToggleLabel?.(action.label) ?? action.label,
				tooltip: options.getVisibilityToggleLabel?.(action.label) ?? action.label,
				icon: action.icon,
				active: action.visible,
				className: 'operon-compact-chip-visibility-toggle',
				errorContext: options.actionErrorContext,
				onClick: async () => {
					await action.onToggle();
					rerenderRowsPreservingScroll(sectionEl, renderRows);
				},
			});
		}
	};

	renderRows();
}

export function createInterfaceMatrixButton(options: InterfaceMatrixButtonOptions): HTMLButtonElement {
	return createInterfaceIconToggleButton({
		containerEl: options.containerEl,
		icon: options.locked ? 'lock' : options.icon,
		label: options.label,
		className: options.className,
			active: options.active === true && options.locked !== true,
			locked: options.locked,
			tooltip: options.locked ? options.lockedTooltip : options.tooltip ?? options.label,
			pressed: options.active === true && options.locked !== true,
			errorContext: options.errorContext,
			onClick: options.locked ? undefined : options.onClick,
		});
}

export function createInterfaceMatrixHeaderIcon(options: InterfaceMatrixHeaderIconOptions): HTMLElement {
	const iconEl = options.containerEl.createSpan({
		cls: options.className,
		attr: {
			role: 'img',
		},
	});
	setIcon(iconEl, options.icon);
	setAccessibleLabelWithoutTooltip(iconEl, options.label);
	bindInterfaceTooltip(iconEl, options.tooltip ?? options.label);
	return iconEl;
}
