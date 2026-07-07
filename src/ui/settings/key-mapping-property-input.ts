import { buildKeyMappingVisiblePropertyNameUpdate, type KeyMapping } from '../../types/settings';
import { settingsAsyncHandler } from './async-settings-action';

export interface KeyMappingPropertyInputBindingOptions {
	inputEl: HTMLInputElement;
	canonicalKey: string;
	getKeyMappings: () => readonly KeyMapping[];
	setKeyMappings: (keyMappings: KeyMapping[]) => void;
	saveSettings: () => Promise<void>;
	errorContext?: string;
}

export function bindKeyMappingPropertyInput(options: KeyMappingPropertyInputBindingOptions): void {
	const inputEl = options.inputEl;
	const errorContext = options.errorContext ?? 'settings key mapping property change failed';
	const validatePropertyInput = (): boolean => {
		const result = buildKeyMappingVisiblePropertyNameUpdate(options.getKeyMappings(), options.canonicalKey, inputEl.value);
		const isInvalid = result.status === 'empty' || result.status === 'missing' || result.status === 'duplicate';
		inputEl.toggleClass('is-error', isInvalid);
		return !isInvalid;
	};
	const savePropertyInput = settingsAsyncHandler(errorContext, async () => {
		const result = buildKeyMappingVisiblePropertyNameUpdate(options.getKeyMappings(), options.canonicalKey, inputEl.value);
		switch (result.status) {
			case 'empty':
			case 'missing':
			case 'duplicate':
				inputEl.toggleClass('is-error', true);
				return;
			case 'unchanged':
				inputEl.toggleClass('is-error', false);
				inputEl.value = result.visiblePropertyName;
				return;
			case 'updated':
				inputEl.toggleClass('is-error', false);
				inputEl.value = result.visiblePropertyName;
				options.setKeyMappings(result.keyMappings);
				await options.saveSettings();
		}
	});

	inputEl.addEventListener('input', validatePropertyInput);
	inputEl.addEventListener('change', savePropertyInput);
	inputEl.addEventListener('blur', savePropertyInput);
	inputEl.addEventListener('keydown', event => {
		if (event.key !== 'Enter') return;
		event.preventDefault();
		inputEl.blur();
	});
}
