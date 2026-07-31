import { Extension, Facet } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { Editor } from 'obsidian';
import { getEditorViewFromEditor } from '../core/obsidian-app';

type OperonEditorSurfaceScope = 'document' | 'compact-inline';

export const operonEditorSurfaceScopeFacet = Facet.define<
	OperonEditorSurfaceScope,
	OperonEditorSurfaceScope
>({
	combine: values => values.includes('compact-inline') ? 'compact-inline' : 'document',
});

export const compactEditorSurfaceScopeExtension: Extension =
	operonEditorSurfaceScopeFacet.of('compact-inline');

export function allowsOperonDocumentAugmentations(view: EditorView): boolean {
	return view.state.facet(operonEditorSurfaceScopeFacet) === 'document';
}

export function allowsOperonDocumentEditor(editor: Editor): boolean {
	const view = getEditorViewFromEditor(editor);
	return view instanceof EditorView && allowsOperonDocumentAugmentations(view);
}
