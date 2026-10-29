"""Authenticated loopback control adapter; the existing Server owns every operation."""
from __future__ import annotations
import asyncio, hmac, json, os, secrets, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

READ={'bootstrap','images.list','images.get','images.history','jobs.list','dsh.catalog','agent.audit','agent.image'}
WRITE={'datasets.import','datasets.scan','datasets.relocate','images.save','presets.save','presets.delete','jobs.start','jobs.pause','jobs.resume','jobs.cancel','assistant.chat','characters.save'}

class AgentAPI:
    def __init__(self,server):
        self.server=server;self.http=None;self.thread=None;self.loop=None
        self.root=server.store.root;self.descriptor=self.root/'agent-endpoint.json'
        self.token=secrets.token_urlsafe(40)
        self.tasks=set()
        server.store.execute('CREATE TABLE IF NOT EXISTS agent_audit(id INTEGER PRIMARY KEY,created REAL,client TEXT,method TEXT,target TEXT,success INTEGER,error TEXT)')

    def info(self):
        return {'enabled':self.http is not None,'access':self.server.settings().get('agent_access','read'),
                'descriptor':str(self.descriptor),'url':f'http://127.0.0.1:{self.http.server_port}/rpc' if self.http else '',
                'mcp':{'command':str(Path(__import__('sys').executable)),
                       'args':['-m','backend.agent_mcp','--data',str(self.root)]}}

    async def dispatch(self,method,params,client):
        task=asyncio.current_task();self.tasks.add(task)
        try:return await self.operation(method,params,client)
        finally:self.tasks.discard(task)

    async def operation(self,method,params,client):
        access=self.server.settings().get('agent_access','read')
        params={k:v for k,v in params.items() if not k.startswith('_')}
        try:
            if access=='off':raise PermissionError('Agent 接口已关闭')
            if method not in READ and not (access=='write' and method in WRITE):raise PermissionError('该操作需要在设置中开启“允许 Agent 操作与修改”')
            if method=='agent.audit':result=self.server.store.query('SELECT * FROM agent_audit ORDER BY id DESC LIMIT 100')
            elif method=='agent.image':
                row=self.server.store.image(params['id'])
                result=await asyncio.to_thread(self.server.native.attachment,row['path'])
            else:result=await self.server.dispatch(method,{**params,'_actor':'Agent · '+client})
        except Exception as e:
            self.audit(client,method,params,False,str(e));raise
        self.audit(client,method,params,True,'');return result

    def audit(self,client,method,params,success,error):
        self.server.store.execute('INSERT INTO agent_audit(created,client,method,target,success,error) VALUES(?,?,?,?,?,?)',
            (time.time(),client,method,str(params.get('id') or params.get('dataset_id') or '')[:128],success,error[:500]))

    async def start(self):
        if self.http or self.server.settings().get('agent_access','read')=='off':return
        self.token=secrets.token_urlsafe(40)
        self.loop=asyncio.get_running_loop();owner=self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def do_POST(self):
                self.connection.settimeout(10)
                try:
                    length=int(self.headers.get('Content-Length','0'))
                    if not 0<length<=2*1024*1024:raise ValueError()
                    payload=self.rfile.read(length)
                except (OSError,ValueError):return self.reply(413,{'error':'Invalid request length'})
                if self.path!='/rpc':return self.reply(404,{'error':'Unknown route'})
                if self.headers.get('Origin') or self.headers.get('Sec-Fetch-Site'):return self.reply(403,{'error':'Browser requests are not accepted'})
                if self.headers.get('Host')!=f'127.0.0.1:{owner.http.server_port}':return self.reply(403,{'error':'Invalid host'})
                if not hmac.compare_digest(self.headers.get('Authorization',''),'Bearer '+owner.token):return self.reply(401,{'error':'Invalid local credential'})
                try:
                    value=json.loads(payload)
                    if not isinstance(value,dict) or not isinstance(value.get('method'),str) or not isinstance(value.get('params',{}),dict):raise ValueError('请求结构无效')
                    client=self.headers.get('X-TKDS-Client','local-agent')[:80]
                    future=asyncio.run_coroutine_threadsafe(owner.dispatch(value['method'],value.get('params',{}),client),owner.loop)
                    try:result=future.result(timeout=1250)
                    except TimeoutError:
                        future.cancel();raise ValueError('操作超时，请先读取任务状态')
                    self.reply(200,{'result':result})
                except PermissionError as e:self.reply(403,{'error':str(e)})
                except Exception as e:self.reply(400,{'error':str(e)[:1200]})
            def reply(self,status,body):
                raw=json.dumps(body,ensure_ascii=False).encode()
                try:
                    self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(raw)));self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(raw)
                except (OSError,ConnectionError):pass
        self.http=ThreadingHTTPServer(('127.0.0.1',0),Handler);self.http.daemon_threads=True
        tokenfile=self.root/'agent.token';tokenfile.write_text(self.token,encoding='utf-8');os.chmod(tokenfile,0o600)
        self.descriptor.write_text(json.dumps({'schemaVersion':1,'status':'running','pid':os.getpid(),'url':self.info()['url'],'tokenFile':str(tokenfile)},indent=2),encoding='utf-8')
        self.thread=threading.Thread(target=lambda:self.http.serve_forever(poll_interval=.2),daemon=True,name='studio-agent-api');self.thread.start()

    async def close(self):
        if not self.http:return
        await asyncio.to_thread(self.http.shutdown);self.http.server_close();self.thread.join(timeout=2);self.http=None
        pending=list(self.tasks)
        for task in pending:task.cancel()
        if pending:await asyncio.gather(*pending,return_exceptions=True)
        self.descriptor.write_text(json.dumps({'schemaVersion':1,'status':'stopped','pid':os.getpid()}),encoding='utf-8')
