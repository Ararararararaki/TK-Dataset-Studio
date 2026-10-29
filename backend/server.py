from __future__ import annotations
import asyncio, hashlib, json, os, sys, threading, time, uuid
from pathlib import Path
from .store import Store, encoded
from .tagger import models
from .presets import BUILTINS
from .native import Native
from .connections import Connections
from .api_transport import AnnotationClient
from .jobs import Jobs
from .references import References
from .agent_api import AgentAPI

DEFAULTS={'model_dirs':[],'wd14':{'model':'','device':'cpu','threshold':.35,'character_threshold':.85,'exclude_tags':''},
 'dsh':{'transport':'api','api_source':'dsh','profile':'web','descriptor':'','timeout':180,'max_tokens':8192,'api_reasoning':'off','api_base':'','api_model':'','repair_format':False},'overwrite':False,'output_warning':12000,'proxy':'http://127.0.0.1:7890','skill_ids':[],
 'lookup_characters':True,'character_snapshot':'','character_update':True,'lookup_missing':True,'agent_access':'read'}

class Server:
    def __init__(self,root):
        self.store=Store(root);self.output_lock=threading.Lock();self.native=Native(root,lambda:self.settings()['dsh'])
        self.connections=Connections(root,lambda:{**self.settings()['dsh'],'proxy':self.settings()['proxy']})
        self.llm=AnnotationClient(self.native,self.connections)
        for item in self.store.query("SELECT DISTINCT run_id FROM job_items WHERE run_id<>''"):
            self.native.active[item['run_id']]={'runId':item['run_id'],'status':'unknown'}
        self.references=References(self.store,self.settings,self.notify)
        self.jobs=Jobs(self.store,self.llm,self.notify,self.references);self.stop=asyncio.Event();self.download_lock=asyncio.Lock()
        self.agent=AgentAPI(self)
        for p in BUILTINS:
            if not self.store.query('SELECT id FROM presets WHERE id=?',(p['id'],)):self.store.execute('INSERT INTO presets VALUES(?,?)',(p['id'],encoded(p)))
        if not self.store.get_setting('migration_api_v1',False):
            old={'presets':self.presets(),'ui':self.store.get_setting('ui',{})}
            backup=self.store.root/'before-api-v1.json'
            if not backup.exists():backup.write_text(encoded(old),encoding='utf-8')
            # Built-ins are immutable in the UI; custom copies keep all choices.
            for p in BUILTINS:self.store.execute('UPDATE presets SET body=? WHERE id=?',(encoded(p),p['id']))
            ui=old['ui']
            for name,draft in ui.get('presetDrafts',{}).items():
                if name in {p['id'] for p in BUILTINS} and isinstance(draft,dict):draft['review']=False
            self.store.set_setting('ui',ui);self.store.set_setting('migration_api_v1',True)

    def write(self,value):
        with self.output_lock:sys.stdout.write(encoded(value)+'\n');sys.stdout.flush()
    def notify(self,event):self.write({'event':event})
    def settings(self):
        saved=self.store.get_setting('config',{})
        result={**DEFAULTS,**saved,'wd14':{**DEFAULTS['wd14'],**saved.get('wd14',{})},'dsh':{**DEFAULTS['dsh'],**saved.get('dsh',{})}}
        result['dsh']['api_key_saved']=(self.store.root/'api-key.dpapi').exists()
        return result

    def presets(self):return [json.loads(r['body']) for r in self.store.query('SELECT body FROM presets ORDER BY rowid')]

    def skills(self):
        result=[]
        for base in (Path.home()/'.dsh/skills',Path.home()/'.codex/skills'):
            if not base.exists():continue
            for path in base.glob('*/SKILL.md'):
                try:
                    text=path.read_text(encoding='utf-8-sig')
                    if any(w in path.parent.name.lower() for w in ('moss','caption','image','tag','character')):
                        result.append({'id':str(path),'name':path.parent.name,'characters':len(text)})
                except OSError:pass
        return result

    async def download(self,repo):
        allowed={'SmilingWolf/wd-eva02-large-tagger-v3','SmilingWolf/wd-v1-4-moat-tagger-v2'}
        if repo not in allowed:raise ValueError('不支持的模型来源')
        import httpx
        async with self.download_lock:
            proxy=self.settings().get('proxy') or 'http://127.0.0.1:7890'
            dest=self.store.root/'models';dest.mkdir(exist_ok=True);name=repo.split('/')[-1]
            async with httpx.AsyncClient(proxy=proxy,trust_env=False,follow_redirects=True,timeout=httpx.Timeout(90)) as client:
                response=await client.get(f'https://huggingface.co/api/models/{repo}?blobs=true');response.raise_for_status();meta=response.json()
                for source,ext in [('model.onnx','.onnx'),('selected_tags.csv','.csv')]:
                    info=next(x for x in meta['siblings'] if x['rfilename']==source);target=dest/(name+ext);partial=target.with_suffix(ext+'.part')
                    start=partial.stat().st_size if partial.exists() else 0;headers={'Range':f'bytes={start}-'} if start else {}
                    async with client.stream('GET',f'https://huggingface.co/{repo}/resolve/{meta["sha"]}/{source}',headers=headers) as stream:
                        stream.raise_for_status();append=start>0 and stream.status_code==206
                        count=start if append else 0;last=0
                        with partial.open('ab' if append else 'wb') as file:
                            async for block in stream.aiter_bytes(1024*1024):
                                file.write(block);count+=len(block)
                                if time.monotonic()-last>.5:self.notify({'kind':'download','model':name,'bytes':count,'total':info.get('size',0)});last=time.monotonic()
                    if info.get('size') and partial.stat().st_size!=info['size']:raise ValueError('下载大小校验失败，已保留断点')
                    expected=info.get('lfs',{}).get('sha256')
                    if expected:
                        def sha():
                            h=hashlib.sha256()
                            with partial.open('rb') as f:
                                for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
                            return h.hexdigest()
                        if await asyncio.to_thread(sha)!=expected:raise ValueError('模型 SHA256 校验失败')
                    os.replace(partial,target)
            settings=self.settings();settings['model_dirs']=list(dict.fromkeys([*settings['model_dirs'],str(dest)]))
            settings['wd14']['model']=str(dest/(name+'.onnx'));self.store.set_setting('config',settings)
            self.notify({'kind':'download','done':True,'model':name});return self.bootstrap()

    def bootstrap(self):
        return {'datasets':self.store.datasets(),'presets':self.presets(),'settings':self.settings(),
            'models':models(self.settings()['model_dirs']),'skills':self.skills(),'jobs':self.jobs.snapshot(),
            'ui':self.store.get_setting('ui',{}),'data_root':str(self.store.root),'agent':self.agent.info(),'version':'0.1.2'}

    async def dispatch(self,method,p):
        if method=='bootstrap':return self.bootstrap()
        if method=='datasets.import':
            result=await asyncio.to_thread(self.store.import_paths,p['paths'],self.notify);self.notify({'kind':'datasets'});return result
        if method=='datasets.scan':
            row=self.store.query('SELECT path FROM datasets WHERE id=?',(p['id'],))
            if not row:raise ValueError('数据集不存在')
            result=await asyncio.to_thread(self.store.import_paths,[row[0]['path']],self.notify);self.notify({'kind':'datasets'});return result
        if method=='datasets.remove':
            if self.jobs.task and not self.jobs.task.done():raise ValueError('请先停止任务再移除目录')
            # Remove only the index, never images or sidecars.
            self.store.execute('DELETE FROM images WHERE dataset_id=?',(p['id'],));self.store.execute('DELETE FROM datasets WHERE id=?',(p['id'],));return self.store.datasets()
        if method=='datasets.relocate':
            new=Path(p['path']).resolve(strict=True)
            if not new.is_dir():raise ValueError('请选择目录')
            old=self.store.query('SELECT * FROM datasets WHERE id=?',(p['id'],))[0]
            if self.jobs.task and not self.jobs.task.done():raise ValueError('任务运行时不能重新定位')
            for image in self.store.query('SELECT id,relative FROM images WHERE dataset_id=?',(p['id'],)):
                self.store.execute('UPDATE images SET path=? WHERE id=?',(str(new/image['relative']),image['id']))
            self.store.execute('UPDATE datasets SET path=?,name=? WHERE id=?',(str(new),new.name,p['id']))
            return await asyncio.to_thread(self.store.import_paths,[str(new)],self.notify)
        if method=='images.list':return self.store.list_images(p['dataset_id'],p.get('search',''),p.get('status','all'))
        if method=='images.get':return self.store.image(p['id'])
        if method=='images.thumbnail':return await asyncio.to_thread(self.store.thumbnail,p['id'],p.get('full',False))
        if method=='images.save':
            result=await asyncio.to_thread(self.store.save,p['id'],p['text'],p.get('format','manual'),p['revision'],reason=p.get('_actor','手动编辑'));self.notify({'kind':'image','id':p['id'],'stage':'已保存'});return result
        if method=='images.history':return self.store.history(p['id'])
        if method=='settings.save':
            current=self.settings();value={**current,**p};
            value['dsh']={**current['dsh'],**value.get('dsh',{})}
            dsh=value['dsh'];api_key=dsh.pop('new_api_key','');clear=dsh.pop('clear_api_key',False);dsh.pop('api_key_saved',None)
            if dsh.get('transport') not in ('api','native'):raise ValueError('请选择 API 或 Agent 连接方式')
            if dsh.get('api_source') not in ('dsh','manual'):raise ValueError('请选择 DSH 连接或手动 API')
            for field,low,high in (('max_tokens',256,131072),('timeout',15,3600)):
                n=dsh.get(field,DEFAULTS['dsh'][field])
                if type(n) not in (int,float) or not low<=n<=high:raise ValueError(f'{field} 应在 {low}–{high} 之间')
                dsh[field]=int(n)
            if value['wd14'].get('model'):value['wd14']['model']=str(Path(value['wd14']['model']).resolve())
            for key in ('threshold','character_threshold'):
                n=value['wd14'].get(key,.35)
                if not isinstance(n,(int,float)) or not 0<=n<=1:raise ValueError('阈值应在 0 到 1 之间')
            if value.get('agent_access') not in ('off','read','write'):raise ValueError('Agent 权限设置无效')
            self.connections.save_key(api_key,clear);self.store.set_setting('config',value)
            if value['agent_access']=='off':await self.agent.close()
            else:await self.agent.start()
            return self.bootstrap()
        if method=='ui.save':self.store.set_setting('ui',{**self.store.get_setting('ui',{}),**p});return True
        if method=='models.list':return models(self.settings()['model_dirs'])
        if method=='models.download':return await self.download(p['repo'])
        if method=='presets.save':
            value=p['preset'];ident=value.get('id','')
            if ident in {x['id'] for x in BUILTINS} or not ident:ident='custom-'+uuid.uuid4().hex
            if value.get('format') not in ('tags','caption','hybrid','moss') or value.get('pipeline') not in ('wd14','wd14-llm','llm') or not value.get('name','').strip():raise ValueError('请填写预设名称并选择输出格式')
            value={**value,'id':ident};self.store.execute('INSERT OR REPLACE INTO presets VALUES(?,?)',(ident,encoded(value)));return self.presets()
        if method=='presets.delete':
            if not p['id'].startswith('custom-'):raise ValueError('内置预设请另存为副本')
            self.store.execute('DELETE FROM presets WHERE id=?',(p['id'],));return self.presets()
        if method=='dsh.catalog':return await self.llm.catalog()
        if method=='dsh.start':
            await self.native.launch();return await self.llm.catalog()
        if method=='jobs.list':return self.jobs.snapshot()
        if method=='jobs.start':
            cfg=p['config'];known={s['id']:s for s in self.skills()}
            for skillid in cfg.get('skill_ids',[]):
                if skillid not in known:raise ValueError('辅助 Skill 不存在，请刷新设置')
                cfg['preset']['guidance']+='\nAuxiliary reference, subordinate to the required annotation format:\n'+Path(skillid).read_text(encoding='utf-8-sig')
            return await self.jobs.start(p['dataset_id'],cfg,p.get('ids'),p.get('only_failed',False),p.get('extra',''))
        if method=='jobs.resume':return await self.jobs.resume(p['id'])
        if method=='jobs.pause':return await self.jobs.pause()
        if method=='jobs.cancel':return await self.jobs.cancel()
        if method=='assistant.chat':
            image=self.store.image(p['id']);stop=asyncio.Event()
            async def progress(run):self.notify({'kind':'assistant','stage':'DSH 思考中','web_url':run.get('webUrl')})
            text,native=await self.llm.annotate(image,'Help the user improve a training annotation for the attached image. Do not modify files. Answer in Chinese. Current annotation: '+image['text']+'\nWD14 evidence: '+encoded(image['raw'])+'\nQuestion: '+p['instruction'],{**self.settings()['dsh'],'proxy':self.settings()['proxy']},'tkds:chat:'+uuid.uuid4().hex,progress,stop)
            return {'text':text,'native':native}
        if method=='characters.save':
            return self.references.save(p)
        if method=='shutdown':self.stop.set();return True
        raise ValueError('未知操作：'+method)

    async def request(self,request):
        ident=request.get('id')
        try:result=await self.dispatch(request['method'],request.get('params') or {});self.write({'id':ident,'result':result})
        except asyncio.CancelledError:self.write({'id':ident,'error':'操作已取消'})
        except Exception as e:self.write({'id':ident,'error':str(e)[:3000]})

    async def run(self):
        pending=set()
        await self.agent.start()
        maintenance=asyncio.create_task(self.references.maintenance())
        try:
            while not self.stop.is_set():
                line=await asyncio.to_thread(sys.stdin.readline)
                if not line:break
                try:request=json.loads(line)
                except ValueError:continue
                task=asyncio.create_task(self.request(request));pending.add(task);task.add_done_callback(pending.discard)
                if request.get('method')=='shutdown':await task;break
        finally:
            await self.agent.close()
            self.references.closed=True;maintenance.cancel()
            await asyncio.gather(maintenance,return_exceptions=True)
            await self.jobs.close();await self.native.cancel_all()
            for t in list(pending):t.cancel()
            if pending:await asyncio.gather(*pending,return_exceptions=True)
            self.native.stop_owned_host();self.store.close()

def main():
    from .lifetime import own_process_tree
    own_process_tree()
    sys.stdout.reconfigure(encoding='utf-8');sys.stdin.reconfigure(encoding='utf-8');sys.stderr.reconfigure(encoding='utf-8')
    root=os.environ.get('TKDS_DATA') or str(Path.home()/'.tk-dataset-studio')
    asyncio.run(Server(root).run())

if __name__=='__main__':main()
