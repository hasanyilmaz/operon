let accessibleLabelCounter = 0;

const RESTRICTED_LABEL_HOST_TAGS = new Set([
	'AREA',
	'BASE',
	'BR',
	'COL',
	'EMBED',
	'HR',
	'IMG',
	'INPUT',
	'LINK',
	'META',
	'PARAM',
	'SELECT',
	'SOURCE',
	'TABLE',
	'TBODY',
	'TD',
	'TEXTAREA',
	'TFOOT',
	'TH',
	'THEAD',
	'TR',
	'TRACK',
	'WBR',
]);

export function setAccessibleLabelWithoutTooltip(target: HTMLElement, label: string): HTMLElement {
	target.removeAttribute('title');
	target.removeAttribute('aria-label');

	const canHostLabel = !RESTRICTED_LABEL_HOST_TAGS.has(target.tagName.toUpperCase());
	let labelEl = canHostLabel
		? target.querySelector<HTMLElement>(':scope > [data-operon-accessible-label="true"]')
		: null;
	const existingLabelId = target.dataset.operonAccessibleLabelId;
	if (!labelEl && existingLabelId) {
		labelEl = target.ownerDocument.getElementById(existingLabelId);
	}
	if (!labelEl) {
		labelEl = target.ownerDocument.win.createSpan();
		labelEl.dataset.operonAccessibleLabel = 'true';
		labelEl.className = 'operon-sr-only';
		if (canHostLabel) {
			target.appendChild(labelEl);
		} else {
			target.insertAdjacentElement('afterend', labelEl);
		}
	}

	if (!labelEl.id) {
		accessibleLabelCounter += 1;
		labelEl.id = `operon-accessible-label-${accessibleLabelCounter}`;
	}
	target.dataset.operonAccessibleLabelId = labelEl.id;

	const normalizedLabel = label.trim();
	labelEl.textContent = normalizedLabel;
	if (normalizedLabel) {
		target.setAttribute('aria-labelledby', labelEl.id);
	} else {
		target.removeAttribute('aria-labelledby');
	}

	return labelEl;
}
