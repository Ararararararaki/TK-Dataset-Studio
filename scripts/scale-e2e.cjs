const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');const {chromium}=require('playwright-core');
(async()=>{
 const root=path.resolve(__dirname,'..'),folder=path.join(root,'.scratch/scale-dataset');fs.mkdirSync(folder,{recursive:true});
 const sources=['01-庆生与五人构图.jpg','02-多人物动作与遮挡.jpg'].map(n=>path.join(root,'.scratch/示例数据集',n));
 for(let i=0;i<1000;i++){const target=path.join(folder,`${String(i).padStart(4,'0')}.jpg`);if(!fs.existsSync(target))fs.linkSync(sources[i%2],target);}
 const browser=await chromium.connectOverCDP('http://127.0.0.1:9236'),page=browser.contexts()[0].pages()[0];
 const call=(method,params={})=>page.evaluate(({method,params})=>window.studio.invoke(method,params),{method,params});const before=await call('bootstrap');
 const start=performance.now(),[did]=await call('datasets.import',{paths:[folder]});const importMs=performance.now()-start;
 const rows=await call('images.list',{dataset_id:did});assert.equal(rows.length,1000);await call('ui.save',{dataset:did,view:'list'});await page.reload();await page.locator('.image-entry').first().waitFor();
 await page.waitForTimeout(400);const initialDom=await page.locator('.image-entry').count();
 const scrolling=await page.evaluate(async()=>{const el=document.querySelector('.image-scroll');const times=[];for(let i=0;i<16;i++){const start=performance.now();el.scrollTop=(i/15)*(el.scrollHeight-el.clientHeight);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));times.push(performance.now()-start)}return times;});
 const finalDom=await page.locator('.image-entry').count();assert.ok(initialDom<25&&finalDom<25,'The virtual list must stay bounded');
 // File-backed browser input supplies actual native File paths to Electron's drop handler.
 const drop=path.join(root,'.scratch/drop-dataset');fs.mkdirSync(drop,{recursive:true});const target=path.join(drop,'拖入的二次元图片.jpg');if(!fs.existsSync(target))fs.copyFileSync(sources[0],target);
 await page.evaluate(()=>{const input=document.createElement('input');input.type='file';input.id='native-qa-input';input.hidden=true;document.body.append(input)});
 const cdp=await page.context().newCDPSession(page);await cdp.send('DOM.enable');const doc=await cdp.send('DOM.getDocument');const inputNode=await cdp.send('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'#native-qa-input'});await cdp.send('DOM.setFileInputFiles',{nodeId:inputNode.nodeId,files:[target]});
 await page.evaluate(()=>{const input=document.querySelector('#native-qa-input'),data=new DataTransfer();for(const file of input.files)data.items.add(file);document.querySelector('.app').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));input.remove()});
 await page.waitForTimeout(600);const after=await call('bootstrap');assert.ok(after.datasets.some(d=>d.path===drop||d.path===drop.replaceAll('/','\\')),'Native drop should import the image folder');
 await call('datasets.remove',{id:did});for(const d of after.datasets.filter(d=>d.name==='drop-dataset'))await call('datasets.remove',{id:d.id});
 await call('ui.save',{dataset:before.datasets.find(d=>d.name==='示例数据集').id,view:'list'});await page.reload();
 const result={passed:true,images:1000,import_ms:+importMs.toFixed(1),initial_card_dom:initialDom,end_card_dom:finalDom,scroll_frame_p50_ms:scrolling.sort((a,b)=>a-b)[8],scroll_frame_max_ms:Math.max(...scrolling),native_file_drop:true};fs.writeFileSync(path.join(root,'.scratch/evidence/scale.json'),JSON.stringify(result,null,2));console.log(result);await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
