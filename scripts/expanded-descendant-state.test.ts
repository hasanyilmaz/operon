import assert from 'node:assert/strict';
import {
	bindExpandedDescendantState,
	EXPANDED_DESCENDANT_CLASS,
} from '../src/ui/expanded-descendant-state';

let assertions = 0;

function equal<T>(actual: T, expected: T, message?: string): void {
	assert.equal(actual, expected, message);
	assertions += 1;
}

class FakeClassList {
	readonly values = new Set<string>();

	toggle(name: string, force: boolean): boolean {
		if (force) this.values.add(name);
		else this.values.delete(name);
		return force;
	}

	remove(name: string): void {
		this.values.delete(name);
	}

	contains(name: string): boolean {
		return this.values.has(name);
	}
}

class FakeRoot {
	readonly classList = new FakeClassList();
	expandedControls = 0;
	readonly ownerDocument = { defaultView: {} };

	querySelector(selector: string): object | null {
		equal(selector, '[aria-expanded="true"]');
		return this.expandedControls > 0 ? {} : null;
	}
}

class FakeMutationObserver {
	static latest: FakeMutationObserver | null = null;
	readonly callback: MutationCallback;
	disconnected = false;
	observedTarget: Node | null = null;
	observedOptions: MutationObserverInit | null = null;

	constructor(callback: MutationCallback) {
		this.callback = callback;
		FakeMutationObserver.latest = this;
	}

	observe(target: Node, options?: MutationObserverInit): void {
		this.observedTarget = target;
		this.observedOptions = options ?? null;
	}

	disconnect(): void {
		this.disconnected = true;
	}

	flush(): void {
		if (!this.disconnected) this.callback([], this as unknown as MutationObserver);
	}
}

function hasExpandedState(root: FakeRoot): boolean {
	return root.classList.contains(EXPANDED_DESCENDANT_CLASS);
}

async function run(): Promise<void> {
	const root = new FakeRoot();
	const dispose = bindExpandedDescendantState(
		root as unknown as HTMLElement,
		FakeMutationObserver,
	);
	const observer = FakeMutationObserver.latest;
	assert.ok(observer);
	assertions += 1;

	equal(hasExpandedState(root), false, 'closed toolbar starts without expanded state');
	equal(observer.observedTarget, root as unknown as Node);
	equal(observer.observedOptions?.attributes, true);
	equal(observer.observedOptions?.attributeFilter?.join(','), 'aria-expanded');
	equal(observer.observedOptions?.childList, true);
	equal(observer.observedOptions?.subtree, true);

	root.expandedControls = 1;
	observer.flush();
	equal(hasExpandedState(root), true, 'one open control keeps the toolbar expanded');

	root.expandedControls = 2;
	observer.flush();
	equal(hasExpandedState(root), true, 'multiple open controls keep the toolbar expanded');

	root.expandedControls = 1;
	observer.flush();
	equal(hasExpandedState(root), true, 'closing one of multiple controls keeps the toolbar expanded');

	root.expandedControls = 0;
	observer.flush();
	equal(hasExpandedState(root), false, 'closing or removing the final control clears expanded state');

	root.expandedControls = 1;
	observer.flush();
	equal(hasExpandedState(root), true);
	dispose();
	equal(observer.disconnected, true, 'cleanup disconnects the observer');
	equal(hasExpandedState(root), false, 'cleanup removes transient toolbar state');

	root.expandedControls = 1;
	observer.flush();
	equal(hasExpandedState(root), false, 'cleanup prevents later observer updates');

	console.log(`Expanded descendant state: ${assertions}/${assertions} passed`);
}

globalThis.__operonExpandedDescendantStateTestRun = run();

declare global {
	var __operonExpandedDescendantStateTestRun: Promise<void> | undefined;
}
