import asyncio, contextlib, json, tempfile, unittest
from pathlib import Path
from PIL import Image
from backend.native import Native,NativeFailure,NativeAttention,FINAL_BEGIN,FINAL_END,final_text
from backend.presets import compile_output

class NativeContractTests(unittest.IsolatedAsyncioTestCase):
    async def test_image_and_instruction_share_one_content_envelope(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);path=root/'original.png';Image.new('RGB',(120,160)).save(path)
            native=Native(root,lambda:{});calls=[]
            async def call(name,args):
                calls.append((name,args))
                if name=='list_workspaces':return {'workspaces':[{'path':str(root)}]}
                return {'runId':'owned','status':'succeeded','taskImageCount':1,'modelSelection':{'provider':'chosen','model':'exact-id'},'assistantText':'Process notes.\n'+FINAL_BEGIN+'{"caption":"A girl."}'+FINAL_END}
            @contextlib.asynccontextmanager
            async def peer():yield call,'http://127.0.0.1:3080'
            native.peer=peer
            async def progress(run):pass
            text,meta=await native.annotate({'path':str(path)},'Required annotation.',{'provider':'chosen','model':'exact-id'},'stable-key',progress,asyncio.Event())
            request=next(args for name,args in calls if name=='start_run')
            self.assertNotIn('task',request);self.assertEqual([v['type'] for v in request['content']],['text','image'])
            self.assertEqual(request['model'],'exact-id');self.assertEqual(meta['model'],'exact-id')
            self.assertEqual(compile_output(text,'caption',120,160),'A girl.')
            self.assertTrue(request['contextReadScope']);self.assertEqual(request['writeScope'],[])
            self.assertEqual((root/request['reviewTargets'][0]).read_text(),'Required annotation.')

    def test_process_text_not_annotation(self):
        self.assertEqual(final_text('Reading file...\n'+FINAL_BEGIN+'actual prompt'+FINAL_END),'actual prompt')
        for invalid in ['I will inspect the image.',FINAL_BEGIN+'x',FINAL_BEGIN+'x'+FINAL_END+'Explanation.']:
            with self.assertRaises(NativeFailure):final_text(invalid)
        with self.assertRaises(ValueError):compile_output('I read the request. {"caption":"A girl."}','caption',10,10)
        with self.assertRaises(ValueError):compile_output('{"error":"image unavailable"}','caption',10,10)

    async def test_attention_run_stays_owned_until_explicit_cancel(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);path=root/'original.png';Image.new('RGB',(12,16)).save(path)
            native=Native(root,lambda:{});calls=[]
            async def call(name,args):
                calls.append((name,args))
                if name=='list_workspaces':return {'workspaces':[{'path':str(root)}]}
                if name=='cancel_run':return {'status':'cancelled'}
                return {'runId':'owned','status':'needs_attention','taskImageCount':1}
            @contextlib.asynccontextmanager
            async def peer():yield call,'http://127.0.0.1:3080'
            native.peer=peer
            async def progress(run):pass
            with self.assertRaises(NativeAttention):
                await native.annotate({'path':str(path)},'Annotation.',{},'key',progress,asyncio.Event())
            self.assertIn('owned',native.active)
            await native.cancel_all()
            self.assertEqual(native.active,{})
            self.assertTrue(any(name=='cancel_run' and args['runId']=='owned' for name,args in calls))

if __name__=='__main__':unittest.main()
