import { resolveTableParentTaskActivation } from './table-text-edit-route';

export interface TableParentTaskCellActivationOptions {
	parentTaskId: string;
	parentExists: boolean;
	canOpenEditor: boolean;
	canOpenSource: boolean;
	isSourceModifier: (event: MouseEvent) => boolean;
	shouldIgnoreTarget: (target: EventTarget | null) => boolean;
	onOpenPicker: () => void;
	onOpenEditor: (parentTaskId: string) => void;
	onOpenSource: (parentTaskId: string) => void;
}

export function bindTableParentTaskCellActivation(
	cell: HTMLElement,
	options: TableParentTaskCellActivationOptions,
): void {
	const activate = (event?: MouseEvent): void => {
		const activation = resolveTableParentTaskActivation({
			parentTaskId: options.parentTaskId,
			parentExists: options.parentExists,
			canOpenEditor: options.canOpenEditor,
			canOpenSource: options.canOpenSource,
			sourceModifier: !!event && options.isSourceModifier(event),
		});
		if (activation === 'source') {
			options.onOpenSource(options.parentTaskId);
			return;
		}
		if (activation === 'editor') {
			options.onOpenEditor(options.parentTaskId);
			return;
		}
		options.onOpenPicker();
	};

	let suppressNextPointerClick = false;
	cell.addEventListener('pointerdown', event => {
		if (event.button !== 0) return;
		if (options.shouldIgnoreTarget(event.target)) return;
		suppressNextPointerClick = true;
		event.preventDefault();
		event.stopPropagation();
		activate(event);
	});
	cell.addEventListener('dblclick', event => {
		if (options.shouldIgnoreTarget(event.target)) return;
		event.preventDefault();
		event.stopPropagation();
	});
	cell.addEventListener('click', event => {
		if (options.shouldIgnoreTarget(event.target)) return;
		event.preventDefault();
		event.stopPropagation();
		if (suppressNextPointerClick && event.detail > 0) {
			suppressNextPointerClick = false;
			return;
		}
		suppressNextPointerClick = false;
		activate(event);
	});
	cell.addEventListener('keydown', event => {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		if (options.shouldIgnoreTarget(event.target)) return;
		event.preventDefault();
		event.stopPropagation();
		activate();
	});
}
