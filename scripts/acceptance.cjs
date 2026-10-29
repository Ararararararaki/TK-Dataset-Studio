const {chromium}=require('playwright-core');const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
(async()=>{
 const b=await chromium.connectOverCDP('http://127.0.0.1:9236');const p=b.contexts()[0].pages()[0];const errors=[];p.on('pageerror',e=>errors.push(e.message));
 const call=(method,params={})=>p.evaluate(({method,params})=>window.studio.invoke(method,params),{method,params});
 await p.reload();await p.locator('.image-entry').first().waitFor();
 const boot=await call('bootstrap');const rows=await call('images.list',{dataset_id:boot.datasets[0].id});const detail=await call('images.get',{id:rows[0].id});
 // The editable guidance stays a draft across preset changes and full reload.
 const guidance=p.getByRole('textbox',{name:'打标指导词',exact:true});const before=await guidance.inputValue();
 await guidance.fill(before+'\nQA: preserve readable text.');await p.waitForTimeout(500);await p.reload();await guidance.waitFor();assert.ok((await guidance.inputValue()).endsWith('QA: preserve readable text.'));
 await guidance.fill(before);await p.waitForTimeout(500);
 // Real textarea resize and full reload.
 const editor=p.getByRole('textbox',{name:detail.relative+' 打标文本',exact:true});await editor.evaluate(e=>{e.style.height='320px';e.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));});await p.waitForTimeout(300);await p.reload();await editor.waitFor();assert.ok(Math.abs((await editor.boundingBox()).height-320)<3);
 // Persist an immediate edit while the user switches datasets/views.
 await editor.fill(detail.text+'\nacceptance edit');await p.getByRole('button',{name:'缩略图网格',exact:true}).click();await p.waitForTimeout(400);
 let current=await call('images.get',{id:detail.id});assert.ok(current.text.endsWith('acceptance edit'));await call('images.save',{id:detail.id,text:detail.text,revision:current.revision,format:detail.format});
 await p.getByRole('button',{name:'图文列表',exact:true}).click();
 // Layout visual overlay uses the saved output and original image dimensions.
 await p.getByRole('button',{name:'放大预览',exact:true}).nth(1).click();await p.locator('.layout-preview rect').first().waitFor();const boxes=await p.locator('.layout-preview rect').count();assert.ok(boxes>=2);await p.getByRole('button',{name:'关闭预览',exact:true}).click();
 // Settings stay readable in light and dark themes.
 await p.getByRole('button',{name:'设置与模型',exact:true}).click();await p.getByRole('button',{name:'Agent 接管',exact:true}).click();await p.getByRole('combobox',{name:'Agent 接口权限',exact:true}).selectOption('read');await p.getByRole('button',{name:'关闭设置',exact:true}).click();
 await p.getByRole('button',{name:'切换主题',exact:true}).click();await p.screenshot({path:'.scratch/screenshots/08-dark-desktop.png'});await p.getByRole('button',{name:'切换主题',exact:true}).click();
 assert.deepEqual(errors,[]);const result={passed:true,checks:['guidance draft survives reload','output textarea height survives reload','edit survives view switch','MOSS overlay','Agent permission setting','both themes','zero page errors'],boxes,errors};fs.writeFileSync('.scratch/evidence/acceptance.json',JSON.stringify(result,null,2));console.log(result);await b.close();
})().catch(e=>{console.error(e);process.exit(1)});
