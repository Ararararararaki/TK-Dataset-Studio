import asyncio, json, tempfile, unittest
from pathlib import Path
from PIL import Image
from backend.store import Store
from backend.jobs import Jobs
from backend.native import Native,NativeFailure,NativeAttention
from backend.presets import BUILTINS

class FakeWorker:
    async def infer(self,path,options,root):return {'tags':['1girl','blue_hair'],'characters':[]}
    async def close(self):pass

class FakeNative:
    def __init__(self):self.fail=False;self.calls=0;self.edit=None
    async def catalog(self):return {'connected':True}
    async def cancel_all(self):pass
    async def annotate(self,row,task,config,key,progress,stop,resume_run=''):
        self.calls+=1
        if self.fail:raise NativeFailure('temporary connection failure')
        await progress({'runId':'native-test','status':'succeeded'})
        if self.edit:self.edit(row)
        return '{"caption":"A blue-haired girl."}',{'runId':'native-test','status':'succeeded'}

class JobTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.folder=self.root/'images';self.folder.mkdir()
        Image.new('RGB',(60,80)).save(self.folder/'one.png');Image.new('RGB',(60,80)).save(self.folder/'two.png')
        self.store=Store(self.root/'data');self.did=self.store.import_paths([str(self.folder)])[0];self.native=FakeNative();self.jobs=Jobs(self.store,self.native,lambda e:None);self.jobs.worker=FakeWorker()
    async def asyncTearDown(self):await self.jobs.close();self.store.close();self.tmp.cleanup()
    def config(self,index=0,overwrite=False):return {'preset':dict(BUILTINS[index]),'wd14':{'model':'fake'},'overwrite':overwrite,'dsh':{}}
    async def test_wd14_sidecars(self):
        await self.jobs.start(self.did,self.config());await self.jobs.task
        self.assertEqual(len(list(self.folder.glob('*.txt'))),2);self.assertEqual(self.native.calls,0)
    async def test_batch_uses_saved_backup_preference(self):
        for row in self.store.list_images(self.did):self.store.save(row['id'],'original','tags',0)
        cfg=self.config(overwrite=True);cfg['backup_before_overwrite']=False
        await self.jobs.start(self.did,cfg);await self.jobs.task
        self.assertTrue(all(r['status']=='done' for r in self.store.list_images(self.did)))
        self.assertFalse(list((self.store.root/'backups').rglob('*.txt')))
        self.assertTrue(all(self.store.history(r['id'])[0]['text']=='original' for r in self.store.list_images(self.did)))
    async def test_existing_sidecar_skipped(self):
        (self.folder/'one.txt').write_text('keep')
        r=await self.jobs.start(self.did,self.config());await self.jobs.task
        self.assertEqual(r['count'],1);self.assertEqual((self.folder/'one.txt').read_text(),'keep')
    async def test_two_pass_actual_review_contract(self):
        cfg=self.config(1);cfg['preset']['review']=True
        await self.jobs.start(self.did,cfg);await self.jobs.task
        self.assertEqual(self.native.calls,4);self.assertTrue(all(r['status']=='done' for r in self.store.list_images(self.did)))
    async def test_failed_llm_no_fallback_txt(self):
        self.native.fail=True
        from unittest.mock import patch
        original=asyncio.sleep
        async def fast(_):await original(0)
        with patch('backend.jobs.asyncio.sleep',fast):
            await self.jobs.start(self.did,self.config(1));await self.jobs.task
        self.assertFalse(list(self.folder.glob('*.txt')));self.assertTrue(all(r['status']=='failed' for r in self.store.list_images(self.did)))
        self.assertTrue(self.store.image(self.store.list_images(self.did)[0]['id'])['raw']['tags'])
    async def test_manual_edit_during_generation_not_overwritten(self):
        once=set()
        def edit(row):
            if row['id'] not in once:self.store.save(row['id'],'manual','caption',0);once.add(row['id'])
        self.native.edit=edit
        await self.jobs.start(self.did,self.config(1));await self.jobs.task
        self.assertTrue(all(p.read_text()=='manual' for p in self.folder.glob('*.txt')))
        self.assertTrue(any('未覆盖' in h['reason'] for h in self.store.history(self.store.list_images(self.did)[0]['id'])))
    async def test_format_dependency(self):
        cfg=self.config(1);cfg['preset']['pipeline']='wd14'
        with self.assertRaises(ValueError):await self.jobs.start(self.did,cfg)
    async def test_native_image_attachment(self):
        block=Native.attachment(str(self.folder/'one.png'));self.assertEqual(block['type'],'image');self.assertEqual(block['mediaType'],'image/jpeg');self.assertTrue(block['data'].startswith('/9j/'))

if __name__=='__main__':unittest.main()
