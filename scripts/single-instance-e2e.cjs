const {_electron}=require('playwright-core'),{spawn}=require('node:child_process'),path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const exe=path.resolve(process.argv[2]||'release/win-unpacked/TK Dataset Studio.exe'),dev=exe.includes('node_modules'),data=path.resolve('.scratch/instance-qa-'+Date.now()),env={...process.env,TKDS_DATA:data};
 const first=await _electron.launch({executablePath:exe,args:dev?['.']:[],cwd:process.cwd(),env,timeout:30000});
 let second;
 try{
  const p=await first.firstWindow();await p.locator('.workspace').waitFor();
  const descriptor=path.join(data,'agent-endpoint.json'),initial=JSON.parse(fs.readFileSync(descriptor));
  second=spawn(exe,dev?['.']:[],{cwd:process.cwd(),env,stdio:'ignore',windowsHide:true});
  const exited=await Promise.race([new Promise(r=>second.once('exit',()=>r(true))),new Promise(r=>setTimeout(()=>r(false),4000))]);
  assert.ok(exited,'Second instance must exit promptly');
  assert.equal(JSON.parse(fs.readFileSync(descriptor)).pid,initial.pid,'Second instance must not start/overwrite the backend');
  console.log({passed:true,second_instance_exits:true,single_backend:true});
 }finally{
  if(second&&second.exitCode===null)second.kill();
  await Promise.race([first.close().catch(()=>{}),new Promise(r=>setTimeout(()=>{first.process().kill();r()},5000).unref())]);
 }
})().catch(e=>{console.error(e.message);process.exitCode=1});
