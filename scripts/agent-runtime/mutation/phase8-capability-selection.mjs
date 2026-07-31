import assert from 'node:assert/strict';

export const PHASE8_MUTATION_FAMILIES = Object.freeze([
	family('update', 'tasks.update', 'task.update'),
	family('reminder', 'tasks.reminder', 'task.reminder-item'),
	family('transition', 'tasks.transition', 'task.transition'),
	family('timer', 'timers.control', 'timer.control'),
	family('relocation', 'tasks.inline.relocate', 'task.inline-relocate'),
	family('conversion', 'tasks.convert', 'task.convert'),
	family('delete', 'tasks.delete', 'task.delete'),
]);

export function selectPhase8MutationFamilies(advertisements) {
	const capabilityMap = new Map(advertisements.map(item => [item.id, item]));
	const published = [];
	const refused = [];
	const unavailable = [];
	for (const definition of PHASE8_MUTATION_FAMILIES) {
		const preview = capabilityMap.get(definition.preview);
		const apply = capabilityMap.get(definition.apply);
		assert.ok(preview, `Missing capability advertisement: ${definition.preview}`);
		assert.ok(apply, `Missing capability advertisement: ${definition.apply}`);
		const previewPublished = isPublished(preview.availability);
		const applyPublished = isPublished(apply.availability);
		assert.equal(
			previewPublished,
			applyPublished,
			`${definition.key} preview/apply must pass publication gates together.`,
		);
		if (previewPublished) {
			published.push(definition.key);
		} else if (
			preview.availability === 'contract-only'
			&& apply.availability === 'contract-only'
		) {
			refused.push(definition.key);
		} else {
			unavailable.push({
				family: definition.key,
				preview: preview.availability,
				apply: apply.availability,
			});
		}
	}
	return Object.freeze({
		published: Object.freeze(published),
		refused: Object.freeze(refused),
		unavailable: Object.freeze(unavailable),
	});
}

export function assertPhase8CompletionFamilies(advertisements) {
	const capabilityMap = new Map(advertisements.map(item => [item.id, item]));
	for (const definition of PHASE8_MUTATION_FAMILIES) {
		assert.equal(
			capabilityMap.get(definition.preview)?.availability,
			'available',
			`${definition.preview} must be exactly available at Phase 8 completion.`,
		);
		assert.equal(
			capabilityMap.get(definition.apply)?.availability,
			'available',
			`${definition.apply} must be exactly available at Phase 8 completion.`,
		);
	}
	const selection = selectPhase8MutationFamilies(advertisements);
	const expected = PHASE8_MUTATION_FAMILIES.map(definition => definition.key);
	assert.deepEqual(
		selection.published,
		expected,
		'Phase 8 completion requires all seven mutation families to be published.',
	);
	assert.deepEqual(selection.refused, [], 'Phase 8 completion cannot retain contract-only families.');
	assert.deepEqual(selection.unavailable, [], 'Phase 8 completion cannot retain unavailable families.');
	return selection;
}

function family(key, capabilityBase, mutationKind) {
	return Object.freeze({
		key,
		preview: `${capabilityBase}.preview`,
		apply: `${capabilityBase}.apply`,
		mutationKind,
	});
}

function isPublished(availability) {
	return availability === 'available' || availability === 'degraded';
}
