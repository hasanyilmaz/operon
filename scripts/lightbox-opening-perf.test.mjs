import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import vm from 'node:vm';

async function load(enabled) {
 const result = await build({entryPoints:['src/ui/lightbox-opening-perf.ts'],bundle:true,write:false,format:'cjs',platform:'node',minify:true,define:{OPERON_LIGHTBOX_PERF_ENABLED:String(enabled)}});
 if(!enabled)assert.doesNotMatch(result.outputFiles[0].text,/operonLightboxPerf|Opening capture|input-or-entry/);
 const module={exports:{}}; vm.runInNewContext(result.outputFiles[0].text,{module,exports:module.exports});
 return module.exports;
}
function host() {
 let time=0, reads=0;
 const listeners=new Map();
 const document={addEventListener(type,fn){listeners.set(type,fn);},removeEventListener(type,fn){if(listeners.get(type)===fn)listeners.delete(type);},querySelectorAll(){return [];}};
 const win={document,performance:{now(){reads++;return time;}}};
 return {win,listeners,tick(ms){time+=ms;},get reads(){return reads;},click(){listeners.get('click')?.();}};
}
const report = h => JSON.parse(h.win.operonLightboxPerf.report());

test('production collector is absent and does not access the window',async()=>{
 const m=await load(false); const h=host(); const dispose=m.installLightboxOpeningProbe(h.win);
 assert.equal(h.win.operonLightboxPerf,undefined); assert.equal(m.beginLightboxOpeningTrace(h.win.document,'editor'),undefined);
 dispose(); assert.equal(h.reads,0); assert.equal(h.listeners.size,0);
});
test('development is opt-in; stop/unload remove capture listeners',async()=>{
 const m=await load(true),h=host(),dispose=m.installLightboxOpeningProbe(h.win);
 assert.equal(m.beginLightboxOpeningTrace(h.win.document,'editor'),undefined); assert.equal(h.reads,0); assert.equal(h.listeners.size,0);
 h.win.operonLightboxPerf.start(); assert.equal(h.listeners.size,2);
 h.win.operonLightboxPerf.stop(); assert.equal(h.listeners.size,0);
 assert.equal(m.beginLightboxOpeningTrace(h.win.document,'editor'),undefined);
 dispose(); assert.equal(h.win.operonLightboxPerf,undefined);
});
test('overlapping traces retain their own counts and timing without content identifiers',async()=>{
 const m=await load(true),h=host();m.installLightboxOpeningProbe(h.win);h.win.operonLightboxPerf.start();
 const resource={path:'PRIVATE.md',text:'SECRET'};
 h.click();h.tick(3);const a=m.beginLightboxOpeningTrace(h.win.document,'editor');a.resource(resource);
 const end=a.span('native-open');h.tick(5);
 const b=m.beginLightboxOpeningTrace(h.win.document,'source');b.resource({path:'OTHER.md'});b.count('scans');h.tick(2);b.finish('ready');
 a.count('leaves');h.tick(4);end();a.kind('paired');a.finish('ready');a.count('scans');end();
 const data=report(h);assert.equal(data.samples[0].durationMs,14);assert.equal(data.samples[0].entryOffsetMs,3);
 assert.equal(data.samples[0].spans[0].durationMs,11);assert.equal(data.samples[0].leaves,1);assert.equal(data.samples[0].scans,0);
 assert.equal(data.samples[1].durationMs,2);assert.equal(data.samples[1].scans,1);assert.equal(data.samples[1].startPoint,'entry');
 assert.doesNotMatch(JSON.stringify(data),/PRIVATE|SECRET|OTHER/);
});
test('first observed sample and repeats are separated per source, kind, depth and input origin',async()=>{
 const m=await load(true),h=host();m.installLightboxOpeningProbe(h.win);h.win.operonLightboxPerf.start(); const file={};
 for(const ms of [100,10,30,20,40]){h.click();const t=m.beginLightboxOpeningTrace(h.win.document,'source');t.resource(file);h.tick(ms);t.finish('ready');}
 const s=report(h).summary[0];assert.equal(s.firstObservedMs,100);assert.equal(s.repeats,4);assert.equal(s.medianRepeatMs,25);assert.equal(s.slowestRepeatMs,40);
});
test('capture is bounded and abandoned/reset traces cannot change a later run',async()=>{
 const m=await load(true),h=host();m.installLightboxOpeningProbe(h.win);h.win.operonLightboxPerf.start();
 const old=m.beginLightboxOpeningTrace(h.win.document,'editor');const end=old.span('editor-mount');h.win.operonLightboxPerf.start();
 old.finish('ready');end();assert.equal(report(h).samples.length,0);
 for(let i=0;i<16;i++)assert.ok(m.beginLightboxOpeningTrace(h.win.document,'editor'));
 assert.equal(m.beginLightboxOpeningTrace(h.win.document,'editor'),undefined);h.win.operonLightboxPerf.stop();
 assert.ok(report(h).samples.every(s=>s.outcome==='cancelled'));
 h.win.operonLightboxPerf.start();for(let i=0;i<110;i++){const t=m.beginLightboxOpeningTrace(h.win.document,'editor');t.finish('ready');}
 assert.equal(report(h).samples.length,100);assert.equal(report(h).truncated,true);
 h.win.operonLightboxPerf.start();const t=m.beginLightboxOpeningTrace(h.win.document,'source');for(let i=0;i<80;i++)t.span('layout')?.();
 assert.equal(report(h).samples[0].spans.length,64);
});
test('wrong document, stale input, failed opens and late completion remain distinct',async()=>{
 const m=await load(true),h=host(),dispose=m.installLightboxOpeningProbe(h.win);h.win.operonLightboxPerf.start();
 assert.equal(m.beginLightboxOpeningTrace({},'source'),undefined);h.click();h.tick(1001);
 const t=m.beginLightboxOpeningTrace(h.win.document,'source');t.finish('error');t.finish('ready');
 assert.equal(report(h).samples[0].startPoint,'entry');assert.equal(report(h).samples[0].outcome,'error');assert.equal(report(h).summary.length,0);
 const pending=m.beginLightboxOpeningTrace(h.win.document,'editor');dispose();pending.finish('ready');assert.equal(h.listeners.size,0);
});
