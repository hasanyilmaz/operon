export type OperonCliCommandRouteV1 = 'meta' | 'local' | 'runtime' | 'convenience';

export type OperonCliHelpSectionV1 =
	| 'system'
	| 'inspect'
	| 'tasks'
	| 'plans'
	| 'developer';

export interface OperonCliCommandDefinitionV1 {
	id: string;
	path: readonly string[];
	aliases?: readonly (readonly string[])[];
	route: OperonCliCommandRouteV1;
	section: OperonCliHelpSectionV1;
	summary: string;
	usage: readonly string[];
	options?: readonly string[];
	examples?: readonly string[];
	safety?: string;
	completion?: {
		positionalValues?: readonly string[];
		optionValues?: Readonly<Record<string, readonly string[]>>;
		repeatableOptions?: readonly string[];
	};
	contract?: {
		output?: 'machine-readable' | 'text-tty-only';
		capability?: string;
		requestSchema?: string | null;
		resultSchema?: string;
		outputSchemas?: readonly string[];
		mutationKind?: string;
		mutationKindRoutes?: readonly {
			label: string;
			mutationKind: string;
		}[];
		targetPolicy?: 'required' | 'optional' | 'forbidden';
	};
}

const TARGET_OPTIONS = Object.freeze([
	'--vault <path>       Use an explicit Obsidian vault.',
	'--profile <alias>    Use a configured vault profile.',
	'--json               Emit exactly one JSON result envelope.',
]);

const INPUT_OPTIONS = Object.freeze([
	'--input <file|->     Read the typed request from a file or stdin.',
	...TARGET_OPTIONS,
]);

export const OPERON_CLI_COMMAND_DEFINITIONS_V1 = Object.freeze([
	{
		id: 'version',
		path: ['version'],
		route: 'local',
		section: 'system',
		summary: 'Show the installed Operon CLI version.',
		usage: ['operon version [--json]'],
		options: ['--json               Emit a JSON result envelope.'],
		examples: ['operon version'],
	},
	{
		id: 'manifest',
		path: ['manifest'],
		route: 'local',
		section: 'developer',
		summary: 'Show the machine-readable CLI command and compatibility manifest.',
		usage: ['operon manifest [--json]'],
		options: ['--json               Emit a JSON result envelope.'],
		examples: ['operon manifest --json'],
	},
	{
		id: 'schema.list',
		path: ['schema', 'list'],
		route: 'local',
		section: 'developer',
		summary: 'List installed request and result schemas.',
		usage: ['operon schema list [--json]'],
		options: ['--json               Emit a JSON result envelope.'],
		examples: ['operon schema list --json'],
	},
	{
		id: 'schema.get',
		path: ['schema', 'get'],
		route: 'local',
		section: 'developer',
		summary: 'Read one installed schema by schema ID.',
		usage: ['operon schema get <schema-id> [--json]'],
		options: ['--json               Emit a JSON result envelope.'],
		examples: ['operon schema get mutation-intent --json'],
	},
	{
		id: 'setup',
		path: ['setup'],
		route: 'local',
		section: 'system',
		summary: 'Configure an Operon vault interactively or with explicit flags.',
		usage: [
			'operon setup',
			'operon setup --vault <path> --name <alias> [--default] [--live] [--json]',
		],
		options: [
			'--vault <path>       Obsidian vault to register.',
			'--name <alias>      Local profile name.',
			'--default           Make this the default profile.',
			'--live              Also verify the running Operon Runtime.',
			'--json              Emit a JSON result envelope.',
		],
		examples: [
			'operon setup',
			'operon setup --vault "/path/to/vault" --name work --default',
		],
		safety: 'Setup stores only local vault identity and profile metadata; it does not change Operon settings.',
	},
	{
		id: 'doctor',
		path: ['doctor'],
		route: 'local',
		section: 'system',
		summary: 'Check the selected vault, plugin, platform, and optional live Runtime.',
		usage: ['operon doctor [--vault <path>|--profile <alias>] [--live] [--repair-security] [--json]'],
		options: [
			'--vault <path>       Use an explicit Obsidian vault.',
			'--profile <alias>    Use a configured vault profile.',
			'--live              Verify the running Operon Runtime.',
			'--repair-security   Repair only the verified CLI storage root permissions.',
			'--json              Emit a JSON result envelope.',
		],
		examples: ['operon doctor --live'],
	},
	{
		id: 'completion',
		path: ['completion'],
		route: 'local',
		section: 'system',
		summary: 'Print a deterministic shell completion script.',
		usage: ['operon completion <zsh|bash|fish>'],
		examples: [
			'operon completion zsh',
			'operon completion bash',
			'operon completion fish',
		],
		completion: {
			positionalValues: ['zsh', 'bash', 'fish'],
		},
		safety: 'Prints only registry-derived static completions and never modifies shell profiles or reads a vault.',
	},
	{
		id: 'profile.list',
		path: ['profile', 'list'],
		route: 'local',
		section: 'system',
		summary: 'List configured Operon vault profiles.',
		usage: ['operon profile list [--json]'],
		options: ['--json               Emit a JSON result envelope.'],
		examples: ['operon profile list'],
	},
	{
		id: 'profile.default',
		path: ['profile', 'default'],
		route: 'local',
		section: 'system',
		summary: 'Select the default Operon vault profile.',
		usage: ['operon profile default <alias> [--json]'],
		options: ['--json               Emit a JSON result envelope.'],
		examples: ['operon profile default work'],
	},
	{
		id: 'profile.remove',
		path: ['profile', 'remove'],
		route: 'local',
		section: 'system',
		summary: 'Remove a local Operon vault profile.',
		usage: ['operon profile remove <alias> [--json]'],
		options: ['--json               Emit a JSON result envelope.'],
		examples: ['operon profile remove work'],
	},
	{
		id: 'plan.show',
		path: ['plan', 'show'],
		route: 'local',
		section: 'plans',
		summary: 'Inspect a stored mutation plan without applying it.',
		usage: ['operon plan show <plan-ref> [--json]'],
		options: ['--json               Emit a JSON result envelope.'],
		examples: ['operon plan show PLAN_REF'],
		contract: { output: 'machine-readable', resultSchema: 'plan-show-envelope' },
	},
	{
		id: 'plan.apply',
		path: ['plan', 'apply'],
		route: 'local',
		section: 'plans',
		summary: 'Apply one unchanged stored mutation plan.',
		usage: ['operon plan apply <plan-ref> [--confirm <target-digest>] [--json]'],
		options: [
			'--confirm <digest>   Confirm an exact confirmation-gated target.',
			'--json               Emit a JSON result envelope.',
		],
		examples: ['operon plan apply PLAN_REF --json'],
		safety: 'Apply only a reviewed, unchanged plan. Never repeat an uncertain apply.',
	},
	{
		id: 'plan.recover',
		path: ['plan', 'recover'],
		route: 'local',
		section: 'plans',
		summary: 'Select or recover the same plan after an uncertain apply result.',
		usage: [
			'operon plan recover',
			'operon plan recover <plan-ref> [--json]',
		],
		options: ['--json               Emit a JSON result envelope.'],
		examples: ['operon plan recover', 'operon plan recover PLAN_REF --json'],
		safety: 'Recovery reuses the original idempotent apply. Interactive ABANDON explicitly removes the only local recovery reference.',
	},
	{
		id: 'plan.discard',
		path: ['plan', 'discard'],
		route: 'local',
		section: 'plans',
		summary: 'Discard an unused stored mutation plan.',
		usage: ['operon plan discard <plan-ref> [--json]'],
		options: ['--json               Emit a JSON result envelope.'],
		examples: ['operon plan discard PLAN_REF'],
	},
	{
		id: 'health',
		path: ['health'],
		route: 'runtime',
		section: 'system',
		summary: 'Show current Runtime lifecycle and freshness health.',
		usage: ['operon health [--vault <path>|--profile <alias>] [--json]'],
		options: TARGET_OPTIONS,
		examples: ['operon health'],
		contract: {
			capability: 'system.health',
			requestSchema: null,
			resultSchema: 'runtime-health',
		},
	},
	{
		id: 'capabilities',
		path: ['capabilities'],
		route: 'runtime',
		section: 'system',
		summary: 'List Runtime capabilities and their availability.',
		usage: ['operon capabilities [--vault <path>|--profile <alias>] [--json]'],
		options: TARGET_OPTIONS,
		examples: ['operon capabilities'],
		contract: {
			capability: 'system.capabilities',
			requestSchema: null,
			resultSchema: 'capability-advertisements',
		},
	},
	{
		id: 'diagnostics',
		path: ['diagnostics'],
		route: 'runtime',
		section: 'system',
		summary: 'Read privacy-safe Runtime and transport diagnostics.',
		usage: ['operon diagnostics [--vault <path>|--profile <alias>] [--json]'],
		options: TARGET_OPTIONS,
		examples: ['operon diagnostics'],
		contract: {
			capability: 'system.diagnostics',
			requestSchema: null,
			resultSchema: 'runtime-diagnostics',
		},
	},
	{
		id: 'catalog',
		path: ['catalog'],
		route: 'runtime',
		section: 'inspect',
		summary: 'Read live pipelines, priorities, mappings, custom keys, and policies.',
		usage: ['operon catalog [--vault <path>|--profile <alias>] [--consistency <value>] [--json]'],
		options: [
			...TARGET_OPTIONS,
			'--consistency <value>  live-verified (default) or best-effort.',
		],
		completion: {
			optionValues: {
				'--consistency': ['live-verified', 'best-effort'],
			},
		},
		examples: ['operon catalog'],
		contract: {
			capability: 'catalog.read',
			requestSchema: 'catalog-request',
			resultSchema: 'operon-catalog',
		},
	},
	{
		id: 'entity.resolve',
		path: ['entity', 'resolve'],
		route: 'runtime',
		section: 'inspect',
		summary: 'Resolve a task selector through the live Runtime.',
		usage: ['operon entity resolve --input <file|-> [--vault <path>|--profile <alias>] [--json]'],
		options: INPUT_OPTIONS,
		examples: ['operon entity resolve --input request.json --json'],
		safety: 'Ambiguous results are candidates, not mutation targets.',
		contract: {
			capability: 'entities.resolve',
			requestSchema: 'entity-resolve-request',
			resultSchema: 'entity-resolution-result',
		},
	},
	{
		id: 'task.find',
		path: ['task', 'find'],
		route: 'local',
		section: 'inspect',
		summary: 'Find and exactly verify one task through an interactive live-index picker.',
		usage: ['operon task find [query] [--vault <path>|--profile <alias>]'],
		options: [
			'--vault <path>       Use an explicit Obsidian vault.',
			'--profile <alias>    Use a configured vault profile.',
		],
		examples: [
			'operon task find',
			'operon task find "release notes"',
		],
		safety: 'Interactive and read-only. A positional query may be visible in shell history and process listings; agents and scripts should use typed finder and task get commands.',
	},
	{
		id: 'task.get',
		path: ['task', 'get'],
		route: 'runtime',
		section: 'inspect',
		summary: 'Read one exact Operon task.',
		usage: [
			'operon task get --id <operonId> [--vault <path>|--profile <alias>] [--json]',
			'operon task get --input <file|-> [--vault <path>|--profile <alias>] [--json]',
		],
		options: [
			'--id <operonId>      Select one canonical Operon task ID.',
			...INPUT_OPTIONS,
		],
		examples: ['operon task get --id abc1234'],
		contract: {
			capability: 'tasks.read',
			requestSchema: 'task-get-request',
			resultSchema: 'task-get-result',
		},
	},
	{
		id: 'tasks.query',
		path: ['query'],
		route: 'runtime',
		section: 'inspect',
		summary: 'Run a bounded indexed task query.',
		usage: ['operon query --input <file|-> [--vault <path>|--profile <alias>] [--json]'],
		options: INPUT_OPTIONS,
		examples: ['operon query --input request.json --json'],
		contract: {
			capability: 'tasks.query',
			requestSchema: 'task-query-request',
			resultSchema: 'task-query-result',
		},
	},
	{
		id: 'tasks.finder',
		path: ['finder'],
		route: 'runtime',
		section: 'inspect',
		summary: 'Run the native Operon Task Finder matcher, ranking, scopes, and project modes.',
		usage: ['operon finder --input <file|-> [--vault <path>|--profile <alias>] [--json]'],
		options: INPUT_OPTIONS,
		examples: ['operon finder --input request.json --json'],
		safety: 'Use the typed Finder schema for agents and scripts. The interactive task find command is the human TTY surface.',
		contract: {
			capability: 'tasks.finder',
			requestSchema: 'task-finder-request',
			resultSchema: 'task-finder-result',
		},
	},
	{
		id: 'relationships.get',
		path: ['relationships'],
		route: 'runtime',
		section: 'inspect',
		summary: 'Read exact parent, child, dependency, and related-task edges.',
		usage: ['operon relationships --input <file|-> [--vault <path>|--profile <alias>] [--json]'],
		options: INPUT_OPTIONS,
		examples: ['operon relationships --input request.json --json'],
		contract: {
			capability: 'relationships.read',
			requestSchema: 'relationship-request',
			resultSchema: 'relationship-result',
		},
	},
	{
		id: 'context.build',
		path: ['context'],
		route: 'runtime',
		section: 'inspect',
		summary: 'Build a bounded live Context Pack.',
		usage: ['operon context --input <file|-> [--vault <path>|--profile <alias>] [--json]'],
		options: INPUT_OPTIONS,
		examples: ['operon context --input request.json --json'],
		contract: {
			capability: 'context.build',
			requestSchema: 'context-request',
			resultSchema: 'context-pack',
		},
	},
	{
		id: 'timers.read',
		path: ['timer', 'state'],
		aliases: [['timer', 'get'], ['timers']],
		route: 'runtime',
		section: 'tasks',
		summary: 'Read the current Operon timer state.',
		usage: ['operon timer state [--vault <path>|--profile <alias>] [--consistency <value>] [--json]'],
		options: [
			...TARGET_OPTIONS,
			'--consistency <value>  live-verified (default) or best-effort.',
		],
		completion: {
			optionValues: {
				'--consistency': ['live-verified', 'best-effort'],
			},
		},
		examples: ['operon timer state'],
		contract: {
			capability: 'timers.read',
			requestSchema: 'timer-read-request',
			resultSchema: 'timer-read-result',
		},
	},
	{
		id: 'mutation.preview',
		path: ['mutation', 'preview'],
		route: 'runtime',
		section: 'plans',
		summary: 'Create a sealed preview from a typed mutation request.',
		usage: ['operon mutation preview --input <file|-> [--vault <path>|--profile <alias>] [--json]'],
		options: INPUT_OPTIONS,
		examples: ['operon mutation preview --input request.json --json'],
		safety: 'Preview does not apply the mutation.',
		contract: {
			capability: 'mutation-kind-derived',
			requestSchema: 'mutation-preview-request',
			resultSchema: 'mutation-preview-result',
		},
	},
	{
		id: 'mutation.apply',
		path: ['mutation', 'apply'],
		route: 'runtime',
		section: 'plans',
		summary: 'Apply a stored plan reference through the safe public path.',
		usage: ['operon mutation apply --plan-ref <plan-ref> [--confirm <target-digest>] [--json]'],
		options: [
			'--plan-ref <ref>     Stored plan reference.',
			'--confirm <digest>   Exact confirmation target digest when required.',
			'--json               Emit a JSON result envelope.',
		],
		examples: ['operon mutation apply --plan-ref PLAN_REF --json'],
		safety: 'Raw mutation apply input is not accepted.',
		contract: {
			capability: 'mutation-kind-derived',
			requestSchema: 'mutation-plan-reference',
			resultSchema: 'mutation-result',
		},
	},
	{
		id: 'task.create',
		path: ['task', 'create'],
		route: 'convenience',
		section: 'tasks',
		summary: 'Create one task or preview a compact line batch.',
		usage: [
			'operon task create [description] [--preview-only] [--vault <path>|--profile <alias>]',
			'operon task create [inline|file] "Description" [key::"VALUE"...] [--preview-only] [--json]',
			'operon task create --input-format compact --input <file|-> [--json]',
			'operon task create --input-format compact-lines --input <file|-> [--json]',
			'operon task create --input <file|-> [--vault <path>|--profile <alias>] [--json]',
		],
		options: [
			...INPUT_OPTIONS,
			'--input-format <json|compact|compact-lines>  Parse typed JSON, one compact record, or 1-64 compact lines.',
			'--preview-only        Keep the reviewed create plan without applying it.',
			'description            Optional guided-mode task text.',
		],
			examples: [
				'operon task create',
				'operon task create inline "CLI test task" status::"EXACT LIVE PIPELINE.STATUS"',
				'operon task create "Follow up" dateDue::"2026-08-01" reminderRules::"dateDue.30m"',
				'operon task create --input-format compact --input - --json',
				'operon task create --input-format compact-lines --input - --json',
				'operon task create --input intent.json --json',
			],
		completion: {
			positionalValues: ['inline', 'file'],
			optionValues: {
				'--input-format': ['json', 'compact', 'compact-lines'],
			},
		},
			safety: 'Human compact argv automatically applies one unchanged safe preview unless --preview-only is used. Agent compact and compact-lines stdin always preview only; compact-lines parses and compiles every record before one preview and never auto-applies multi-source plans. Apply the returned unchanged planRef separately. Temporal, compact-batch, and advanced typed create features require matching versioned advertisements in both the CLI manifest and live Runtime creation Catalog. Cross-source graph operations require the matching graph transaction gate, fresh confirmation, and same-plan recovery. Positional text may appear in shell history and process listings.',
		contract: { mutationKind: 'task.create', targetPolicy: 'forbidden' },
	},
	{
		id: 'task.update',
		path: ['task', 'update'],
		route: 'convenience',
		section: 'tasks',
		summary: 'Update an exact task through guided, compact, or typed input.',
		usage: [
			'operon task update [--vault <path>|--profile <alias>]',
			'operon task update (--id <operon-id>|--description <exact-description>) {key::"VALUE"|--clear <key>}... [--preview-only] [--json]',
			'operon task update (--id <operon-id>|--description <exact-description>) --scope <this-task|this-and-following> {dateScheduled::"YYYY-MM-DD"|dateStarted::"YYYY-MM-DD"|dateDue::"YYYY-MM-DD"|datetimeStart::"YYYY-MM-DDTHH:mm:ss"|datetimeEnd::"YYYY-MM-DDTHH:mm:ss"|estimate::"SECONDS"|--clear <recurrence-key>}... [--preview-only] [--json]',
			'operon task update (--id <operon-id>|--description <exact-description>) repeat::"<normalized-rule>" [datetimeRepeatEnd::"YYYY-MM-DDTHH:mm:ss"] [--scope this-and-following] [--preview-only] [--json]',
			'operon task update (--id <operon-id>|--description <exact-description>) {parentTask::"<operon-id>"|blocking::"<operon-id>; ..."|blockedBy::"<operon-id>; ..."|--clear <relationship-key>}... [--preview-only] [--json]',
			'operon task update --input-format compact-lines --input <file|-> [--vault <path>|--profile <alias>] [--json]',
			'operon task update --input <file|-> [--vault <path>|--profile <alias>] [--json]',
		],
		options: [
			...INPUT_OPTIONS,
			'--input-format <json|compact-lines>  Parse typed JSON or 2-64 exact-ID compact update lines.',
			'--id <operon-id>           Select one exact task by canonical Operon ID.',
			'--description <text>       Select one unique case-sensitive exact description.',
			'--clear <canonical-key>    Clear one field; repeat for additional fields.',
			'--scope <scope>            Recurrence scope: this-task or this-and-following.',
			'--preview-only             Keep the reviewed update plan without applying it.',
		],
		examples: [
			'operon task update',
			'operon task update --id "abc1234" priority::"EXACT LIVE PRIORITY" note::"Published"',
			'operon task update --description "Release notes" contexts::"Operon; Release" --clear "dateDue"',
			'operon task update --id "abc1234" parentTask::"def5678"',
			'operon task update --id "abc1234" blocking::"def5678; ghi9012" --clear "blockedBy"',
			'operon task update --id "abc1234" --scope this-and-following dateScheduled::"2026-08-04"',
			'operon task update --id "abc1234" --scope this-task estimate::"3600"',
			'operon task update --id "abc1234" repeat::"mode=schedule|freq=week|interval=1|days=mo"',
			'operon task update --id "abc1234" note::"Review first" --preview-only',
			'operon task update --input-format compact-lines --input - --json',
			'operon task update --input intent.json --json',
		],
		completion: {
			repeatableOptions: ['--clear'],
			optionValues: {
				'--input-format': ['json', 'compact-lines'],
				'--scope': ['this-task', 'this-and-following'],
			},
		},
		safety: 'Human compact argv automatically applies one unchanged warning-free update plan unless --preview-only is used. Compact-lines requires 2-64 unique exact --id records, validates all lines before one coherent multi-ID readiness request, returns one preview-only planRef, and has no sequential fallback. It admits only general updates that resolve to one inline source and one atomic plan. Recurring temporal changes require --scope; starting recurrence on a non-recurring task defaults to this-and-following. Recurrence updates and relationship replacements cannot be mixed with general field updates. Typed --input only previews and returns a planRef. Exact-description targeting must resolve to one live source task. Agents should keep sensitive values in typed stdin.',
		contract: {
			mutationKind: 'task.update',
			mutationKindRoutes: [
				{ label: 'General fields', mutationKind: 'task.update' },
				{ label: 'Recurrence fields', mutationKind: 'task.recurrence' },
				{ label: 'Relationship keys', mutationKind: 'task.relationship' },
			],
			targetPolicy: 'required',
		},
	},
	{
		id: 'task.complete',
		path: ['task', 'complete'],
		route: 'convenience',
		section: 'tasks',
		summary: 'Complete one exact task through a sealed semantic transition.',
		usage: [
			'operon task complete (--id <operon-id>|--description <exact-description>) [--preview-only] [--vault <path>|--profile <alias>] [--json]',
		],
		options: [
			'--id <operon-id>           Select one exact task by canonical Operon ID.',
			'--description <text>       Select one unique case-sensitive exact description.',
			'--preview-only             Keep the reviewed transition plan without applying it.',
			...TARGET_OPTIONS,
		],
		examples: ['operon task complete --id "abc1234"'],
		safety: 'A warning-free unchanged plan applies automatically. Compound timer, recurrence, pin, dependency, and parent effects remain visible in the Runtime preview.',
		contract: { mutationKind: 'task.transition', targetPolicy: 'required' },
	},
	{
		id: 'task.reopen',
		path: ['task', 'reopen'],
		route: 'convenience',
		section: 'tasks',
		summary: 'Reopen one exact terminal task in its first resolved non-terminal status.',
		usage: [
			'operon task reopen (--id <operon-id>|--description <exact-description>) [--preview-only] [--vault <path>|--profile <alias>] [--json]',
		],
		options: [
			'--id <operon-id>           Select one exact task by canonical Operon ID.',
			'--description <text>       Select one unique case-sensitive exact description.',
			'--preview-only             Keep the reviewed transition plan without applying it.',
			...TARGET_OPTIONS,
		],
		examples: ['operon task reopen --description "Prepare release notes"'],
		safety: 'A warning-free unchanged plan applies automatically; ambiguous pipeline or status semantics fail closed.',
		contract: { mutationKind: 'task.transition', targetPolicy: 'required' },
	},
	{
		id: 'task.cancel',
		path: ['task', 'cancel'],
		route: 'convenience',
		section: 'tasks',
		summary: 'Cancel one exact task through its pipeline cancellation status.',
		usage: [
			'operon task cancel (--id <operon-id>|--description <exact-description>) [--preview-only] [--vault <path>|--profile <alias>] [--json]',
		],
		options: [
			'--id <operon-id>           Select one exact task by canonical Operon ID.',
			'--description <text>       Select one unique case-sensitive exact description.',
			'--preview-only             Keep the reviewed transition plan without applying it.',
			...TARGET_OPTIONS,
		],
		examples: ['operon task cancel --id "abc1234" --preview-only'],
		safety: 'Cancellation is a workflow transition, not deletion. A warning-free unchanged plan applies automatically.',
		contract: { mutationKind: 'task.transition', targetPolicy: 'required' },
	},
	{
		id: 'task.pin',
		path: ['task', 'pin'],
		route: 'convenience',
		section: 'tasks',
		summary: 'Pin one exact task through compare-aware Operon state.',
		usage: [
			'operon task pin (--id <operon-id>|--description <exact-description>) [--preview-only] [--vault <path>|--profile <alias>] [--json]',
			'operon task pin --input <file|-> [--vault <path>|--profile <alias>] [--json]',
		],
		options: [
			'--id <operon-id>           Select one exact task by canonical Operon ID.',
			'--description <text>       Select one unique case-sensitive exact description.',
			'--preview-only             Keep the reviewed pinned-state plan without applying it.',
			...INPUT_OPTIONS,
		],
		examples: ['operon task pin --id "abc1234"'],
		safety: 'Direct human selector argv automatically applies one warning-free unchanged plan unless --preview-only is used. Typed --input only previews and returns a planRef for separate apply. An already pinned task is a no-op.',
		contract: { mutationKind: 'task.pinned-state', targetPolicy: 'required' },
	},
	{
		id: 'task.unpin',
		path: ['task', 'unpin'],
		route: 'convenience',
		section: 'tasks',
		summary: 'Unpin one exact task through compare-aware Operon state.',
		usage: [
			'operon task unpin (--id <operon-id>|--description <exact-description>) [--preview-only] [--vault <path>|--profile <alias>] [--json]',
			'operon task unpin --input <file|-> [--vault <path>|--profile <alias>] [--json]',
		],
		options: [
			'--id <operon-id>           Select one exact task by canonical Operon ID.',
			'--description <text>       Select one unique case-sensitive exact description.',
			'--preview-only             Keep the reviewed pinned-state plan without applying it.',
			...INPUT_OPTIONS,
		],
		examples: ['operon task unpin --description "Prepare release notes"'],
		safety: 'Direct human selector argv automatically applies one warning-free unchanged plan unless --preview-only is used. Typed --input only previews and returns a planRef for separate apply. An already unpinned task is a no-op.',
		contract: { mutationKind: 'task.pinned-state', targetPolicy: 'required' },
	},
	{
		id: 'task.transition',
		path: ['task', 'transition'],
		route: 'convenience',
		section: 'tasks',
		summary: 'Transition an exact task interactively or preview a typed status change.',
		usage: [
			'operon task transition [--vault <path>|--profile <alias>]',
			'operon task transition --input <file|-> [--vault <path>|--profile <alias>] [--json]',
		],
		options: INPUT_OPTIONS,
		examples: ['operon task transition', 'operon task transition --input intent.json --json'],
		contract: { mutationKind: 'task.transition', targetPolicy: 'required' },
	},
	{
		id: 'task.delete',
		path: ['task', 'delete'],
		route: 'convenience',
		section: 'tasks',
		summary: 'Select and preview exact task deletion interactively or from typed input.',
		usage: [
			'operon task delete [--vault <path>|--profile <alias>]',
			'operon task delete (--id <operon-id>|--description <exact-description>) [--preview-only] [--json]',
			'operon task delete --input <file|-> [--vault <path>|--profile <alias>] [--json]',
		],
		options: [
			'--id <operon-id>            Select one exact task by Operon ID.',
			'--description <text>        Select one exact task by description.',
			'--preview-only              Keep the reviewed delete plan without applying it.',
			...INPUT_OPTIONS,
		],
		examples: [
			'operon task delete',
			'operon task delete --id "abc1234" --preview-only',
			'operon task delete --input intent.json --json',
		],
		safety: 'Direct deletion never auto-applies without a fresh DELETE confirmation for the exact reviewed plan. JSON and non-interactive calls retain the plan for separate review.',
		contract: { mutationKind: 'task.delete', targetPolicy: 'required' },
	},
	{
		id: 'task.convert',
		path: ['task', 'convert'],
		route: 'convenience',
		section: 'tasks',
		summary: 'Convert an exact inline or File Task through a guided or typed preview.',
		usage: [
			'operon task convert [--vault <path>|--profile <alias>]',
			'operon task convert (--id <operon-id>|--description <exact-description>) --to file --template <exact-live-name> --target-file <vault-relative.md> [--preview-only] [--json]',
			'operon task convert (--id <operon-id>|--description <exact-description>) --to inline --target-file <vault-relative.md> --line <1-based-line> [--preview-only] [--json]',
			'operon task convert --input <file|-> [--vault <path>|--profile <alias>] [--json]',
		],
		options: [
			'--id <operon-id>            Select one exact task by Operon ID.',
			'--description <text>        Select one exact task by description.',
			'--to <file|inline>          Exact conversion direction.',
			'--template <name>           Exact case-sensitive live template name for File Tasks.',
			'--target-file <path.md>     Exact vault-relative target path.',
			'--line <number>             Positive 1-based blank inline target line.',
			'--preview-only              Keep the reviewed plan without applying it.',
			...INPUT_OPTIONS,
		],
		completion: { optionValues: { '--to': ['file', 'inline'] } },
		examples: ['operon task convert', 'operon task convert --input intent.json --json'],
		safety: 'File-to-inline conversion requires a fresh CONVERT confirmation of the exact reviewed losses. JSON and non-interactive calls retain the plan for separate review.',
		contract: { mutationKind: 'task.convert', targetPolicy: 'required' },
	},
	{
		id: 'task.relocate',
		path: ['task', 'relocate'],
		route: 'convenience',
		section: 'tasks',
		summary: 'Move an exact inline task to a live blank-line candidate.',
		usage: [
			'operon task relocate [--vault <path>|--profile <alias>]',
			'operon task relocate (--id <operon-id>|--description <exact-description>) --target-file <vault-relative.md> --line <1-based-line> [--preview-only] [--json]',
			'operon task relocate --input <file|-> [--vault <path>|--profile <alias>] [--json]',
		],
		options: [
			'--id <operon-id>            Select one exact task by Operon ID.',
			'--description <text>        Select one exact task by description.',
			'--target-file <path.md>     Exact existing target note.',
			'--line <number>             Positive 1-based blank target line.',
			'--preview-only              Keep the reviewed plan without applying it.',
			...INPUT_OPTIONS,
		],
		examples: ['operon task relocate', 'operon task relocate --input intent.json --json'],
		contract: { mutationKind: 'task.inline-relocate', targetPolicy: 'required' },
	},
	{
		id: 'reminder.add',
		path: ['reminder', 'add'],
		route: 'convenience',
		section: 'tasks',
		summary: 'Add one Fixed or Relative Reminder interactively or with typed input.',
		usage: [
			'operon reminder add [--vault <path>|--profile <alias>]',
			'operon reminder add (--id <operon-id>|--description <exact-description>) (reminderDatetimes::"VALUE"|reminderRules::"VALUE") [--preview-only] [--vault <path>|--profile <alias>] [--json]',
			'operon reminder add --input <file|-> [--vault <path>|--profile <alias>] [--json]',
		],
		options: [
			...INPUT_OPTIONS,
			'--id <operon-id>           Select one exact task by canonical Operon ID.',
			'--description <text>       Select one unique case-sensitive exact description.',
			'--preview-only             Keep the reviewed reminder plan without applying it.',
		],
		examples: [
			'operon reminder add',
			'operon reminder add --id "abc1234" reminderRules::"dateDue.30m"',
			'operon reminder add --input intent.json --json',
		],
		safety: 'Direct mode changes exactly one canonical reminder item and automatically applies only an unchanged warning-free plan.',
		contract: { mutationKind: 'task.reminder-item', targetPolicy: 'required' },
	},
	{
		id: 'reminder.replace',
		path: ['reminder', 'replace'],
		route: 'convenience',
		section: 'tasks',
		summary: 'Replace one exact reminder item interactively or with typed input.',
		usage: [
			'operon reminder replace [--vault <path>|--profile <alias>]',
			'operon reminder replace (--id <operon-id>|--description <exact-description>) --current <VALUE> (reminderDatetimes::"NEW_VALUE"|reminderRules::"NEW_VALUE") [--preview-only] [--vault <path>|--profile <alias>] [--json]',
			'operon reminder replace --input <file|-> [--vault <path>|--profile <alias>] [--json]',
		],
		options: [
			...INPUT_OPTIONS,
			'--id <operon-id>           Select one exact task by canonical Operon ID.',
			'--description <text>       Select one unique case-sensitive exact description.',
			'--current <value>          Select one existing reminder by canonical value.',
			'--preview-only             Keep the reviewed reminder plan without applying it.',
		],
		examples: [
			'operon reminder replace',
			'operon reminder replace --id "abc1234" --current "dateDue.30m" reminderRules::"dateDue.1h"',
			'operon reminder replace --input intent.json --json',
		],
		safety: 'The exact hydrated reminder item ID and raw expected value are sealed before a warning-free plan can apply.',
		contract: { mutationKind: 'task.reminder-item', targetPolicy: 'required' },
	},
	{
		id: 'reminder.remove',
		path: ['reminder', 'remove'],
		route: 'convenience',
		section: 'tasks',
		summary: 'Remove one exact reminder item interactively or with typed input.',
		usage: [
			'operon reminder remove [--vault <path>|--profile <alias>]',
			'operon reminder remove (--id <operon-id>|--description <exact-description>) (reminderDatetimes::"VALUE"|reminderRules::"VALUE") [--preview-only] [--vault <path>|--profile <alias>] [--json]',
			'operon reminder remove --input <file|-> [--vault <path>|--profile <alias>] [--json]',
		],
		options: [
			...INPUT_OPTIONS,
			'--id <operon-id>           Select one exact task by canonical Operon ID.',
			'--description <text>       Select one unique case-sensitive exact description.',
			'--preview-only             Keep the reviewed reminder plan without applying it.',
		],
		examples: [
			'operon reminder remove',
			'operon reminder remove --id "abc1234" reminderRules::"dateDue.1h"',
			'operon reminder remove --input intent.json --json',
		],
		safety: 'The exact hydrated reminder item ID and raw expected value are sealed before a warning-free plan can apply.',
		contract: { mutationKind: 'task.reminder-item', targetPolicy: 'required' },
	},
	{
		id: 'timer.session.add',
		path: ['timer', 'session', 'add'],
		route: 'convenience',
		section: 'tasks',
		summary: 'Add one completed tracker session to an exact task.',
		usage: [
			'operon timer session add (--id <operon-id>|--description <exact-description>) --start <LOCAL_DATETIME> --end <LOCAL_DATETIME> [--preview-only] [--vault <path>|--profile <alias>] [--json]',
			'operon timer session add --input <file|-> [--vault <path>|--profile <alias>] [--json]',
		],
		options: [
			...INPUT_OPTIONS,
			'--id <operon-id>           Select one exact task by canonical Operon ID.',
			'--description <text>       Select one unique case-sensitive exact description.',
			'--start <datetime>         Local-naive session start.',
			'--end <datetime>           Local-naive session end.',
			'--preview-only             Keep the reviewed plan without applying it.',
		],
		examples: [
			'operon timer session add --id "abc1234" --start "2026-07-27T09:00" --end "2026-07-27T10:00"',
		],
		contract: { mutationKind: 'timer.session', targetPolicy: 'required' },
	},
	{
		id: 'timer.session.update',
		path: ['timer', 'session', 'update'],
		route: 'convenience',
		section: 'tasks',
		summary: 'Update one oldest-first completed tracker session.',
		usage: [
			'operon timer session update (--id <operon-id>|--description <exact-description>) --session <number> --start <LOCAL_DATETIME> --end <LOCAL_DATETIME> [--preview-only] [--vault <path>|--profile <alias>] [--json]',
			'operon timer session update --input <file|-> [--vault <path>|--profile <alias>] [--json]',
		],
		options: [
			...INPUT_OPTIONS,
			'--id <operon-id>           Select one exact task by canonical Operon ID.',
			'--description <text>       Select one unique case-sensitive exact description.',
			'--session <number>         Select the 1-based oldest-first session.',
			'--start <datetime>         Replacement local-naive start.',
			'--end <datetime>           Replacement local-naive end.',
			'--preview-only             Keep the reviewed plan without applying it.',
		],
		examples: [
			'operon timer session update --id "abc1234" --session "1" --start "2026-07-27T09:15" --end "2026-07-27T10:30"',
		],
		safety: 'The selected raw storage index and exact old range are sealed before apply.',
		contract: { mutationKind: 'timer.session', targetPolicy: 'required' },
	},
	{
		id: 'timer.session.remove',
		path: ['timer', 'session', 'remove'],
		route: 'convenience',
		section: 'tasks',
		summary: 'Remove one oldest-first completed tracker session.',
		usage: [
			'operon timer session remove (--id <operon-id>|--description <exact-description>) --session <number> [--preview-only] [--vault <path>|--profile <alias>] [--json]',
			'operon timer session remove --input <file|-> [--vault <path>|--profile <alias>] [--json]',
		],
		options: [
			...INPUT_OPTIONS,
			'--id <operon-id>           Select one exact task by canonical Operon ID.',
			'--description <text>       Select one unique case-sensitive exact description.',
			'--session <number>         Select the 1-based oldest-first session.',
			'--preview-only             Keep the reviewed destructive plan without applying it.',
		],
		examples: ['operon timer session remove --id "abc1234" --session "1"'],
		safety: 'Removal requires fresh REMOVE confirmation for the same sealed plan.',
		contract: { mutationKind: 'timer.session', targetPolicy: 'required' },
	},
	{
		id: 'timer.start',
		path: ['timer', 'start'],
		route: 'convenience',
		section: 'tasks',
		summary: 'Start or switch the Operon timer interactively or with typed input.',
		usage: [
			'operon timer start [--vault <path>|--profile <alias>]',
			'operon timer start --input <file|-> [--vault <path>|--profile <alias>] [--json]',
		],
		options: INPUT_OPTIONS,
		examples: ['operon timer start', 'operon timer start --input intent.json --json'],
		contract: { mutationKind: 'timer.control', targetPolicy: 'optional' },
	},
	{
		id: 'timer.stop',
		path: ['timer', 'stop'],
		route: 'convenience',
		section: 'tasks',
		summary: 'Stop the current Operon timer interactively or with typed input.',
		usage: [
			'operon timer stop [--vault <path>|--profile <alias>]',
			'operon timer stop --input <file|-> [--vault <path>|--profile <alias>] [--json]',
		],
		options: INPUT_OPTIONS,
		examples: ['operon timer stop', 'operon timer stop --input intent.json --json'],
		contract: { mutationKind: 'timer.control', targetPolicy: 'optional' },
	},
	{
		id: 'help',
		path: ['help'],
		route: 'meta',
		section: 'system',
		summary: 'Show root, group, or command help without opening a vault.',
		usage: ['operon help [command]'],
		examples: ['operon help task create'],
	},
] as const satisfies readonly OperonCliCommandDefinitionV1[]);

export type OperonCliCommandDefinitionIdV1 =
	(typeof OPERON_CLI_COMMAND_DEFINITIONS_V1)[number]['id'];

export type OperonCliCommandIdForRouteV1<Route extends OperonCliCommandRouteV1> =
	Extract<
		(typeof OPERON_CLI_COMMAND_DEFINITIONS_V1)[number],
		{ route: Route }
	>['id'];

export function commandDefinitionsForRouteV1(
	route: OperonCliCommandRouteV1,
): readonly OperonCliCommandDefinitionV1[] {
	return OPERON_CLI_COMMAND_DEFINITIONS_V1.filter(definition => definition.route === route);
}

export function commandDefinitionByIdV1(
	id: string,
): OperonCliCommandDefinitionV1 | undefined {
	return OPERON_CLI_COMMAND_DEFINITIONS_V1.find(definition => definition.id === id);
}

export function resolveCommandDefinitionV1(
	tokens: readonly string[],
	route?: OperonCliCommandRouteV1,
): { definition: OperonCliCommandDefinitionV1; consumed: number } | undefined {
	const definitions: readonly OperonCliCommandDefinitionV1[] = OPERON_CLI_COMMAND_DEFINITIONS_V1;
	const matches: Array<{
		definition: OperonCliCommandDefinitionV1;
		path: readonly string[];
	}> = [];
	for (const definition of definitions) {
		if (route && definition.route !== route) continue;
		for (const path of [definition.path, ...(definition.aliases ?? [])]) {
			if (path.every((token, index) => tokens[index] === token)) {
				matches.push({ definition, path });
			}
		}
	}
	matches.sort((left, right) => right.path.length - left.path.length);
	const match = matches[0];
	return match ? { definition: match.definition, consumed: match.path.length } : undefined;
}

export function isCommandGroupV1(token: string): boolean {
	return isCommandGroupPathV1([token]);
}

export function isCommandGroupPathV1(tokens: readonly string[]): boolean {
	return tokens.length > 0 && OPERON_CLI_COMMAND_DEFINITIONS_V1.some(definition => (
		definition.path.length > tokens.length
		&& tokens.every((token, index) => definition.path[index] === token)
	));
}

export function completionCandidatesV1(tokens: readonly string[]): string[] {
	if (tokens.length === 0) {
		return canonicalFirstTokens();
	}
	if (tokens.length === 1) {
		const prefix = tokens[0];
		return canonicalFirstTokens().filter(token => token.startsWith(prefix));
	}
	const parent = tokens.slice(0, -1);
	const prefix = tokens.at(-1) ?? '';
	if (isCommandGroupPathV1(parent) && !resolveCommandDefinitionV1(parent)) {
		return OPERON_CLI_COMMAND_DEFINITIONS_V1
			.filter(definition => (
				definition.path.length > parent.length
				&& parent.every((token, index) => definition.path[index] === token)
			))
			.map(definition => definition.path[parent.length])
			.filter((token): token is NonNullable<typeof token> => token !== undefined)
			.filter((token, index, values) => values.indexOf(token) === index)
			.filter(token => token.startsWith(prefix))
			.sort();
	}
	const resolved = resolveCommandDefinitionV1(tokens);
	if (!resolved || tokens.length <= resolved.consumed) return [];
	const activePrefix = tokens.at(-1) ?? '';
	const previousToken = tokens.at(-2);
	const optionValues = previousToken
		? resolved.definition.completion?.optionValues?.[previousToken]
		: undefined;
	if (optionValues) {
		return optionValues
			.filter(value => value.startsWith(activePrefix))
			.sort();
	}
	if (
		resolved.definition.completion?.positionalValues
		&& tokens.length === resolved.consumed + 1
		&& !activePrefix.startsWith('-')
	) {
		return resolved.definition.completion.positionalValues
			.filter(value => value.startsWith(activePrefix))
			.sort();
	}
	const used = new Set(tokens.slice(resolved.consumed, -1));
	const repeatableOptions = new Set(resolved.definition.completion?.repeatableOptions ?? []);
	return completionOptions(resolved.definition)
		.filter(option => repeatableOptions.has(option) || !used.has(option))
		.filter(option => option.startsWith(activePrefix));
}

export function commandOptionRequiresValueV1(
	definition: OperonCliCommandDefinitionV1,
	optionName: string,
): boolean {
	return (definition.options ?? []).some(option => {
		const [name, valuePlaceholder] = option.trim().split(/\s+/u, 2);
		return name === optionName && valuePlaceholder?.startsWith('<') === true;
	});
}

function completionOptions(definition: OperonCliCommandDefinitionV1): string[] {
	const options = (definition.options ?? [])
		.map(option => option.trim().split(/\s+/u, 1)[0])
		.filter(option => option.startsWith('-'));
	return [...new Set([...options, '--help'])].sort();
}

export function renderRootHelpV1(mode: 'short' | 'full' = 'full'): string {
	if (mode === 'short') {
		return [
			'Operon CLI',
			'',
			'Usage:',
			'  operon <command> [options]',
			'  operon help [command]',
			'',
			'Get started:',
			'  operon setup           Configure an Operon vault.',
			'  operon doctor --live   Verify the configured vault and live Runtime.',
			'  operon health          Check current Runtime health.',
			'  operon task --help     Explore task commands.',
			'',
			'Run "operon --help" to see all commands.',
			'',
		].join('\n');
	}
	const sections: ReadonlyArray<{
		id: OperonCliHelpSectionV1;
		title: string;
	}> = [
		{ id: 'system', title: 'System and setup' },
		{ id: 'inspect', title: 'Find and inspect' },
		{ id: 'tasks', title: 'Tasks, reminders, and timers' },
		{ id: 'plans', title: 'Plans and recovery' },
		{ id: 'developer', title: 'Developer contracts' },
	];
	const lines = [
		'Operon CLI',
		'',
		'Usage:',
		'  operon <command> [options]',
		'  operon help [command]',
		'  operon <command> --help',
		'',
		'Get started:',
		'  operon setup           Configure an Operon vault.',
		'  operon doctor --live   Verify the configured vault and live Runtime.',
		'  operon health          Check current Runtime health.',
		'  operon task --help     Explore task commands.',
	];
	for (const section of sections) {
		lines.push('', `${section.title}:`);
		for (const definition of OPERON_CLI_COMMAND_DEFINITIONS_V1.filter(item => item.section === section.id)) {
			lines.push(`  ${definition.path.join(' ').padEnd(22)} ${definition.summary}`);
		}
	}
	lines.push(
		'',
		'Vault selection:',
		'  The current-directory match, single profile, or default profile is used automatically.',
		'  Use --vault or --profile only to select a different vault explicitly.',
		'  Obsidian vault folder names must be unique; Runtime hash verification rejects a wrong match.',
		'',
		'Sensitive task values belong in --input JSON, not command-line flags.',
		'',
	);
	return lines.join('\n');
}

export function renderGroupHelpV1(group: string | readonly string[]): string | undefined {
	const groupTokens = typeof group === 'string' ? [group] : [...group];
	const definitions = OPERON_CLI_COMMAND_DEFINITIONS_V1
		.filter(definition => (
			definition.path.length > groupTokens.length
			&& groupTokens.every((token, index) => definition.path[index] === token)
		));
	if (definitions.length === 0) return undefined;
	const groupPath = groupTokens.join(' ');
	return [
		`Operon ${groupPath} commands`,
		'',
		'Usage:',
		`  operon ${groupPath} <command> [options]`,
		'',
		'Commands:',
		...definitions.map(definition => (
			`  ${definition.path.slice(groupTokens.length).join(' ').padEnd(16)} ${definition.summary}`
		)),
		'',
		`Run "operon ${groupPath} <command> --help" for command details.`,
		'',
	].join('\n');
}

export function renderCommandHelpV1(
	definition: OperonCliCommandDefinitionV1,
): string {
	const lines = [
		`Operon ${definition.path.join(' ')}`,
		'',
		definition.summary,
		'',
		'Usage:',
		...definition.usage.map(usage => `  ${usage}`),
	];
	if (definition.options?.length) {
		lines.push('', 'Options:', ...definition.options.map(option => `  ${option}`));
	}
	if (definition.examples?.length) {
		lines.push('', 'Examples:', ...definition.examples.map(example => `  ${example}`));
	}
	if (definition.safety) {
		lines.push('', 'Safety:', `  ${definition.safety}`);
	}
	lines.push('', `Contract: ${definition.id}`);
	if (definition.contract?.capability) {
		lines.push(`Capability: ${definition.contract.capability}`);
	}
	if (definition.contract?.requestSchema) {
		lines.push(`Request schema: ${definition.contract.requestSchema}`);
	}
	if (definition.contract?.resultSchema) {
		lines.push(`Result schema: ${definition.contract.resultSchema}`);
	}
	if (definition.contract?.mutationKindRoutes?.length) {
		lines.push(
			'Mutation kinds:',
			...definition.contract.mutationKindRoutes.map(route => (
				`  ${route.label}: ${route.mutationKind}`
			)),
		);
	} else if (definition.contract?.mutationKind) {
		lines.push(`Mutation kind: ${definition.contract.mutationKind}`);
	}
	lines.push('');
	return lines.join('\n');
}

export function canonicalSubcommandsV1(group: string | readonly string[]): string[] {
	const groupTokens = typeof group === 'string' ? [group] : [...group];
	return OPERON_CLI_COMMAND_DEFINITIONS_V1
		.filter(definition => (
			definition.path.length > groupTokens.length
			&& groupTokens.every((token, index) => definition.path[index] === token)
		))
		.map(definition => definition.path[groupTokens.length])
		.filter((token): token is NonNullable<typeof token> => token !== undefined)
		.filter((token, index, values) => values.indexOf(token) === index)
		.sort();
}

function canonicalFirstTokens(): string[] {
	return OPERON_CLI_COMMAND_DEFINITIONS_V1
		.map(definition => definition.path[0])
		.filter((token, index, values) => values.indexOf(token) === index)
		.sort();
}
