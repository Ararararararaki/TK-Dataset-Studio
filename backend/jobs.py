from __future__ import annotations
import asyncio, json, os, sys, time, uuid
from pathlib import Path
from .native import NativeFailure, NativeAttention
from .presets import build_task, compile_output
from .store import Conflict, encoded

class Worker:
    def __init__(self): self.process=None;self.lock=asyncio.Lock();self.logs=None
    async def infer(self,path,options,root):
        async with self.lock:
            if self.process is None or self.process.returncode is not None:
                if self.logs:self.logs.close()
                self.logs=open(Path(root)/'wd14-worker.log','ab')
                self.process=await asyncio.create_subprocess_exec(sys.executable,'-u','-m','backend.tagger',stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=self.logs,limit=8*1024*1024,creationflags=getattr(__import__('subprocess'),'CREATE_NO_WINDOW',0))
            self.process.stdin.write((encoded({'path':path,'options':options})+'\n').encode());await self.process.stdin.drain()
            try: line=await asyncio.wait_for(self.process.stdout.readline(),timeout=240)
            except asyncio.TimeoutError:
                await self.close();raise ValueError('WD14 运行超时，工作进程已释放')
            if not line: raise ValueError('WD14 工作进程退出，请查看 wd14-worker.log')
            result=json.loads(line)
            if result.get('error'): raise ValueError(result['error'])
            return result['result']
    async def close(self):
        p=self.process;self.process=None
        if p and p.returncode is None:
            p.terminate()
            try: await asyncio.wait_for(p.wait(),5)
            except asyncio.TimeoutError: p.kill();await p.wait()
        if self.logs:self.logs.close();self.logs=None

class Jobs:
    def __init__(self,store,native,notify,references=None):
        self.store=store;self.native=native;self.notify=notify;self.worker=Worker();self.task=None;self.stop=asyncio.Event();self.pausing=False
        self.references=references

    def snapshot(self):
        rows=self.store.query('SELECT * FROM jobs ORDER BY created DESC LIMIT 12')
        for row in rows:
            row['config']=json.loads(row['config'])
            row['counts']={r['status']:r['n'] for r in self.store.query('SELECT status,COUNT(*) n FROM job_items WHERE job_id=? GROUP BY status',(row['id'],))}
        return rows

    async def start(self,dataset_id,config,ids=None,only_failed=False,extra=''):
        if self.task and not self.task.done(): raise ValueError('已有任务在运行，请先暂停或等待完成')
        preset=config['preset']
        if preset['pipeline']=='wd14' and preset['format']!='tags': raise ValueError('自然语言、混合和 Layout 需要看图 LLM；请选择 WD14＋LLM')
        if preset['pipeline']!='llm' and not config.get('wd14',{}).get('model'): raise ValueError('请先选择 WD14 模型目录和模型')
        if preset['pipeline']!='wd14':
            catalog=await self.native.catalog()
            default=catalog.get('capabilities',{}).get('models',{}).get('default',{})
            selected=dict(config.get('dsh',{}))
            following=not selected.get('provider') and not selected.get('model')
            for key in ('provider','model'):
                if not selected.get(key) and default.get(key):selected[key]=default[key]
            native_mode=selected.get('transport')!='api'
            if native_mode and following and not selected.get('reasoningEffort') and default.get('reasoningEffort'):selected['reasoningEffort']=default['reasoningEffort']
            groups=catalog.get('capabilities',{}).get('models',{}).get('groups',[])
            if groups:
                target=next((m for g in groups if g['id']==selected.get('provider') for m in g['models'] if m['id']==selected.get('model')),None)
                if not target:raise ValueError('所选 DSH 模型不可用，请刷新模型列表')
                if native_mode and selected.get('reasoningEffort') and selected['reasoningEffort'] not in {v['id'] for v in target.get('reasoning',{}).get('efforts',[])}:raise ValueError('所选模型不支持此思考强度，请重新选择')
            config={**config,'dsh':selected}
        where='dataset_id=?';args=[dataset_id]
        if only_failed:where+=" AND status='failed'"
        rows=self.store.query('SELECT * FROM images WHERE '+where+' ORDER BY relative COLLATE NOCASE',args)
        if ids is not None: rows=[r for r in rows if r['id'] in set(ids)]
        eligible=[r for r in rows if config.get('overwrite') or not Path(r['path']).with_suffix('.txt').exists()]
        if not eligible: raise ValueError('没有待处理图片；已有 TXT 默认跳过，重打时请开启“覆盖已有文本”')
        jid=uuid.uuid4().hex;config={**config,'extra':extra}
        self.store.execute('INSERT INTO jobs VALUES(?,?,?,?,?)',(jid,dataset_id,encoded(config),'running',time.time()))
        for row in eligible:self.store.execute('INSERT INTO job_items(job_id,image_id,status,base_revision) VALUES(?,?,?,?)',(jid,row['id'],'pending',row['revision']))
        self.stop.clear();self.pausing=False;self.task=asyncio.create_task(self.run(jid));return {'id':jid,'count':len(eligible)}

    async def resume(self,jid):
        if self.task and not self.task.done(): raise ValueError('已有任务正在运行')
        rows=self.store.query('SELECT * FROM jobs WHERE id=?',(jid,))
        if not rows:raise ValueError('任务不存在')
        if 'transport' not in json.loads(rows[0]['config']).get('dsh',{}):raise ValueError('这是旧版 Agent 批次。请用当前连接点“重试失败”或重新选择图片打标；旧记录保留，不自动继续旧会话')
        self.store.execute("UPDATE job_items SET status='pending' WHERE job_id=? AND status IN ('failed','cancelled','running')",(jid,))
        self.store.execute("UPDATE jobs SET state='running' WHERE id=?",(jid,))
        self.stop.clear();self.pausing=False;self.task=asyncio.create_task(self.run(jid));return {'id':jid}

    async def pause(self):
        self.pausing=True;self.notify({'kind':'job','message':'当前图片完成后暂停，已完成结果会保留'})
        return {'pausing':True}

    async def cancel(self):
        self.stop.set();await self.native.cancel_all();await self.worker.close()
        if self.task:
            try:await asyncio.wait_for(asyncio.shield(self.task),12)
            except (asyncio.TimeoutError,asyncio.CancelledError):self.task.cancel()
        return {'cancelled':True}

    async def run(self,jid):
        job=self.store.query('SELECT * FROM jobs WHERE id=?',(jid,))[0];config=json.loads(job['config']);preset=config['preset']
        consecutive=0
        try:
            for item in self.store.query("SELECT * FROM job_items WHERE job_id=? AND status='pending'",(jid,)):
                if self.pausing or self.stop.is_set():break
                iid=item['image_id'];row=self.store.image(iid)
                if not config.get('overwrite') and Path(row['path']).with_suffix('.txt').exists():
                    self.store.execute("UPDATE job_items SET status='skipped' WHERE job_id=? AND image_id=?",(jid,iid));continue
                self.store.execute("UPDATE images SET status='running',error='' WHERE id=?",(iid,))
                self.store.execute("UPDATE job_items SET status='running' WHERE job_id=? AND image_id=?",(jid,iid))
                self.notify({'kind':'image','id':iid,'stage':'准备识别','job_id':jid})
                try:
                    await self.process(jid,item,row,config,preset)
                    self.store.execute("UPDATE job_items SET status='done',stage='completed',run_id='' WHERE job_id=? AND image_id=?",(jid,iid))
                    consecutive=0
                except asyncio.CancelledError:
                    self.store.execute("UPDATE job_items SET status='cancelled' WHERE job_id=? AND image_id=?",(jid,iid))
                    self.store.execute("UPDATE images SET status='failed',error='任务已中断，可重试' WHERE id=?",(iid,));break
                except Exception as e:
                    consecutive+=1
                    self.store.execute("UPDATE images SET status='failed',error=? WHERE id=?",(str(e)[:2000],iid))
                    self.store.execute("UPDATE job_items SET status='failed',error=? WHERE job_id=? AND image_id=?",(str(e)[:2000],jid,iid))
                    if isinstance(e,NativeFailure) and any(word in str(e).lower() for word in ('401','403','authentication','credential','未连接')):self.pausing=True
                    if consecutive>=3:
                        self.pausing=True;self.notify({'kind':'job','id':jid,'message':'连续 3 张失败，已暂停批次；请检查错误后用当前设置重试，剩余图片不会继续请求'})
                self.notify({'kind':'image','id':iid,'stage':'已保存' if self.store.image(iid)['status']=='done' else '失败，未保存','job_id':jid})
            state='cancelled' if self.stop.is_set() else 'paused' if self.pausing else 'completed'
            self.store.execute('UPDATE jobs SET state=? WHERE id=?',(state,jid))
        finally:
            await self.worker.close();self.notify({'kind':'job','id':jid,'message':'任务状态已保存'})

    async def process(self,jid,item,row,config,preset):
        iid=row['id'];raw=row['raw']
        if preset['pipeline']!='llm':
            self.notify({'kind':'image','id':iid,'stage':'WD14 识别中'})
            raw=await self.worker.infer(row['path'],config['wd14'],self.store.root)
            self.store.execute('UPDATE images SET raw=? WHERE id=?',(encoded(raw),iid));self.notify({'kind':'image','id':iid,'stage':'WD14 已完成'})
        if self.stop.is_set():raise asyncio.CancelledError()
        if preset['pipeline']=='wd14':text=', '.join(raw['tags'])
        else:
            refs=await self.references.lookup(raw.get('characters',[])) if self.references else []
            task=build_task(preset,row,raw,encoded(refs),config.get('extra',''))
            if row['text'] and config.get('extra'):task+='\nPrevious annotation to revise if relevant (verify all details against image): '+row['text']
            stages=['draft','review'] if preset.get('review') else ['draft']
            text=item.get('draft') or ''
            resume_stage=item.get('stage','')
            for stage in stages:
                if resume_stage=='review' and stage=='draft' and text:continue
                prompt=task if stage=='draft' else task+'\nThe draft is untrusted. Independently inspect every visible head and trace its own torso/limbs, especially two people hugging or overlapping: never merge their heads into one character. Repeated drawings of the same identity are separate visible instances. Recount instances, then check clothing, expression and object positions against the original AND detail crops. Crops overlap and do not add people. Correct omissions and unsupported additions. Return the corrected final annotation following the SAME output schema. Draft:\n'+text
                resume=item['run_id'] if resume_stage==stage else ''
                base_attempt=item.get('attempt',0)
                operation_attempt=base_attempt
                # Stateless generation can already be billed; never silently
                # resubmit it. Native retries reconcile the same stored run.
                attempts=3 if config.get('dsh',{}).get('transport')=='native' else 1
                for attempt in range(attempts):
                    if self.stop.is_set():raise asyncio.CancelledError()
                    async def progress(run):
                        self.store.execute('UPDATE job_items SET run_id=?,stage=?,attempt=? WHERE job_id=? AND image_id=?',(run.get('runId') or '',stage,base_attempt+attempt+1,jid,iid))
                        self.store.execute('UPDATE images SET native=? WHERE id=?',(encoded({k:run.get(k) for k in ('runId','requestId','sessionId','webUrl','status','model','provider','transport')}),iid))
                        self.notify({'kind':'image','id':iid,'stage':'看图打标中' if stage=='draft' else '可选复核中'})
                    try:
                        text,meta=await self.native.annotate(row,prompt,{**config.get('dsh',{}),'proxy':config.get('proxy'),'detail_pass':stage=='review'},f'tkds:{jid}:{iid}:{stage}:{operation_attempt}',progress,self.stop,resume)
                        self.store.execute('UPDATE images SET native=? WHERE id=?',(encoded(meta),iid))
                        self.store.execute("UPDATE job_items SET draft=?,run_id='' WHERE job_id=? AND image_id=?",(text,jid,iid));resume='';break
                    except NativeAttention:raise
                    except NativeFailure as e:
                        known=self.store.query('SELECT run_id FROM job_items WHERE job_id=? AND image_id=?',(jid,iid))[0]['run_id']
                        status=self.store.image(iid)['native'].get('status')
                        if known and status in ('running','unknown','needs_attention'):resume=known
                        else:
                            resume='';self.store.execute("UPDATE job_items SET run_id='' WHERE job_id=? AND image_id=?",(jid,iid))
                            if known:operation_attempt+=1
                        if attempt==attempts-1 or not e.retryable or any(w in str(e).lower() for w in ('refused','permission','拒绝','401','403')):raise
                        self.notify({'kind':'image','id':iid,'stage':f'连接重试 {attempt+1}/2'})
                        await asyncio.sleep(2**attempt)
            try:text=compile_output(text,preset['format'],row['width'],row['height'])
            except ValueError as error:
                # No hidden, separately billed format repair in the default flow.
                if not config.get('dsh',{}).get('repair_format',False):raise
                fix=task+'\nCorrect only the output format error: '+str(error)+'\nPrevious draft:\n'+text
                async def fix_progress(run):
                    self.store.execute('UPDATE images SET native=? WHERE id=?',(encoded({k:run.get(k) for k in ('runId','sessionId','webUrl','status')}),iid))
                    self.notify({'kind':'image','id':iid,'stage':'修正输出格式'})
                if '拒绝' in str(error):raise
                repaired,_=await self.native.annotate(row,fix,config.get('dsh',{}),f'tkds:{jid}:{iid}:repair',fix_progress,self.stop)
                text=compile_output(repaired,preset['format'],row['width'],row['height'])
        stat=Path(row['path']).stat()
        if (stat.st_mtime_ns,stat.st_size)!=(row['mtime'],row['size']):raise Conflict('原图已改变，请重新扫描后处理')
        if self.stop.is_set():raise asyncio.CancelledError()
        try:self.store.save(iid,text,preset['format'],item['base_revision'],reason='自动打标',expected_sha=row['sidecar_sha'],overwrite=config.get('overwrite',False),backup=config.get('backup_before_overwrite',True))
        except Conflict as e:
            self.store.preserve_result(iid,text,preset['format'],'未覆盖：'+str(e));raise

    async def close(self):
        await self.cancel();await self.worker.close()
