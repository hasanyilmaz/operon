import momentLibrary from 'moment';

export const moment = momentLibrary;

export function normalizePath(path: string): string {
	return path.replace(/\\/gu, '/').replace(/\/+/gu, '/').replace(/^\/|\/$/gu, '');
}

export class App {}

export const editorLivePreviewField = {};

export type KeymapEventHandler = (...args: any[]) => any;

export class Scope {
	constructor(_parent?: Scope) {}
	register(): void {}
	unregister(): void {}
}

export class Component {
	private readonly unloadCallbacks: Array<() => void> = [];

	register(callback: () => void): void {
		this.unloadCallbacks.push(callback);
	}

	load(): void {}

	unload(): void {
		for (const callback of this.unloadCallbacks.splice(0)) {
			callback();
		}
	}
}

export class MarkdownRenderChild extends Component {
	containerEl: any;

	constructor(containerEl: any) {
		super();
		this.containerEl = containerEl;
	}

	onload(): void {}
	onunload(): void {}

	load(): void {
		this.onload();
	}

	unload(): void {
		super.unload();
		this.onunload();
	}
}

export class WorkspaceLeaf {
	app: App;
	view: unknown = null;
	containerEl: any = createStubEl();
	tabHeaderInnerTitleEl: any = createStubEl();
	tabHeaderEl: any = createStubEl();

	constructor(app = new App()) {
		this.app = app;
	}

	getViewState(): { state: Record<string, unknown> } {
		return { state: {} };
	}

	setViewState(): Promise<void> {
		return Promise.resolve();
	}
}

export class ItemView extends Component {
	app: App;
	leaf: WorkspaceLeaf;
	containerEl: any;
	contentEl: any;

	constructor(leaf = new WorkspaceLeaf()) {
		super();
		this.leaf = leaf;
		this.app = leaf.app;
		this.containerEl = createStubEl();
		this.contentEl = createStubEl();
		this.containerEl.children = [createStubEl(), this.contentEl];
	}

	getViewType(): string { return ''; }
	getDisplayText(): string { return ''; }
	getIcon(): string { return ''; }
}

export const MarkdownRenderer = {
	render(): Promise<void> {
		return Promise.resolve();
	},
};

export class Setting {
	settingEl: any;
	controlEl: any;

	constructor(_containerEl?: any) {
		this.settingEl = createStubEl();
		this.controlEl = createStubEl();
	}

	setName(): this { return this; }
	setDesc(): this { return this; }
	setHeading(): this { return this; }
	addTextArea(callback: (component: any) => void): this {
		const inputEl = createStubEl();
		inputEl.value = '';
		inputEl.rows = 0;
		inputEl.scrollHeight = 0;
		const component = {
			inputEl,
			setValue(value: string) {
				inputEl.value = value;
				return component;
			},
			setPlaceholder() {
				return component;
			},
			onChange() {
				return component;
			},
		};
		callback(component);
		return this;
	}
	addText(callback: (component: any) => void): this {
		const inputEl = createStubEl();
		inputEl.value = '';
		const component = {
			inputEl,
			setValue(value: string) {
				inputEl.value = value;
				return component;
			},
			setPlaceholder() {
				return component;
			},
			onChange() {
				return component;
			},
		};
		callback(component);
		return this;
	}
	addExtraButton(callback: (component: any) => void): this {
		const extraSettingsEl = createStubEl();
		const component = {
			extraSettingsEl,
			setIcon() {
				return component;
			},
			setDisabled(value: boolean) {
				extraSettingsEl.disabled = value;
				return component;
			},
			onClick() {
				return component;
			},
		};
		callback(component);
		return this;
	}
}

export const Platform = {
	isMacOS: false,
	isMobile: false,
	isMobileApp: false,
	isPhone: false,
	isTablet: false,
};

export class Modal {
	app: App;
	containerEl: any;
	modalEl: any;
	contentEl: any;
	titleEl: any;

	constructor(app: App) {
		this.app = app;
		this.containerEl = createStubEl();
		this.modalEl = createStubEl();
		this.contentEl = createStubEl();
		this.titleEl = createStubEl();
	}

	open(): void {
		this.onOpen();
	}

	close(): void {
		this.onClose();
	}

	onOpen(): void { }
	onClose(): void { }
}

export interface FuzzyMatch<T> {
	item: T;
	match: {
		score: number;
		matches: number[];
	};
}

export class FuzzySuggestModal<T> extends Modal {
	emptyStateText = '';
	inputEl: any = createStubEl();

	setPlaceholder(_placeholder: string): this { return this; }
	setInstructions(_instructions: Array<{ command: string; purpose: string }>): this { return this; }
	getItems(): T[] { return []; }
	getItemText(item: T): string { return String(item); }
	getSuggestions(query: string): Array<FuzzyMatch<T>> {
		return this.getItems().map(item => ({
			item,
			match: prepareFuzzySearch(query)(this.getItemText(item)) ?? { score: Number.POSITIVE_INFINITY, matches: [] },
		}));
	}
	renderSuggestion(_match: FuzzyMatch<T>, _el: HTMLElement): void {}
	onChooseItem(_item: T): void {}
}

export class Notice {
	message: string;

	constructor(message: string) {
		this.message = message;
	}
}

export class Menu {
	items: Array<MenuItem | { separator: true }> = [];
	private hideCallbacks: Array<() => void> = [];

	constructor() {
		const menus = (globalThis as any).__obsidianMenus;
		if (Array.isArray(menus)) {
			menus.push(this);
		}
	}

	addItem(callback: (item: MenuItem) => unknown): this {
		const item = new MenuItem();
		this.items.push(item);
		callback(item);
		return this;
	}
	addSeparator(): this {
		this.items.push({ separator: true });
		return this;
	}
	onHide(callback: () => void): this {
		this.hideCallbacks.push(callback);
		return this;
	}
	showAtPosition(): this { return this; }
	showAtMouseEvent(): this { return this; }
	hide(): this {
		for (const callback of this.hideCallbacks.splice(0)) callback();
		return this;
	}
	close(): void { this.hide(); }
}

export class MenuItem {
	title: string | null = null;
	icon: string | null = null;
	checked = false;
	disabled = false;
	isLabel = false;
	clickHandler: (() => unknown) | null = null;

	setTitle(title: string): this {
		this.title = title;
		return this;
	}
	setIcon(icon: string): this {
		this.icon = icon;
		return this;
	}
	setChecked(checked: boolean): this {
		this.checked = checked;
		return this;
	}
	setDisabled(disabled: boolean): this {
		this.disabled = disabled;
		return this;
	}
	setWarning(): this { return this; }
	setIsLabel(value = true): this {
		this.isLabel = value;
		return this;
	}
	onClick(handler: () => unknown): this {
		this.clickHandler = handler;
		return this;
	}
	setSection(): this { return this; }
}

export async function requestUrl(options: any): Promise<any> {
	const handler = (globalThis as any).__obsidianRequestUrl;
	if (typeof handler !== 'function') {
		throw new Error('requestUrl test stub handler not configured');
	}
	return await handler(options);
}

export class TFile {
	path: string;
	name: string;
	basename: string;
	extension: string;

	constructor(path: string) {
		this.path = path;
		this.name = path.split('/').pop() ?? path;
		this.basename = this.name.replace(/\.[^.]+$/, '');
		this.extension = this.name.split('.').pop() ?? '';
	}
}

export class TFolder {
	path: string;
	name: string;
	children: Array<TFile | TFolder> = [];

	constructor(path: string) {
		this.path = path;
		this.name = path.split('/').pop() ?? path;
	}
}

export function parseYaml(source: string): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const rawLine of source.split(/\r?\n/u)) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) continue;
		const separatorIndex = line.indexOf(':');
		if (separatorIndex === -1) continue;
		const key = line.slice(0, separatorIndex).trim();
		const value = line.slice(separatorIndex + 1).trim();
		if (value.startsWith('"')) {
			try {
				result[key] = JSON.parse(value);
				continue;
			} catch {
				// Fall back to the deliberately small fixture parser below.
			}
		}
		result[key] = value.replace(/^["']|["']$/gu, '');
	}
	return result;
}

export function stringifyYaml(value: unknown): string {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
	const lines: string[] = [];
	for (const [key, entry] of Object.entries(value)) {
		if (Array.isArray(entry)) {
			lines.push(`${key}:`);
			for (const item of entry) lines.push(`  - ${stringifyYamlScalar(item)}`);
			continue;
		}
		lines.push(`${key}: ${stringifyYamlScalar(entry)}`.trimEnd());
	}
	return `${lines.join('\n')}\n`;
}

function stringifyYamlScalar(value: unknown): string {
	if (value === null || value === undefined || value === '') return '';
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	const text = String(value);
	return /^[A-Za-z0-9_./@:+()-]+(?: [A-Za-z0-9_./@:+()-]+)*$/u.test(text)
		? text
		: JSON.stringify(text);
}

export function getIcon(_iconId: string): any {
	return createStubEl();
}

export function getIconIds(): string[] {
	return ['alarm-clock', 'calendar', 'check', 'circle', 'pin', 'square-pen', 'timer'];
}

export function setIcon(el: any, iconId: string): void {
	const testHook = (globalThis as typeof globalThis & {
		__operonTestSetIcon?: (target: any, name: string) => void;
	}).__operonTestSetIcon;
	testHook?.(el, iconId);
}

export function setTooltip(_el: any, _tooltip: string): void {}

export const activeDocument = {
	body: createStubEl(),
	createElement() { return createStubEl(); },
	createElementNS() { return createStubEl(); },
	addEventListener() { },
	removeEventListener() { },
	querySelector() { return null; },
	querySelectorAll() { return []; },
};

export const activeWindow = {
	document: activeDocument,
	innerWidth: 1024,
	innerHeight: 768,
	HTMLElement: class HTMLElement {},
	Node: class Node {},
	DOMRect: class DOMRect {
		constructor(
			public x = 0,
			public y = 0,
			public width = 0,
			public height = 0,
		) {}
		get left(): number { return this.x; }
		get top(): number { return this.y; }
		get right(): number { return this.x + this.width; }
		get bottom(): number { return this.y + this.height; }
	},
	setTimeout: globalThis.setTimeout.bind(globalThis),
	clearTimeout: globalThis.clearTimeout.bind(globalThis),
	setInterval: globalThis.setInterval.bind(globalThis),
	clearInterval: globalThis.clearInterval.bind(globalThis),
	requestAnimationFrame(callback: FrameRequestCallback): number {
		return Number(globalThis.setTimeout(() => callback(Date.now()), 0));
	},
	cancelAnimationFrame(handle: number): void {
		globalThis.clearTimeout(handle);
	},
	addEventListener() { },
	removeEventListener() { },
	createEl() { return createStubEl(); },
	createDiv() { return createStubEl(); },
	createSpan() { return createStubEl(); },
};

(activeDocument as any).defaultView = activeWindow;
(activeDocument as any).win = activeWindow;
(activeDocument.body as any).ownerDocument = activeDocument;
(globalThis as any).activeDocument = activeDocument;
(globalThis as any).activeWindow = activeWindow;

function createStubEl(): any {
	const classes = new Set<string>();
	const styleValues = new Map<string, string>();
	const attributes = new Map<string, string>();
	const element: any = {
			tagName: 'DIV',
			dataset: {},
			id: '',
			textContent: '',
			setText() { },
			createEl() { return createStubEl(); },
			createDiv() { return createStubEl(); },
			empty() { },
			addClass() { },
			removeClass() { },
			appendChild() { },
			addEventListener() { },
			removeEventListener() { },
			setAttribute(name: string, value: string) {
				attributes.set(name, String(value));
			},
			getAttribute(name: string) {
				return attributes.get(name) ?? null;
			},
			removeAttribute(name: string) {
				attributes.delete(name);
			},
			querySelector() { return null; },
			insertAdjacentElement() { },
			disabled: false,
			style: {
				values: styleValues,
				setProperty(name: string, value: string) {
					styleValues.set(name, value);
				},
				removeProperty(name: string) {
					styleValues.delete(name);
				},
			},
			classList: {
				add(...classNames: string[]) {
					for (const className of classNames) classes.add(className);
				},
				remove(...classNames: string[]) {
					for (const className of classNames) classes.delete(className);
				},
				toggle(className: string, force?: boolean) {
					const next = force ?? !classes.has(className);
					if (next) classes.add(className);
					else classes.delete(className);
					return next;
				},
				contains(className: string) {
					return classes.has(className);
				},
			},
		};
	const activeDoc = (globalThis as any).activeDocument;
	if (activeDoc) element.ownerDocument = activeDoc;
	return element;
	}

export function parseLinktext(linktext: string): { path: string; subpath: string } {
	const headingIndex = linktext.indexOf('#');
	const blockIndex = linktext.indexOf('^');
	const splitIndex = [headingIndex, blockIndex]
		.filter((index) => index >= 0)
		.sort((a, b) => a - b)[0];

	if (splitIndex === undefined) {
		return { path: linktext, subpath: '' };
	}

	return {
		path: linktext.slice(0, splitIndex),
		subpath: linktext.slice(splitIndex),
	};
}

export function prepareFuzzySearch(query: string): (value: string) => { score: number; matches: number[] } | null {
	const normalizedQuery = query.toLowerCase();
	return (value: string) => {
		const normalizedValue = value.toLowerCase();
		if (!normalizedQuery) return { score: 0, matches: [] };
		const directIndex = normalizedValue.indexOf(normalizedQuery);
		if (directIndex >= 0) {
			return {
				score: directIndex,
				matches: Array.from({ length: normalizedQuery.length }, (_, index) => directIndex + index),
			};
		}

		const matches: number[] = [];
		let searchIndex = 0;
		for (const char of normalizedQuery) {
			const nextIndex = normalizedValue.indexOf(char, searchIndex);
			if (nextIndex === -1) return null;
			matches.push(nextIndex);
			searchIndex = nextIndex + 1;
		}

		return {
			score: matches[matches.length - 1] - matches[0] + matches[0],
			matches,
		};
	};
}
