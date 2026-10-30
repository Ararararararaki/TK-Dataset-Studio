"""Parallelism contract: the WD14 pool overlaps, and one job keeps several images in flight."""
import asyncio, tempfile, time, unittest
from pathlib import Path
from PIL import Image
from backend import jobs as jobs_module
from backend.store import Store
from backend.jobs import Jobs, Worker
from backend.presets import BUILTINS

class SlowNative:
    def __init__(self,delay=0.2):self.delay=delay;self.calls=0;self.peak=0;self.live=0
    async def catalog(self):return {'connected':True}
    async def cancel_all(self):pass
    async def annotate(self,row,task,config,key,progress,stop,resume_run=''):
        self.calls+=1;self.live+=1;self.peak=max(self.peak,self.live)
        try:
            await progress({'runId':'slow','status':'running'})
            await asyncio.sleep(self.delay)
            return '{"caption":"A blue-haired girl standing outdoors."}',{'runId':'slow','status':'succeeded'}
        finally:self.live-=1

class SlowWorker:
    def __init__(self,delay=0.2):self.delay=delay;self.live=0;self.peak=0
    async def infer(self,path,options,root):
        self.live+=1;self.peak=max(self.peak,self.live)
        try:
            await asyncio.sleep(self.delay)
            return {'tags':['1girl','blue_hair'],'characters':[]}
        finally:self.live-=1
    async def close(self):pass

class PoolTests(unittest.IsolatedAsyncioTestCase):
    async def test_worker_pool_overlaps_slots(self):
        original=jobs_module._Slot.infer
        async def slow(self,path,options,root):
            await asyncio.sleep(0.25)
            return {'tags':['1girl'],'characters':[]}
        jobs_module._Slot.infer=slow
        try:
            pool=Worker(3)
            started=time.monotonic()
            results=await asyncio.gather(*(pool.infer('x',{},'.') for _ in range(6)))
            elapsed=time.monotonic()-started
            await pool.close()
        finally:
            jobs_module._Slot.infer=original
        self.assertEqual(len(results),6)
        self.assertLess(elapsed,0.9,'三进程池应让六次调用并行，而不是串行 1.5 秒')
        self.assertGreaterEqual(elapsed,0.25)

    async def test_pool_size_one_stays_serial(self):
        original=jobs_module._Slot.infer
        async def slow(self,path,options,root):
            await asyncio.sleep(0.15)
            return {'tags':['1girl'],'characters':[]}
        jobs_module._Slot.infer=slow
        try:
            pool=Worker(1)
            started=time.monotonic()
            await asyncio.gather(*(pool.infer('x',{},'.') for _ in range(3)))
            elapsed=time.monotonic()-started
            await pool.close()
        finally:
            jobs_module._Slot.infer=original
        self.assertGreaterEqual(elapsed,0.45,'单进程必须保持串行语义')

class JobParallelTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.folder=self.root/'images';self.folder.mkdir()
        for name in ('a','b','c','d'):
            Image.new('RGB',(60,80)).save(self.folder/f'{name}.png')
        self.store=Store(self.root/'data');self.did=self.store.import_paths([str(self.folder)])[0]
        self.native=SlowNative();self.worker=SlowWorker()
        self.jobs=Jobs(self.store,self.native,lambda e:None);self.jobs.worker=self.worker

    async def asyncTearDown(self):
        await self.jobs.close();self.store.close();self.tmp.cleanup()

    def config(self,wd14,llm):
        return {'preset':dict(BUILTINS[1]),'wd14':{'model':'fake'},'overwrite':True,
                'dsh':{'transport':'api'},'concurrency':{'wd14':wd14,'llm':llm}}

    async def test_job_overlaps_stages_across_images(self):
        started=time.monotonic()
        await self.jobs.start(self.did,self.config(2,2));await self.jobs.task
        elapsed=time.monotonic()-started
        self.assertEqual(len(list(self.folder.glob('*.txt'))),4)
        self.assertGreater(self.native.peak,1,'两张图应同时在 LLM 阶段')
        self.assertGreater(self.worker.peak,1,'两张图应同时做 WD14')
        self.assertLess(elapsed,4*0.4*0.8,'四张图应并行完成，而不是串行约 1.6 秒')

    async def test_serial_config_keeps_one_image_in_flight(self):
        started=time.monotonic()
        await self.jobs.start(self.did,self.config(1,1));await self.jobs.task
        elapsed=time.monotonic()-started
        self.assertEqual(len(list(self.folder.glob('*.txt'))),4)
        self.assertEqual(self.native.peak,1)
        self.assertEqual(self.worker.peak,1)
        self.assertGreaterEqual(elapsed,4*0.35)

if __name__=='__main__':unittest.main()
