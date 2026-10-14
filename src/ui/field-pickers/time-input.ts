import { isValidTimePrefix } from './datetime-time-grid';

const POSITIONS = [0, 1, 3, 4];
const format = (buffer: string): string => `${buffer.slice(0, 2)}:${buffer.slice(2)}`;

interface TimeInputOptions {
	getBuffer: () => string;
	onChange: (buffer: string, caret: number) => void;
	timeFormat: '12h' | '24h';
	allowEndOfDay?: boolean;
}

interface Edit {
	start: number;
	end: number;
	text: string;
	deletion?: 'backward' | 'forward';
}

/** One edit path for hardware keys, paste, soft keyboards and IME commits. */
export function bindTimeInput(input: HTMLInputElement, options: TimeInputOptions): void {
	let composing = false;
	let compositionValue = '';
	let pending: Edit | null = null;
	input.inputMode = 'numeric';

	const restore = () => { input.value = format(options.getBuffer()); };
	const selection = (): Pick<Edit, 'start' | 'end'> => ({
		start: input.selectionStart ?? 0,
		end: input.selectionEnd ?? input.selectionStart ?? 0,
	});
	const apply = ({ start, end, text, deletion }: Edit) => {
		const digits = options.getBuffer().split('');
		let caret = start;
		if (start === end && deletion) {
			const index = deletion === 'backward'
				? POSITIONS.findLastIndex(position => position < start)
				: POSITIONS.findIndex((position, index) => position >= start && digits[index] !== '_');
			if (index < 0) { restore(); return; }
			digits[index] = '_';
			caret = POSITIONS[index];
		} else {
			for (let index = 0; index < 4; index++) {
				if (POSITIONS[index] >= start && POSITIONS[index] < end) digits[index] = '_';
			}
		}
		if (text) {
			// Normalize full-width digits produced by some mobile input methods.
			const normalized = text.normalize('NFKC').trim();
			if (!/^(?:\d{1,4}|\d{2}:\d{2})$/.test(normalized)) { restore(); return; }
			const inserted = normalized.replace(':', '');
			const first = POSITIONS.findIndex(position => position >= start);
			if (first < 0 || first + inserted.length > 4) { restore(); return; }
			for (let offset = 0; offset < inserted.length; offset++) digits[first + offset] = inserted[offset];
			const last = first + inserted.length;
			const prefix = digits.slice(0, last).join('');
			if (!isValidTimePrefix(prefix, options.timeFormat, options.allowEndOfDay)) { restore(); return; }
			// Changing the hour can invalidate its old suffix (notably 24:00).
			if (!digits.includes('_') && !isValidTimePrefix(digits.join(''), options.timeFormat, options.allowEndOfDay)) {
				for (let index = last; index < 4; index++) digits[index] = '_';
			}
			caret = POSITIONS[last] ?? 5;
		}
		options.onChange(digits.join(''), caret);
	};

	const nativeEdit = (previous: string, inputType = '') => {
		const value = input.value;
		if (/^\d{2}:\d{2}$/.test(value.normalize('NFKC'))) {
			apply({ start: 0, end: 5, text: value });
			return;
		}
		let start = 0;
		// The post-edit caret disambiguates deleting one of two equal digits.
		const limit = input.selectionStart ?? value.length;
		while (start < previous.length && start < value.length && start < limit && previous[start] === value[start]) start++;
		let oldEnd = previous.length;
		let newEnd = value.length;
		while (oldEnd > start && newEnd > start && previous[oldEnd - 1] === value[newEnd - 1]) { oldEnd--; newEnd--; }
		if (newEnd === start && oldEnd === start + 1
			&& (inputType === 'deleteContentBackward' || inputType === 'deleteContentForward')) {
			const caret = inputType === 'deleteContentBackward' ? oldEnd : start;
			apply({ start: caret, end: caret, text: '', deletion: inputType === 'deleteContentBackward' ? 'backward' : 'forward' });
		} else apply({ start, end: oldEnd, text: value.slice(start, newEnd) });
	};

	input.addEventListener('keydown', event => {
		pending = null;
		if (composing || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
		if (event.key === 'Backspace' || event.key === 'Delete' || /^\d$/.test(event.key)) {
			event.preventDefault();
			apply({ ...selection(), text: /^\d$/.test(event.key) ? event.key : '',
				deletion: event.key === 'Backspace' ? 'backward' : event.key === 'Delete' ? 'forward' : undefined });
		}
	});
	input.addEventListener('paste', event => {
		if (composing || !event.clipboardData) return;
		event.preventDefault();
		pending = null;
		apply({ ...selection(), text: event.clipboardData.getData('text/plain') });
	});
	input.addEventListener('beforeinput', event => {
		pending = null;
		if (composing || event.isComposing) return;
		const deletion = event.inputType === 'deleteContentBackward' ? 'backward'
			: event.inputType === 'deleteContentForward' ? 'forward' : undefined;
		const range = selection();
		if (!deletion && !(event.inputType.startsWith('delete') && range.start !== range.end)
			&& !(event.inputType.startsWith('insert') && event.data !== null)) return;
		const edit: Edit = { ...range, text: event.data ?? '', deletion };
		if (event.cancelable) { event.preventDefault(); apply(edit); }
		else pending = edit;
	});
	input.addEventListener('input', event => {
		if (composing || ('isComposing' in event && event.isComposing)) return;
		const edit = pending;
		pending = null;
		if (edit) { apply(edit); return; }
		if (input.value === format(options.getBuffer())) return;
		if ('inputType' in event && typeof event.inputType === 'string' && event.inputType) {
			nativeEdit(format(options.getBuffer()), event.inputType); return;
		}
		// Full-value replacement by autofill, accessibility tools or host integrations.
		const value = input.value.normalize('NFKC').trim();
		const digits = value.replace(':', '');
		if (/^[\d_]{0,4}$/.test(digits)) {
			options.onChange(digits.padEnd(4, '_'), input.selectionStart ?? value.length);
		} else nativeEdit(format(options.getBuffer()));
	});
	input.addEventListener('compositionstart', () => {
		pending = null;
		composing = true;
		compositionValue = format(options.getBuffer());
	});
	input.addEventListener('compositionend', () => {
		composing = false;
		if (input.value !== compositionValue) nativeEdit(compositionValue);
	});
}
