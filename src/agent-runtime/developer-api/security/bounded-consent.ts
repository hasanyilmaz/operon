export type BoundedDeveloperConsentDecisionV1 =
	| 'approved'
	| 'denied'
	| 'unavailable';

export interface DeveloperConsentOwnerWindowV1 {
	activeWindow: DeveloperConsentOwnerWindowV1;
	activeDocument: Document;
	focus(): void;
	setTimeout(handler: () => void, timeoutMs: number): number;
	clearTimeout(handle: number): void;
}

export interface BoundedDeveloperConsentOptionsV1 {
	ownerWindow: DeveloperConsentOwnerWindowV1;
	ownerDocument: Document;
	timeoutMs: number;
	show: (onDecision: (confirmed: boolean) => void) => () => void;
}

/**
 * Presents host-owned consent in the plugin's owning window and guarantees that
 * a missing or hidden UI cannot leave a Developer API request pending forever.
 */
export function requestBoundedDeveloperConsentV1(
	options: BoundedDeveloperConsentOptionsV1,
): Promise<BoundedDeveloperConsentDecisionV1> {
	return new Promise(resolve => {
		let settled = false;
		let closePrompt: (() => void) | null = null;
		let openHandle: number | null = null;
		let timeoutHandle: number | null = null;

		const clearTimers = (): void => {
			if (openHandle !== null) options.ownerWindow.clearTimeout(openHandle);
			if (timeoutHandle !== null) options.ownerWindow.clearTimeout(timeoutHandle);
			openHandle = null;
			timeoutHandle = null;
		};
		const settle = (decision: BoundedDeveloperConsentDecisionV1): void => {
			if (settled) return;
			settled = true;
			clearTimers();
			resolve(decision);
		};

		try {
			options.ownerWindow.focus();
		} catch {
			// Some window managers can reject focus requests. Opening still remains
			// useful, and the bounded timeout preserves fail-closed behavior.
		}

		openHandle = options.ownerWindow.setTimeout(() => {
			openHandle = null;
			if (settled) return;
			const previousActiveWindow = options.ownerWindow.activeWindow;
			const previousActiveDocument = options.ownerWindow.activeDocument;
			try {
				// Obsidian's Modal API targets the global active window. A Developer
				// API request can originate from a background vault window, so scope
				// that global only while the modal is constructed and opened.
				options.ownerWindow.activeWindow = options.ownerWindow;
				options.ownerWindow.activeDocument = options.ownerDocument;
				closePrompt = options.show(confirmed => {
					settle(confirmed ? 'approved' : 'denied');
				});
			} catch {
				settle('unavailable');
			} finally {
				options.ownerWindow.activeWindow = previousActiveWindow;
				options.ownerWindow.activeDocument = previousActiveDocument;
			}
		}, 0);
		timeoutHandle = options.ownerWindow.setTimeout(() => {
			if (settled) return;
			settled = true;
			clearTimers();
			try {
				closePrompt?.();
			} finally {
				resolve('unavailable');
			}
		}, options.timeoutMs);
	});
}
