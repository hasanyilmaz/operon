import { App, Notice, Setting, type ButtonComponent } from 'obsidian';
import { t } from '../../core/i18n';
import { createKanbanPropertyAccess, type KanbanPropertyDescriptor } from '../../core/kanban-axis-properties';
import { CANONICAL_KEY_MAP } from '../../types/keys';
import { resolveKanbanAxes, setKanbanPresetAxes, normalizeKanbanAxisValue, kanbanAxisValueKey, type KanbanAxis, type KanbanAxisValue } from '../../core/kanban-axis-model';
import { getNativePropertyIndex } from '../../indexer/native-property-index';
import { collectKanbanScope, type KanbanGroupingResult } from '../../systems/kanban-grouping';
import type { KanbanPreset } from '../../types/kanban';
import type { OperonSettings } from '../../types/settings';
import type { IndexedTask } from '../../types/fields';
import type { FilterEvaluationOptions } from '../../core/filter-display';
import { showSearchableFieldPicker } from '../field-pickers/searchable-field-picker';
import { showSearchableOptionPicker } from '../field-pickers/searchable-option-picker';
import { kanbanAxisReason } from './kanban-axis-labels';
import { collectKanbanAxisValueChoices } from './kanban-axis-values';
import type { KanbanPickerData } from './kanban-picker-session';

function propertyLabel(field: KanbanPropertyDescriptor): string {
	const key = field.reference.key;
	return field.reference.source === 'managed' && CANONICAL_KEY_MAP.has(key)
		&& field.label.toLowerCase() !== key.toLowerCase() ? `${field.label} - ${key}` : field.label;
}

export function kanbanTaskCountLabels(result: KanbanGroupingResult): { scoped: string; board: string } {
	const partial = (count: number) => `${count} · ${t('settings', 'kanbanCountsPartial')}`;
	const waiting = result.state === 'partial' && result.total === 0 && result.diagnostics.length > 0 && result.diagnostics.every(item => item.state === 'pending');
	return {
		scoped: result.scopeComplete ? String(result.scopedTotal) : partial(result.scopedTotal),
		board: result.state === 'unavailable' ? '—' : waiting ? '…' : result.countsComplete ? String(result.total) : partial(result.total),
	};
}

export function renderKanbanTaskCounts(container: HTMLElement, result: KanbanGroupingResult): void {
	const labels = kanbanTaskCountLabels(result);
	const setting = new Setting(container).setName(t('settings', 'kanbanTaskCounts'));
	setting.controlEl.addClass('operon-kanban-task-counts');
	setting.controlEl.setAttribute('aria-live', 'polite');
	for (const [key, value] of [['kanbanScopedTasks', labels.scoped], ['kanbanBoardTasks', labels.board]] as const) {
		const item = setting.controlEl.createSpan({ cls: 'operon-kanban-task-count' });
		item.createSpan({ text: t('settings', key), cls: 'operon-kanban-task-count-label' });
		item.createSpan({ text: value, cls: 'operon-kanban-task-count-value' });
	}
	if (result.state === 'unavailable') setting.controlEl.setAttribute('aria-label', kanbanAxisReason(result.reason));
}

export function renderKanbanAxisSettings(options: {
	app: App; container: HTMLElement; host: HTMLElement; side: 'columns' | 'swimlanes';
	preset: KanbanPreset; settings: OperonSettings; tasks: readonly IndexedTask[];
	preparePicker?: (property?: import('../../core/kanban-axis-model').KanbanPropertyReference) => Promise<KanbanPickerData | null>;
	onPickerClose?: () => void;
	onPickerPreparationEnd?: () => void;
	onPropertyPickerOpen?: () => void;
	pinnedCache?: import('../../storage/pinned-cache').PinnedCache; filterEvaluationOptions?: FilterEvaluationOptions; refresh: () => void; retainPicker: (close: () => void) => void;
}): void {
	const { app, container, host, side, preset, settings, refresh, retainPicker } = options;
	const decoded = resolveKanbanAxes(preset, settings.keyMappings);
	if (!decoded.ok) return;
	const axis = decoded.axes[side];
	const native = getNativePropertyIndex(app);
	native.configure(settings);
	const access = createKanbanPropertyAccess(settings, native);
	const runPicker = (button: ButtonComponent, property: import('../../core/kanban-axis-model').KanbanPropertyReference | undefined, show: (data: KanbanPickerData) => void) => {
		if (!options.preparePicker) {
			const context = { settings, tasks: options.tasks, filterSet: settings.filterSets.find(f => f.id === preset.filterSetId), filterEvaluationOptions: options.filterEvaluationOptions, pinnedCache: options.pinnedCache };
			show({ ...context, access, scope: collectKanbanScope(context) }); return;
		}
		const previous = button.buttonEl.textContent ?? '';
		button.setDisabled(true).setButtonText('…');
		void options.preparePicker(property).then(data => {
			if (data && button.buttonEl.isConnected) { button.setDisabled(false).setButtonText(previous); show(data); }
		}).catch(() => { if (button.buttonEl.isConnected) new Notice(t('settings', 'kanbanAxisPoolPending')); })
			.finally(() => { if (button.buttonEl.isConnected) button.setDisabled(false).setButtonText(previous); options.onPickerPreparationEnd?.(); });
	};

	const change = (next: KanbanAxis | null) => {
		if (side === 'columns' && !next) return;
		const current = resolveKanbanAxes(preset, settings.keyMappings);
		if (!current.ok) return;
		setKanbanPresetAxes(preset, { ...current.axes, [side]: next }, settings.keyMappings);
		refresh();
	};
	if (side === 'swimlanes') {
		new Setting(container).setName(t('settings', 'kanbanEnableSwimlanes')).setDesc(t('settings', 'kanbanEnableSwimlanesDesc')).addToggle(toggle => toggle.setValue(axis !== null).onChange(enabled => {
			const current = resolveKanbanAxes(preset, settings.keyMappings);
			if (!current.ok || enabled === (current.axes.swimlanes !== null)) return;
			const { inactiveSwimlanes, ...axes } = current.axes;
			setKanbanPresetAxes(preset, enabled
				? { ...axes, swimlanes: inactiveSwimlanes ?? { kind: 'property', property: { source: 'managed', key: 'priority', type: 'text' }, values: [] } }
				: { ...axes, swimlanes: null, inactiveSwimlanes: axes.swimlanes! }, settings.keyMappings);
			refresh();
		}));
		if (!axis) return;
	}
	const selected = axis?.kind === 'status' ? access.resolve({ source: 'managed', key: 'status', type: 'text' }) : axis ? access.resolve(axis.property) : null;
	const label = selected?.ok ? propertyLabel(selected.field) : axis?.kind === 'property' ? axis.property.key : t('settings', 'kanbanAxisDisabled');
	new Setting(container).setName(t('settings', 'kanbanAxisProperty')).addButton(button => button.setButtonText(label).onClick(() => {
		options.onPropertyPickerOpen?.();
		// Property selection needs only the catalog, never task values or scope counts.
		const fields = access.fields.map(field => ({ field: field.identity, label: propertyLabel(field), descriptor: field }));
		retainPicker(showSearchableFieldPicker(button.buttonEl, {
			value: selected?.ok ? selected.field.identity : null, fields,
			placeholder: t('settings', 'kanbanAxisProperty'), ariaLabel: t('settings', 'kanbanAxisProperty'), noMatchesText: t('settings', 'kanbanAxisNoMatches'),
			floatingHost: host, floatingScrollHost: host,
			variantClassName: 'operon-kanban-value-picker', getSearchText: item => item.label,
			onClose: options.onPickerClose,
			onSelect: item => {
				if (selected?.ok && selected.field.identity === item.field) return;
				const property = item.descriptor.reference;
				change(property.source === 'managed' && property.key === 'status' ? { kind: 'status', pipelineId: null } : { kind: 'property', property, values: [] });
			},
		}));
	}));
	if (!axis) return;
	if (selected && !selected.ok) new Setting(container).setDesc(kanbanAxisReason(selected.reason));
	if (axis.kind === 'status') {
		new Setting(container).setName(t('settings', 'kanbanPipeline')).addDropdown(dropdown => {
			dropdown.addOption('', t('settings', 'kanbanNoPipeline'));
			for (const pipeline of settings.pipelines) dropdown.addOption(pipeline.id, pipeline.name);
			if (axis.pipelineId && !settings.pipelines.some(p => p.id === axis.pipelineId)) dropdown.addOption(axis.pipelineId, `${axis.pipelineId} — ${t('notifications', 'kanbanAxesUnavailable')}`);
			dropdown.setValue(axis.pipelineId ?? '').onChange(value => change({ kind: 'status', pipelineId: value || null }));
		});
		return;
	}
	const add = (value: KanbanAxisValue) => {
		const property = selected?.ok ? selected.field.reference : axis.property;
		const normalized = normalizeKanbanAxisValue(value, property);
		if (!normalized) { new Notice(t('settings', 'kanbanAxisInvalidValue')); return; }
		if (axis.values.some(existing => kanbanAxisValueKey(existing) === kanbanAxisValueKey(normalized))) return;
		change({ ...axis, property, values: [...axis.values, normalized] });
	};
	const valueLabel = (value: KanbanAxisValue, labelSettings = settings): string => value.kind === 'empty' ? t('settings', 'kanbanAxisNoValue')
		: value.kind === 'priority' ? labelSettings.priorities.find(p => p.id === value.id)?.label ?? `${value.id} — ${t('notifications', 'kanbanAxesUnavailable')}`
			: value.kind === 'status' ? value.id : String(value.value);
	new Setting(container).setName(t('settings', 'kanbanAxisAddValue')).setDesc(t('settings', 'kanbanAxisAllValuesDesc')).addButton(button => button.setButtonText(t('settings', 'kanbanAxisChooseValue')).setDisabled(!selected?.ok).onClick(() => runPicker(button, axis.property, ({ scope, access, settings, tasks, memo = (_key, calculate) => calculate() }) => {
		const resolved = access.resolve(axis.property); if (!resolved.ok) return;
		const result = memo(`values:${JSON.stringify(axis.property)}`, () => {
		const counts = new Map<string, number>(); let complete = scope.scope.scopeComplete;
		for (const task of scope.scoped) {
			const read = access.read(task, resolved.field.reference);
			if (read.state === 'ready' || read.state === 'empty') for (const value of read.values) {
				const key = kanbanAxisValueKey(value); counts.set(key, (counts.get(key) ?? 0) + 1);
			} else complete = false;
		}

		return { complete, values: collectKanbanAxisValueChoices({ app, tasks, field: resolved.field, access, settings, counts, label: value => valueLabel(value, settings) }) };
		});
		const used = new Set(axis.values.map(kanbanAxisValueKey));
		const values = result.values.filter(item => !used.has(kanbanAxisValueKey(item.value)));
		const countLabel = (count: number) => access.revision !== access.getCurrentRevision() ? '—' : result.complete ? String(count) : `${count} · ${t('settings', 'kanbanCountsPartial')}`;

		retainPicker(showSearchableOptionPicker(button.buttonEl, {
			value: null, options: values.map(item => ({ value: kanbanAxisValueKey(item.value), label: item.label, typed: item.value, trailingText: countLabel(item.count) })),
			placeholder: t('settings', 'kanbanAxisChooseValue'), ariaLabel: t('settings', 'kanbanAxisAddValue'), noMatchesText: t('settings', 'kanbanAxisNoMatches'),
			floatingHost: host, floatingScrollHost: host, onSelect: item => add(item.typed), pageSize: 100, fuzzySearch: true, preserveSearchOrder: true,
			variantClassName: 'operon-kanban-value-picker', getSearchText: item => item.label,
			onClose: options.onPickerClose,
		}));
	})));
	if (!native.isReady(options.tasks) && selected?.ok && selected.field.encoding === 'vault-v1') container.createEl('p', { text: t('settings', 'kanbanAxisPoolPending'), attr: { role: 'status' } });
	axis.values.forEach((value, index) => {
		const row = new Setting(container).setName(valueLabel(value));
		const move = (offset: number) => { const values = [...axis.values]; [values[index], values[index + offset]] = [values[index + offset], values[index]]; change({ ...axis, values }); };
		row.addExtraButton(button => button.setIcon('arrow-up').setTooltip(t('settings', 'moveUp')).setDisabled(index === 0).onClick(() => move(-1)));
		row.addExtraButton(button => button.setIcon('arrow-down').setTooltip(t('settings', 'moveDown')).setDisabled(index === axis.values.length - 1).onClick(() => move(1)));
		row.addExtraButton(button => button.setIcon('x').setTooltip(t('settings', 'kanbanAxisRemoveValue')).onClick(() => change({ ...axis, values: axis.values.filter((_, i) => i !== index) })));
	});
}
