import { StateEffect, StateField, type Text } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import { createOwnerElement, getOwnerWindow } from '../core/dom-compat';
import { allowsOperonDocumentAugmentations } from './editor-augmentation-scope';

export interface ProbeEditorLayout {
	reserveFrom: number;
	boundaryFrom: number;
	atEnd: boolean;
	width: number;
	height: number;
	side: 'left' | 'right';
	tail: number;
}

class ProbeTail extends WidgetType {
	constructor(private readonly id: number, private readonly height: number) { super(); }
	eq(other: ProbeTail): boolean { return other.id === this.id && other.height === this.height; }
	get estimatedHeight(): number { return this.height; }
	toDOM(view: EditorView): HTMLElement {
		const element = createOwnerElement(view.dom, 'div');
		element.className = 'operon-card-layout-probe-tail';
		element.dataset.probeTail = String(this.id);
		element.style.setProperty('height', `${this.height}px`);
		return element;
	}
}

/** Direct StateField decorations keep block spacer heights visible to CodeMirror. */
export function createTaskCardEditorBridge(refresh: () => void) {
	const views = new Set<EditorView>();
	const pending = new Map<EditorView, Map<number, { layout: ProbeEditorLayout | null; sourceDoc: Text }>>();
	const frames = new Map<EditorView, { id: number; window: Window }>();
	const updateLayout = StateEffect.define<{ id: number; layout: ProbeEditorLayout | null }>();
	const field = StateField.define<Map<number, ProbeEditorLayout>>({
		create: () => new Map(),
		update(value, transaction) {
			const next = new Map<number, ProbeEditorLayout>();
			for (const [id, layout] of value) {
				next.set(id, transaction.docChanged ? {
					...layout,
					reserveFrom: transaction.newDoc.lineAt(transaction.changes.mapPos(layout.reserveFrom, 1)).from,
					boundaryFrom: layout.atEnd ? transaction.newDoc.length : transaction.newDoc.lineAt(transaction.changes.mapPos(layout.boundaryFrom, 1)).from,
				} : layout);
			}
			for (const effect of transaction.effects) if (effect.is(updateLayout)) {
				if (effect.value.layout) next.set(effect.value.id, effect.value.layout);
				else next.delete(effect.value.id);
			}
			return next;
		},
		provide: field => EditorView.decorations.from(field, entries => Decoration.set(
			[...entries].flatMap(([id, layout]) => {
				const line = Decoration.line({
					class: 'operon-card-layout-probe-reserve',
					attributes: { style: `--probe-reserve-width:${layout.width}px;--probe-reserve-height:${layout.height}px;--probe-reserve-side:${layout.side}` },
				}).range(layout.reserveFrom);
				return layout.tail > 0
					? [line, Decoration.widget({ widget: new ProbeTail(id, layout.tail), block: true, side: layout.atEnd ? 1 : -1 }).range(layout.boundaryFrom)]
					: [line];
			}), true,
		)),
	});
	const lifecycle = ViewPlugin.fromClass(class {
		constructor(private readonly view: EditorView) {
			if (allowsOperonDocumentAugmentations(view)) views.add(view);
			refresh();
		}
		update(): void { refresh(); }
		destroy(): void {
			views.delete(this.view);
			const frame = frames.get(this.view);
			if (frame) frame.window.cancelAnimationFrame(frame.id);
			frames.delete(this.view);
			pending.delete(this.view);
			refresh();
		}
	});
	return {
		views,
		extension: [field, lifecycle],
		set(view: EditorView, id: number, layout: ProbeEditorLayout | null): void {
			if (!views.has(view)) return;
			const current = view.state.field(field, false)?.get(id) ?? null;
			if (JSON.stringify(current) === JSON.stringify(layout) && !pending.get(view)?.has(id)) return;
			let updates = pending.get(view);
			if (!updates) { updates = new Map(); pending.set(view, updates); }
			updates.set(id, { layout, sourceDoc: view.state.doc });
			if (frames.has(view)) return;
			const window = getOwnerWindow(view.dom);
			const frame = window.requestAnimationFrame(() => {
				frames.delete(view);
				const changes = pending.get(view);
				pending.delete(view);
				if (!views.has(view) || !changes || !view.state.field(field, false)) return;
				const effects = [...changes].filter(([, change]) => change.layout === null || change.sourceDoc === view.state.doc)
					.map(([id, change]) => updateLayout.of({ id, layout: change.layout }));
				if (effects.length) { view.dispatch({ effects }); view.requestMeasure(); }
				if (effects.length !== changes.size) refresh();
			});
			frames.set(view, { id: frame, window });
		},
	};
}

export type TaskCardEditorBridge = ReturnType<typeof createTaskCardEditorBridge>;
