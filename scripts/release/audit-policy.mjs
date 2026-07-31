import { readFileSync } from 'node:fs';
import path from 'node:path';

function sorted(values) {
	return [...values].sort((left, right) => left.localeCompare(right));
}

function packageNameFromLocation(location) {
	const marker = '/node_modules/';
	const normalized = `/${location.replaceAll('\\', '/')}`;
	const index = normalized.lastIndexOf(marker);
	if (index < 0) return '';
	const tail = normalized.slice(index + marker.length);
	if (!tail.startsWith('@')) return tail.split('/')[0] ?? '';
	return tail.split('/').slice(0, 2).join('/');
}

function parentPackageLocation(location) {
	const normalized = location.replaceAll('\\', '/');
	const marker = '/node_modules/';
	const index = normalized.lastIndexOf(marker);
	return index < 0 ? '' : normalized.slice(0, index);
}

function resolveInstalledDependency(packages, fromLocation, dependencyName) {
	let current = fromLocation;
	while (true) {
		const candidate = current
			? `${current}/node_modules/${dependencyName}`
			: `node_modules/${dependencyName}`;
		if (packages[candidate]) return candidate;
		if (!current) return null;
		current = parentPackageLocation(current);
	}
}

export function developmentDependencyClosure(packageLock, directRoot) {
	const packages = packageLock?.packages;
	if (!packages || typeof packages !== 'object') {
		throw new Error('AUDIT_PACKAGE_LOCK_PACKAGES_INVALID');
	}
	const rootLocation = `node_modules/${directRoot}`;
	if (!packages[rootLocation]) throw new Error('AUDIT_EXCEPTION_ROOT_MISSING');
	const closure = new Set();
	const pending = [rootLocation];
	while (pending.length > 0) {
		const location = pending.pop();
		if (!location || closure.has(location)) continue;
		closure.add(location);
		const entry = packages[location] ?? {};
		const dependencies = {
			...(entry.dependencies ?? {}),
			...(entry.optionalDependencies ?? {}),
		};
		for (const dependencyName of Object.keys(dependencies)) {
			const resolved = resolveInstalledDependency(packages, location, dependencyName);
			if (resolved && !closure.has(resolved)) pending.push(resolved);
		}
	}
	return closure;
}

function auditCounts(report) {
	return report?.metadata?.vulnerabilities;
}

function hasValidAuditCounts(report) {
	const counts = auditCounts(report);
	if (!counts || typeof counts !== 'object') return false;
	const expectedKeys = ['critical', 'high', 'info', 'low', 'moderate', 'total'];
	if (
		JSON.stringify(Object.keys(counts).sort()) !== JSON.stringify(expectedKeys)
		|| expectedKeys.some(key => !Number.isSafeInteger(counts[key]) || counts[key] < 0)
	) return false;
	return counts.total === counts.info + counts.low + counts.moderate + counts.high + counts.critical;
}

function isUnavailableAuditReport(report) {
	return !report
		|| typeof report !== 'object'
		|| Boolean(report.error)
		|| report.auditReportVersion !== 2
		|| !report.vulnerabilities
		|| !hasValidAuditCounts(report);
}

function collectAdvisories(vulnerabilities) {
	const advisories = [];
	for (const vulnerability of Object.values(vulnerabilities)) {
		for (const via of vulnerability.via ?? []) {
			if (!via || typeof via !== 'object' || !Number.isSafeInteger(via.source)) continue;
			advisories.push({ source: via.source, url: via.url });
		}
	}
	return advisories.sort((left, right) => left.source - right.source);
}

function sameJson(left, right) {
	return JSON.stringify(left) === JSON.stringify(right);
}

function runtimeArtifactFailures(rootDir, vulnerabilityNames) {
	const failures = [];
	for (const relativePath of ['main.js', 'packages/operon-cli/dist/operon.mjs']) {
		let text;
		try {
			text = readFileSync(path.join(rootDir, relativePath), 'utf8');
		} catch {
			continue;
		}
		for (const name of vulnerabilityNames) {
			if (text.includes(name)) {
				failures.push(`${relativePath} contains development audit package marker ${name}`);
			}
		}
	}
	return failures;
}

function artifactProvenanceFailures(artifactMetafiles, vulnerabilityNames) {
	const failures = [];
	for (const artifact of ['plugin', 'cli']) {
		const metafile = artifactMetafiles?.[artifact];
		if (!metafile || typeof metafile !== 'object' || !metafile.inputs) {
			failures.push(`${artifact} bundle metafile is unavailable or malformed.`);
			continue;
		}
		for (const inputPath of Object.keys(metafile.inputs)) {
			const packageName = packageNameFromLocation(inputPath);
			if (vulnerabilityNames.includes(packageName)) {
				failures.push(`${artifact} bundle includes development audit package ${packageName}: ${inputPath}.`);
			}
		}
	}
	return failures;
}

function evaluateResolvedDevelopmentPolicy({
	policy,
	productionCounts,
	fullReport,
	packageLock,
	rootPackage,
	cliPackage,
	rootDir,
	artifactMetafiles,
}) {
	const failures = [];
	const development = policy.development;
	const fullCounts = auditCounts(fullReport);
	if (
		Object.keys(fullReport.vulnerabilities).length !== development.maximumVulnerabilities
		|| Object.values(fullCounts).some(count => count !== development.maximumVulnerabilities)
	) {
		failures.push('Development dependency audit must contain zero vulnerabilities.');
	}

	const rootDevDependencies = rootPackage?.devDependencies ?? {};
	const rootProductionDependencies = {
		...(rootPackage?.dependencies ?? {}),
		...(rootPackage?.optionalDependencies ?? {}),
	};
	if (!Object.hasOwn(rootDevDependencies, development.directRoot)) {
		failures.push(`${development.directRoot} must remain a direct development dependency.`);
	}
	if (Object.hasOwn(rootProductionDependencies, development.directRoot)) {
		failures.push(`${development.directRoot} must not enter production dependencies.`);
	}

	const resolved = development.resolvedAdvisory;
	const installedLocations = Object.entries(packageLock?.packages ?? {})
		.filter(([location]) => packageNameFromLocation(location) === resolved.packageName);
	const installedVersions = sorted(new Set(installedLocations.map(([, entry]) => entry.version)));
	const allowedVersions = sorted(resolved.allowedInstalledVersions);
	if (!sameJson(installedVersions, allowedVersions)) {
		failures.push(`${resolved.packageName} installed versions changed: ${installedVersions.join(', ')}.`);
	}
	for (const [location, entry] of installedLocations) {
		if (entry.dev !== true) {
			failures.push(`${resolved.packageName} node is not dev-only in package-lock.json: ${location}.`);
		}
	}

	const forbiddenRuntimePackages = development.forbiddenRuntimePackages;
	const cliRuntimeDependencies = {
		...(cliPackage?.dependencies ?? {}),
		...(cliPackage?.optionalDependencies ?? {}),
	};
	for (const name of forbiddenRuntimePackages) {
		if (Object.hasOwn(cliRuntimeDependencies, name)) {
			failures.push(`operon-cli runtime dependency includes forbidden development package ${name}.`);
		}
	}
	if ((cliPackage?.files ?? []).some(file => file.includes('node_modules'))) {
		failures.push('operon-cli package files must not include node_modules.');
	}
	failures.push(...artifactProvenanceFailures(artifactMetafiles, forbiddenRuntimePackages));
	if (rootDir) failures.push(...runtimeArtifactFailures(rootDir, forbiddenRuntimePackages));

	return failures.length > 0
		? { status: 'mismatch', failures }
		: {
			status: 'accepted-clean',
			failures: [],
			productionVulnerabilities: productionCounts.total,
			developmentVulnerabilities: fullCounts.total,
			directRoot: development.directRoot,
		};
}

export function evaluateReleaseAuditPolicy({
	policy,
	productionReport,
	fullReport,
	packageLock,
	rootPackage,
	cliPackage,
	rootDir,
	artifactMetafiles,
}) {
	if (isUnavailableAuditReport(productionReport)) {
		return { status: 'unavailable', failures: ['Production audit report is unavailable or malformed.'] };
	}
	if (isUnavailableAuditReport(fullReport)) {
		return { status: 'unavailable', failures: ['Full audit report is unavailable or malformed.'] };
	}

	const failures = [];
	const productionCounts = auditCounts(productionReport);
	if (
		Object.keys(productionReport.vulnerabilities).length !== policy.production.maximumVulnerabilities
		|| Object.values(productionCounts).some(count => count !== policy.production.maximumVulnerabilities)
	) {
		failures.push('Production dependency audit must contain zero vulnerabilities.');
	}
	if (policy.policyVersion === 2) {
		const resolved = evaluateResolvedDevelopmentPolicy({
			policy,
			productionCounts,
			fullReport,
			packageLock,
			rootPackage,
			cliPackage,
			rootDir,
			artifactMetafiles,
		});
		return failures.length > 0
			? { status: 'mismatch', failures: [...failures, ...resolved.failures] }
			: resolved;
	}

	const exception = policy.developmentException;
	const fullCounts = auditCounts(fullReport);
	if (fullCounts.critical > exception.maximumCritical) {
		failures.push(`Full audit contains ${fullCounts.critical} critical vulnerabilities.`);
	}
	const countNames = sorted([
		...Object.keys(fullCounts),
		...Object.keys(exception.expectedCounts),
	]);
	if (
		new Set(countNames).size !== Object.keys(exception.expectedCounts).length
		|| countNames.some(name => fullCounts[name] !== exception.expectedCounts[name])
	) {
		failures.push(`Full audit counts changed: ${JSON.stringify(fullCounts)}.`);
	}
	const actualNames = sorted(Object.keys(fullReport.vulnerabilities));
	const expectedNames = sorted(exception.vulnerabilityNames);
	if (!sameJson(actualNames, expectedNames)) {
		failures.push(`Full audit vulnerability inventory changed: ${actualNames.join(', ')}.`);
	}
	const requiredNoFixPackages = sorted(exception.requiredNoFixPackages ?? []);
	if (
		requiredNoFixPackages.length === 0
		|| !requiredNoFixPackages.includes(exception.directRoot)
		|| requiredNoFixPackages.some(name => !expectedNames.includes(name))
	) {
		failures.push('Required no-fix package policy is missing or inconsistent.');
	}
	for (const [name, vulnerability] of Object.entries(fullReport.vulnerabilities)) {
		if (vulnerability.severity !== exception.severity) {
			failures.push(`${name} changed severity to ${vulnerability.severity}.`);
		}
		if (requiredNoFixPackages.includes(name) && vulnerability.fixAvailable !== false) {
			failures.push(`${name} fix availability changed.`);
		}
		if (vulnerability.isDirect && name !== exception.directRoot) {
			failures.push(`${name} became an unapproved direct vulnerability.`);
		}
	}
	const directVulnerabilities = Object.entries(fullReport.vulnerabilities)
		.filter(([, vulnerability]) => vulnerability.isDirect)
		.map(([name]) => name);
	if (!sameJson(sorted(directVulnerabilities), [exception.directRoot])) {
		failures.push(`Direct vulnerability roots changed: ${directVulnerabilities.join(', ')}.`);
	}
	const rootVulnerability = fullReport.vulnerabilities[exception.directRoot];
	if (rootVulnerability?.fixAvailable !== exception.rootFixAvailable) {
		failures.push(`${exception.directRoot} fix availability changed.`);
	}
	const actualAdvisories = collectAdvisories(fullReport.vulnerabilities);
	const expectedAdvisories = [...exception.advisories].sort((left, right) => left.source - right.source);
	if (!sameJson(actualAdvisories, expectedAdvisories)) {
		failures.push(`Full audit advisory inventory changed: ${JSON.stringify(actualAdvisories)}.`);
	}
	const advisoryPackages = sorted(Object.entries(fullReport.vulnerabilities)
		.filter(([, vulnerability]) => (vulnerability.via ?? []).some(via => (
			via && typeof via === 'object' && Number.isSafeInteger(via.source)
		)))
		.map(([name]) => name));
	if (advisoryPackages.some(name => !requiredNoFixPackages.includes(name))) {
		failures.push(`Advisory-bearing package lacks a no-fix requirement: ${advisoryPackages.join(', ')}.`);
	}

	const rootDevDependencies = rootPackage?.devDependencies ?? {};
	const rootProductionDependencies = {
		...(rootPackage?.dependencies ?? {}),
		...(rootPackage?.optionalDependencies ?? {}),
	};
	if (!Object.hasOwn(rootDevDependencies, exception.directRoot)) {
		failures.push(`${exception.directRoot} must remain a direct development dependency.`);
	}
	if (Object.hasOwn(rootProductionDependencies, exception.directRoot)) {
		failures.push(`${exception.directRoot} must not enter production dependencies.`);
	}

	let closure = new Set();
	try {
		closure = developmentDependencyClosure(packageLock, exception.directRoot);
	} catch (error) {
		failures.push(error instanceof Error ? error.message : String(error));
	}
	for (const [name, vulnerability] of Object.entries(fullReport.vulnerabilities)) {
		const nodes = vulnerability.nodes ?? [];
		if (nodes.length === 0) {
			failures.push(`${name} audit entry has no installed node to verify.`);
		}
		for (const node of nodes) {
			if (typeof node !== 'string') {
				failures.push(`${name} audit entry contains an invalid installed node.`);
				continue;
			}
			const entry = packageLock?.packages?.[node];
			if (!entry?.dev) failures.push(`${name} node is not dev-only in package-lock.json: ${node}.`);
			if (!closure.has(node)) {
				failures.push(`${name} node is outside the ${exception.directRoot} dependency closure: ${node}.`);
			}
			if (packageNameFromLocation(node) !== name) {
				failures.push(`${name} audit node resolves to a different package: ${node}.`);
			}
		}
	}

	const cliRuntimeDependencies = {
		...(cliPackage?.dependencies ?? {}),
		...(cliPackage?.optionalDependencies ?? {}),
	};
	for (const name of exception.vulnerabilityNames) {
		if (Object.hasOwn(cliRuntimeDependencies, name)) {
			failures.push(`operon-cli runtime dependency includes audit exception package ${name}.`);
		}
	}
	if ((cliPackage?.files ?? []).some(file => file.includes('node_modules'))) {
		failures.push('operon-cli package files must not include node_modules.');
	}
	failures.push(...artifactProvenanceFailures(artifactMetafiles, exception.vulnerabilityNames));
	if (rootDir) failures.push(...runtimeArtifactFailures(rootDir, exception.vulnerabilityNames));

	return failures.length > 0
		? { status: 'mismatch', failures }
		: {
			status: 'accepted-development-exception',
			failures: [],
			productionVulnerabilities: productionCounts.total,
			developmentVulnerabilities: fullCounts.total,
			directRoot: exception.directRoot,
		};
}
