export interface TimedGridVisualLayoutSegment {
	dayIndex: number;
	startMinutes: number;
	endMinutes: number;
	visualLayer?: TimedGridVisualLayer;
}

export type TimedGridVisualLayer = 'primary' | 'availability';

export interface TimedGridVisualLayout {
	visualLayer: TimedGridVisualLayer;
	visualLeftRatio: number;
	visualWidthRatio: number;
	visualStackIndex: number;
	visualOverlapGroupSize: number;
	visualInsetLevel: number;
	visualEndOccluded: boolean;
	visualHoverRaiseEligible: boolean;
	visualAvailabilityLayer: boolean;
}

export type TimedGridVisualLayoutPlacement<T extends TimedGridVisualLayoutSegment> = T & TimedGridVisualLayout;

const TIMED_GRID_CASCADE_INSET_RATIO = 0.055;
const TIMED_GRID_MAX_CASCADE_LEFT_RATIO = 0.28;
const TIMED_GRID_RATIO_EPSILON = 0.0001;
const TIMED_GRID_PRIMARY_LAYER_RATIO = 0.78;
const TIMED_GRID_AVAILABILITY_LAYER_RATIO = 1 - TIMED_GRID_PRIMARY_LAYER_RATIO;

export function buildTimedGridVisualLayout<T extends TimedGridVisualLayoutSegment>(
	segments: T[],
): TimedGridVisualLayoutPlacement<T>[] {
	const indexed = segments.map((segment, index) => ({ segment, index }));
	const perDay = new Map<number, Array<{ segment: T; index: number }>>();
	for (const entry of indexed) {
		const list = perDay.get(entry.segment.dayIndex) ?? [];
		list.push(entry);
		perDay.set(entry.segment.dayIndex, list);
	}

	const placements: TimedGridVisualLayoutPlacement<T>[] = [];
	for (const daySegments of perDay.values()) {
		placements.push(...layoutTimedGridVisualDay(daySegments));
	}
	return placements.sort((left, right) => {
		if (left.dayIndex !== right.dayIndex) return left.dayIndex - right.dayIndex;
		if (left.startMinutes !== right.startMinutes) return left.startMinutes - right.startMinutes;
		if (left.endMinutes !== right.endMinutes) return left.endMinutes - right.endMinutes;
		return left.visualStackIndex - right.visualStackIndex;
	});
}

function layoutTimedGridVisualDay<T extends TimedGridVisualLayoutSegment>(
	entries: Array<{ segment: T; index: number }>,
): TimedGridVisualLayoutPlacement<T>[] {
	const sorted = [...entries].sort((left, right) => {
		if (left.segment.startMinutes !== right.segment.startMinutes) {
			return left.segment.startMinutes - right.segment.startMinutes;
		}
		if (left.segment.endMinutes !== right.segment.endMinutes) {
			return right.segment.endMinutes - left.segment.endMinutes;
		}
		return left.index - right.index;
	});

	const placements: TimedGridVisualLayoutPlacement<T>[] = [];
	let cluster: Array<{ segment: T; index: number }> = [];
	let clusterMaxEnd = -1;

	const flushCluster = (): void => {
		if (cluster.length === 0) return;
		placements.push(...layoutTimedGridVisualCluster(cluster));
		cluster = [];
		clusterMaxEnd = -1;
	};

	for (const entry of sorted) {
		if (cluster.length > 0 && entry.segment.startMinutes >= clusterMaxEnd) {
			flushCluster();
		}
		cluster.push(entry);
		clusterMaxEnd = Math.max(clusterMaxEnd, entry.segment.endMinutes);
	}
	flushCluster();
	return placements;
}

function layoutTimedGridVisualCluster<T extends TimedGridVisualLayoutSegment>(
	cluster: Array<{ segment: T; index: number }>,
): TimedGridVisualLayoutPlacement<T>[] {
	const hasPrimarySegments = cluster.some(entry => resolveTimedGridVisualLayer(entry.segment) === 'primary');
	const hasAvailabilitySegments = cluster.some(entry => resolveTimedGridVisualLayer(entry.segment) === 'availability');
	if (hasPrimarySegments && hasAvailabilitySegments) {
		return layoutMixedTimedGridVisualCluster(cluster);
	}

	if (cluster.length === 1) {
		return [{
			...cluster[0].segment,
			visualLayer: resolveTimedGridVisualLayer(cluster[0].segment),
			visualLeftRatio: 0,
			visualWidthRatio: 1,
			visualStackIndex: 1,
			visualOverlapGroupSize: 1,
			visualInsetLevel: 0,
			visualEndOccluded: false,
			visualHoverRaiseEligible: false,
			visualAvailabilityLayer: false,
		}];
	}

	const groups = new Map<number, Array<{ segment: T; index: number }>>();
	for (const entry of cluster) {
		const list = groups.get(entry.segment.startMinutes) ?? [];
		list.push(entry);
		groups.set(entry.segment.startMinutes, list);
	}

	const sortedGroups = [...groups.entries()].sort((left, right) => left[0] - right[0]);
	const placements: TimedGridVisualLayoutPlacement<T>[] = [];
	const depthEnds: number[] = [];
	for (let groupOrder = 0; groupOrder < sortedGroups.length; groupOrder++) {
		const [startMinutes, group] = sortedGroups[groupOrder];
		const sortedGroup = [...group].sort((left, right) => {
			if (left.segment.endMinutes !== right.segment.endMinutes) {
				return right.segment.endMinutes - left.segment.endMinutes;
			}
			return left.index - right.index;
		});
		let depth = 0;
		while (depth < depthEnds.length && depthEnds[depth] > startMinutes) {
			depth += 1;
		}
		depthEnds[depth] = Math.max(
			depthEnds[depth] ?? -1,
			...sortedGroup.map(entry => entry.segment.endMinutes),
		);
		const groupLeft = Math.min(
			depth * TIMED_GRID_CASCADE_INSET_RATIO,
			TIMED_GRID_MAX_CASCADE_LEFT_RATIO,
		);
		const groupWidth = Math.max(0.01, 1 - groupLeft);
		const laneWidth = groupWidth / Math.max(1, sortedGroup.length);
		for (let lane = 0; lane < sortedGroup.length; lane++) {
			placements.push({
				...sortedGroup[lane].segment,
				visualLayer: resolveTimedGridVisualLayer(sortedGroup[lane].segment),
				visualLeftRatio: groupLeft + (lane * laneWidth),
				visualWidthRatio: laneWidth,
				visualStackIndex: (groupOrder * 10) + lane + 1,
				visualOverlapGroupSize: cluster.length,
				visualInsetLevel: depth,
				visualEndOccluded: false,
				visualHoverRaiseEligible: false,
				visualAvailabilityLayer: false,
			});
		}
	}
	markVisualEndOcclusion(placements);
	markVisualHoverRaiseEligibility(placements);
	return placements;
}

function layoutMixedTimedGridVisualCluster<T extends TimedGridVisualLayoutSegment>(
	cluster: Array<{ segment: T; index: number }>,
): TimedGridVisualLayoutPlacement<T>[] {
	const primaryEntries = cluster.filter(entry => resolveTimedGridVisualLayer(entry.segment) === 'primary');
	const availabilityEntries = cluster.filter(entry => resolveTimedGridVisualLayer(entry.segment) === 'availability');
	const availabilityPlacements = distributeAvailabilityLayerWidths(
		layoutTimedGridVisualDay(availabilityEntries).map(placement => ({
			...placement,
			visualLeftRatio: 0,
			visualWidthRatio: 1,
			visualAvailabilityLayer: true,
		})),
	);
	const maxAvailabilityStackIndex = availabilityPlacements.reduce(
		(max, placement) => Math.max(max, placement.visualStackIndex),
		0,
	);
	const primaryPlacements = layoutTimedGridVisualDay(primaryEntries).map(placement => ({
		...placement,
		visualLeftRatio: placement.visualLeftRatio * TIMED_GRID_PRIMARY_LAYER_RATIO,
		visualWidthRatio: placement.visualWidthRatio * TIMED_GRID_PRIMARY_LAYER_RATIO,
		visualStackIndex: maxAvailabilityStackIndex + placement.visualStackIndex,
		visualAvailabilityLayer: false,
	}));
	return [...primaryPlacements, ...availabilityPlacements];
}

function distributeAvailabilityLayerWidths<T extends TimedGridVisualLayoutSegment>(
	placements: TimedGridVisualLayoutPlacement<T>[],
): TimedGridVisualLayoutPlacement<T>[] {
	const result = placements.map(placement => ({ ...placement }));
	const sorted = [...result].sort((left, right) => {
		if (left.startMinutes !== right.startMinutes) return left.startMinutes - right.startMinutes;
		if (left.endMinutes !== right.endMinutes) return right.endMinutes - left.endMinutes;
		return left.visualStackIndex - right.visualStackIndex;
	});
	let cluster: Array<TimedGridVisualLayoutPlacement<T>> = [];
	let clusterMaxEnd = -1;

	const flushCluster = (): void => {
		if (cluster.length <= 1) {
			cluster = [];
			clusterMaxEnd = -1;
			return;
		}
		const byStack = [...cluster].sort((left, right) => {
			if (left.visualStackIndex !== right.visualStackIndex) return left.visualStackIndex - right.visualStackIndex;
			if (left.startMinutes !== right.startMinutes) return left.startMinutes - right.startMinutes;
			return right.endMinutes - left.endMinutes;
		});
		const count = byStack.length;
		for (let index = 0; index < count; index++) {
			const visibleBandShare = (count - index) / count;
			byStack[index].visualLeftRatio = 0;
			byStack[index].visualWidthRatio = TIMED_GRID_PRIMARY_LAYER_RATIO + (TIMED_GRID_AVAILABILITY_LAYER_RATIO * visibleBandShare);
		}
		cluster = [];
		clusterMaxEnd = -1;
	};

	for (const placement of sorted) {
		if (cluster.length > 0 && placement.startMinutes >= clusterMaxEnd) {
			flushCluster();
		}
		cluster.push(placement);
		clusterMaxEnd = Math.max(clusterMaxEnd, placement.endMinutes);
	}
	flushCluster();

	return result;
}

function resolveTimedGridVisualLayer(segment: TimedGridVisualLayoutSegment): TimedGridVisualLayer {
	return segment.visualLayer === 'availability' ? 'availability' : 'primary';
}

function markVisualEndOcclusion<T extends TimedGridVisualLayoutSegment>(
	placements: TimedGridVisualLayoutPlacement<T>[],
): void {
	for (const placement of placements) {
		const placementLeft = placement.visualLeftRatio;
		const placementRight = placement.visualLeftRatio + placement.visualWidthRatio;
		placement.visualEndOccluded = placements.some(other => {
			if (other === placement) return false;
			if (other.visualStackIndex <= placement.visualStackIndex) return false;
			if (other.startMinutes >= placement.endMinutes) return false;
			if (other.endMinutes <= placement.endMinutes) return false;
			const otherLeft = other.visualLeftRatio;
			const otherRight = other.visualLeftRatio + other.visualWidthRatio;
			return otherLeft < placementRight - TIMED_GRID_RATIO_EPSILON
				&& otherRight > placementLeft + TIMED_GRID_RATIO_EPSILON;
		});
	}
}

function markVisualHoverRaiseEligibility<T extends TimedGridVisualLayoutSegment>(
	placements: TimedGridVisualLayoutPlacement<T>[],
): void {
	for (const placement of placements) {
		placement.visualHoverRaiseEligible = placement.visualInsetLevel > 0 && (
			placement.visualEndOccluded
			|| placements.some(other => isEarlierIndentedSameEndPlacement(placement, other))
		);
	}
}

function isEarlierIndentedSameEndPlacement<T extends TimedGridVisualLayoutSegment>(
	placement: TimedGridVisualLayoutPlacement<T>,
	other: TimedGridVisualLayoutPlacement<T>,
): boolean {
	if (other === placement) return false;
	if (placement.visualInsetLevel <= 0 || other.visualInsetLevel <= 0) return false;
	if (placement.visualInsetLevel === other.visualInsetLevel) return false;
	if (placement.endMinutes !== other.endMinutes) return false;
	if (placement.startMinutes >= other.startMinutes) return false;
	return other.startMinutes < placement.endMinutes;
}
