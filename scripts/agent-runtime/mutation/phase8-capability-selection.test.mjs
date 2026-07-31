import assert from 'node:assert/strict';
import test from 'node:test';
import {
	PHASE8_MUTATION_FAMILIES,
	assertPhase8CompletionFamilies,
	selectPhase8MutationFamilies,
} from './phase8-capability-selection.mjs';

test('published acceptance derives complete preview/apply families from Runtime advertisements', () => {
	const advertisements = advertiseAll('contract-only');
	setFamily(advertisements, 'update', 'available');
	setFamily(advertisements, 'timer', 'degraded');
	setFamily(advertisements, 'conversion', 'unavailable');
	const selected = selectPhase8MutationFamilies(advertisements);
	assert.deepEqual(selected.published, ['update', 'timer']);
	assert.deepEqual(selected.refused, ['reminder', 'transition', 'relocation', 'delete']);
	assert.deepEqual(selected.unavailable, [{
		family: 'conversion',
		preview: 'unavailable',
		apply: 'unavailable',
	}]);
});

test('strict completion requires all seven families and no refused or unavailable pair', () => {
	const complete = advertiseAll('available');
	assert.deepEqual(assertPhase8CompletionFamilies(complete), {
		published: ['update', 'reminder', 'transition', 'timer', 'relocation', 'conversion', 'delete'],
		refused: [],
		unavailable: [],
	});
	const incomplete = advertiseAll('available');
	setFamily(incomplete, 'conversion', 'contract-only');
	assert.throws(
		() => assertPhase8CompletionFamilies(incomplete),
		/tasks\.convert\.preview must be exactly available/u,
	);
	const degraded = advertiseAll('available');
	setFamily(degraded, 'timer', 'degraded');
	assert.throws(
		() => assertPhase8CompletionFamilies(degraded),
		/timers\.control\.preview must be exactly available/u,
	);
});

test('published acceptance rejects half-published mutation families', () => {
	const advertisements = advertiseAll('contract-only');
	const update = PHASE8_MUTATION_FAMILIES.find(item => item.key === 'update');
	assert.ok(update);
	advertisements.find(item => item.id === update.preview).availability = 'available';
	assert.throws(
		() => selectPhase8MutationFamilies(advertisements),
		/update preview\/apply must pass publication gates together/u,
	);
});

test('published acceptance fails closed when an advertisement is missing', () => {
	const advertisements = advertiseAll('contract-only');
	advertisements.pop();
	assert.throws(
		() => selectPhase8MutationFamilies(advertisements),
		/Missing capability advertisement/u,
	);
});

function advertiseAll(availability) {
	return PHASE8_MUTATION_FAMILIES.flatMap(definition => [
		{ id: definition.preview, availability },
		{ id: definition.apply, availability },
	]);
}

function setFamily(advertisements, key, availability) {
	const definition = PHASE8_MUTATION_FAMILIES.find(item => item.key === key);
	assert.ok(definition);
	advertisements.find(item => item.id === definition.preview).availability = availability;
	advertisements.find(item => item.id === definition.apply).availability = availability;
}
