// Isolated UI/sidecar verification. No models, real DSH sessions, user images or paid requests.
const {_electron}=require('playwright-core');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const root=path.resolve(__dirname,'..'),data=path.join(root,`.scratch/hover-ui-${Date.now()}`),folder=path.join(data,'images'),home=path.join(data,'home');
 fs.mkdirSync(folder,{recursive:true});fs.mkdirSync(home,{recursive:true});
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
 for(const name of ['01-caption','02-empty','03-short'])fs.writeFileSync(path.join(folder,name+'.png'),png);
 const caption='A girl holds a red umbrella beside a station. '+('Behind her, passengers wait beside the ticket counter. '.repeat(120))+' END-OF-FULL-CAPTION';
 fs.writeFileSync(path.join(folder,'01-caption.txt'),caption);fs.writeFileSync(path.join(folder,'03-short.txt'),'Two friends wave.');
 const packaged=process.argv.includes('--packaged');
 const app=await _electron.launch({executablePath:process.env.TKDS_QA_EXE||path.join(root,packaged?'release/win-unpacked/TK Dataset Studio.exe':'node_modules/electron/dist/electron.exe'),args:packaged?[]:['.'],cwd:root,env:{...process.env,TKDS_DATA:data,USERPROFILE:home},timeout:60000});
 try{
  const page=await app.firstWindow();await page.locator('.workspace').waitFor();
  const ids=await page.evaluate(folder=>window.studio.invoke('datasets.import',{paths:[folder]}),folder);
  await page.evaluate(dataset=>window.studio.invoke('ui.save',{dataset,view:'grid',preset:'caption',inspector:true}),ids[0]);await page.reload();
  await page.locator('.thumb-card').first().waitFor();
  const backup=page.getByRole('checkbox',{name:'覆盖前备份 TXT'});
  assert.ok(await backup.isChecked());await backup.uncheck();
  await page.waitForFunction(async()=>!(await window.studio.invoke('bootstrap')).settings.backup_before_overwrite);
  await page.reload();await page.locator('.thumb-card').first().waitFor();assert.equal(await backup.isChecked(),false);
  // Save through the real renderer IPC boundary, following persistent settings rather than passing a save override.
  const replacement=caption+' UPDATED';
  await page.evaluate(async({dataset,text})=>{const [row]=await window.studio.invoke('images.list',{dataset_id:dataset});await window.studio.invoke('images.save',{id:row.id,text,format:'caption',revision:row.revision});},{dataset:ids[0],text:replacement});
  assert.equal(fs.readFileSync(path.join(folder,'01-caption.txt'),'utf8'),replacement);
  const backupFiles=fs.existsSync(path.join(data,'backups'))?fs.readdirSync(path.join(data,'backups'),{recursive:true}).filter(n=>n.endsWith('.txt')):[];assert.equal(backupFiles.length,0);
  await page.reload();await page.locator('.thumb-card').first().waitFor();
  const popup=page.getByRole('dialog',{name:'打标文本预览'});
  const measurements=[];
  for(const [width,height,theme] of [[1440,900,'light'],[920,650,'dark']]){
   await page.setViewportSize({width,height});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
   await page.mouse.move(5,5);await page.locator('.thumb-card').first().hover();await popup.waitFor();
   await page.waitForFunction(text=>document.querySelector('.annotation-hover-text')?.textContent===text,replacement);
   const box=await popup.boundingBox();assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=width+1&&box.y+box.height<=height+1);
   const text=popup.locator('.annotation-hover-text');await text.hover();await text.evaluate(el=>el.scrollTop=el.scrollHeight);await page.waitForTimeout(250);assert.ok(await popup.isVisible(),'Scrolling the text must not dismiss it');
   assert.ok((await text.textContent()).endsWith('UPDATED'));assert.equal(await page.locator('.thumb-card.selected').count(),0);
   measurements.push({width,height,theme,popup:box});await page.keyboard.press('Escape');await popup.waitFor({state:'hidden'});
  }
  await page.locator('.thumb-card').nth(1).hover();await popup.waitFor();await page.waitForFunction(()=>document.querySelector('.annotation-hover-text')?.textContent==='暂无打标文本');
  await page.keyboard.press('Escape');
  // Keyboard focus also exposes the preview; pointer selection and drag handlers remain untouched.
  await page.locator('.thumb-card').nth(2).getByRole('button').focus();await popup.waitFor();await page.waitForFunction(()=>document.querySelector('.annotation-hover-text')?.textContent==='Two friends wave.');
  await page.screenshot({path:`.scratch/screenshots/annotation-hover-${packaged?'packaged':'dev'}.png`});
  await page.keyboard.press('Escape');await page.locator('.thumb-card').first().hover();await popup.waitFor();
  await page.locator('.image-scroll').evaluate(el=>el.dispatchEvent(new Event('scroll',{bubbles:true})));
  await popup.waitFor({state:'hidden'});
  const result={passed:true,packaged,backupPreferencePersisted:true,ipcSaveWithoutBackup:true,fullCaptionCharacters:replacement.length,emptyCaption:true,keyboardPreview:true,scrollDismiss:true,selectionUnchanged:true,measurements};
  fs.writeFileSync(`.scratch/evidence/annotation-hover-${packaged?'packaged':'dev'}.json`,JSON.stringify(result,null,2));console.log(result);
  const closed=page.waitForEvent('close');await page.evaluate(()=>window.studio.window('close'));await closed;
 }finally{await app.close();}
})().catch(error=>{console.error(error);process.exit(1)});
