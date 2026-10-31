"""Stateless, one-image API requests; no DSH conversations or task files."""
import asyncio, json, time, uuid
from .connections import is_loopback
from .images import file_block
from .host_bridge import Bridge
from .native import NativeFailure
from .responses import check_response

class ApiTransport:
    def __init__(self,connections):self.connections=connections;self.active=set()

    async def cancel_all(self):
        for task in tuple(self.active):task.cancel()
        if self.active:await asyncio.gather(*tuple(self.active),return_exceptions=True)

    async def annotate(self,row,task,config,key,progress,stop,resume_run=''):
        if resume_run:raise NativeFailure('此记录来自旧版 Agent 会话；请重新打标，API 模式不会恢复或继续旧会话',False)
        if stop.is_set():raise asyncio.CancelledError()
        try:connection=self.connections.resolve(config)
        except ValueError as e:raise NativeFailure(str(e),False) from None
        image=await asyncio.to_thread(file_block,row['path'])
        content=[{'type':'text','text':task},{'type':'image_url','image_url':{'url':f'data:{image["mediaType"]};base64,{image["data"]}'}}]
        payload={'model':connection['model'],'messages':[{'role':'system','content':'You are a visual dataset annotator. Return only the requested final annotation. Do not narrate the task or use tools.'},{'role':'user','content':content}],
                 'stream':True,'max_tokens':int(config.get('max_tokens',8192))}
        effort=config.get('api_reasoning','off')
        if connection['provider']=='workbuddy' and 'deepseek' in connection['model'].lower():
            payload['thinking']={'type':'enabled' if effort!='off' else 'disabled'}
        if effort not in ('off','',None):payload['reasoning_effort']=effort
        meta={'transport':'api','requestId':uuid.uuid4().hex,'provider':connection['provider'],'model':connection['model'],'status':'running','runId':''}
        await progress(meta)
        operation=asyncio.create_task(self.request(connection,payload,config,meta))
        self.active.add(operation);cancel=asyncio.create_task(stop.wait())
        try:
            done,_=await asyncio.wait((operation,cancel),return_when=asyncio.FIRST_COMPLETED)
            if cancel in done and stop.is_set():operation.cancel();raise asyncio.CancelledError()
            result=await operation
            meta['status']='succeeded';return result,meta
        finally:
            cancel.cancel();operation.cancel();await asyncio.gather(cancel,operation,return_exceptions=True);self.active.discard(operation)

    async def request(self,connection,payload,config,meta):
        import httpx
        started=time.monotonic();key=connection['key'];headers={'Authorization':'Bearer '+key} if key else {}
        proxy=None if is_loopback(connection['base_url']) else config.get('proxy') or 'http://127.0.0.1:7890'
        timeout=max(15,min(3600,float(config.get('timeout',180))))
        try:
            async with asyncio.timeout(timeout):
                async with httpx.AsyncClient(proxy=proxy,trust_env=False,timeout=httpx.Timeout(timeout,connect=15)) as client:
                    async with client.stream('POST',connection['base_url']+'/chat/completions',headers=headers,json=payload) as response:
                        if response.status_code>=400:
                            # Do not echo raw gateway errors: they may contain credentials or image data.
                            meaning={400:'模型或请求参数不兼容',401:'认证失败',403:'请求被服务拒绝',413:'图片请求过大',429:'请求限流',500:'服务内部错误',502:'网关错误',503:'服务不可用',504:'网关超时'}.get(response.status_code,'请求失败')
                            raise NativeFailure(f'API {meaning}（HTTP {response.status_code}）；本次未保存、不会自动重复计费请求',False)
                        chunks=[];finish=None;size=0;refused=False
                        if 'text/event-stream' not in response.headers.get('content-type',''):
                            raw=await response.aread()
                            if len(raw)>16*1024*1024:raise NativeFailure('API 响应过大',False)
                            value=json.loads(raw);choice=(value.get('choices') or [{}])[0];message=choice.get('message',{})
                            finish=choice.get('finish_reason');refused=bool(message.get('refusal'));chunks=[self.text(message.get('content'))]
                            meta['usage']=value.get('usage')
                        else:
                            async for line in response.aiter_lines():
                                if not line.startswith('data:'):continue
                                data=line[5:].strip()
                                if not data or data=='[DONE]':continue
                                if len(data)>2*1024*1024:raise NativeFailure('API 响应片段过大',False)
                                value=json.loads(data)
                                if value.get('error'):raise NativeFailure('API 在生成过程中返回错误；未保存、不自动重发',False)
                                if value.get('usage'):meta['usage']=value['usage']
                                for choice in value.get('choices',[]):
                                    if choice.get('index',0)!=0:continue
                                    delta=choice.get('delta',{})
                                    part=self.text(delta.get('content'));size+=len(part)
                                    if size>2000000:raise NativeFailure('API 正文过大',False)
                                    chunks.append(part);refused=refused or bool(delta.get('refusal'))
                                    if choice.get('finish_reason'):finish=choice['finish_reason']
                        if refused or finish=='content_filter':raise NativeFailure('模型拒绝了本次请求；未保存标注，不会自动重试',False)
                        if finish=='length':raise NativeFailure('模型输出被 token 上限截断；未保存，请增加输出 token 上限或缩短指导词',False)
                        if finish!='stop':raise NativeFailure('API 未返回完整的最终正文；未保存，不会自动重发',False)
                        try:result=check_response(''.join(chunks))
                        except ValueError as e:raise NativeFailure(str(e),False) from None
                        meta['elapsed']=round(time.monotonic()-started,3);return result
        except (NativeFailure,asyncio.CancelledError):raise
        except (asyncio.TimeoutError,httpx.TimeoutException):raise NativeFailure('API 请求超时；未保存、不自动重发，避免重复计费',False) from None
        except Exception:raise NativeFailure('API 连接或响应解析失败；未保存、不自动重发，请检测连接',False) from None

    @staticmethod
    def text(value):
        if isinstance(value,str):return value
        if isinstance(value,list):return ''.join(v.get('text','') for v in value if isinstance(v,dict) and v.get('type') in ('text','output_text'))
        return ''

class AnnotationClient:
    """One transport owner; never silently fall back between API, bridge and Agent."""
    def __init__(self,native,connections):
        self.native=native;self.connections=connections;self.api=ApiTransport(connections);self.bridge=Bridge(connections)
    async def catalog(self):
        transport=self.connections.settings().get('transport')
        if transport=='native':return await self.native.catalog()
        if transport=='bridge':return await self.bridge_catalog()
        return await self.connections.catalog()
    async def bridge_catalog(self):
        config=self.connections.settings()
        try:value=await self.bridge.status(config)
        except NativeFailure as e:return {'connected':False,'transport':'bridge','error':str(e),'plugins':[],'providers':[],'tools':{'available':False,'names':[]}}
        dsh=config.get('dsh') or {}
        providers=value.get('providers') or []
        # 前端按 capabilities.models 取默认路由与分组；桥接没有 DSH 的 list_capabilities，
        # 这里用桥接自报的 provider 列表合成同样结构，模型细节由 dsh.models 单独取。
        capabilities={'models':{'default':{'provider':dsh.get('provider') or '','model':dsh.get('model') or ''},
                                'groups':[{'id':p.get('id',''),'label':p.get('name') or p.get('id',''),
                                           'models':[{'id':m.get('id'),'name':m.get('name') or m.get('id')}
                                                     for m in (p.get('models') or []) if m.get('id')]}
                                          for p in providers if p.get('id')]}}
        return {'connected':True,'transport':'bridge','host_url':config.get('bridge_url') or 'http://127.0.0.1:3080',
                'port':value.get('port'),'providers':providers,'tools':value.get('tools') or {'available':False,'names':[]},
                'purge':bool(value.get('purge')),'token_required':bool(value.get('tokenRequired')),'plugins':[],
                'workspaces':[],'capabilities':capabilities}
    async def bridge_models(self,provider):
        return await self.bridge.models(self.connections.settings(),provider)
    async def bridge_tool(self,name,arguments=None):
        return await self.bridge.tool(self.connections.settings(),name,arguments)
    async def annotate(self,row,task,config,key,progress,stop,resume_run=''):
        transport={'native':self.native,'bridge':self.bridge}.get(config.get('transport'),self.api)
        return await transport.annotate(row,task,config,key,progress,stop,resume_run)
    async def cancel_all(self):await asyncio.gather(self.api.cancel_all(),self.native.cancel_all(),self.bridge.cancel_all())
