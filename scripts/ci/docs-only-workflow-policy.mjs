export function checkDocsClassificationGate(document, workflow, gates, {assertEqual, assertNoMatch}) {
	const surface = document.jobs?.surface;
	const steps = new Map((surface?.steps ?? []).map(step => [step.name, step]));
	assertEqual(workflow + ' classification checkout', steps.get('Check out repository')?.with?.ref, "${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha }}");
	assertEqual(workflow + ' classification history', steps.get('Check out repository')?.with?.['fetch-depth'], 0);
	assertEqual(workflow + ' docs output', surface?.outputs?.docs_only, '${{ steps.surface.outputs.docs_only }}');
	assertEqual(workflow + ' comparison command', steps.get('Classify validation surface')?.run, 'node scripts/ci/classify-pr-validation-surface.mjs --base "$BASE_SHA" --head "$HEAD_SHA" --event "$EVENT_NAME" >> "$GITHUB_OUTPUT"');
	assertEqual(workflow + ' comparison base', steps.get('Classify validation surface')?.env?.BASE_SHA, "${{ github.event_name == 'pull_request' && github.event.pull_request.base.sha || github.event.before || github.sha }}");
	assertEqual(workflow + ' comparison head', steps.get('Classify validation surface')?.env?.HEAD_SHA, "${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha }}");
	assertEqual(workflow + ' comparison event', steps.get('Classify validation surface')?.env?.EVENT_NAME, '${{ github.event_name }}');
	assertNoMatch(workflow, /paths-ignore:|paths:/u, 'Required workflows must report a result for docs-only changes');
	for (const id of gates) {
		const job = document.jobs?.[id];
		assertEqual(id + ' classification dependency', job?.needs, 'surface');
		assertEqual(id + ' always reports', job?.if, 'always()');
		const barrier = job?.steps?.[0];
		assertEqual(id + ' classification failure condition', barrier?.if, "needs.surface.result != 'success'");
		assertEqual(id + ' classification failure', barrier?.run, 'exit 1');
	}
}
