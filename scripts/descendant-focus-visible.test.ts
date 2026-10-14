import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bindDescendantFocusVisible, cleanupDescendantFocusVisible } from '../src/ui/descendant-focus-visible';

class FakeObserver {
	static instances: FakeObserver[] = [];
	observed = new Set<unknown>();
	constructor(readonly callback: () => void) { FakeObserver.instances.push(this); }
	observe(node: unknown): void { this.observed.add(node); }
	disconnect(): void { this.observed.clear(); }
}
class FakeWindow {
	MutationObserver = FakeObserver;
	frames = new Map<number, FrameRequestCallback>();
	private sequence = 0;
	requestAnimationFrame(callback: FrameRequestCallback): number { const id = ++this.sequence; this.frames.set(id, callback); return id; }
	cancelAnimationFrame(id: number): void { this.frames.delete(id); }
	flush(): void { const frames = [...this.frames]; this.frames.clear(); for (const [, callback] of frames) callback(0); }
}
class FakeDocument {
	activeElement: FakeElement | null = null;
	defaultView = new FakeWindow();
	listeners = new Map<string, Set<() => void>>();
	addEventListener(type: string, listener: () => void): void { const rows = this.listeners.get(type) ?? new Set(); rows.add(listener); this.listeners.set(type, rows); }
	removeEventListener(type: string, listener: () => void): void { this.listeners.get(type)?.delete(listener); }
	fire(type: string): void { for (const callback of [...(this.listeners.get(type) ?? [])]) callback(); }
	listenerCount(): number { return [...this.listeners.values()].reduce((sum, rows) => sum + rows.size, 0); }
}
class FakeElement {
	parentElement: FakeElement | null = null;
	children: FakeElement[] = [];
	visibleFocus = false;
	classes = new Set<string>();
	classList = {
		add: (...names: string[]) => { for (const name of names) this.classes.add(name); },
		remove: (...names: string[]) => { for (const name of names) this.classes.delete(name); },
	};
	listeners = new Map<string, Set<() => void>>();
	constructor(public ownerDocument: FakeDocument) {}
	append(child: FakeElement): void { child.parentElement = this; this.children.push(child); }
	matches(selector: string): boolean { return selector === ':focus-visible' && this.visibleFocus; }
	querySelectorAll(selector: string): FakeElement[] {
		const all = this.children.flatMap(child => [child, ...child.querySelectorAll('*')]);
		return selector === '*' ? all : all.filter(child => child.classes.has(selector.slice(1)));
	}
	addEventListener(type: string, listener: () => void): void { const rows = this.listeners.get(type) ?? new Set(); rows.add(listener); this.listeners.set(type, rows); }
	removeEventListener(type: string, listener: () => void): void { this.listeners.get(type)?.delete(listener); }
	fire(type: string): void { for (const callback of [...(this.listeners.get(type) ?? [])]) callback(); }
}
const element = (value: FakeElement): HTMLElement => value as unknown as HTMLElement;
const state = (scope: FakeElement): boolean => scope.classes.has('has-descendant-focus-visible');
function fixture() {
	const document = new FakeDocument();
	const scope = new FakeElement(document), button = new FakeElement(document);
	scope.append(button); document.activeElement = button;
	const cleanup = bindDescendantFocusVisible(element(scope));
	return { document, scope, button, cleanup };
}

test('pointer focus stays hidden while native visible focus reveals the same descendant', () => {
	const f = fixture();
	try {
		assert.equal(state(f.scope), false);
		f.button.visibleFocus = true; f.document.fire('keydown'); assert.equal(state(f.scope), true);
		f.button.visibleFocus = false; f.document.fire('pointerdown'); assert.equal(state(f.scope), false);
		// Mouse-focused text inputs are visible whenever the browser reports them so.
		f.button.visibleFocus = true; f.document.fire('pointerdown'); assert.equal(state(f.scope), true);
	} finally { f.cleanup(); }
});
test('default-action focus changes are reconciled after keyboard and pointer events', () => {
	const f = fixture();
	try {
		f.document.fire('keydown'); f.button.visibleFocus = true; f.document.defaultView.flush(); assert.equal(state(f.scope), true);
		f.document.fire('pointerdown'); f.button.visibleFocus = false; f.document.defaultView.flush(); assert.equal(state(f.scope), false);
	} finally { f.cleanup(); }
});
test('nested scopes exclude their own focus and preserve outer descendant focus', () => {
	const f = fixture();const inner = new FakeElement(f.document);f.scope.append(inner);
	const cleanup = bindDescendantFocusVisible(element(inner));
	try {
		f.document.activeElement = inner; inner.visibleFocus = true; f.document.fire('focusin');
		assert.equal(state(inner), false); assert.equal(state(f.scope), true);
		f.document.activeElement = null; f.document.fire('focusout'); assert.equal(state(f.scope), false);
	} finally { cleanup(); f.cleanup(); }
});
test('focused ancestry observes non-visible focus and clears removed descendants', () => {
	const f = fixture();const observer = FakeObserver.instances.at(-1)!;
	try {
		assert.ok(observer.observed.has(f.button));
		f.button.visibleFocus = true; observer.callback(); assert.equal(state(f.scope), true);
		f.document.activeElement = null; observer.callback(); assert.equal(state(f.scope), false);
		assert.equal(observer.observed.size, 0);
	} finally { f.cleanup(); }
});
test('shared document listeners and scheduled work are removed after idempotent cleanup', () => {
	const f = fixture();const scopes: FakeElement[] = [];
	for (let index = 0; index < 100; index++) { const scope = new FakeElement(f.document);scopes.push(scope);f.scope.append(scope);bindDescendantFocusVisible(element(scope)); }
	assert.equal(f.document.listenerCount(), 6);
	assert.equal(bindDescendantFocusVisible(element(f.scope)), f.cleanup);
	f.document.fire('keydown'); assert.equal(f.document.defaultView.frames.size, 1);
	cleanupDescendantFocusVisible(element(f.scope)); f.cleanup();
	assert.equal(f.document.listenerCount(), 0);assert.equal(f.document.defaultView.frames.size, 0);
	assert.ok(scopes.every(scope => !scope.classes.has('operon-focus-visible-scope')));
});
test('separate documents and adopted view DOM keep independent native focus ownership', () => {
	const f = fixture(), other = fixture();
	try {
		f.button.visibleFocus = true;f.document.fire('focusin');assert.equal(state(f.scope), true);assert.equal(state(other.scope), false);
		f.scope.ownerDocument = other.document;f.button.ownerDocument = other.document;
		f.document.activeElement = null;other.document.activeElement = f.button;f.scope.fire('focusin');
		assert.equal(f.document.listenerCount(), 0);assert.equal(state(f.scope), true);
		f.button.visibleFocus = false;other.document.fire('pointerdown');assert.equal(state(f.scope), false);
	} finally { f.cleanup();other.cleanup(); }
});
