import type { PublicCommandOutcomeV1 } from './command-line';

interface TextWriterV1 {
	write(text: string): unknown;
}

export function writePublicCommandOutcomeV1(
	outcome: PublicCommandOutcomeV1,
	streams: {
		stdout: TextWriterV1;
		stderr: TextWriterV1;
	},
): void {
	if (outcome.json) {
		streams.stdout.write(`${JSON.stringify(outcome.envelope)}\n`);
		return;
	}
	const rendered = `${outcome.human}\n`;
	if (outcome.exitCode === 0) streams.stdout.write(rendered);
	else streams.stderr.write(rendered);
}
