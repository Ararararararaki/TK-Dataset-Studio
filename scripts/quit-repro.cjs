const {_electron}=require('playwright-core'),path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const data=path.resolve('.scratch/quit-repro-'+Date.now());
 const app=await _electron.launch({executablePath:path.resolve(process.argv[2]||'release/win-unpacked/TK Dataset Studio.exe'),args:process.argv[2]?['.']:[],cwd:process.cwd(),env:{...process.env,TKDS_DATA:data},timeout:30000});
 const p=await app.firstWindow();await p.locator('.workspace').waitFor();const pid=app.process().pid;
 const start=Date.now();console.log('ready',pid);
 const closed=app.waitForEvent('close',{timeout:12000});
 await p.evaluate(()=>window.studio.window('close'));await closed;
 const endpoint=JSON.parse(fs.readFileSync(path.join(data,'agent-endpoint.json'),'utf8'));assert.equal(endpoint.status,'stopped');
 console.log({passed:true,elapsed_ms:Date.now()-start,pid});
})().catch(e=>{console.error(e.message);process.exit(1)});
