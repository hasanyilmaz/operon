import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bindTimeInput } from '../src/ui/field-pickers/time-input';

function harness(initial = '1415', timeFormat: '12h' | '24h' = '24h', allowEndOfDay = false) {
	let buffer = initial;
	const handlers = new Map<string, Array<(event: Record<string, unknown>) => void>>();
	const input = {
		value: `${buffer.slice(0, 2)}:${buffer.slice(2)}`, selectionStart: 5, selectionEnd: 5,
		addEventListener(type: string, handler: (event: Record<string, unknown>) => void) {
			handlers.set(type, [...(handlers.get(type) ?? []), handler]);
		},
	};
	bindTimeInput(input as unknown as HTMLInputElement, {
		getBuffer: () => buffer, timeFormat, allowEndOfDay,
		onChange: (value, caret) => { buffer = value; input.value = `${value.slice(0, 2)}:${value.slice(2)}`; input.selectionStart = input.selectionEnd = caret; },
	});
	return {
		input,
		select(start: number, end = start) { input.selectionStart = start; input.selectionEnd = end; },
		fire(type: string, properties: Record<string, unknown> = {}) {
			let prevented = false;
			const event = { data: null, cancelable: true, preventDefault() { prevented = true; }, ...properties };
			for (const handler of handlers.get(type) ?? []) handler(event);
			return prevented;
		},
		buffer: () => buffer,
	};
}

test('backspace clears all four digits from the end, then permits immediate replacement', () => {
	const h = harness();
	for (const expected of ['14:1_', '14:__', '1_:__', '__:__']) {
		h.fire('keydown', { key: 'Backspace' }); assert.equal(h.input.value, expected);
	}
	for (const key of '1343') h.fire('keydown', { key });
	assert.equal(h.input.value, '13:43'); assert.equal(h.input.selectionStart, 5);
});

test('selection deletion, cut and replacement cover full and partial ranges', () => {
	for (const key of ['Backspace', 'Delete']) {
		const h = harness(); h.select(0, 5); h.fire('keydown', { key }); assert.equal(h.buffer(), '____');
	}
	const h = harness(); h.select(3, 5); h.fire('keydown', { key: '4' }); h.fire('keydown', { key: '3' }); assert.equal(h.buffer(), '1443');
	h.select(0, 2); h.fire('beforeinput', { inputType: 'deleteByCut' }); assert.equal(h.buffer(), '__43');
	h.select(0, 2); h.fire('paste', { clipboardData: { getData: () => '13' } }); assert.equal(h.buffer(), '1343');
});

test('deletion respects both boundaries and the separator', () => {
	const h = harness(); h.select(0); h.fire('keydown', { key: 'Backspace' }); assert.equal(h.buffer(), '1415');
	h.select(5); h.fire('keydown', { key: 'Delete' }); assert.equal(h.buffer(), '1415');
	h.select(3); h.fire('keydown', { key: 'Backspace' }); assert.equal(h.buffer(), '1_15');
	h.select(2); h.fire('keydown', { key: 'Delete' }); assert.equal(h.buffer(), '1__5');
});

test('paste accepts formatted or compact time and rejects invalid or overflowing text', () => {
	for (const text of ['13:43', '1343', '１３４３']) {
		const h = harness(); h.select(0, 5); h.fire('paste', { clipboardData: { getData: () => text } }); assert.equal(h.buffer(), '1343');
	}
	for (const text of ['25:00', '14:60', 'hello', '14:15__:__']) {
		const h = harness(); h.select(0, 5); h.fire('paste', { clipboardData: { getData: () => text } }); assert.equal(h.buffer(), '1415');
	}
});

test('mobile beforeinput handles cancellable and noncancellable insertion and deletion', () => {
	for (const cancelable of [true, false]) {
		const h = harness();
		for (let i = 0; i < 4; i++) {
			assert.equal(h.fire('beforeinput', { inputType: 'deleteContentBackward', cancelable }), cancelable);
			if (!cancelable) h.fire('input', { inputType: 'deleteContentBackward' });
		}
		assert.equal(h.buffer(), '____');
		for (const data of '1415') {
			h.fire('keydown', { key: 'Unidentified', keyCode: 229 });
			h.fire('beforeinput', { inputType: 'insertText', data, cancelable });
			if (!cancelable) h.fire('input', { inputType: 'insertText', data });
		}
		assert.equal(h.buffer(), '1415');
	}
});

test('input-only mobile mutation reconciles insertions into the mask and backward deletion', () => {
	const reported = harness('____'); reported.input.value = '14:15__:__'; reported.select(5);
	reported.fire('input', { inputType: 'insertText', data: '14:15' }); assert.equal(reported.buffer(), '1415');
	const h = harness('____'); h.input.value = '1__:__'; h.select(1); h.fire('input', { inputType: 'insertText', data: '1' }); assert.equal(h.buffer(), '1___');
	h.input.value = '14_:__'; h.select(2); h.fire('input', { inputType: 'insertText', data: '4' }); assert.equal(h.buffer(), '14__');
	h.input.value = '14:1__'; h.select(4); h.fire('input', { inputType: 'insertText', data: '1' });
	h.input.value = '14:15_'; h.select(5); h.fire('input', { inputType: 'insertText', data: '5' }); assert.equal(h.buffer(), '1415');
	h.input.value = '14:1'; h.select(4); h.fire('input', { inputType: 'deleteContentBackward' }); assert.equal(h.buffer(), '141_');
});

test('input-only deletion disambiguates repeated digits and full replacement', () => {
	const h = harness('1111'); h.input.value = '1:11'; h.select(0); h.fire('input', { inputType: 'deleteContentForward' }); assert.equal(h.buffer(), '_111');
	h.input.value = '13:43'; h.select(5); h.fire('input', { inputType: 'insertReplacementText' }); assert.equal(h.buffer(), '1343');
});

test('IME remains untouched until composition ends and trailing input is idempotent', () => {
	const h = harness('____'); h.select(0, 5); h.fire('compositionstart');
	h.input.value = '１３:４３'; h.select(5); h.fire('input', { inputType: 'insertCompositionText', isComposing: true });
	assert.equal(h.buffer(), '____'); assert.equal(h.input.value, '１３:４３');
	h.fire('compositionend'); assert.equal(h.buffer(), '1343');
	h.fire('input', { inputType: 'insertCompositionText' }); assert.equal(h.buffer(), '1343');
});

test('12-hour and end-of-day validation are retained', () => {
	for (const [format, allow, text, expected] of [
		['12h', false, '12:52', '1252'], ['12h', false, '13:00', '1100'],
		['24h', false, '24:00', '1100'], ['24h', true, '24:00', '2400'], ['24h', true, '24:01', '1100'],
	] as const) {
		const h = harness('1100', format, allow); h.select(0, 5); h.fire('paste', { clipboardData: { getData: () => text } }); assert.equal(h.buffer(), expected);
	}
});

test('native arrow selection and command shortcuts remain browser-owned', () => {
	const h = harness();
	for (const key of ['ArrowLeft', 'ArrowRight']) assert.equal(h.fire('keydown', { key, shiftKey: true }), false);
	assert.equal(h.fire('keydown', { key: 'a', ctrlKey: true }), false);
});


test('input-only full replacement with shared prefix and separator deletion match keyboard edits', () => {
	const h = harness(); h.input.value = '13:43'; h.select(5);
	h.fire('input', { inputType: 'insertReplacementText' }); assert.equal(h.buffer(), '1343');
	h.input.value = '1343'; h.select(2);
	h.fire('input', { inputType: 'deleteContentBackward' }); assert.equal(h.buffer(), '1_43');
});

test('repeated forward Delete clears digits even as masked slots become empty', () => {
	for (const native of [false, true]) {
		const h = harness(); h.select(0);
		for (let i = 0; i < 4; i++) {
			if (native) {
				const caret = h.input.selectionStart;
				h.input.value = h.input.value.slice(0, caret) + h.input.value.slice(caret + 1);
				h.fire('input', { inputType: 'deleteContentForward' });
			} else h.fire('keydown', { key: 'Delete' });
		}
		assert.equal(h.buffer(), '____');
	}
});

test('generic input events without InputEvent fields retain autofill replacement', () => {
	for (const value of ['13:43', '1343', '１３４３']) {
		const h = harness(); h.input.value = value; h.select(value.length);
		h.fire('input'); assert.equal(h.buffer(), '1343');
	}
	const h = harness(); h.input.value = ''; h.select(0);
	h.fire('input'); assert.equal(h.buffer(), '____');
});

test('input event composition flags work without a preceding compositionstart', () => {
	const h = harness(); h.input.value = '13:43'; h.select(5);
	h.fire('input', { isComposing: true, inputType: 'insertCompositionText' });
	assert.equal(h.buffer(), '1415'); assert.equal(h.input.value, '13:43');
	h.fire('input', { isComposing: false, inputType: 'insertCompositionText' });
	assert.equal(h.buffer(), '1343');
});
