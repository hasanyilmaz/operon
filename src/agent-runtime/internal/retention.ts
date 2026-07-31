export interface ExpiringRecordRetentionPlanV1 {
	readonly keysToDelete: string[];
	readonly expiredDeleted: number;
	readonly overflowDeleted: number;
	readonly retained: number;
}

export function planExpiringRecordRetentionV1<T>(input: {
	readonly records: readonly T[];
	readonly now: number;
	readonly maximumRecords: number;
	readonly key: (record: T) => string;
	readonly expiresAt: (record: T) => number;
	readonly compareNewestFirst: (left: T, right: T) => number;
	readonly validate?: (record: T) => void;
}): ExpiringRecordRetentionPlanV1 {
	const expired: T[] = [];
	const live: T[] = [];
	for (const record of input.records) {
		input.validate?.(record);
		(input.expiresAt(record) <= input.now ? expired : live).push(record);
	}
	live.sort(input.compareNewestFirst);
	const overflow = live.slice(input.maximumRecords);
	return {
		keysToDelete: [...expired, ...overflow].map(input.key),
		expiredDeleted: expired.length,
		overflowDeleted: overflow.length,
		retained: live.length - overflow.length,
	};
}
