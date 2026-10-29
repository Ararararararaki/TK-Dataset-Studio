const {chromium}=require('playwright-core'),{spawn}=require('node:child_process'),path=require('node:path'),fs=require('node:fs'),net=require('node:net'),assert=require('node:assert/strict');
(async()=>{
 const data=path.resolve('.scratch/portable-state');fs.mkdirSync(data,{recursive:true});
 const version=require('../package.json').version;
 const exe=path.resolve(process.env.TKDS_QA_PORTABLE||`release/TK-Dataset-Studio-${version}-Windows-x64.exe`);
 const child=spawn(exe,['--remote-debugging-port=9236'],{cwd:process.cwd(),env:{...process.env,TKDS_DATA:data},stdio:'ignore',windowsHide:true});
 let ready=false;for(let i=0;i<120;i++){try{const r=await fetch('http://127.0.0.1:9236/json/version',{signal:AbortSignal.timeout(400)});if(r.ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,500))}
 assert.ok(ready,'Portable application must open its actual Electron window');
 const b=await chromium.connectOverCDP('http://127.0.0.1:9236'),p=b.contexts()[0].pages()[0];await p.locator('.workspace').waitFor();
 const boot=await p.evaluate(()=>window.studio.invoke('bootstrap'));assert.equal(boot.version,version);assert.equal(boot.datasets.length,0);
 await p.screenshot({path:'.scratch/screenshots/12-portable-desktop.png'});
 const closed=p.waitForEvent('close',{timeout:15000});await p.evaluate(()=>window.studio.window('close'));await closed;await b.close();
 const endpoint=JSON.parse(fs.readFileSync(path.join(data,'agent-endpoint.json')));assert.equal(endpoint.status,'stopped');assert.throws(()=>process.kill(endpoint.pid,0));
 const port=Number(new URL(boot.agent.url).port);assert.ok(await new Promise(r=>{const s=net.createServer();s.once('error',()=>r(false));s.listen(port,'127.0.0.1',()=>s.close(()=>r(true)))}));
 if(child.exitCode===null)await new Promise(r=>{child.once('exit',r);setTimeout(r,10000).unref()});
 const result={passed:true,bytes:fs.statSync(exe).size,independent_runtime:boot.agent.mcp.command,backend_exited:true,agent_port_released:true,portable_launcher_exited:child.exitCode!==null};assert.ok(result.portable_launcher_exited);
 fs.writeFileSync('.scratch/evidence/portable.json',JSON.stringify(result,null,2));console.log(result);
})().catch(e=>{console.error(e);process.exit(1)});
