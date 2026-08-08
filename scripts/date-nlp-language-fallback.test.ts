import assert from 'node:assert/strict';
import { resolveDatePickerLanguage } from '../src/ui/field-pickers/date-nlp';

assert.equal(
	resolveDatePickerLanguage('pt-BR'),
	'en',
	'Brazilian Portuguese UI uses English natural-language date parsing',
);

console.log('Date NLP language fallback tests passed: 1 assertion');
