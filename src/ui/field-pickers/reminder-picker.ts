import { App } from 'obsidian';
import { t } from '../../core/i18n';
import { getAppLocale } from '../../core/obsidian-app';
import {
	applyReminderListMutation,
	type ReminderListFieldKey,
	type ReminderListItemRef,
	type ReminderListMutation,
} from '../../core/reminder-list-mutation';
import {
	parseReminderOffsetInput,
	parseReminderRule,
	resolveReminderRule,
	type ReminderRuleAnchor,
} from '../../core/reminder-rules';
import { splitTaskListValue } from '../../core/task-field-patch';
import { getVisiblePropertyName } from '../../core/yaml-fields';
import type { OperonSettings } from '../../types/settings';
import {
	bindPickerListItemActivation,
	createButton,
	createFloatingPanel,
	requestFloatingInputFocus,
	scrollChildIntoView,
} from './common';
import { showDatetimePicker, type DatetimePickerActionResult } from './datetime-picker';
import {
	buildReminderRuleCandidates,
	evaluateAbsoluteReminderSelection,
	type ReminderPickerEditingItem,
	type ReminderPickerModelInput,
	type ReminderRuleCandidate,
} from './reminder-picker-model';

export type ReminderPickerOperation =
	| { kind: 'add' }
	| { kind: 'edit'; item: ReminderListItemRef };

interface ReminderPickerBaseOptions {
	app: App;
	settings: Pick<OperonSettings,
		| 'timeFormat'
		| 'calendarWeekStart'
		| 'calendarSidebarShowWeekNumbers'
		| 'keyMappings'
	>;
	fieldValues: Readonly<Record<string, string | undefined>>;
	getFieldValues?: () => Readonly<Record<string, string | undefined>>;
	operation: ReminderPickerOperation;
	retainInputFocus?: boolean;
	nowEpochMs?: number;
	onCommit: (fieldValue: string) => void;
	onCancel?: () => void;
	onClose?: () => void;
}

type ReminderDatetimePickerOptions = ReminderPickerBaseOptions;
type ReminderRulesPickerOptions = ReminderPickerBaseOptions;

const REMINDER_RULE_QUICK_OFFSETS = ['0m', '10m', '30m', '1h', '1d'] as const;

interface ReminderMutationSession {
	getFieldValues: () => Readonly<Record<string, string | undefined>>;
	modelInput: () => ReminderPickerModelInput;
	mutationFor: (nextValue: string) => ReminderListMutation;
	removeMutation: () => ReminderListMutation | null;
	attempt: (mutation: ReminderListMutation) => ReminderMutationAttempt;
}

type ReminderMutationAttempt =
	| { accepted: true }
	| { accepted: false; message: string };

export function showReminderDatetimePicker(
	anchor: HTMLElement | DOMRect,
	options: ReminderDatetimePickerOptions,
): () => void {
	const session = createReminderMutationSession('reminderDatetimes', options);
	return showDatetimePicker(anchor, {
		app: options.app,
		settings: options.settings,
		fieldKey: 'reminderDatetimes',
		value: options.operation.kind === 'edit' ? options.operation.item.rawValue : '',
		retainInputFocus: options.retainInputFocus,
		onSelect: value => {
			const evaluation = evaluateAbsoluteReminderSelection(value, session.modelInput());
			if (evaluation.status !== 'valid') {
				return rejectDatetimeSelection(
					evaluation.status === 'duplicate'
						? t('reminders', 'duplicateReminder')
						: evaluation.status === 'past'
							? t('reminders', 'futureTimeRequired')
							: t('reminders', 'offsetInvalid'),
				);
			}
			const attempt = session.attempt(session.mutationFor(evaluation.canonical));
			return attempt.accepted ? undefined : rejectDatetimeSelection(attempt.message);
		},
		canRemove: options.operation.kind === 'edit',
		onRemove: options.operation.kind === 'edit'
			? () => {
				const mutation = session.removeMutation();
				if (!mutation) return rejectDatetimeSelection(t('reminders', 'staleItem'));
				const attempt = session.attempt(mutation);
				return attempt.accepted ? undefined : rejectDatetimeSelection(attempt.message);
			}
			: undefined,
		onCancel: options.onCancel,
		onClose: options.onClose,
	});
}

export function showReminderRulesPicker(
	anchor: HTMLElement | DOMRect,
	options: ReminderRulesPickerOptions,
): () => void {
	let completed = false;
	const session = createReminderMutationSession('reminderRules', options);
	const { panel, close } = createFloatingPanel(
		anchor,
		'operon-floating-panel operon-reminder-rules-picker-panel',
		() => {
			if (!completed) options.onCancel?.();
			options.onClose?.();
		},
		{ retainInputFocus: options.retainInputFocus },
	);

	const title = panel.createDiv({
		cls: 'operon-reminder-rules-picker-title',
		text: getVisiblePropertyName('reminderRules', options.settings.keyMappings).trim() || 'ReminderRules',
	});
	const pickerId = nextReminderRulesPickerId();
	title.id = `operon-reminder-rules-picker-title-${pickerId}`;
	panel.setAttribute('role', 'dialog');
	panel.setAttribute('aria-labelledby', title.id);

	const diagnostic = panel.createDiv('operon-reminder-rules-picker-diagnostic');
	diagnostic.setAttribute('role', 'status');
	diagnostic.setAttribute('aria-live', 'polite');
	const input = panel.createEl('input');
	input.type = 'text';
	input.className = 'operon-floating-input operon-reminder-rules-picker-input';
	input.placeholder = t('reminders', 'offsetPlaceholder');
	input.value = getInitialRuleOffset(options.operation);
	const quickOffsets = panel.createDiv('operon-reminder-rules-picker-quick-offsets');
	quickOffsets.setAttribute('role', 'group');
	quickOffsets.setAttribute('aria-label', t('reminders', 'quickOffsets'));
	const quickOffsetButtons = REMINDER_RULE_QUICK_OFFSETS.map(offset => {
		const label = offset === '0m' ? t('reminders', 'quickOffsetOnTime') : offset;
		const button = quickOffsets.createEl('button');
		button.type = 'button';
		button.className = 'operon-reminder-rules-picker-quick-offset';
		button.textContent = label;
		button.setAttribute('data-offset', offset);
		button.setAttribute('aria-label', t('reminders', 'quickOffsetChoose', { offset: label }));
		button.setAttribute('aria-pressed', 'false');
		return { button, offset };
	});
	const ruleList = panel.createDiv('operon-reminder-rules-picker-list');
	ruleList.id = `operon-reminder-rules-picker-list-${pickerId}`;
	ruleList.setAttribute('role', 'listbox');
	input.setAttribute('role', 'combobox');
	input.setAttribute('aria-autocomplete', 'list');
	input.setAttribute('aria-controls', ruleList.id);
	input.setAttribute('aria-expanded', 'true');
	let activeRuleIndex = -1;
	let visibleCandidates: ReminderRuleCandidate[] = [];

	const closeAccepted = (): void => {
		completed = true;
		close();
	};

	const commitRule = (candidate: ReminderRuleCandidate): void => {
		if (candidate.isPast) return;
		const currentCandidate = buildReminderRuleCandidates(input.value, session.modelInput()).candidates
			.find(item => item.canonicalRule === candidate.canonicalRule);
		if (!currentCandidate || currentCandidate.isPast) {
			setRuleDiagnostic(diagnostic, t('reminders', 'duplicateReminder'), 'error');
			return;
		}
		completed = true;
		const attempt = session.attempt(session.mutationFor(candidate.canonicalRule));
		if (!attempt.accepted) {
			completed = false;
			setRuleDiagnostic(diagnostic, attempt.message, 'error');
			return;
		}
		closeAccepted();
	};

	const setActiveRuleIndex = (nextIndex: number): void => {
		if (activeRuleIndex === nextIndex || visibleCandidates[nextIndex]?.isPast) return;
		const previous = ruleList.children[activeRuleIndex] as HTMLElement | undefined;
		activeRuleIndex = nextIndex;
		previous?.classList.remove('is-active');
		previous?.setAttribute('aria-selected', 'false');
		const active = ruleList.children[activeRuleIndex] as HTMLElement | undefined;
		active?.classList.add('is-active');
		active?.setAttribute('aria-selected', 'true');
		if (active?.id) input.setAttribute('aria-activedescendant', active.id);
		else input.removeAttribute('aria-activedescendant');
		scrollChildIntoView(ruleList, active);
	};

	const renderRuleCandidates = (): void => {
		const parsedOffset = parseReminderOffsetInput(input.value);
		const selectedQuickOffset = parsedOffset.ok ? parsedOffset.value.canonical : null;
		for (const quickOffset of quickOffsetButtons) {
			const selected = quickOffset.offset === selectedQuickOffset;
			quickOffset.button.classList.toggle('is-selected', selected);
			quickOffset.button.setAttribute('aria-pressed', String(selected));
		}
		const evaluation = buildReminderRuleCandidates(input.value, session.modelInput());
		visibleCandidates = evaluation.candidates;
		ruleList.replaceChildren();
		input.removeAttribute('aria-activedescendant');
		activeRuleIndex = visibleCandidates.findIndex(candidate => !candidate.isPast);
		const editingDiagnostic = resolveEditingRuleDiagnostic(options.operation, session.getFieldValues());

		if (evaluation.status !== 'ready') {
			setRuleDiagnostic(
				diagnostic,
				evaluation.status === 'no-anchors'
					? editingDiagnostic ?? t('reminders', 'noAvailableAnchors')
					: evaluation.status === 'invalid-input'
						? t('reminders', 'offsetInvalid')
						: editingDiagnostic ?? t('reminders', 'offsetHint'),
				evaluation.status === 'invalid-input' || evaluation.status === 'no-anchors' ? 'warning' : 'default',
			);
			return;
		}

		setRuleDiagnostic(
			diagnostic,
			visibleCandidates.length === 0
				? t('reminders', 'noMatchingRules')
				: editingDiagnostic ?? t('reminders', 'offsetHint'),
			visibleCandidates.length === 0 ? 'warning' : 'default',
		);
		for (const [index, candidate] of visibleCandidates.entries()) {
			const button = ruleList.createEl('button');
			button.type = 'button';
			button.className = 'operon-reminder-rules-picker-item';
			button.id = `operon-reminder-rules-picker-option-${pickerId}-${index}`;
			button.setAttribute('role', 'option');
			button.setAttribute('aria-selected', String(index === activeRuleIndex));
			button.disabled = candidate.isPast;
			if (index === activeRuleIndex) button.classList.add('is-active');
			button.createDiv({
				cls: 'operon-reminder-rules-picker-item-label',
				text: formatRuleCandidateLabel(candidate, options),
			});
			const preview = button.createDiv('operon-reminder-rules-picker-preview');
			preview.createDiv({
				cls: 'operon-reminder-rules-picker-time',
				text: formatReminderPreview(candidate.epochMs, options),
			});
			if (candidate.isPast) {
				preview.createDiv({
					cls: 'operon-reminder-rules-picker-state',
					text: t('reminders', 'alreadyPassed'),
				});
			} else {
				button.addEventListener('mousemove', () => setActiveRuleIndex(index));
				bindPickerListItemActivation(button, () => commitRule(candidate));
			}
			ruleList.appendChild(button);
		}
		const active = ruleList.children[activeRuleIndex] as HTMLElement | undefined;
		if (active?.id) input.setAttribute('aria-activedescendant', active.id);
	};

	for (const quickOffset of quickOffsetButtons) {
		quickOffset.button.addEventListener('click', () => {
			input.value = quickOffset.offset;
			renderRuleCandidates();
			requestFloatingInputFocus(input);
		});
	}

	input.addEventListener('input', renderRuleCandidates);
	input.addEventListener('keydown', event => {
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			const selectable = visibleCandidates
				.map((candidate, index) => candidate.isPast ? -1 : index)
				.filter(index => index >= 0);
			if (selectable.length === 0) return;
			event.preventDefault();
			const current = Math.max(0, selectable.indexOf(activeRuleIndex));
			const delta = event.key === 'ArrowDown' ? 1 : -1;
			setActiveRuleIndex(selectable[(current + delta + selectable.length) % selectable.length]);
			return;
		}
		if (event.key === 'Enter' && activeRuleIndex >= 0) {
			event.preventDefault();
			const candidate = visibleCandidates[activeRuleIndex];
			if (candidate) commitRule(candidate);
		}
	});

	if (options.operation.kind === 'edit') {
		const actions = panel.createDiv('operon-reminder-rules-picker-actions');
		const clearButton = createButton(t('buttons', 'clear'), 'operon-floating-btn is-secondary', actions);
		clearButton.addEventListener('click', () => {
			const mutation = session.removeMutation();
			if (!mutation) {
				setRuleDiagnostic(diagnostic, t('reminders', 'staleItem'), 'error');
				return;
			}
			completed = true;
			const attempt = session.attempt(mutation);
			if (!attempt.accepted) {
				completed = false;
				setRuleDiagnostic(diagnostic, attempt.message, 'error');
				return;
			}
			closeAccepted();
		});
		actions.appendChild(clearButton);
	}

	renderRuleCandidates();
	const ownerWindow = panel.ownerDocument.defaultView;
	if (ownerWindow) ownerWindow.requestAnimationFrame(() => requestFloatingInputFocus(input));
	else requestFloatingInputFocus(input);
	return close;
}

function createReminderMutationSession(
	fieldKey: ReminderListFieldKey,
	options: ReminderPickerBaseOptions,
): ReminderMutationSession {
	const getFieldValues = (): Readonly<Record<string, string | undefined>> => (
		options.getFieldValues?.() ?? options.fieldValues
	);
	const editing: ReminderPickerEditingItem | undefined = options.operation.kind === 'edit'
		? {
			fieldKey,
			index: options.operation.item.index,
			rawValue: options.operation.item.rawValue.trim(),
		}
		: undefined;
	return {
		getFieldValues,
		modelInput: () => {
			const fieldValues = getFieldValues();
			return {
				fieldValues,
				reminderDatetimes: splitTaskListValue(fieldValues['reminderDatetimes']),
				reminderRules: splitTaskListValue(fieldValues['reminderRules']),
				...(editing ? { editing } : {}),
				nowEpochMs: options.nowEpochMs,
			};
		},
		mutationFor: nextValue => options.operation.kind === 'edit'
			? { action: 'replace', current: options.operation.item, nextValue }
			: { action: 'add', nextValue },
		removeMutation: () => options.operation.kind === 'edit'
			? { action: 'remove', current: options.operation.item }
			: null,
		attempt: mutation => {
			const result = applyReminderListMutation({
				fieldKey,
				currentValue: getFieldValues()[fieldKey],
				mutation,
			});
			if (!result.ok) {
				return {
					accepted: false,
					message: result.reason === 'duplicate'
						? t('reminders', 'duplicateReminder')
						: result.reason === 'stale-item'
							? t('reminders', 'staleItem')
							: t('reminders', 'offsetInvalid'),
				};
			}
			if (result.changed) options.onCommit(result.fieldValue);
			return { accepted: true };
		},
	};
}

function rejectDatetimeSelection(message: string): DatetimePickerActionResult {
	return { status: 'rejected', message };
}

function getInitialRuleOffset(operation: ReminderPickerOperation): string {
	if (operation.kind !== 'edit') return '';
	const parsed = parseReminderRule(operation.item.rawValue);
	return parsed.ok ? parsed.value.offset.canonical : '';
}

function resolveEditingRuleDiagnostic(
	operation: ReminderPickerOperation,
	fieldValues: Readonly<Record<string, string | undefined>>,
): string | null {
	if (operation.kind !== 'edit') return null;
	const resolution = resolveReminderRule(operation.item.rawValue, fieldValues);
	if (resolution.status === 'missing-anchor') return t('reminders', 'missingAnchor');
	if (resolution.status === 'invalid-anchor') return t('reminders', 'invalidAnchor');
	if (resolution.status === 'invalid-rule') return t('reminders', 'offsetInvalid');
	return null;
}

function formatRuleCandidateLabel(
	candidate: ReminderRuleCandidate,
	options: ReminderRulesPickerOptions,
): string {
	const anchor = getAnchorLabel(candidate.anchor, options);
	return candidate.offset === '0m'
		? t('reminders', 'atAnchor', { anchor })
		: t('reminders', 'offsetBeforeAnchor', { offset: candidate.offset, anchor });
}

function getAnchorLabel(anchor: ReminderRuleAnchor, options: ReminderRulesPickerOptions): string {
	return getVisiblePropertyName(anchor, options.settings.keyMappings).trim() || anchor;
}

function formatReminderPreview(epochMs: number, options: ReminderRulesPickerOptions): string {
	return new Intl.DateTimeFormat(getAppLocale(options.app), {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
		hour12: options.settings.timeFormat === '12h',
	}).format(new Date(epochMs));
}

function setRuleDiagnostic(
	element: HTMLElement,
	message: string,
	tone: 'default' | 'warning' | 'error',
): void {
	element.textContent = message;
	element.classList.toggle('is-warning', tone === 'warning');
	element.classList.toggle('is-error', tone === 'error');
}

let reminderRulesPickerId = 0;

function nextReminderRulesPickerId(): number {
	reminderRulesPickerId += 1;
	return reminderRulesPickerId;
}
