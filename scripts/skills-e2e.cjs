// Deterministic checkbox/text geometry; no user images, DSH or paid model calls.
const {_electron}=require('playwright-core');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const root=path.resolve(__dirname,'..'),data=path.join(root,`.scratch/skills-ui-${Date.now()}`),home=path.join(data,'home');
 const names=['moss_'+ 'longSkillName'.repeat(8),'image-caption-guidance','character-reference-binding'];
 for(const name of names){const dir=path.join(home,'.dsh/skills',name);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'SKILL.md'),'Describe visible characters and their actions.');}
 const packaged=process.argv.includes('--packaged');
 const app=await _electron.launch({executablePath:process.env.TKDS_QA_EXE||path.join(root,packaged?'release/win-unpacked/TK Dataset Studio.exe':'node_modules/electron/dist/electron.exe'),args:packaged?[]:['.'],cwd:root,env:{...process.env,TKDS_DATA:data,USERPROFILE:home},timeout:60000});
 try{
  const page=await app.firstWindow();await page.locator('.workspace').waitFor();
  await page.evaluate(()=>window.studio.invoke('ui.save',{preset:'caption',inspector:true}));await page.reload();
  const details=page.locator('.advanced').filter({has:page.getByText('辅助 Skill 指导词',{exact:false})});await details.locator('summary').click();
  for(const [width,theme] of [[1440,'light'],[920,'light'],[920,'dark']]){
   await page.setViewportSize({width,height:900});await page.evaluate(theme=>{document.documentElement.dataset.theme=theme},theme);
   const checks=details.locator('label.check-field');assert.equal(await checks.count(),3);
   for(let n=0;n<3;n++){
    const bounds=await checks.nth(n).evaluate(el=>{const box=el.getBoundingClientRect(),input=el.querySelector('input').getBoundingClientRect(),text=el.querySelector('span').getBoundingClientRect();return {labelWidth:box.width,inputWidth:input.width,textWidth:text.width,textRight:text.right,labelRight:box.right};});
    assert.ok(bounds.inputWidth<=20,`Checkbox must not consume the Skill row: ${JSON.stringify(bounds)}`);
    assert.ok(bounds.textWidth>70&&bounds.textRight<=bounds.labelRight+1,`Skill name must fit: ${JSON.stringify(bounds)}`);
   }
  }
  await checksAt(details,1).setChecked(true);await page.waitForFunction(async()=> (await window.studio.invoke('bootstrap')).settings.skill_ids.length===1);
  await page.reload();await details.locator('summary').click();assert.ok(await checksAt(details,1).isChecked());
  await page.getByRole('button',{name:'DSH Agent',exact:true}).click();
  await page.waitForFunction(async()=> (await window.studio.invoke('bootstrap')).settings.dsh.transport==='native');
  assert.match(await page.getByTestId('execution-channel-status').innerText(),/DSH Agent/);
  await page.getByRole('button',{name:'API 直连',exact:true}).click();
  await page.waitForFunction(async()=> (await window.studio.invoke('bootstrap')).settings.dsh.transport==='api');
  assert.match(await page.getByTestId('execution-channel-status').innerText(),/API 直连/);
  await details.scrollIntoViewIfNeeded?.();
  await page.screenshot({path:path.join(root,`.scratch/screenshots/skills-${packaged?'packaged':'dev'}.png`)});
  fs.writeFileSync(path.join(root,`.scratch/evidence/skills-${packaged?'packaged':'dev'}.json`),JSON.stringify({passed:true,packaged,skills:3,widths:[1440,920],themes:['light','dark'],selectionPersisted:true,visibleChannelSwitch:true},null,2));
  console.log('Skill names fit beside 13px checkboxes at 920/1440px; selection persists.');
 }finally{await app.close();}
 function checksAt(details,n){return details.locator('label.check-field input').nth(n);}
})().catch(e=>{console.error(e);process.exitCode=1});
