import { lightboxFixture } from './lightbox-dom';

/** Extend the existing two-document fixture with the DOM operations the dock owns. */
export function statusDockDocument() {
	const fixture = lightboxFixture();
	const doc = fixture.doc;
	Object.assign(doc.defaultView, doc.win); doc.win = doc.defaultView;
	doc.defaultView.innerWidth = 900; doc.defaultView.innerHeight = 700;
	const Element = doc.defaultView.HTMLElement;
	const proto = Element.prototype;
	Object.defineProperties(proto, {
		className: { get() { return [...this.classes].join(' '); }, set(value: string) { this.classes = new Set(value.split(/\s+/u).filter(Boolean)); } },
		parentElement: { get() { return this.parent; } },
		classList: { get() { return { add: (...names: string[]) => names.forEach(name => this.classes.add(name)), remove: (...names: string[]) => names.forEach(name => this.classes.delete(name)),
			contains: (name: string) => this.classes.has(name), toggle: (name: string, value: boolean) => { if (value) this.classes.add(name); else this.classes.delete(name); } }; } },
	});
	proto.insertBefore = function (node: any, before: any) {
		if (node === before) return node;
		this.appendChild(node);
		if (before) { this.children.pop(); const index = this.children.indexOf(before); if (index < 0) throw new Error('Missing reference child'); this.children.splice(index, 0, node); }
		return node;
	};
	proto.clientWidth = 900;
	proto.empty = function () { this.children = []; this.textContent = ''; };
	proto.remove = function () { if (this.parent) this.parent.children = this.parent.children.filter((child: unknown) => child !== this); this.parent = null; this.connected = false; };
	proto.matches = function (selector: string) {
		if (selector === '*') return true;
		if (selector.startsWith('.')) return this.classes.has(selector.slice(1));
		if (selector.includes('data-operon-accessible-label')) return this.dataset.operonAccessibleLabel === 'true';
		return false;
	};
	proto.closest = function (selector: string): unknown { return this.matches(selector) ? this : this.parent?.closest(selector) ?? null; };
	proto.querySelectorAll = function (selector = '*'): unknown[] {
		return this.children.flatMap((el: any) => [el, ...el.querySelectorAll('*')]).filter((el: any) => el.matches(selector));
	};
	proto.querySelector = function (selector: string): unknown {
		if (selector.startsWith(':scope')) return this.children.find((el: any) => el.dataset.operonAccessibleLabel === 'true') ?? null;
		return this.querySelectorAll(selector)[0] ?? null;
	};
	proto.addEventListener = function (name: string, callback: (event: unknown) => void) {
		this.handlers ??= new Map(); const handlers = this.handlers.get(name) ?? new Set(); handlers.add(callback); this.handlers.set(name, handlers);
	};
	proto.removeEventListener = function (name: string, callback: (event: unknown) => void) { this.handlers?.get(name)?.delete(callback); };
	proto.click = function () { if (!this.disabled) for (const callback of this.handlers?.get('click') ?? []) callback({ stopPropagation() {}, preventDefault() {} }); };
	doc.createElement = (tag: string) => { const el = new Element(); el.tagName = tag.toUpperCase(); return el; };
	doc.win.createEl = doc.createElement;
	doc.win.createDiv = () => doc.createElement('div');
	let sequence = 0;
	const timers = new Map<number, () => void>();
	doc.defaultView.setTimeout = (callback: () => void) => { const id = ++sequence; timers.set(id, callback); return id; };
	doc.defaultView.clearTimeout = (id: number) => timers.delete(id);
	doc.defaultView.requestAnimationFrame = (callback: FrameRequestCallback) => doc.defaultView.setTimeout(() => callback(0), 0);
	doc.defaultView.cancelAnimationFrame = doc.defaultView.clearTimeout;
	doc.defaultView.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
	const windowListeners = new Map<string, Set<(event: any) => void>>();
	doc.defaultView.addEventListener = (key: string, callback: (event: any) => void) => {
		const callbacks = windowListeners.get(key) ?? new Set(); callbacks.add(callback); windowListeners.set(key, callbacks);
	};
	doc.defaultView.removeEventListener = (key: string, callback: (event: any) => void) => windowListeners.get(key)?.delete(callback);
	return { ...fixture, windowListeners, emitWindow(key: string, event: unknown) { windowListeners.get(key)?.forEach(callback => callback(event)); }, timers, flush() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(callback => callback()); } };
}
