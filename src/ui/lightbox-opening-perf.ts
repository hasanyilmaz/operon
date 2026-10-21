/** Development-only, opt-in diagnostics. No content, paths or task IDs are collected. */
declare const OPERON_LIGHTBOX_PERF_ENABLED: boolean;
export const LIGHTBOX_PERF_ENABLED = typeof OPERON_LIGHTBOX_PERF_ENABLED !== 'undefined' && OPERON_LIGHTBOX_PERF_ENABLED;

type Kind = 'editor' | 'paired' | 'source';
type Outcome = 'ready' | 'cancelled' | 'error' | 'excluded';
type Phase = 'task-load' | 'editor-create' | 'editor-mount' | 'source-read' | 'source-scan' | 'source-validation' | 'properties' | 'native-leaf' | 'native-open' | 'native-load' | 'context' | 'surface-refresh' | 'editor-ready-wait' | 'frame-wait' | 'layout';
interface Span { phase: Phase; startMs: number; durationMs: number | null }
interface Sample {
 id: number; kind: Kind; resource: number | null; depth: number;
 startPoint: 'input' | 'entry'; entryOffsetMs: number; durationMs: number | null;
 outcome: Outcome | 'pending'; spans: Span[]; scans: number; leaves: number;
}
export interface LightboxOpeningTrace {
 kind(value: Kind): void;
 resource(value: object): void;
 span(phase: Phase): (() => void) | undefined;
 count(counter: 'scans' | 'leaves'): void;
 finish(outcome: Outcome): void;
}
interface ProbeApi {
 start(): string;
 stop(): string;
 report(): string;
}
interface ProbeWindow extends Window { operonLightboxPerf?: ProbeApi }
interface Collector { doc: Document; begin(kind: Kind): LightboxOpeningTrace | undefined }
let collector: Collector | undefined;

export function beginLightboxOpeningTrace(doc: Document, kind: Kind): LightboxOpeningTrace | undefined {
 if (!LIGHTBOX_PERF_ENABLED || collector?.doc !== doc) return undefined;
 return collector.begin(kind);
}

/** Installed by the plugin and removed on unload; listeners exist only during capture. */
export function installLightboxOpeningProbe(win: Window): () => void {
 if (!LIGHTBOX_PERF_ENABLED) return () => undefined;
 const target: ProbeWindow = win;
 const previous = target.operonLightboxPerf;
 let enabled = false;
 let generation = 0;
 let lastInput: number | null = null;
 let sequence = 0;
 let resourceSequence = 0;
 let resources = new WeakMap<object, number>();
 let samples: Sample[] = [];
 const pending = new Set<LightboxOpeningTrace>();
 const now = () => win.performance.now();
 const capture = () => { lastInput = now(); };
 const keyboard = (event: KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') capture(); };
 const stop = () => {
  enabled = false;
  win.document.removeEventListener('click', capture, true);
  win.document.removeEventListener('keydown', keyboard, true);
  for (const trace of pending) trace.finish('cancelled');
  lastInput = null;
 };
 const owner: Collector = { doc: win.document, begin(kind) {
  if (!enabled || pending.size >= 16) return undefined;
  const epoch = generation;
  const entry = now();
  const input = lastInput !== null && entry - lastInput <= 1000 ? lastInput : null;
  lastInput = null;
  const start = input ?? entry;
  const sample: Sample = { id: ++sequence, kind, resource: null,
   depth: win.document.querySelectorAll('.operon-task-media-lightbox').length,
   startPoint: input === null ? 'entry' : 'input', entryOffsetMs: entry - start,
   durationMs: null, outcome: 'pending', spans: [], scans: 0, leaves: 0 };
  samples.push(sample);
  if (samples.length > 100) samples.shift();
  const active = () => epoch === generation && sample.outcome === 'pending';
  const trace: LightboxOpeningTrace = {
   kind(value) { if (active()) sample.kind = value; },
   resource(value) {
    if (!active()) return;
    let id = resources.get(value);
    if (id === undefined) { id = ++resourceSequence; resources.set(value, id); }
    sample.resource = id;
   },
   span(phase) {
    if (!active() || sample.spans.length >= 64) return undefined;
    const started = now();
    const span: Span = { phase, startMs: started - start, durationMs: null };
    sample.spans.push(span);
    return () => { if (active() && span.durationMs === null) span.durationMs = now() - started; };
   },
   count(counter) { if (active()) sample[counter]++; },
   finish(outcome) {
    if (!active()) return;
    sample.outcome = outcome;
    sample.durationMs = now() - start;
    pending.delete(trace);
   },
  };
  pending.add(trace);
  return trace;
 } };
 const api: ProbeApi = {
  start() {
   stop(); generation++; sequence = 0; resourceSequence = 0;
   samples = []; resources = new WeakMap(); enabled = true; collector = owner;
   win.document.addEventListener('click', capture, true);
   win.document.addEventListener('keydown', keyboard, true);
   return 'Opening capture started (development only, maximum 100 samples).';
  },
  stop() { stop(); return 'Opening capture stopped. Call report() for JSON.'; },
  report() {
   const groups = new Map<string, Sample[]>();
   for (const sample of samples) {
    if (sample.outcome !== 'ready' || sample.durationMs === null) continue;
    const key = `${sample.kind}/${sample.resource}/${sample.depth}/${sample.startPoint}`;
    const group = groups.get(key) ?? []; group.push(sample); groups.set(key, group);
   }
   const summary = [...groups].map(([group, items]) => {
    const durations = items.slice(1).map(item => item.durationMs ?? 0).sort((a, b) => a - b);
    const middle = Math.floor(durations.length / 2);
    return { group, firstObservedMs: items[0].durationMs, repeats: durations.length,
     medianRepeatMs: durations.length ? (durations[middle] + durations[Math.floor((durations.length - 1) / 2)]) / 2 : null,
     slowestRepeatMs: durations.length ? durations[durations.length - 1] : null,
     scans: items.reduce((sum, item) => sum + item.scans, 0), leaves: items.reduce((sum, item) => sum + item.leaves, 0) };
   });
   return JSON.stringify({ version: 1, build: 'development', enabled, truncated: sequence > 100,
    measurement: 'input-or-entry to reveal-ready; not a compositor paint measurement; overlapping spans are not additive',
    summary, samples }, null, 2);
  },
 };
 target.operonLightboxPerf = api;
 return () => {
  stop(); generation++;
  if (collector === owner) collector = undefined;
  if (target.operonLightboxPerf === api) {
   if (previous) target.operonLightboxPerf = previous;
   else delete target.operonLightboxPerf;
  }
 };
}
