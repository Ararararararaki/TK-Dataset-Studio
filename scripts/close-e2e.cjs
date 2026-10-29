const {chromium}=require('playwright-core');
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),assert=require('node:assert/strict');
(async()=>{
 const b=await chromium.connectOverCDP('http://127.0.0.1:9236'),p=b.contexts()[0].pages()[0];
 const call=(method,params={})=>p.evaluate(({method,params})=>window.studio.invoke(method,params),{method,params});
 await p.reload();await p.locator('.image-entry').first().waitFor();
 const boot=await call('bootstrap'),did=boot.ui.dataset||boot.datasets[0].id,rows=await call('images.list',{dataset_id:did}),row=await call('images.get',{id:rows[0].id});
 const editor=p.getByRole('textbox',{name:row.relative+' 打标文本',exact:true});await editor.fill(row.text+'\nClose flush QA.');
 const expected=row.text+'\nClose flush QA.',port=Number(new URL(boot.agent.url).port);
 // Closing immediately after input must flush the still-debounced editor.
 const closed=p.waitForEvent('close',{timeout:30000});await p.evaluate(()=>window.studio.window('close'));
 await closed;await b.close();
 const current=fs.readFileSync(row.path.replace(/\.[^.\\/]+$/,'.txt'),'utf8');assert.equal(current,expected);
 const endpoint=JSON.parse(fs.readFileSync(path.join(boot.data_root,'agent-endpoint.json'),'utf8'));assert.equal(endpoint.status,'stopped');
 const available=await new Promise(resolve=>{const s=net.createServer();s.once('error',()=>resolve(false));s.listen(port,'127.0.0.1',()=>s.close(()=>resolve(true)))});assert.ok(available,'Agent port must be released');
 const result={passed:true,immediate_edit_saved:true,agent_port_released:true,backend_pid:endpoint.pid,image_id:row.id,original:row.text,expected};
 fs.writeFileSync('.scratch/evidence/close.json',JSON.stringify(result,null,2));console.log({passed:true,immediate_edit_saved:true,agent_port_released:true,backend_pid:endpoint.pid});
})().catch(e=>{console.error(e);process.exit(1)});
