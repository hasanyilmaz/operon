import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import ts from 'typescript';
import {build} from 'esbuild';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=fs.mkdtempSync(path.join(tmpdir(),'operon-filter-signature-'));
try {
 const ast=ts.createSourceFile('filter.ts',fs.readFileSync(path.join(root,'src/ui/embed-filter-processor.ts'),'utf8'),ts.ScriptTarget.Latest,true);
 const fn=ast.statements.find(n=>n.name?.text==='renderFilterSurface');
 const statements=fn.body.statements;const end=statements.findIndex(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(ast)==='renderSignature'));assert.ok(end>=0);
 const outfile=path.join(dir,'test.mjs');
 await build({stdin:{resolveDir:root,loader:'ts',contents:`
 export {DEFAULT_SETTINGS} from './src/types/settings';
 import {buildTaskWikilinkOverlaySettingsSignature} from './src/ui/task-wikilink-overlay-chips';
 import {buildTaskStatusIconRenderSettingsSignature} from './src/ui/task-status-icon-signature';
 let language='en';export const setLanguage=value=>language=value;const getCurrentLang=()=>language;
 const localToday=()=> '2026-10-09',getOwnerDocument=()=>({activeElement:null}),shouldResolveLocationCompactChips=()=>false;
 const getFilterSortSpecs=()=>[],getTableFilePropertyIndex=()=>({getSnapshot:()=>({signature:'props'})});
 const buildWorkflowStatusOrderSignature=JSON.stringify,buildWorkflowStatusSemanticsSignature=JSON.stringify;
 export function signature(instance,filterSet,deps,options={}){${statements.slice(0,end+1).map(n=>n.getText(ast)).join('\n')}return renderSignature;}
 `},outfile,bundle:true,format:'esm',platform:'node',logLevel:'silent',alias:{obsidian:path.join(root,'scripts/test-support/obsidian.ts')}});
 const {signature,DEFAULT_SETTINGS,setLanguage}=await import(pathToFileURL(outfile).href);
 const settings=structuredClone(DEFAULT_SETTINGS),instance={el:{cloneNode:()=>({}),querySelector:()=>null},searchQuery:''};
 let generation=1;const deps={settings,getSettings:()=>settings,getPipelines:()=>settings.pipelines,indexer:{getAllTasks:()=>[],getGeneration:()=>generation}};
 const read=()=>signature(instance,{id:'filter'},deps);assert.equal(read(),read());
 const changes=[()=>settings.calendarWeekStart='sunday',()=>settings.timeFormat='12h',()=>settings.assigneeImageProperty='Avatar',()=>setLanguage('tr'),()=>settings.keyMappings[0].type='number',()=>settings.priorities[0].color='#123456',()=>generation++];
 for(const change of changes){const before=read();change();assert.notEqual(read(),before);}
 console.log('Filter render signature: unchanged + 7 freshness changes passed');
} finally {fs.rmSync(dir,{recursive:true,force:true});}
