// A real packaged UI/backend round trip against a deterministic vision API.
// Does not send paid model requests or start DSH conversations.
const { _electron }=require('playwright-core');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),net=require('node:net'),assert=require('node:assert/strict');
(async()=>{
  const root=path.resolve(__dirname,'..'),stamp=Date.now();
  const data=path.join(root,`.scratch/api-ui-${stamp}`),images=path.join(data,'images');fs.mkdirSync(images,{recursive:true});
  for(const f of fs.readdirSync(path.join(root,'.scratch/示例数据集')).filter(f=>f.endsWith('.jpg')))fs.copyFileSync(path.join(root,'.scratch/示例数据集',f),path.join(images,f));
  const requests=[];
  const server=http.createServer((req,res)=>{
    if(req.method==='GET'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{id:'qa-vision'}]}));return;}
    let raw='';req.on('data',d=>raw+=d);req.on('end',()=>{
      requests.push({path:req.url,payload:JSON.parse(raw),authenticated:req.headers.authorization==='Bearer ui-test-key'});
      res.setHeader('Content-Type','text/event-stream');
      res.end('data: '+JSON.stringify({choices:[{index:0,delta:{content:'Five anime characters gather at a colorful outdoor festival stall.'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
    });
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const packaged=process.argv.includes('--packaged');
  const app=await _electron.launch({executablePath:process.env.TKDS_QA_EXE || path.join(root,packaged?'release/win-unpacked/TK Dataset Studio.exe':'node_modules/electron/dist/electron.exe'),args:packaged?[]:['.'],cwd:root,env:{...process.env,TKDS_DATA:data},timeout:60000});
  let closed=false;
  try{
    const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.locator('.workspace').waitFor();
    const call=(method,params={})=>page.evaluate(({method,params})=>window.studio.invoke(method,params),{method,params});
    const boot=await call('bootstrap');
    const current=JSON.parse(fs.readFileSync(path.join(root,'.scratch/current-bootstrap.json'),'utf8'));const model=(current.result||current).settings.wd14;
    const settings={...boot.settings,lookup_characters:false,lookup_missing:false,character_update:false,wd14:{...model,device:'cpu'},dsh:{...boot.settings.dsh,api_source:'manual',api_base:`http://127.0.0.1:${server.address().port}/v1`,api_model:'qa-vision',model:'qa-vision',provider:'manual'}};
    await call('settings.save',settings);const [dataset]=await call('datasets.import',{paths:[images]});await call('ui.save',{dataset,preset:'caption',view:'list',inspector:true});await page.reload();
    await page.locator('.image-entry').first().waitFor();
    await page.getByRole('button',{name:'设置与模型',exact:true}).click();
    assert.equal(await page.getByLabel('打标执行方式',{exact:true}).inputValue(),'api');
    assert.ok(await page.getByText('API 模式复用模型连接，不执行 DSH 会话插件。',{exact:false}).isVisible());
    await page.getByLabel('API Key',{exact:true}).fill('ui-test-key');await page.getByRole('button',{name:'保存 Key',exact:true}).click();
    await page.waitForFunction(async()=>!(await window.studio.invoke('bootstrap')).settings.dsh.new_api_key && (await window.studio.invoke('bootstrap')).settings.dsh.api_key_saved);
    const saved=await call('bootstrap');assert.ok(!JSON.stringify(saved).includes('ui-test-key'));
    await page.getByRole('button',{name:'检测连接',exact:true}).click();await page.getByText('API 连接就绪 · 无 DSH 会话',{exact:true}).waitFor();
    await page.screenshot({path:path.join(root,`.scratch/screenshots/api-${packaged?'packaged':'dev'}-settings.png`)});
    await page.getByRole('button',{name:'关闭设置',exact:true}).click();
    assert.equal(await page.getByRole('checkbox',{name:/独立看图复核/}).isChecked(),false);
    await page.getByRole('button',{name:'开始打标',exact:true}).click();
    let job;for(let i=0;i<90;i++){await page.waitForTimeout(500);job=(await call('jobs.list'))[0];if(job&&job.state!=='running')break;}
    assert.equal(job?.state,'completed');assert.deepEqual(job.counts,{done:2});assert.equal(requests.length,2);
    assert.deepEqual(requests.map(r=>({path:r.path,authenticated:r.authenticated,model:r.payload.model,image:r.payload.messages[1].content[1].type})),Array.from({length:2},()=>({path:'/v1/chat/completions',authenticated:true,model:'qa-vision',image:'image_url'})));
    const after=await call('bootstrap');assert.equal(after.datasets[0].completed,2);
    const rows=await call('images.list',{dataset_id:dataset});for(const row of rows){const detail=await call('images.get',{id:row.id});assert.equal(detail.native.transport,'api');assert.equal(detail.native.runId,'');assert.equal(fs.readFileSync(detail.path.replace(/\.[^.\\/]+$/,'.txt'),'utf8'),detail.text);}
    await page.screenshot({path:path.join(root,`.scratch/screenshots/api-${packaged?'packaged':'dev'}-results.png`)});
    assert.deepEqual(errors,[]);
    const closing=app.waitForEvent('close',{timeout:15000});await page.evaluate(()=>window.studio.window('close'));await closing;closed=true;
    const endpoint=JSON.parse(fs.readFileSync(path.join(data,'agent-endpoint.json'),'utf8'));assert.equal(endpoint.status,'stopped');
    const port=Number(new URL(after.agent.url).port);assert.ok(await new Promise(r=>{const s=net.createServer();s.once('error',()=>r(false));s.listen(port,'127.0.0.1',()=>s.close(()=>r(true)))}));
    const evidence={passed:true,packaged,images:2,requests:requests.length,completed:after.datasets[0].completed,stored_keys_redacted:true,default_single_pass:true,txts_saved:true,no_agent_run_ids:true,agent_port_released:true,errors};
    fs.writeFileSync(path.join(root,`.scratch/evidence/api-ui-${packaged?'packaged':'dev'}.json`),JSON.stringify(evidence,null,2));console.log(evidence);
  }finally{if(!closed)await app.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
