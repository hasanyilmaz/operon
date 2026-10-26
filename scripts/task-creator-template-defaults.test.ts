import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SettingsPreservationHarness } from './test-support/settings-preservation-harness';
import { migrateSettings } from '../src/types/settings';

async function fixture() {
 const disk=new SettingsPreservationHarness({table:false});
 const storage=disk.createStorage();await storage.initialize();
 return {disk,storage,settings:storage.getSettings()};
}
for(const inline of [false,true])for(const file of [false,true])test(`dynamic defaults independent: inline=${inline}, file=${file}`,async()=>{
 const {disk,storage,settings}=await fixture();try{
  await storage.updateSettings({inlineTaskUseLastTemplateAsDefault:inline,fileTaskUseLastTemplateAsDefault:file,defaultInlineTaskTemplateId:'initial-inline',taskCreatorDefaultFileTemplateId:'initial-file'});
  for(const mode of ['inline','file'] as const)for(const id of ['A','B']){
   const key=mode==='inline'?'defaultInlineTaskTemplateId':'taskCreatorDefaultFileTemplateId';const enabled=mode==='inline'?inline:file;
   await storage.saveTaskCreatorTemplateUsage({createType:mode,templateId:id,enabledAtSubmit:enabled,expectedDefaultId:settings[key]});
   assert.equal(settings[key],enabled?id:`initial-${mode}`);
  }
  assert.equal(settings.defaultInlineTaskTemplateId,inline?'B':'initial-inline');
  assert.equal(settings.taskCreatorDefaultFileTemplateId,file?'B':'initial-file');
  const reopened=disk.createStorage();await reopened.initialize();assert.equal(reopened.getSettings().inlineTaskUseLastTemplateAsDefault,inline);assert.equal(reopened.getSettings().fileTaskUseLastTemplateAsDefault,file);
  await storage.updateSettings({inlineTaskUseLastTemplateAsDefault:false,fileTaskUseLastTemplateAsDefault:false});
  assert.equal(settings.defaultInlineTaskTemplateId,inline?'B':'initial-inline');assert.equal(settings.taskCreatorDefaultFileTemplateId,file?'B':'initial-file');
  assert.equal(disk.package().ui.taskCreationProfile.inlineTaskUseLastTemplateAsDefault,undefined);
 }finally{await disk.dispose();}
});
test('old package loading is zero-write and malformed flags remain off',async()=>{
 const {disk,settings}=await fixture();try{
  assert.equal(settings.inlineTaskUseLastTemplateAsDefault,false);assert.equal(settings.fileTaskUseLastTemplateAsDefault,false);
  const count=disk.canonicalAttempts,raw=disk.raw();
  const reopened=disk.createStorage();await reopened.initialize();assert.equal(disk.canonicalAttempts,count);assert.equal(disk.raw(),raw);
  const malformed=migrateSettings({inlineTaskUseLastTemplateAsDefault:'true',fileTaskUseLastTemplateAsDefault:1});
  assert.equal(malformed.inlineTaskUseLastTemplateAsDefault,false);assert.equal(malformed.fileTaskUseLastTemplateAsDefault,false);
 }finally{await disk.dispose();}
});
test('same default and picker history produce no save; unknown and unrelated values survive',async()=>{
 const {disk,storage,settings}=await fixture();try{
  await storage.updateSettings({inlineTaskUseLastTemplateAsDefault:true,defaultInlineTaskTemplateId:'A',lastUsedFileTaskTemplateId:'A'});
  const count=disk.canonicalAttempts,before=disk.raw();
  await storage.saveTaskCreatorTemplateUsage({createType:'inline',templateId:'A',enabledAtSubmit:true,expectedDefaultId:'A'});
  assert.equal(disk.canonicalAttempts,count);assert.equal(disk.raw(),before);
  const unrelated=settings.dailyNoteFolder;
  await storage.saveTaskCreatorTemplateUsage({createType:'inline',templateId:'B',enabledAtSubmit:true,expectedDefaultId:'A'});
  assert.equal(settings.dailyNoteFolder,unrelated);for(const [path,contents] of disk.sentinels)assert.equal(await disk.adapter.read(path),contents);
 }finally{await disk.dispose();}
});
for(const changed of ['toggle','default','enabled-late'])test(`in-flight preference protected: ${changed}`,async()=>{
 const {disk,storage,settings}=await fixture();try{
  await storage.updateSettings({inlineTaskUseLastTemplateAsDefault:true,defaultInlineTaskTemplateId:'A'});
  if(changed==='toggle')settings.inlineTaskUseLastTemplateAsDefault=false;
  if(changed==='default')settings.defaultInlineTaskTemplateId='manual';
  await storage.saveTaskCreatorTemplateUsage({createType:'inline',templateId:'B',enabledAtSubmit:changed!=='enabled-late',expectedDefaultId:'A'});
  assert.equal(settings.defaultInlineTaskTemplateId,changed==='default'?'manual':'A');
 }finally{await disk.dispose();}
});
test('settings failure preserves committed preferences and permits later retry',async()=>{
 const {disk,storage,settings}=await fixture();try{
  await storage.updateSettings({inlineTaskUseLastTemplateAsDefault:true,defaultInlineTaskTemplateId:'A'});
  const before=disk.raw();disk.writeFault='throw-before';
  await assert.rejects(storage.saveTaskCreatorTemplateUsage({createType:'inline',templateId:'B',enabledAtSubmit:true,expectedDefaultId:'A'}));
  assert.equal(settings.defaultInlineTaskTemplateId,'A');assert.equal(disk.raw(),before);
  disk.writeFault='none';await storage.saveTaskCreatorTemplateUsage({createType:'inline',templateId:'B',enabledAtSubmit:true,expectedDefaultId:'A'});
  assert.equal(settings.defaultInlineTaskTemplateId,'B');
 }finally{await disk.dispose();}
});

for(const changed of ['toggle','default'])test(`conditional persistence rejects preference change at disk boundary: ${changed}`,async()=>{
 const {disk,storage,settings}=await fixture();try{
  await storage.updateSettings({inlineTaskUseLastTemplateAsDefault:true,defaultInlineTaskTemplateId:'A'});
  const original=disk.adapter.process;
  disk.adapter.process=(path,callback)=>original(path,source=>{
   if(changed==='toggle')settings.inlineTaskUseLastTemplateAsDefault=false;
   else settings.defaultInlineTaskTemplateId='manual';
   return callback(source);
  });
  const count=disk.canonicalAttempts;
  await storage.saveTaskCreatorTemplateUsage({createType:'inline',templateId:'B',enabledAtSubmit:true,expectedDefaultId:'A'});
  assert.equal(disk.canonicalAttempts,count);assert.equal(disk.package().ui.taskCreationProfile.defaultInlineTaskTemplateId,'A');
  assert.equal(settings.defaultInlineTaskTemplateId,changed==='default'?'manual':'A');
 }finally{await disk.dispose();}
});
test('profile unknown extensions survive learning and disabled toggles are removed on disk',async()=>{
 const first=await fixture();let raw:string;
 try{const pkg=first.disk.package();Object.assign(pkg.ui.taskCreationProfile,{futureExtension:{preserve:'yes'},inlineTaskUseLastTemplateAsDefault:true});raw=JSON.stringify(pkg);}finally{await first.disk.dispose();}
 const disk=new SettingsPreservationHarness({table:false,initialRaw:raw!});try{
  const storage=disk.createStorage();await storage.initialize();
  await storage.saveTaskCreatorTemplateUsage({createType:'inline',templateId:'B',enabledAtSubmit:true,expectedDefaultId:storage.getSettings().defaultInlineTaskTemplateId});
  assert.deepEqual((disk.package().ui.taskCreationProfile as unknown as Record<string,unknown>).futureExtension,{preserve:'yes'});
  await storage.updateSettings({inlineTaskUseLastTemplateAsDefault:false});
  const reloaded=disk.createStorage();await reloaded.initialize();assert.equal(reloaded.getSettings().inlineTaskUseLastTemplateAsDefault,false);assert.equal(reloaded.getSettings().defaultInlineTaskTemplateId,'B');
 }finally{await disk.dispose();}
});

test('conversion Creator setting defaults off, persists, and preserves unrelated settings',async()=>{
 const {disk,storage,settings}=await fixture();try{
  assert.equal(settings.inlineTaskOpenCreatorBeforeConversion,false);
  assert.equal(migrateSettings({inlineTaskOpenCreatorBeforeConversion:'true'}).inlineTaskOpenCreatorBeforeConversion,false);
  const before=disk.canonicalAttempts;const reopened=disk.createStorage();await reopened.initialize();assert.equal(disk.canonicalAttempts,before);
  const target=settings.defaultInlineTaskTemplateId;
  await storage.updateSettings({inlineTaskOpenCreatorBeforeConversion:true});
  const reload=disk.createStorage();await reload.initialize();assert.equal(reload.getSettings().inlineTaskOpenCreatorBeforeConversion,true);assert.equal(reload.getSettings().defaultInlineTaskTemplateId,target);
  await storage.updateSettings({inlineTaskOpenCreatorBeforeConversion:false});
  const final=disk.createStorage();await final.initialize();assert.equal(final.getSettings().inlineTaskOpenCreatorBeforeConversion,false);
 }finally{await disk.dispose();}
});

test('canonical package without conversion toggle reloads byte-for-byte without writes',async()=>{
 const first=await fixture();let raw:string;try{const pkg=first.disk.package();delete (pkg.settings as Partial<typeof pkg.settings>).inlineTaskOpenCreatorBeforeConversion;raw=JSON.stringify(pkg);}finally{await first.disk.dispose();}
 const disk=new SettingsPreservationHarness({table:false,initialRaw:raw!});try{const storage=disk.createStorage();await storage.initialize();assert.equal(storage.getSettings().inlineTaskOpenCreatorBeforeConversion,false);assert.equal(disk.canonicalAttempts,0);assert.equal(disk.raw(),raw!);}finally{await disk.dispose();}
});


for (const key of ['fileTaskAfterCreate', 'inlineTaskAfterCreate'] as const) {
for (const value of [undefined, 'none', null, true, 1, 'future-action', 'source', 'background-tab', 'editor']) test(`${key} opening preference initializes without writes: ${String(value)}`, async () => {
 const first = await fixture(); let raw: string;
 try {
  const pkg = first.disk.package(); const profile = pkg.ui.taskCreationProfile as unknown as Record<string, unknown>;
  if (value === undefined) delete profile[key]; else profile[key] = value;
  profile.futureOpeningExtension = { preserved: true }; raw = JSON.stringify(pkg);
 } finally { await first.disk.dispose(); }
 const disk = new SettingsPreservationHarness({ table: false, initialRaw: raw! });
 try {
  const storage = disk.createStorage(); await storage.initialize();
  assert.equal(storage.getSettings()[key], value === 'source' || value === 'background-tab' || value === 'editor' ? value : 'none');
  assert.equal(disk.canonicalAttempts, 0); assert.equal(disk.raw(), raw!);
 } finally { await disk.dispose(); }
});

for (const action of ['new-tab', 'background-tab', 'source', 'source-and-editor', 'editor'] as const) test(`${key} opening persists, resets and survives unrelated settings: ${action}`, async () => {
 const { disk, storage, settings } = await fixture();
 try {
  const unrelated = settings.dailyNoteFolder;
  await storage.updateSettings({ [key]: action });
  assert.equal(disk.package().ui.taskCreationProfile[key], action);
  const loaded = disk.createStorage(); await loaded.initialize(); assert.equal(loaded.getSettings()[key], action);
  await storage.updateSettings({ [key]: 'none' });
  assert.equal(disk.package().ui.taskCreationProfile[key], undefined);
  assert.equal(settings.dailyNoteFolder, unrelated);
  const count = disk.canonicalAttempts; const raw = disk.raw();
  const reopened = disk.createStorage(); await reopened.initialize();
  assert.equal(reopened.getSettings()[key], 'none'); assert.equal(disk.canonicalAttempts, count); assert.equal(disk.raw(), raw);
 } finally { await disk.dispose(); }
});

test(`${key} opening failed persistence leaves committed memory and source intact`, async () => {
 const { disk, storage, settings } = await fixture();
 try {
  await storage.updateSettings({ [key]: 'source' }); const before = disk.raw();
  disk.writeFault = 'throw-before';
  await assert.rejects(storage.updateSettings({ [key]: 'background-tab' }));
  assert.equal(settings[key], 'source'); assert.equal(disk.raw(), before);
 } finally { await disk.dispose(); }
});


test(`${key} unrelated saves preserve an unknown stored opening value until an explicit reset`, async () => {
 const first=await fixture();let raw:string;
 try {const pkg=first.disk.package();Object.assign(pkg.ui.taskCreationProfile,{[key]:'future-action',futureOpeningExtension:{keep:true}});raw=JSON.stringify(pkg);}finally{await first.disk.dispose();}
 const disk=new SettingsPreservationHarness({table:false,initialRaw:raw!});
 try {
  const storage=disk.createStorage();await storage.initialize();
  await storage.updateSettings({taskDescriptionRequired:!storage.getSettings().taskDescriptionRequired});
  assert.equal((disk.package().ui.taskCreationProfile as any)[key],'future-action');
  await storage.updateSettings({[key]:'none'});
  assert.equal(disk.package().ui.taskCreationProfile[key],undefined);
  assert.deepEqual((disk.package().ui.taskCreationProfile as any).futureOpeningExtension,{keep:true});
 }finally{await disk.dispose();}
});

}
