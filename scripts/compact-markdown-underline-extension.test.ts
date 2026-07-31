import assert from 'node:assert/strict';
import {
	findCompactMarkdownUnderlineTokens,
	isCompactMarkdownUnderlineTokenActive,
} from '../src/ui/compact-markdown-underline-extension';

let assertions = 0;

function deepEqual(actual: unknown, expected: unknown, message?: string): void {
	if (message) {
		assert.deepEqual(actual, expected, message);
	} else {
		assert.deepEqual(actual, expected);
	}
	assertions += 1;
}

function equal(actual: unknown, expected: unknown, message?: string): void {
	if (message) {
		assert.equal(actual, expected, message);
	} else {
		assert.equal(actual, expected);
	}
	assertions += 1;
}

function ranges(value: string): Array<[number, number, string]> {
	return findCompactMarkdownUnderlineTokens(value).map(token => [
		token.from,
		token.to,
		value.slice(token.contentFrom, token.contentTo),
	]);
}

deepEqual(ranges('++underlined++'), [[0, 14, 'underlined']]);
deepEqual(ranges('Before ++one++ and ++iki üç++.'), [
	[7, 14, 'one'],
	[19, 29, 'iki üç'],
]);
deepEqual(ranges('C++ and C++20 are not underline'), []);
deepEqual(ranges('word++joined++ and ++joined++word'), []);
deepEqual(ranges('++ leading++ ++trailing ++ ++++'), []);
deepEqual(ranges(String.raw`\++escaped++ but ++shown++`), [[17, 26, 'shown']]);
deepEqual(ranges('`++code++` and ``++more code++`` and ++shown++'), [
	[37, 46, 'shown'],
]);
deepEqual(ranges('[++link label++](https://example.com) and ++shown++'), [
	[42, 51, 'shown'],
]);
deepEqual(ranges('[[target++alias++]] and ++shown++'), [
	[24, 33, 'shown'],
]);
deepEqual(ranges('++text `code ++ marker` tail++'), [
	[0, 30, 'text `code ++ marker` tail'],
]);
deepEqual(ranges('++first++ ++unfinished'), [[0, 9, 'first']]);
deepEqual(ranges('(++Unicode çözüldü++)'), [[1, 20, 'Unicode çözüldü']]);

const token = findCompactMarkdownUnderlineTokens('a ++value++ b')[0];
assert.ok(token);
assertions += 1;
equal(isCompactMarkdownUnderlineTokenActive(token, [{ from: 0, to: 0 }]), false);
equal(isCompactMarkdownUnderlineTokenActive(token, [{ from: 4, to: 4 }]), true);
equal(isCompactMarkdownUnderlineTokenActive(token, [{ from: 0, to: 5 }]), true);
equal(isCompactMarkdownUnderlineTokenActive(token, [{ from: token.to, to: token.to }]), false);
equal(isCompactMarkdownUnderlineTokenActive(token, [{ from: 12, to: 12 }]), false);

console.log(`Compact Markdown underline extension tests passed: ${assertions}`);
