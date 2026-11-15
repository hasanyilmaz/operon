import { Setting, setIcon, type App } from 'obsidian';
import { t } from '../../core/i18n';
import { generateUniqueOperonId } from '../../core/id-generator';
import { isWritableRawYamlPropertyName } from '../../core/raw-yaml-property';
import { resolveTaskEditorLayout, type TaskEditorLayout, type TaskEditorLayoutChange } from '../../core/task-editor-layout';
import { getNativePropertyIndex } from '../../indexer/native-property-index';
import { isRetiredKeyMapping, type OperonSettings } from '../../types/settings';
import {
	isTaskEditorSectionRemovable, type TaskEditorCommandId, type TaskEditorPropertyRef, type TaskEditorSectionId,
} from '../../types/task-editor-sections';
import { setAccessibleLabelWithoutTooltip } from '../accessibility-label';
import { getSourcePropertyIcon } from '../../core/property-icons';
import { bindPropertyIcon } from '../property-icon-presentation';
import { resolveEditorWorkflowPickerIcon } from '../editor-property-fields';
import { editorSectionLabel } from '../editor-sections-layout';
import { showSearchableFieldPicker } from '../field-pickers/searchable-field-picker';
import { cleanupOperonHoverTooltips } from '../operon-hover-tooltip';
import { createCachedTableFilePropertyTypeResolver, createVaultFilePropertySnapshot, getTableFilePropertyTypeIcon } from '../table/table-file-property';
import { taskEditorSectionDefaultLabel } from '../task-editor-section-label';
import { setSettingsScope } from './settings-scope';
import { createSettingsListCardActionButton, createSettingsListCardChip } from './settings-list-ui';
import { createWorkflowInlineAddRow } from './workflow-editor-ui';

interface FieldChoice {
	ref: TaskEditorPropertyRef;
	label: string;
	icon: string;
	builtIn?: true;
}

function collectFields(app: App, settings: OperonSettings, layout: TaskEditorLayout): Map<string, FieldChoice> {
	const fields = new Map<string, FieldChoice>();
	const add = (field: FieldChoice): void => {
		const identity = layout.identify(field.ref);
		if (!fields.has(identity)) fields.set(identity, field);
	};
	for (const mapping of settings.keyMappings) {
		const key = mapping.canonicalKey;
		if (key === 'note' || mapping.isInternal || mapping.enabled === false
			|| (key !== 'related' && isRetiredKeyMapping(key))) continue;
		add({ ref: { kind: 'mapped', key }, label: mapping.visiblePropertyName || key,
			icon: resolveEditorWorkflowPickerIcon(key, settings.keyMappings) });
	}
	for (const key of ['tags', 'subtasks'] as const) {
		add({ ref: { kind: 'mapped', key }, label: t('taskEditor', key),
			icon: resolveEditorWorkflowPickerIcon(key, settings.keyMappings), builtIn: true });
	}
	const declarations = getNativePropertyIndex(app).getTypes();
	const resolver = createCachedTableFilePropertyTypeResolver();
	resolver.replaceTypes(declarations);
	const snapshot = createVaultFilePropertySnapshot(app, resolver, { keyMappings: settings.keyMappings, nativeListCandidates: true });
	for (const field of snapshot.fields) {
		const ref = layout.referenceForName(field.propertyName);
		if (ref.kind === 'vault') add({ ref, label: field.propertyName, icon: field.icon });
	}
	for (const name of Object.keys(declarations)) {
		const ref = layout.referenceForName(name);
		if (ref.kind !== 'vault' || !isWritableRawYamlPropertyName(name, settings.keyMappings)) continue;
		const type = resolver.resolve(name, []).tableType;
		add({ ref, label: name, icon: getTableFilePropertyTypeIcon(type) });
	}
	for (const { sourceName: name, type } of settings.inlinePropertyDefinitions?.entries ?? []) {
		const ref = layout.referenceForName(name);
		if (ref.kind !== 'vault' || !isWritableRawYamlPropertyName(name, settings.keyMappings)) continue;
		add({ ref, label: name, icon: getTableFilePropertyTypeIcon(type) });
	}
	return fields;
}

function commandDisplay(id: TaskEditorCommandId): Pick<FieldChoice, 'label' | 'icon'> {
	switch (id) {
		case 'tracker': return { icon: 'play', label: t('taskEditor', 'trackerStartButton') };
		case 'scrollbars': return { icon: 'mouse', label: t('settings', 'workspaceTweaksHideScrollbars') };
		case 'pin': return { icon: 'pin', label: t('buttons', 'pin') };
		case 'checkboxes': return { icon: 'layout-list', label: t('taskEditor', 'showCheckboxes') };
		case 'subtask': return { icon: 'plus', label: t('buttons', 'addSubtask') };
		case 'inlineSubtask': return { icon: 'list-plus', label: t('buttons', 'addInlineSubtask') };
		case 'remove': return { icon: 'trash-2', label: t('buttons', 'remove') };
	}
}

interface SectionSettingsOptions {
	app: App;
	settings: () => OperonSettings;
	change: (change: TaskEditorLayoutChange) => Promise<void>;
	confirmRemove: (name: string) => Promise<boolean>;
	openIconPicker: (anchor: HTMLButtonElement, field: TaskEditorPropertyRef, label: string, icon: string, onClose: () => void) => (() => void) | null;
}

export function renderTaskEditorSectionsSettings(root: HTMLElement, options: SectionSettingsOptions): () => void {
	root.addClass('operon-task-editor-sections-settings');
	setSettingsScope(root, true);
	let disposed = false;
	let closePicker: (() => void) | null = null;
	let closeIconPicker: (() => void) | null = null;
	let addInput: HTMLInputElement;
	let addPending = false;
	let fieldCatalog: Map<string, FieldChoice>;
	let catalogMappings: OperonSettings['keyMappings'] | undefined;

	function focusControl(keys: readonly string[]): void {
		const controls = Array.from(root.querySelectorAll<HTMLElement>('[data-editor-settings-focus]'));
		for (const key of keys) {
			const control = controls.find(item => item.dataset.editorSettingsFocus === key && !item.matches(':disabled'));
			if (control) { control.focus({ preventScroll: true }); return; }
		}
	}

	async function commit(change: TaskEditorLayoutChange, focus: readonly string[]): Promise<void> {
		let saved = false;
		try { await options.change(change); saved = true; } catch { /* The shared save path reports failures. */ }
		if (disposed || !root.isConnected) return;
		const draft = addInput.value;
		render(change.type === 'add' && saved && draft === change.name ? '' : draft);
		const active = root.ownerDocument.activeElement;
		if (active === root.ownerDocument.body || root.contains(active)) focusControl(focus);
	}

	function addMoveButtons(parent: HTMLElement, label: string, target: string, index: number, length: number, move: (delta: -1 | 1) => TaskEditorLayoutChange, fallback: string): void {
		for (const delta of [-1, 1] as const) {
			const key = `${target}:${delta}`;
			const button = createSettingsListCardActionButton({
				containerEl: parent, icon: delta === -1 ? 'arrow-up' : 'arrow-down',
				label: `${t('settings', delta === -1 ? 'moveUp' : 'moveDown')} · ${label}`,
				errorContext: 'settings section reorder failed', disabled: index + delta < 0 || index + delta >= length,
				onClick: () => commit(move(delta), [key, `${target}:${-delta}`, fallback]),
			});
			button.dataset.editorSettingsFocus = key;
		}
	}

	function fieldIcon(field: FieldChoice): string {
		const settings = options.settings();
		return field.ref.kind === 'mapped'
			? resolveEditorWorkflowPickerIcon(field.ref.key, settings.keyMappings)
			: getSourcePropertyIcon(settings, field.ref.name, field.icon);
	}

	function fieldRow(card: HTMLElement, field: Pick<FieldChoice, 'label' | 'icon'>, className = '', property?: FieldChoice): HTMLElement {
		const row = card.createDiv(`operon-settings-list-card operon-compact-chip-row operon-editor-section-item ${className}`.trim());
		if (property && !property.builtIn) {
			const button = row.createEl('button', {
				cls: 'operon-editor-section-item-icon operon-settings-list-card-action',
				attr: { type: 'button' },
			});
			setAccessibleLabelWithoutTooltip(button, t('settings', 'propertyIconChange', { name: field.label }));
			bindPropertyIcon(button, () => fieldIcon(property));
			button.addEventListener('click', () => {
				if (disposed || closeIconPicker) return;
				closePicker?.();
				closeIconPicker = options.openIconPicker(button, property.ref, property.label, fieldIcon(property), () => {
					closeIconPicker = null;
				});
			});
		} else {
			const icon = row.createSpan({ cls: 'operon-settings-list-card-icon', attr: { 'aria-hidden': 'true' } });
			setIcon(icon, field.icon);
		}
		const main = row.createDiv('operon-settings-list-card-main');
		main.createSpan({ text: field.label, cls: 'operon-settings-list-card-title operon-editor-section-item-name' });
		if (property?.ref.kind === 'mapped' && !property.builtIn) {
			createSettingsListCardChip({
				containerEl: main.createDiv('operon-settings-list-card-meta operon-compact-chip-row-meta'),
				label: `{{${property.ref.key}:: }}`,
				className: 'operon-compact-chip-canonical-chip',
			});
		}
		return row.createDiv('operon-settings-list-card-actions operon-editor-section-item-actions');
	}

	function openAddProperty(anchor: HTMLButtonElement, id: TaskEditorSectionId, layout: TaskEditorLayout, focus: string): void {
		closePicker?.();
		let selected: TaskEditorPropertyRef | undefined;
		const scrollHost = root.closest<HTMLElement>('.vertical-tab-content, .modal-content');
		// Position in the outer containing block and follow scrolls in the inner Settings pane.
		const floatingHost = root.closest<HTMLElement>('.vertical-tab-content-container');
		closePicker = showSearchableFieldPicker(anchor, {
			floatingHost: floatingHost ?? undefined, floatingScrollHost: scrollHost ?? undefined,
			constrainToFloatingHost: true, fitToHostViewport: true,
			value: null, ariaLabel: t('taskEditor', 'propertyEditorAdd'), placeholder: t('taskEditor', 'searchFileProperties'),
			noMatchesText: t('taskEditor', 'noAvailableFileProperties'),
			fields: Array.from(fieldCatalog.entries())
				.filter(([, field]) => layout.assignment(field.ref)?.section !== id)
				.sort(([, a], [, b]) => a.label.localeCompare(b.label))
				.map(([identity, field]) => ({ field: identity, label: field.label, resolveIcon: () => fieldIcon(field),
					description: layout.assignment(field.ref) ? editorSectionLabel(layout.sections, layout.position(field.ref).section) : undefined })),
			onSelect: field => { selected = fieldCatalog.get(field.field)?.ref; },
			onClose: () => {
				closePicker = null;
				if (!anchor.isConnected || disposed) return;
				anchor.focus({ preventScroll: true });
				if (selected) void commit({ type: 'assign', field: selected, section: id }, [focus]);
			},
		});
	}

	function render(draft = ''): void {
		closePicker?.();
		closeIconPicker?.();
		cleanupOperonHoverTooltips(root);
		root.empty();
		const settings = options.settings();
		const layout = resolveTaskEditorLayout(settings.taskEditorSections, settings.keyMappings);
		if (catalogMappings !== settings.keyMappings) {
			fieldCatalog = collectFields(options.app, settings, layout);
			catalogMappings = settings.keyMappings;
		}
		for (const [index, section] of layout.sections.entries()) {
			const { id } = section;
			const label = editorSectionLabel(layout.sections, id);
			const nameKey = `${id}:name`;
			const addKey = `${id}:add-property`;
			const card = root.createDiv('operon-pipeline-card operon-editor-section-card');
			card.dataset.editorSettingsSection = id;
			const header = new Setting(card);
			header.settingEl.addClass('operon-editor-section-settings-header');
			header.setName(label);
			header.addText(text => {
				setAccessibleLabelWithoutTooltip(text.inputEl, t('settings', 'taskEditorSectionName'));
				text.inputEl.dataset.editorSettingsFocus = nameKey;
				text.inputEl.maxLength = 80;
				text.setValue(label).setPlaceholder(taskEditorSectionDefaultLabel(id));
				header.infoEl.replaceChildren(text.inputEl);
				text.inputEl.addEventListener('change', () => {
					const name = text.getValue().trim();
					const value = !id.startsWith('custom:') && name === taskEditorSectionDefaultLabel(id) ? '' : name;
					void commit({ type: 'rename', id, name: value }, [nameKey]);
				});
				text.inputEl.addEventListener('keydown', event => {
					if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); text.inputEl.blur(); }
				});
			});
			if (id !== 'description') header.addToggle(toggle => {
				toggle.toggleEl.dataset.editorSettingsFocus = `${id}:visibility`;
				setAccessibleLabelWithoutTooltip(toggle.toggleEl, label);
				toggle.setValue(section.enabled !== false).onChange(enabled => commit({ type: 'visibility', id, enabled }, [`${id}:visibility`, nameKey]));
			});
			addMoveButtons(header.controlEl, label, id, index, layout.sections.length, delta => ({ type: 'move-section', id, delta }), nameKey);
			if (isTaskEditorSectionRemovable(id)) createSettingsListCardActionButton({
				containerEl: header.controlEl, icon: 'x', errorContext: 'settings section removal failed',
				label: `${t('settings', 'taskEditorRemoveSection')} · ${label}`,
				onClick: async () => {
					if (await options.confirmRemove(label) && !disposed && root.isConnected) await commit({ type: 'remove-section', id }, ['add-section']);
				},
			});
			if (id === 'commands') {
				for (const [position, command] of layout.commandOrder.entries()) {
					const display = commandDisplay(command);
					addMoveButtons(fieldRow(card, display), display.label, `command:${command}`, position, layout.commandOrder.length,
						delta => ({ type: 'move-command', id: command, delta }), nameKey);
				}
			}
			const fields = layout.fields.get(id);
			if (!fields) continue;
			for (const [position, ref] of fields.entries()) {
				const identity = layout.identify(ref);
				const property = fieldCatalog.get(identity);
				const field = property ?? { label: ref.kind === 'mapped' ? ref.key : ref.name, icon: 'text' };
				const actions = fieldRow(card, field, '', property);
				addMoveButtons(actions, field.label, `${id}:${identity}`, position, fields.length,
					delta => ({ type: 'move-field', field: ref, section: id, delta }), addKey);
				createSettingsListCardActionButton({
					containerEl: actions, icon: 'x', errorContext: 'settings property removal failed',
					label: `${t('settings', 'taskEditorRemoveProperty')} · ${field.label}`,
					onClick: () => commit({ type: 'assign', field: ref }, [addKey]),
				});
			}
			if (id === 'additional') for (const field of fieldCatalog.values()) {
				if (!layout.assignment(field.ref)) fieldRow(card, field, 'is-automatic', field);
			}
			const button = createSettingsListCardActionButton({
				containerEl: card, className: 'operon-editor-section-add-property', errorContext: 'settings property picker failed', text: t('taskEditor', 'propertyEditorAdd'),
				label: t('taskEditor', 'propertyEditorAdd'),
				onClick: () => openAddProperty(button, id, layout, addKey),
			});
			button.dataset.editorSettingsFocus = addKey;
		}
		const add = createWorkflowInlineAddRow({
			containerEl: root, rowClass: 'operon-pipeline-add-row', inputClass: 'operon-pipeline-add-input',
			buttonLabel: t('settings', 'taskEditorAddSection'), placeholder: t('settings', 'taskEditorSectionName'),
			errorContext: 'task editor section add failed',
			onSubmit: async value => {
				if (addPending || !value.trim()) return;
				addPending = true;
				const ids = new Set(options.settings().taskEditorSections.flatMap(section => section.id.startsWith('custom:') ? [section.id.slice(7)] : []));
				const id = `custom:${generateUniqueOperonId(ids)}` as const;
				try { await commit({ type: 'add', id, name: value }, [`${id}:name`, 'add-section']); }
				finally { addPending = false; }
			},
		});
		addInput = add.inputEl;
		addInput.value = draft;
		addInput.maxLength = 80;
		addInput.dataset.editorSettingsFocus = 'add-section';
		setAccessibleLabelWithoutTooltip(addInput, t('settings', 'taskEditorSectionName'));
	}
	render();
	return () => { disposed = true; closePicker?.(); closeIconPicker?.(); cleanupOperonHoverTooltips(root); };
}
