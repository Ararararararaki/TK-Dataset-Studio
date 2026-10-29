from __future__ import annotations
import asyncio, base64, hashlib, io, json, os, re, subprocess, time, uuid
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlsplit
from PIL import Image, ImageOps
from .responses import annotation_only, check_response
from .images import file_block, jpeg_block

class NativeFailure(ValueError):
    def __init__(self,message,retryable=True):
        super().__init__(message);self.retryable=retryable
class NativeAttention(NativeFailure): pass

FINAL_BEGIN='<<<TK_FINAL_PROMPT>>>'
FINAL_END='<<<TK_FINAL_PROMPT_END>>>'

def final_text(value):
    """Accept a real final annotation, with or without the legacy envelope."""
    try:check_response(value)
    except ValueError as e:raise NativeFailure(str(e),False) from None
    tokens=list(re.finditer(r'<<<TK_FINAL_PROMPT(?:_END)?>>>',value))
    if not tokens:
        try:return annotation_only(value)
        except ValueError as e:raise NativeFailure(str(e),False) from None
    if [token.group() for token in tokens]!=[FINAL_BEGIN,FINAL_END]:
        raise NativeFailure('DSH 最终稿标记不完整，本次不会写入标注',retryable=False)
    annotation=value[tokens[0].end():tokens[1].start()].strip()
    if not annotation or value[tokens[1].end():].strip():
        raise NativeFailure('DSH 最终稿为空或含额外说明，本次不会写入标注',retryable=False)
    try:return annotation_only(annotation)
    except ValueError as e:raise NativeFailure(str(e),False) from None

def local_url(value):
    p=urlsplit(str(value))
    if p.scheme!='http' or p.hostname not in ('127.0.0.1','localhost','::1') or not p.port or p.username or p.password or p.fragment or p.query:
        raise NativeFailure('Relay 地址必须是本机 HTTP 连接')
    return str(value)

def unwrap(result):
    if getattr(result,'isError',False):
        data=getattr(result,'structuredContent',None)
        if isinstance(data,dict):raise NativeFailure(str(data.get('message') or data.get('code') or 'DSH 原生接口调用失败'),retryable=data.get('retryable',False))
        message=' '.join(getattr(c,'text','') for c in result.content)
        raise NativeFailure(message[:1000] or 'DSH 原生接口调用失败')
    if isinstance(getattr(result,'structuredContent',None),dict): return result.structuredContent
    for c in getattr(result,'content',[]):
        if getattr(c,'type','')=='text':
            try: return json.loads(c.text)
            except ValueError: pass
    raise NativeFailure('Relay 返回内容无法解析')

class Native:
    def __init__(self, root, settings):
        self.root=Path(root).resolve();self.settings=settings;self.active={};self.started_host=None

    def descriptor(self):
        config=self.settings()
        return Path(config.get('descriptor') or Path.home()/'.dsh/plugins/dsh-relay'/config.get('profile','web')/'relay-endpoint.json').expanduser()

    @asynccontextmanager
    async def peer(self):
        import httpx
        from mcp import ClientSession
        from mcp.client.streamable_http import streamable_http_client
        try:
            doc=json.loads(self.descriptor().read_text(encoding='utf-8-sig'))
            if doc.get('schemaVersion')!=1: raise ValueError('版本不支持')
            url=local_url(doc['mcpUrl']);host=local_url(doc['hostWebUrl'])
            if urlsplit(url).netloc!=urlsplit(host).netloc: raise ValueError('Relay 与 Host 来源不匹配')
            token=Path(doc['tokenFilePath']).read_text(encoding='utf-8').strip()
            if not token or any(c.isspace() for c in token): raise ValueError('凭据无效')
        except (OSError,KeyError,ValueError) as e: raise NativeFailure('DSH 未连接：请启动已安装 Relay 的 DSH，或在连接设置中检查路径') from e
        headers={'Authorization':'Bearer '+token,'x-dsh-relay-principal':'tk-dataset-studio'}
        try:
            async with httpx.AsyncClient(headers=headers,trust_env=False,timeout=httpx.Timeout(45)) as http:
                async with streamable_http_client(url,http_client=http,terminate_on_close=False) as (read,write,_):
                    async with ClientSession(read,write) as session:
                        await session.initialize()
                        async def call(name,args):
                            result=await session.call_tool(name,args)
                            try: return unwrap(result)
                            except NativeFailure as e: raise NativeFailure(str(e).replace(token,'[redacted]'),retryable=e.retryable) from None
                        yield call,host
        except (NativeFailure,asyncio.CancelledError): raise
        except Exception as e:
            def leaves(error):
                if isinstance(error,BaseExceptionGroup):
                    for child in error.exceptions:yield from leaves(child)
                else:yield error
            reasons=list(leaves(e))
            specific=next((r for r in reasons if isinstance(r,NativeFailure)),None)
            if specific:raise specific from None
            reason='; '.join(str(r).replace(token,'[redacted]') for r in reasons)
            invalid=any(getattr(getattr(r,'error',None),'code',None)==-32602 for r in reasons)
            raise NativeFailure('DSH 原生接口：'+reason[:1000],retryable=not invalid) from None

    async def catalog(self):
        async with self.peer() as (call,host):
            caps=await call('list_capabilities',{})
            workspaces=await call('list_workspaces',{})
            return {'connected':True,'capabilities':caps,'workspaces':workspaces.get('workspaces',[]),'host_url':host,'descriptor':str(self.descriptor()),'plugins':self.plugins()}

    def plugins(self):
        home=Path.home()/'.dsh';items=[]
        # Installation evidence only. It is not proof that a plugin ran in a session.
        for base in [home/'plugins',Path(os.environ.get('APPDATA',''))/'npm/node_modules']:
            if not base.is_dir(): continue
            for manifest in list(base.glob('*/package.json'))[:250]:
                try:
                    doc=json.loads(manifest.read_text(encoding='utf-8-sig'));name=doc.get('name','')
                    if 'dsh' in name or 'harness' in name: items.append({'name':name,'version':doc.get('version',''),'status':'installed; execution managed by DSH'})
                except (OSError,ValueError): pass
        return items

    async def launch(self):
        try: return await self.catalog()
        except NativeFailure: pass
        if self.started_host and self.started_host.poll() is None: raise NativeFailure('DSH 正在启动，请稍后检测连接')
        try:
            status=json.loads(self.descriptor().with_name('relay-status.json').read_text(encoding='utf-8-sig'))
            launcher=status['launcher'];command=Path(launcher['command']);args=launcher['args'];cwd=Path(launcher['cwd'])
            if not command.is_file() or not cwd.is_dir() or not isinstance(args,list) or not all(isinstance(a,str) for a in args): raise ValueError()
            if not any(Path(a).name in ('bin.js','dsh.js','cli.js') and Path(a).is_file() for a in args): raise ValueError()
            env=os.environ.copy();env.update({k:str(v) for k,v in launcher.get('environment',{}).items() if k.startswith('DSH_')})
            log=(self.root/'dsh-start.log').open('ab')
            self.started_host=subprocess.Popen([str(command),*args],cwd=cwd,env=env,stdin=subprocess.DEVNULL,stdout=log,stderr=log,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            log.close()
        except (OSError,KeyError,ValueError) as e: raise NativeFailure('没有可验证的 DSH 启动记录，请先正常安装并启动一次 DSH + Relay') from e
        for _ in range(30):
            await asyncio.sleep(1)
            try: return await self.catalog()
            except NativeFailure: pass
        raise NativeFailure('DSH 启动尚未完成，请查看连接设置中的日志并重新检测')

    @staticmethod
    def attachment(path):
        return {**file_block(path,max_side=1600,max_bytes=180000),'name':Path(path).name}

    @staticmethod
    def detail_attachments(path):
        with Image.open(path) as source:
            image=ImageOps.exif_transpose(source).convert('RGBA');w,h=image.size
            boxes=[(0,0,w,int(h*.6)),(0,int(h*.4),w,h)] if h>=w else [(0,0,int(w*.6),h),(int(w*.4),0,w,h)]
            output=[]
            for box in boxes:
                output.extend([{'type':'text','text':f'Detail crop of SAME original image, source pixel xyxy={list(box)}. Overlap repeats existing people, never count them twice. All output boxes still use the full original canvas.'},
                    {**jpeg_block(image.crop(box),max_side=1600,max_bytes=180000),'name':f'detail-{box}.jpg'}])
        return output

    async def annotate(self, row, task, config, key, progress, stop, resume_run=''):
        image=await asyncio.to_thread(self.attachment,row['path'])
        details=await asyncio.to_thread(self.detail_attachments,row['path']) if config.get('detail_pass') else []
        async with self.peer() as (call,host):
            if resume_run:
                run=await call('get_run',{'runId':resume_run})
            else:
                registered=(await call('list_workspaces',{})).get('workspaces',[])
                configured=config.get('workspace') or self.settings().get('workspace')
                if configured:
                    workspace=Path(configured).resolve()
                    if not any(Path(w['path']).resolve()==workspace for w in registered):raise NativeFailure('DSH 工作区已移除，请在连接设置中重新选择',retryable=False)
                else:
                    parents=[Path(w['path']).resolve() for w in registered if self.root.is_relative_to(Path(w['path']).resolve())]
                    if not parents:raise NativeFailure('请在连接设置中选择一个已注册的 DSH 工作区；可先在 DSH 添加专用空目录',retryable=False)
                    workspace=max(parents,key=lambda p:len(p.parts))
                base=self.root/'native' if self.root.is_relative_to(workspace) else workspace/'.tk-dataset-studio'/hashlib.sha256(str(self.root).encode()).hexdigest()[:16]
                request=base/hashlib.sha256(key.encode()).hexdigest()[:32]/'request.md'
                request.parent.mkdir(parents=True,exist_ok=True);request.write_text(task,encoding='utf-8')
                relative=request.relative_to(workspace).as_posix()
                selection={k:config[k] for k in ('provider','model','reasoningEffort','agentPreset') if config.get(k)}
                instruction=f'Read {relative} for the image-annotation requirements. Analyze the attached image. Do not change files or read other locations. Output only the requested final answer between {FINAL_BEGIN} and {FINAL_END}; no content after the closing marker. Put any process explanation outside these markers.'
                run=await call('start_run',{'workspace':str(workspace),
                    'content':[{'type':'text','text':instruction},image,*details],'sessionMode':'fresh','permissionPreset':'read-only',
                    'openBrowser':False,'authorizationBasis':'explicit-user-request','idempotencyKey':key,'reviewTargets':[relative],'contextReadScope':[relative],
                    'excludedPaths':[],'writeScope':[],**selection})
            rid=run.get('runId')
            if not isinstance(rid,str) or not rid: raise NativeFailure('DSH 未返回运行 ID')
            self.active[rid]=run
            if run.get('taskImageCount')!=(3 if details else 1):
                try:
                    await call('cancel_run',{'runId':rid,'idempotencyKey':'cancel:'+rid});self.active.pop(rid,None)
                except Exception:pass
                raise NativeFailure('DSH 未完整接收原图附件，本次不会写入标注',retryable=False)
            def metadata(value):return {**{k:value.get(k) for k in ('runId','sessionId','webUrl','status')},**value.get('modelSelection',{})}
            self.active[rid]=run;await progress({**run,**metadata(run)})
            try:
                start=time.monotonic()
                while run.get('status') in ('running','unknown'):
                    if stop.is_set():
                        await call('cancel_run',{'runId':rid,'idempotencyKey':'cancel:'+rid});raise asyncio.CancelledError()
                    if time.monotonic()-start>config.get('timeout',900):
                        raise NativeAttention('DSH 仍未完成；已保留运行 ID，请查看原生会话后重试，不重复提交')
                    run=await call('wait_run',{'runId':rid,'timeoutMs':10000});await progress({**run,**metadata(run)})
                if run.get('status')=='needs_attention': raise NativeAttention('DSH 等待处理，请打开原生会话；处理后重试可继续核对同一次运行')
                if run.get('status')!='succeeded': raise NativeFailure('DSH '+str(run.get('status'))+'：'+str(run.get('error') or run.get('assistantText') or '本次未完成')[:600])
                if run.get('assistantTextTruncated'):raise NativeFailure('DSH 最终稿被截断，本次不会写入标注',retryable=False)
                return final_text(run.get('assistantText')),metadata(run)
            finally:
                if run.get('status') in ('succeeded','failed','cancelled','incomplete'):self.active.pop(rid,None)

    async def cancel_all(self):
        if not self.active: return
        try:
            async with self.peer() as (call,_):
                for rid in list(self.active):
                    await call('cancel_run',{'runId':rid,'idempotencyKey':'cancel:'+rid});self.active.pop(rid,None)
        except Exception: pass

    def stop_owned_host(self):
        # Existing user-managed DSH is never stopped.
        if self.started_host and self.started_host.poll() is None:
            self.started_host.terminate()
            try: self.started_host.wait(timeout=5)
            except subprocess.TimeoutExpired: self.started_host.kill()
        self.started_host=None
