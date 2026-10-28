// Shared picker behavior is covered by its own tests. Capture only the axis UI contract here.
export let axisPicker: { options: any[]; fields?: any[]; onSelect: (value: any) => void } | null = null;
export function showSearchableFieldPicker(_anchor: unknown, options: any): () => void { axisPicker = options; return () => {}; }
export function showSearchableOptionPicker(_anchor: unknown, options: any): () => void { axisPicker = options; return () => {}; }
