import {build} from 'esbuild';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const temporary=await mkdtemp(path.join(tmpdir(),'operon-custom-key-reuse-'));
try{
 const outfile=path.join(temporary,'tests.mjs');
 await build({entryPoints:[path.join(root,'scripts/custom-key-type-reuse.test.ts')],outfile,bundle:true,format:'esm',platform:'node',target:'node18',logLevel:'silent',
  banner:{js:`import {createRequire as bundleRequire} from 'node:module'; const require=bundleRequire(${JSON.stringify(path.join(root,'package.json'))});`},
  alias:{obsidian:path.join(root,'scripts/test-support/obsidian-native-yaml.ts')},
 });
 process.exitCode=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['--test',outfile],{cwd:root,stdio:'inherit'});child.once('error',reject);child.once('exit',code=>resolve(code??1));});
}finally{await rm(temporary,{recursive:true,force:true});}
