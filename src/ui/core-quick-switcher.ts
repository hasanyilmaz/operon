import { Platform, TFile, type App } from 'obsidian';
import { asHTMLElement } from '../core/dom-compat';
import { getInternalPlugin, isPluginEnabled } from '../core/obsidian-app';
import { isRecord } from '../core/unknown-value';
import { resolveCoreQuickSwitcherOpenBehavior, type CoreQuickSwitcherOpenBehavior } from '../types/settings';

const CHOOSE_METHOD = 'onChooseSuggestion';

type ActiveBehavior = Exclude<CoreQuickSwitcherOpenBehavior, 'default'>;
type Opening = () => void | Promise<void>;

interface CoreQuickSwitcherOptions {
	behavior: () => CoreQuickSwitcherOpenBehavior | undefined;
	prepareOpening: (file: TFile, behavior: ActiveBehavior, anchor: HTMLElement) => Opening | null;
	onOpenError: (error: unknown) => void;
}

export { resolveFileLightboxOpening as resolveCoreQuickSwitcherFileOpening } from './file-lightbox-opening';

function isPlainSelection(event: unknown): boolean {
	if (!isRecord(event) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
	// The native chooser has already prevented the click's default action.
	return event.type === 'click' && event.button === 0
		|| event.type === 'keydown' && event.key === 'Enter' && !event.isComposing;
}

export class CoreQuickSwitcherIntegration {
	private prototype: object | null = null;
	private restore: (() => void) | null = null;

	constructor(private readonly app: App, private readonly options: CoreQuickSwitcherOptions) {}

	sync(): void {
		const { app, options } = this;
		const mode = resolveCoreQuickSwitcherOpenBehavior(options.behavior());
		const core = Platform.isDesktopApp && mode && mode !== 'default'
			? getInternalPlugin(app, 'switcher') : null;
		const constructor = isRecord(core) && isRecord(core.instance) ? core.instance.QuickSwitcherModal : null;
		const prototype: unknown = typeof constructor === 'function' ? constructor.prototype : null;
		if (this.prototype === prototype) return;
		this.dispose();
		if (!isRecord(prototype)) return;
		const descriptor = Object.getOwnPropertyDescriptor(prototype, CHOOSE_METHOD);
		if (!descriptor?.configurable || typeof descriptor.value !== 'function') return;

		const original = descriptor.value as (this: unknown, result: unknown, event: unknown) => unknown;
		let enabled = true;
		const choose = function (this: unknown, result: unknown, event: unknown): unknown {
			const current = resolveCoreQuickSwitcherOpenBehavior(options.behavior());
			let opening: Opening | null = null;
			if (enabled && current && current !== 'default' && isPluginEnabled(core)
				&& isRecord(this) && this.app === app && isPlainSelection(event)
				&& isRecord(result) && (result.type === 'file' || result.type === 'alias')
				&& result.file instanceof TFile && app.vault.getAbstractFileByPath(result.file.path) === result.file) {
				try {
					const doc = asHTMLElement(this.modalEl)?.ownerDocument;
					if (doc?.body && doc.defaultView && !doc.defaultView.closed) {
						opening = options.prepareOpening(result.file, current, doc.body);
					}
				} catch {
					// Core still owns the selection until Operon has a valid opening.
				}
			}
			if (!opening) return original.call(this, result, event);
			try { void Promise.resolve(opening()).catch(options.onOpenError); }
			catch (error) { options.onOpenError(error); }
		};
		if (!Reflect.defineProperty(prototype, CHOOSE_METHOD, { ...descriptor, value: choose })) return;
		this.prototype = prototype;
		this.restore = () => {
			enabled = false;
			if (Object.getOwnPropertyDescriptor(prototype, CHOOSE_METHOD)?.value === choose) {
				Reflect.defineProperty(prototype, CHOOSE_METHOD, descriptor);
			}
		};
	}

	dispose(): void {
		this.restore?.();
		this.restore = null;
		this.prototype = null;
	}
}
