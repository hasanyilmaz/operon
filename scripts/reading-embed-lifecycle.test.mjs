import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import ts from 'typescript';
import {build} from 'esbuild';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=fs.mkdtempSync(path.join(tmpdir(),'operon-embed-lifetime-'));
try {
 const source=fs.readFileSync(path.join(root,'src/ui/embed-filter-processor.ts'),'utf8');
 const ast=ts.createSourceFile('embed.ts',source,ts.ScriptTarget.Latest,true);
 const names=['createFilterSurfaceInstance','destroyFilterSurfaceInstance','destroyEmbedFilterInstance','parseFilterReference','resolveFilterSet','registerEmbedFilterProcessor','refreshEmbedFilters','renderEmbed','EmbedFilterRenderChild'];
 const declarations=names.map(name=>{const n=ast.statements.find(n=>n.name?.text===name);assert.ok(n,name);return n.getText(ast);});
 const prelude=`class MarkdownRenderChild{constructor(el){this.containerEl=el;}}
 const activeEmbeds=new Set(),FILTER_RENDER_BATCH_SIZE=50;
 const requestCloseTextFieldPopoversForOwner=el=>{el.closed++;},cleanupOperonRenderRoot=el=>{el.cleaned++;};
 const parseEmbedWidthPercent=()=>null,isSpecialDynamicFilterSet=()=>false;
 const bindEmbedPercentWidth=el=>()=>{el.widthCleaned++;},refreshActiveEmbedPercentWidths=()=>{};
 const renderError=(el,message)=>{el.error=message;};
 function renderFilterSurface(instance,filter,deps){instance.el.rendered=deps.indexer.getGeneration();instance.el.renders++;}
 `;
 const outfile=path.join(dir,'test.mjs');await build({stdin:{contents:prelude+declarations.join('\n'),resolveDir:root,loader:'ts'},outfile,bundle:true,format:'esm',platform:'node',logLevel:'silent'});
 const {registerEmbedFilterProcessor:register,refreshEmbedFilters:refresh}=await import(pathToFileURL(outfile).href);
 const setup=(connected=true)=>{
  let generation=1,handler,child;const el={isConnected:connected,cleaned:0,closed:0,widthCleaned:0,renders:0,empty(){}};
  const deps={settings:{filterSets:[{id:'fs_test',name:'Test'}]},indexer:{getGeneration:()=>generation}};
  register((_lang,fn)=>{handler=fn;},deps);handler('filterId: fs_test',el,{addChild:value=>{child=value;}});
  return {el,deps,child,update(){generation++;refresh(deps);},dispose(){child.onunload();}};
 };
 let count=0;const test=(name,fn)=>{fn();count++;console.log('PASS',name);};
 test('initial detached section keeps receiving updates before attachment',()=>{
  const s=setup(false);s.update();assert.equal(s.el.rendered,2);assert.equal(s.el.cleaned,0);s.el.isConnected=true;assert.equal(s.el.rendered,2);s.dispose();
 });
 test('temporarily detached section returns with the latest rendered generation',()=>{
  const s=setup();s.el.isConnected=false;s.update();s.el.isConnected=true;assert.equal(s.el.rendered,2);assert.equal(s.el.widthCleaned,0);s.update();assert.equal(s.el.rendered,3);s.dispose();
 });
 test('temporary detach retains its owner and width binding until real unload',()=>{
  const s=setup();const instance=s.child.instance;s.el.isConnected=false;s.update();
  assert.equal(s.child.instance,instance);assert.equal(s.el.widthCleaned,0);
  let disconnected=0;instance.lazyLoadObserver={disconnect(){disconnected++;}};
  s.dispose();assert.equal(disconnected,1);assert.equal(s.el.widthCleaned,1);
 });
 for(const connected of [false,true])test('real child unload cleans and unregisters a '+(connected?'connected':'detached')+' section',()=>{
  const s=setup(connected);s.dispose();const before=s.el.renders;s.update();assert.equal(s.el.renders,before);assert.equal(s.el.cleaned,1);assert.equal(s.el.closed,1);assert.equal(s.el.widthCleaned,1);
 });
 test('repeated detach and reattach never duplicates the registered instance',()=>{
  const s=setup();for(let i=0;i<3;i++){s.el.isConnected=false;s.update();s.el.isConnected=true;s.update();}assert.equal(s.el.renders,7);s.dispose();
 });
 console.log(`Reading embed lifecycle: ${count}/${count} passed`);
} finally {fs.rmSync(dir,{recursive:true,force:true});}
