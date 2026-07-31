/**
 * Durable production promotion switches.
 *
 * Keep persistent reads disabled until the Stage 5.1 live feasibility and
 * production-candidate gates pass. Promotion is an intentional source change,
 * so subsequent ordinary production/release builds preserve the decision.
 */
export const OPERON_PRODUCTION_PERSISTENT_READ = true;

/**
 * Ordinary Operon CLI production builds include the promoted JSONL-session
 * persistent read client. Stage 5.1 rollback/feasibility artifacts override
 * this durable default explicitly with OPERON_CLI_PERSISTENT_READ_BUILD=0/1.
 */
export const OPERON_PRODUCTION_CLI_PERSISTENT_READ = true;
