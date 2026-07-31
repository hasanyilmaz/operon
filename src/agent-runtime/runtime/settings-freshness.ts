import {
	structuredErrorV1,
	type StructuredErrorV1,
} from '../contracts/v1/primitives';

export interface RuntimeSettingsFreshnessPortsV1 {
	statFingerprint(): Promise<string>;
	reload(): Promise<{ ok: boolean }>;
}

export type RuntimeSettingsFreshnessResultV1 =
	| {
		ok: true;
		changed: boolean;
		reloadCount: 0 | 1 | 2;
	}
	| {
		ok: false;
		changed: false;
		reloadCount: 0 | 1 | 2;
		error: StructuredErrorV1;
	};

export class RuntimeSettingsFreshnessCoordinatorV1 {
	private observedFingerprint: string | null = null;
	private active: Promise<RuntimeSettingsFreshnessResultV1> | null = null;

	constructor(private readonly ports: RuntimeSettingsFreshnessPortsV1) {}

	prime(): Promise<RuntimeSettingsFreshnessResultV1> {
		return this.runSingleFlight(async () => {
			try {
				this.observedFingerprint = await this.ports.statFingerprint();
				return { ok: true, changed: false, reloadCount: 0 };
			} catch {
				return failed(
					'internal-error',
					'Canonical settings revision could not be observed.',
					true,
					0,
				);
			}
		});
	}

	refresh(): Promise<RuntimeSettingsFreshnessResultV1> {
		return this.runSingleFlight(() => this.refreshOnce());
	}

	private async refreshOnce(): Promise<RuntimeSettingsFreshnessResultV1> {
		let candidate: string;
		try {
			candidate = await this.ports.statFingerprint();
		} catch {
			return failed(
				'internal-error',
				'Canonical settings revision could not be observed.',
				true,
				0,
			);
		}
		if (this.observedFingerprint === null) {
			this.observedFingerprint = candidate;
			return { ok: true, changed: false, reloadCount: 0 };
		}
		if (candidate === this.observedFingerprint) {
			return { ok: true, changed: false, reloadCount: 0 };
		}

		const firstReload = await this.reloadSafely(1);
		if (firstReload) return firstReload;
		const afterFirst = await this.statAfterReload(1);
		if (typeof afterFirst !== 'string') return afterFirst;
		if (afterFirst === candidate) {
			this.observedFingerprint = afterFirst;
			return { ok: true, changed: true, reloadCount: 1 };
		}

		const secondReload = await this.reloadSafely(2);
		if (secondReload) return secondReload;
		const afterSecond = await this.statAfterReload(2);
		if (typeof afterSecond !== 'string') return afterSecond;
		if (afterSecond !== afterFirst) {
			return failed(
				'live-settling',
				'Canonical settings changed during both bounded refresh attempts.',
				true,
				2,
			);
		}
		this.observedFingerprint = afterSecond;
		return { ok: true, changed: true, reloadCount: 2 };
	}

	private async reloadSafely(
		reloadCount: 1 | 2,
	): Promise<RuntimeSettingsFreshnessResultV1 | null> {
		try {
			const result = await this.ports.reload();
			return result.ok
				? null
				: failed(
					'internal-error',
					'Canonical settings reload did not complete successfully.',
					true,
					reloadCount,
				);
		} catch {
			return failed(
				'internal-error',
				'Canonical settings reload failed.',
				true,
				reloadCount,
			);
		}
	}

	private async statAfterReload(
		reloadCount: 1 | 2,
	): Promise<string | RuntimeSettingsFreshnessResultV1> {
		try {
			return await this.ports.statFingerprint();
		} catch {
			return failed(
				'internal-error',
				'Canonical settings revision could not be verified after reload.',
				true,
				reloadCount,
			);
		}
	}

	private runSingleFlight(
		operation: () => Promise<RuntimeSettingsFreshnessResultV1>,
	): Promise<RuntimeSettingsFreshnessResultV1> {
		if (this.active) return this.active;
		const run = operation();
		let active: Promise<RuntimeSettingsFreshnessResultV1>;
		active = run.then(
			result => {
				if (this.active === active) this.active = null;
				return result;
			},
			error => {
				if (this.active === active) this.active = null;
				throw error;
			},
		);
		this.active = active;
		return active;
	}
}

function failed(
	code: StructuredErrorV1['code'],
	reason: string,
	retryable: boolean,
	reloadCount: 0 | 1 | 2,
): RuntimeSettingsFreshnessResultV1 {
	return {
		ok: false,
		changed: false,
		reloadCount,
		error: structuredErrorV1(code, reason, { retryable }),
	};
}
