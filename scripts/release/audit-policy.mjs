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

export function bundleDependencyFailures({ bundleMetafile, packageLock }) {
	if (!bundleMetafile?.inputs || !packageLock?.packages) {
		return ['Production bundle dependency evidence is unavailable or malformed.'];
	}
	const packageLocations = Object.keys(packageLock.packages)
		.filter(location => location.includes('node_modules/'))
		.sort((left, right) => right.length - left.length);
	const failures = [];
	for (const input of Object.keys(bundleMetafile.inputs)) {
		const normalized = input.replaceAll('\\', '/');
		const nodeModulesIndex = normalized.indexOf('node_modules/');
		if (nodeModulesIndex < 0) continue;
		const packageInput = normalized.slice(nodeModulesIndex);
		const location = packageLocations.find(candidate => (
			packageInput === candidate || packageInput.startsWith(`${candidate}/`)
		));
		if (!location) {
			failures.push(`Bundle input is absent from package-lock.json: ${packageInput}.`);
			continue;
		}
		if (packageLock.packages[location]?.dev === true) {
			failures.push(`Development-only package entered the production bundle: ${location}.`);
		}
	}
	return failures;
}

export function evaluateReleaseAuditPolicy({ productionReport, bundleMetafile, packageLock }) {
	if (
		!productionReport
		|| typeof productionReport !== 'object'
		|| Boolean(productionReport.error)
		|| productionReport.auditReportVersion !== 2
		|| !productionReport.vulnerabilities
		|| !hasValidAuditCounts(productionReport)
	) {
		return {
			status: 'unavailable',
			failures: ['Production audit report is unavailable or malformed.'],
		};
	}

	const counts = auditCounts(productionReport);
	const failures = bundleDependencyFailures({ bundleMetafile, packageLock });
	if (Object.keys(productionReport.vulnerabilities).length > 0 || counts.total > 0) {
		failures.unshift('Production dependency audit must contain zero vulnerabilities.');
	}
	if (failures.length > 0) {
		return {
			status: 'mismatch',
			failures,
			productionVulnerabilities: counts.total,
		};
	}

	return {
		status: 'accepted-clean',
		failures: [],
		productionVulnerabilities: 0,
	};
}
