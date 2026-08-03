import assert from 'node:assert/strict';
import {
	parseCompactTaskMarkdown,
	renderCompactTaskMarkdown,
	type CompactTaskMarkdownNode,
} from '../src/ui/compact-task-markdown-renderer';

let assertions = 0;

function equal<T>(actual: T, expected: T, message?: string): void {
	if (message) {
		assert.equal(actual, expected, message);
	} else {
		assert.equal(actual, expected);
	}
	assertions++;
}

function deepEqual(actual: unknown, expected: unknown, message?: string): void {
	if (message) {
		assert.deepEqual(actual, expected, message);
	} else {
		assert.deepEqual(actual, expected);
	}
	assertions++;
}

function nodeTypes(value: string): string[] {
	return parseCompactTaskMarkdown(value).map(node => node.type);
}

class FakeClassList {
	private readonly values = new Set<string>();

	add(...names: string[]): void {
		for (const name of names) this.values.add(name);
	}

	has(name: string): boolean {
		return this.values.has(name);
	}

	toString(): string {
		return [...this.values].join(' ');
	}

	replaceFrom(value: string): void {
		this.values.clear();
		for (const name of value.split(/\s+/u).filter(Boolean)) this.values.add(name);
	}
}

class FakeElement {
	readonly children: FakeElement[] = [];
	readonly classList = new FakeClassList();
	readonly attributes = new Map<string, string>();
	readonly listeners = new Map<string, Array<(event: Event) => void>>();
	readonly ownerDocument: FakeDocument;
	textContent = '';
	draggable = false;
	tagName: string;

	constructor(tagName: string, ownerDocument: FakeDocument) {
		this.tagName = tagName.toUpperCase();
		this.ownerDocument = ownerDocument;
	}

	set className(value: string) {
		this.classList.replaceFrom(value);
	}

	get className(): string {
		return this.classList.toString();
	}

	addClass(...names: string[]): void {
		this.classList.add(...names);
	}

	appendChild(child: FakeElement): FakeElement {
		this.children.push(child);
		return child;
	}

	setAttribute(name: string, value: string): void {
		this.attributes.set(name, value);
	}

	addEventListener(name: string, listener: (event: Event) => void): void {
		const listeners = this.listeners.get(name) ?? [];
		listeners.push(listener);
		this.listeners.set(name, listeners);
	}
}

class FakeDocument {
	readonly win = {
		createEl: (tagName: string): FakeElement => new FakeElement(tagName, this),
	};
}

function createContainer(): FakeElement {
	const document = new FakeDocument();
	return new FakeElement('span', document);
}

function flatten(nodes: readonly CompactTaskMarkdownNode[]): string {
	return nodes.map(node => {
		if (node.type === 'text' || node.type === 'code') return node.value;
		if (node.type === 'wikilink' || node.type === 'markdown-link') return node.label;
		return flatten(node.children);
	}).join('');
}

function run(): void {
	deepEqual(nodeTypes('A **bold** *italic* `code`'), ['text', 'strong', 'text', 'emphasis', 'text', 'code']);
	deepEqual(nodeTypes('A __bold__ _italic_ ~~strike~~ ++underline++ ==highlight=='), [
		'text',
		'strong',
		'text',
		'emphasis',
		'text',
		'strikethrough',
		'text',
		'underline',
		'text',
		'highlight',
	]);
	deepEqual(parseCompactTaskMarkdown('[[Folder/Note|Label]] [site](https://example.com/a_(b))'), [
		{ type: 'wikilink', target: 'Folder/Note', label: 'Label' },
		{ type: 'text', value: ' ' },
		{
			type: 'markdown-link',
			destination: 'https://example.com/a_(b)',
			label: 'site',
			external: true,
		},
	]);
	deepEqual(parseCompactTaskMarkdown('lelalal [[2026-07-24]] tt'), [
		{ type: 'text', value: 'lelalal ' },
		{ type: 'wikilink', target: '2026-07-24', label: '2026-07-24' },
		{ type: 'text', value: ' tt' },
	]);
	deepEqual(parseCompactTaskMarkdown('[local](Folder/Note.md)'), [{
		type: 'markdown-link',
		destination: 'Folder/Note.md',
		label: 'local',
		external: false,
	}]);
	deepEqual(parseCompactTaskMarkdown('[bad](javascript:alert(1))'), [{
		type: 'text',
		value: '[bad](javascript:alert(1))',
	}]);
	deepEqual(parseCompactTaskMarkdown('[bad](data:text/html,test)'), [{
		type: 'text',
		value: '[bad](data:text/html,test)',
	}]);
	deepEqual(parseCompactTaskMarkdown('C++ and foo++bar++ stay literal; ++valid++ works'), [
		{ type: 'text', value: 'C++ and foo++bar++ stay literal; ' },
		{ type: 'underline', children: [{ type: 'text', value: 'valid' }] },
		{ type: 'text', value: ' works' },
	]);
	for (const value of ['+++foo++', '++foo+++', '++++foo++', '++foo++++']) {
		deepEqual(parseCompactTaskMarkdown(value), [{ type: 'text', value }]);
	}
	deepEqual(nodeTypes('\\*literal\\* \\++literal\\++'), ['text']);
	deepEqual(nodeTypes('\\==literal\\== ==shown=='), ['text', 'highlight']);
	deepEqual(parseCompactTaskMarkdown('`==not highlighted==` [==link==](https://example.com)'), [
		{ type: 'code', value: '==not highlighted==' },
		{ type: 'text', value: ' ' },
		{
			type: 'markdown-link',
			destination: 'https://example.com',
			label: '==link==',
			external: true,
		},
	]);
	deepEqual(
		parseCompactTaskMarkdown('==[Label](https://example.com/?q==v)=='),
		[{
			type: 'highlight',
			children: [{
				type: 'markdown-link',
				destination: 'https://example.com/?q==v',
				label: 'Label',
				external: true,
			}],
		}],
	);
	deepEqual(nodeTypes('==**bold**=='), ['highlight']);
	equal(flatten(parseCompactTaskMarkdown('==**bold**==')), 'bold');
	for (const value of [
		'**https://example.com/path**',
		'**see https://example.com/path**',
		'++https://example.com/path++',
		'==https://example.com/path==',
	]) {
		equal(nodeTypes(value)[0], value.startsWith('**') ? 'strong' : value.startsWith('++') ? 'underline' : 'highlight');
	}
	for (const value of ['===foo==', '==foo===', '====foo==', '==foo====']) {
		deepEqual(parseCompactTaskMarkdown(value), [{ type: 'text', value }]);
	}
	deepEqual(nodeTypes('**unclosed ++empty++ ~~ ~~'), ['text', 'underline', 'text']);
	deepEqual(parseCompactTaskMarkdown('`**not bold** [[not-link]] ++not underline++`'), [{
		type: 'code',
		value: '**not bold** [[not-link]] ++not underline++',
	}]);
	deepEqual(parseCompactTaskMarkdown('https://example.com/++raw++'), [{
		type: 'text',
		value: 'https://example.com/++raw++',
	}]);
	deepEqual(parseCompactTaskMarkdown('<https://example.com/++raw++>'), [{
		type: 'text',
		value: '<https://example.com/++raw++>',
	}]);
	deepEqual(nodeTypes('**bold and _italic_**'), ['strong']);
	equal(flatten(parseCompactTaskMarkdown('**bold and _italic_**')), 'bold and italic');

	const tooltip = createContainer();
	const tooltipResult = renderCompactTaskMarkdown(tooltip as unknown as HTMLElement, {
		value: 'See [site](https://example.com), [[Note|note]], and ==highlight==',
		mode: 'tooltip',
	});
	deepEqual(tooltipResult, { formatted: true, hasLinks: true });
	equal(tooltip.classList.has('operon-compact-task-markdown--tooltip'), true);
	equal(tooltip.children.some(child => child.tagName === 'A'), false, 'tooltip links must never be anchors');
	equal(tooltip.children.filter(child => child.classList.has('operon-hover-tooltip-link-label')).length, 2);
	equal(tooltip.children.every(child => child.attributes.has('href') === false), true);
	equal(tooltip.children.every(child => child.listeners.size === 0), true);
	equal(
		tooltip.children.some(child =>
			child.tagName === 'MARK'
			&& child.classList.has('operon-compact-task-markdown-highlight')
		),
		true,
	);

	const visualOnly = createContainer();
	renderCompactTaskMarkdown(visualOnly as unknown as HTMLElement, {
		value: '**bold** ++underlined++ ~~struck~~',
		mode: 'visual-only',
	});
	deepEqual(
		visualOnly.children
			.filter(child => child.className)
			.map(child => child.tagName),
		['STRONG', 'SPAN', 'S'],
	);
	equal(
		visualOnly.children.some(child => child.classList.has('operon-compact-task-markdown-underline')),
		true,
	);
	const plain = createContainer();
	const plainResult = renderCompactTaskMarkdown(plain as unknown as HTMLElement, {
		value: 'Plain task text',
		mode: 'visual-only',
	});
	deepEqual(plainResult, { formatted: false, hasLinks: false });
	equal(plain.textContent, 'Plain task text');
	equal(plain.children.length, 0);
	const escaped = createContainer();
	const escapedResult = renderCompactTaskMarkdown(escaped as unknown as HTMLElement, {
		value: String.raw`\*literal\*`,
		mode: 'visual-only',
	});
	deepEqual(escapedResult, { formatted: true, hasLinks: false });
	equal(escaped.children.map(child => child.textContent).join(''), '*literal*');

	console.log(`Compact task Markdown renderer tests passed: ${assertions} assertions`);
}

run();
