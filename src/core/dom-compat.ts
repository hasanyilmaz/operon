declare global {
	interface Window {
		createEl<K extends keyof HTMLElementTagNameMap>(
			tagName: K,
			options?: DomElementInfo | string,
			callback?: (element: HTMLElementTagNameMap[K]) => void,
		): HTMLElementTagNameMap[K];
		createDiv(
			options?: DomElementInfo | string,
			callback?: (element: HTMLDivElement) => void,
		): HTMLDivElement;
		createSpan(
			options?: DomElementInfo | string,
			callback?: (element: HTMLSpanElement) => void,
		): HTMLSpanElement;
	}
}

export interface WindowTimeoutHandle {
	id: ReturnType<Window['setTimeout']>;
	win: Window;
}

export interface WindowIntervalHandle {
	id: ReturnType<Window['setInterval']>;
	win: Window;
}

export function getActiveDocument(): Document {
	return activeDocument;
}

export function getActiveWindow(): Window {
	return activeWindow;
}

export function getOwnerDocument(owner: Node | null | undefined): Document {
	return owner?.ownerDocument ?? activeDocument;
}

export function getOwnerWindow(owner: Node | null | undefined): Window {
	return getOwnerDocument(owner).defaultView ?? activeWindow;
}

export function getOwnerBody(owner: Node | null | undefined): HTMLElement {
	return getOwnerDocument(owner).body;
}

export function createActiveElement<K extends keyof HTMLElementTagNameMap>(tagName: K): HTMLElementTagNameMap[K] {
	return createOwnerElement(null, tagName);
}

export function createOwnerElement<K extends keyof HTMLElementTagNameMap>(
	owner: Node | null | undefined,
	tagName: K,
): HTMLElementTagNameMap[K] {
	return getOwnerDocument(owner).win.createEl(tagName);
}

export function isHTMLElement(value: unknown, owner?: Node | null): value is HTMLElement {
	if (typeof value !== 'object' || value === null) return false;
	const maybeNode = value as { ownerDocument?: Document | null };
	const doc = owner?.ownerDocument ?? maybeNode.ownerDocument ?? activeDocument;
	const win = doc.defaultView ?? activeWindow;
	const HTMLElementCtor = (win as Window & { HTMLElement?: typeof HTMLElement }).HTMLElement;
	return Boolean(HTMLElementCtor && Object.prototype.isPrototypeOf.call(HTMLElementCtor.prototype, value));
}

export function asHTMLElement(value: unknown, owner?: Node | null): HTMLElement | null {
	return isHTMLElement(value, owner) ? value : null;
}

export function setWindowTimeout(callback: () => void, delayMs = 0): WindowTimeoutHandle {
	const win = activeWindow;
	return {
		win,
		id: win.setTimeout(callback, delayMs),
	};
}

export function clearWindowTimeout(handle: WindowTimeoutHandle | null | undefined): void {
	if (!handle) return;
	handle.win.clearTimeout(handle.id);
}

export function setWindowInterval(callback: () => void, delayMs = 0): WindowIntervalHandle {
	const win = activeWindow;
	return {
		win,
		id: win.setInterval(callback, delayMs),
	};
}

export function clearWindowInterval(handle: WindowIntervalHandle | null | undefined): void {
	if (!handle) return;
	handle.win.clearInterval(handle.id);
}

export function delayWithActiveWindow(delayMs: number): Promise<void> {
	return new Promise(resolve => {
		getActiveWindow().setTimeout(resolve, delayMs);
	});
}
