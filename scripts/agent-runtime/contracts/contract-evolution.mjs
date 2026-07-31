const BREAKING_CHANGE_KINDS_V1 = new Set([
	'field-removed',
	'field-made-required',
	'field-made-optional',
	'type-narrowed',
	'control-flow-enum-changed',
	'exit-meaning-changed',
	'capability-semantics-changed',
	'error-semantics-changed',
	'deprecation-changed',
	'sealed-plan-input-expanded',
	'authorization-input-expanded',
]);

const ADDITIVE_CHANGE_KINDS_V1 = new Set([
	'optional-response-field-added',
	'optional-schema-entrypoint-added',
	'capability-added',
	'error-code-added',
	'deprecation-announced',
]);

export function classifyContractChangeV1(change) {
	if (!change || typeof change !== 'object' || typeof change.kind !== 'string') {
		throw new Error('CONTRACT_CHANGE_INVALID');
	}
	if (BREAKING_CHANGE_KINDS_V1.has(change.kind)) {
		return Object.freeze({
			classification: 'breaking',
			requiredMajor: change.surface === 'cli' ? 'cli-2.0' : 'runtime-v2',
		});
	}
	if (ADDITIVE_CHANGE_KINDS_V1.has(change.kind)) {
		const review = change.kind === 'capability-added' || change.kind === 'error-code-added'
			? 'safe-default-required'
			: 'compatibility-test-required';
		return Object.freeze({ classification: 'additive', review });
	}
	return Object.freeze({
		classification: 'unclassified',
		review: 'manual-contract-review-required',
	});
}

export function classifyContractDiffV1(before, after, options = {}) {
	if (!isRecord(before) || !isRecord(after)) throw new Error('CONTRACT_SNAPSHOT_INVALID');
	const changes = [];
	const {
		errorRegistry: _beforeErrorRegistry,
		capabilities: _beforeCapabilities,
		entrypoints: _beforeEntrypoints,
		exitCodes: _beforeExitCodes,
		deprecations: _beforeDeprecations,
		...beforeSchema
	} = before;
	const {
		errorRegistry: _afterErrorRegistry,
		capabilities: _afterCapabilities,
		entrypoints: _afterEntrypoints,
		exitCodes: _afterExitCodes,
		deprecations: _afterDeprecations,
		...afterSchema
	} = after;
	compareSchemaNode(beforeSchema, afterSchema, '', changes, options);
	compareNamedRegistry(before.errorRegistry, after.errorRegistry, 'error', changes);
	compareNamedRegistry(before.capabilities, after.capabilities, 'capability', changes);
	compareEntrypoints(before.entrypoints, after.entrypoints, changes);
	compareDeprecationInventory(before.deprecations, after.deprecations, changes);
	if (
		before.exitCodes !== undefined
		&& JSON.stringify(before.exitCodes) !== JSON.stringify(after.exitCodes)
	) changes.push({ kind: 'exit-meaning-changed', path: '/exitCodes' });
	return Object.freeze(changes.map(change => Object.freeze({
		...change,
		...classifyContractChangeV1({ ...change, surface: options.surface }),
	})));
}

function compareSchemaNode(before, after, path, changes, options = {}) {
	if (!isRecord(before) || !isRecord(after)) {
		if (schemaValueChanged(before, after)) {
			changes.push({ kind: 'schema-keyword-changed', path: path || '/' });
		}
		return;
	}
	if (schemaValueChanged(before.type, after.type)) {
		changes.push({ kind: 'type-narrowed', path: path || '/' });
	}
	if (Array.isArray(before.enum) && Array.isArray(after.enum)) {
		if (!sameJsonSet(before.enum, after.enum)) {
			changes.push({ kind: 'control-flow-enum-changed', path: path || '/' });
		}
	}
	if (
		Object.prototype.hasOwnProperty.call(before, 'const')
		&& JSON.stringify(before.const) !== JSON.stringify(after.const)
	) {
		changes.push({ kind: 'control-flow-enum-changed', path: `${path || ''}/const` });
	}
	for (const keyword of ['pattern', 'format', 'additionalProperties']) {
		if (
			Object.prototype.hasOwnProperty.call(before, keyword)
			&& JSON.stringify(before[keyword]) !== JSON.stringify(after[keyword])
		) changes.push({ kind: 'type-narrowed', path: `${path || ''}/${keyword}` });
	}
	for (const keyword of ['minimum', 'exclusiveMinimum', 'minLength', 'minItems', 'minProperties']) {
		if (
			typeof before[keyword] === 'number'
			&& typeof after[keyword] === 'number'
			&& after[keyword] > before[keyword]
		) changes.push({ kind: 'type-narrowed', path: `${path || ''}/${keyword}` });
	}
	for (const keyword of ['maximum', 'exclusiveMaximum', 'maxLength', 'maxItems', 'maxProperties']) {
		if (
			typeof before[keyword] === 'number'
			&& typeof after[keyword] === 'number'
			&& after[keyword] < before[keyword]
		) changes.push({ kind: 'type-narrowed', path: `${path || ''}/${keyword}` });
	}
	const beforeRequired = new Set(Array.isArray(before.required) ? before.required : []);
	const afterRequired = new Set(Array.isArray(after.required) ? after.required : []);
	for (const field of afterRequired) {
		if (!beforeRequired.has(field)) changes.push({ kind: 'field-made-required', path: `${path}/${field}` });
	}
	for (const field of beforeRequired) {
		if (!afterRequired.has(field)) changes.push({ kind: 'field-made-optional', path: `${path}/${field}` });
	}
	if (isRecord(before.properties) && isRecord(after.properties)) {
		for (const [field, value] of Object.entries(before.properties)) {
			if (!(field in after.properties)) {
				changes.push({ kind: 'field-removed', path: `${path}/${field}` });
				continue;
			}
			compareSchemaNode(value, after.properties[field], `${path}/${field}`, changes, options);
		}
		for (const field of Object.keys(after.properties)) {
			if (!(field in before.properties)) {
				const direction = resolveDirection(options, path || '/');
				changes.push({
					kind: direction === 'response'
						? 'optional-response-field-added'
						: direction === 'input'
							? 'authorization-input-expanded'
							: 'direction-unknown-field-added',
					path: `${path}/${field}`,
				});
			}
		}
	}
	for (const keyword of ['$defs', 'patternProperties', 'dependentSchemas']) {
		compareSchemaMap(before[keyword], after[keyword], `${path}/${keyword}`, changes, options);
	}
	for (const keyword of ['items', 'contains', 'not', 'if', 'then', 'else', 'propertyNames']) {
		if (isRecord(before[keyword]) && isRecord(after[keyword])) {
			compareSchemaNode(before[keyword], after[keyword], `${path}/${keyword}`, changes, options);
		} else if (schemaValueChanged(before[keyword], after[keyword])) {
			changes.push({ kind: 'type-narrowed', path: `${path}/${keyword}` });
		}
	}
	for (const keyword of ['allOf', 'anyOf', 'oneOf', 'prefixItems']) {
		compareSchemaArray(before[keyword], after[keyword], `${path}/${keyword}`, changes, options);
	}
	if (
		Array.isArray(before['x-operon-knownValues'])
		&& Array.isArray(after['x-operon-knownValues'])
		&& !before['x-operon-knownValues'].every(value => (
			after['x-operon-knownValues'].some(candidate => JSON.stringify(candidate) === JSON.stringify(value))
		))
	) {
		changes.push({ kind: 'schema-keyword-changed', path: `${path || ''}/x-operon-knownValues` });
	}
	const handledKeywords = new Set([
		'type', 'enum', 'const', 'pattern', 'format', 'additionalProperties',
		'minimum', 'exclusiveMinimum', 'minLength', 'minItems', 'minProperties',
		'maximum', 'exclusiveMaximum', 'maxLength', 'maxItems', 'maxProperties',
		'required', 'properties', '$defs', 'patternProperties', 'dependentSchemas',
		'items', 'contains', 'not', 'if', 'then', 'else', 'propertyNames',
		'allOf', 'anyOf', 'oneOf', 'prefixItems',
		'x-operon-knownValues',
	]);
	for (const keyword of new Set([...Object.keys(before), ...Object.keys(after)])) {
		if (
			!handledKeywords.has(keyword)
			&& JSON.stringify(before[keyword]) !== JSON.stringify(after[keyword])
		) changes.push({ kind: 'schema-keyword-changed', path: `${path || ''}/${keyword}` });
	}
}

function compareSchemaMap(before, after, path, changes, options) {
	if (!isRecord(before) || !isRecord(after)) {
		if (schemaValueChanged(before, after)) changes.push({ kind: 'type-narrowed', path });
		return;
	}
	for (const [key, value] of Object.entries(before)) {
		if (!(key in after)) {
			changes.push({ kind: 'field-removed', path: `${path}/${key}` });
		} else {
			compareSchemaNode(value, after[key], `${path}/${key}`, changes, options);
		}
	}
	for (const key of Object.keys(after)) {
		if (!(key in before)) {
			changes.push({ kind: 'schema-keyword-changed', path: `${path}/${key}` });
		}
	}
}

function compareSchemaArray(before, after, path, changes, options) {
	if (!Array.isArray(before) || !Array.isArray(after)) {
		if (schemaValueChanged(before, after)) changes.push({ kind: 'type-narrowed', path });
		return;
	}
	if (before.length !== after.length) {
		changes.push({ kind: 'type-narrowed', path });
		return;
	}
	for (let index = 0; index < before.length; index += 1) {
		compareSchemaNode(before[index], after[index], `${path}/${index}`, changes, options);
	}
}

function schemaValueChanged(before, after) {
	if (before === undefined && after === undefined) return false;
	return JSON.stringify(before) !== JSON.stringify(after);
}

function sameJsonSet(before, after) {
	if (before.length !== after.length) return false;
	const right = new Set(after.map(value => JSON.stringify(value)));
	return before.every(value => right.has(JSON.stringify(value)));
}

function compareNamedRegistry(before, after, kind, changes) {
	if (!Array.isArray(before)) return;
	if (!Array.isArray(after)) {
		changes.push({
			kind: kind === 'error' ? 'error-semantics-changed' : 'capability-semantics-changed',
			path: `/${kind}`,
		});
		return;
	}
	const next = new Map(after.map(entry => [entry?.code ?? entry?.id, entry]));
	for (const entry of before) {
		const key = entry?.code ?? entry?.id;
		const nextEntry = next.get(key);
		if (!nextEntry) {
			changes.push({
				kind: kind === 'error' ? 'error-semantics-changed' : 'capability-semantics-changed',
				path: `/${kind}/${key ?? 'unknown'}`,
			});
			continue;
		}
		const beforeDeprecation = entry?.deprecation;
		const afterDeprecation = nextEntry?.deprecation;
		if (
			JSON.stringify(withoutDeprecation(entry))
			!== JSON.stringify(withoutDeprecation(nextEntry))
		) {
			changes.push({
				kind: kind === 'error' ? 'error-semantics-changed' : 'capability-semantics-changed',
				path: `/${kind}/${key ?? 'unknown'}`,
			});
		} else if (beforeDeprecation === undefined && afterDeprecation !== undefined) {
			changes.push({
				kind: 'deprecation-announced',
				path: `/${kind}/${key ?? 'unknown'}/deprecation`,
			});
		} else if (JSON.stringify(beforeDeprecation) !== JSON.stringify(afterDeprecation)) {
			changes.push({
				kind: 'deprecation-changed',
				path: `/${kind}/${key ?? 'unknown'}/deprecation`,
			});
		}
	}
	const previous = new Set(before.map(entry => entry?.code ?? entry?.id));
	for (const entry of after) {
		const key = entry?.code ?? entry?.id;
		if (!previous.has(key)) {
			changes.push({
				kind: kind === 'error' ? 'error-code-added' : 'capability-added',
				path: `/${kind}/${key ?? 'unknown'}`,
			});
		}
	}
}

function compareDeprecationInventory(before, after, changes) {
	if (!Array.isArray(before)) return;
	if (!Array.isArray(after)) {
		changes.push({
			kind: 'deprecation-changed',
			path: '/deprecations',
		});
		return;
	}
	const previous = new Set(before.map(entry => JSON.stringify(entry)));
	const next = new Set(after.map(entry => JSON.stringify(entry)));
	for (const entry of previous) {
		if (!next.has(entry)) {
			changes.push({
				kind: 'deprecation-changed',
				path: '/deprecations',
			});
		}
	}
	for (const entry of next) {
		if (!previous.has(entry)) {
			changes.push({
				kind: 'deprecation-announced',
				path: '/deprecations',
			});
		}
	}
}

function withoutDeprecation(value) {
	if (!isRecord(value)) return value;
	const { deprecation: _deprecation, ...rest } = value;
	return rest;
}

function resolveDirection(options, path) {
	if (typeof options.directionForPath === 'function') {
		const resolved = options.directionForPath(path);
		if (resolved === 'input' || resolved === 'response') return resolved;
		return undefined;
	}
	return options.direction;
}

function compareEntrypoints(before, after, changes) {
	if (!Array.isArray(before)) return;
	if (!Array.isArray(after)) {
		changes.push({
			kind: 'field-removed',
			path: '/entrypoints',
		});
		return;
	}
	const next = new Map(after.map(entry => [entry?.schemaId, entry]));
	for (const entry of before) {
		if (
			!next.has(entry?.schemaId)
			|| next.get(entry?.schemaId)?.ref !== entry?.ref
		) changes.push({ kind: 'field-removed', path: `/entrypoints/${entry?.schemaId ?? 'unknown'}` });
	}
	const previous = new Set(before.map(entry => entry?.schemaId));
	for (const entry of after) {
		if (!previous.has(entry?.schemaId)) {
			changes.push({ kind: 'optional-schema-entrypoint-added', path: `/entrypoints/${entry?.schemaId}` });
		}
	}
}

function isRecord(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
