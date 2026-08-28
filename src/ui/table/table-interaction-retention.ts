export interface TableScrollPosition {
	scrollLeft?: number;
	scrollTop?: number;
}

export interface TableScrollTarget {
	scrollLeft: number;
	scrollTop: number;
}

interface ExpectedTableScrollPosition {
	scrollLeft: number | null;
	scrollTop: number | null;
}

export class TableProgrammaticScrollGuard {
	private readonly expectedPositions = new WeakMap<object, ExpectedTableScrollPosition>();

	set(target: TableScrollTarget, position: TableScrollPosition): void {
		if (position.scrollLeft !== undefined) target.scrollLeft = position.scrollLeft;
		if (position.scrollTop !== undefined) target.scrollTop = position.scrollTop;
		const previous = this.expectedPositions.get(target);
		this.expectedPositions.set(target, {
			scrollLeft: position.scrollLeft === undefined
				? previous?.scrollLeft ?? null
				: target.scrollLeft,
			scrollTop: position.scrollTop === undefined
				? previous?.scrollTop ?? null
				: target.scrollTop,
		});
	}

	isExpected(target: TableScrollTarget): boolean {
		const expected = this.expectedPositions.get(target);
		if (!expected) return false;
		const matches = (expected.scrollLeft === null || expected.scrollLeft === target.scrollLeft)
			&& (expected.scrollTop === null || expected.scrollTop === target.scrollTop);
		if (!matches) this.expectedPositions.delete(target);
		return matches;
	}
}

export function resolveTableScrollUiDismissal(
	programmatic: boolean,
	retainActivePickerOnScroll: boolean,
): { blurSearch: boolean; closeActivePicker: boolean } {
	return {
		blurSearch: !programmatic,
		closeActivePicker: !programmatic && !retainActivePickerOnScroll,
	};
}

export function captureTableSearchFocusRange(input: Pick<HTMLInputElement, 'selectionStart' | 'selectionEnd' | 'value'>): {
	start: number;
	end: number;
} {
	return {
		start: input.selectionStart ?? input.value.length,
		end: input.selectionEnd ?? input.value.length,
	};
}

export function shouldReleaseTableSearchFocusLease(input: {
	isConnected: boolean;
	ownerDocument: { activeElement: object | null };
}): boolean {
	return input.isConnected && input.ownerDocument.activeElement !== input;
}
