import { InlineTaskCompactChipItem } from '../../types/settings';
import { renderInterfaceIconToggleSection, type InterfaceIconActionToggle } from './interface-editor-ui';

type CompactChipActionToggle = InterfaceIconActionToggle;

export interface CompactChipSettingsRendererOptions {
	containerEl: HTMLElement;
	layout?: 'legacy' | 'row-list';
	description: string;
	toggleTitle: string;
	iconOnlyTitle?: string;
	reorderTitle: string;
	moveUpLabel: string;
	moveDownLabel: string;
	getItems: () => InlineTaskCompactChipItem[];
	setItems: (items: InlineTaskCompactChipItem[]) => void;
	getLabel: (key: InlineTaskCompactChipItem['key']) => string;
	getIcon: (key: InlineTaskCompactChipItem['key']) => string;
	save: () => Promise<void>;
	getActionToggles?: () => CompactChipActionToggle[];
	actionTogglesTitle?: string;
	iconOnlyButtonLabel?: string;
	descriptionSearchTargetId?: string;
	getCanonicalLabel?: (key: InlineTaskCompactChipItem['key']) => string;
	getVisibilityToggleLabel?: (label: string) => string;
	getIconOnlyToggleLabel?: (label: string) => string;
}

export function renderCompactChipSettingsSection(options: CompactChipSettingsRendererOptions): void {
	renderInterfaceIconToggleSection({
		...options,
		visibilityErrorContext: 'compact chip settings toggle failed',
		iconOnlyErrorContext: 'compact chip icon-only toggle failed',
		actionErrorContext: 'compact chip action toggle failed',
	});
}
