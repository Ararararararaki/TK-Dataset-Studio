import asyncio, tempfile, unittest
from pathlib import Path
from PIL import Image
from backend.native import final_text, NativeFailure
from backend.presets import compile_output, BUILTINS
from backend.jobs import Jobs
from backend.store import Store

class ResultRegressionTests(unittest.TestCase):
    def test_completed_plain_caption_without_private_marker(self):
        caption='Two girls in winter coats share an umbrella on a busy street.'
        self.assertEqual(compile_output(final_text(caption),'caption',900,1200),caption)

    def test_refusal_after_process_prose_has_correct_diagnosis(self):
        response="I'll read the requirements file first.\n\nI can't produce this annotation."
        with self.assertRaisesRegex((NativeFailure,ValueError),'拒绝'):
            compile_output(final_text(response),'caption',900,1200)

    def test_does_not_save_preamble_or_truncated_envelope(self):
        for text in ['I will inspect the image.', 'Here is the annotation: A girl.', '<<<TK_FINAL_PROMPT>>>unfinished']:
            with self.assertRaises((NativeFailure,ValueError)):
                compile_output(final_text(text),'caption',900,1200)

class FailureBudgetTests(unittest.IsolatedAsyncioTestCase):
    async def test_batch_stops_after_three_consecutive_failures(self):
        class Broken:
            calls=0
            async def catalog(self):return {'connected':True}
            async def annotate(self,*args,**kwargs):
                self.calls+=1
                raise NativeFailure('模型拒绝了本次请求',retryable=False)
            async def cancel_all(self):pass
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);folder=root/'images';folder.mkdir()
            for n in range(7):Image.new('RGB',(20,30)).save(folder/f'{n}.png')
            store=Store(root/'data');did=store.import_paths([str(folder)])[0]
            llm=Broken();jobs=Jobs(store,llm,lambda e:None)
            cfg={'preset':{**BUILTINS[1],'pipeline':'llm','review':False},'dsh':{}}
            try:
                await jobs.start(did,cfg);await jobs.task
                self.assertEqual(llm.calls,3)
                job=jobs.snapshot()[0]
                self.assertEqual(job['state'],'paused')
                self.assertEqual(job['counts'],{'failed':3,'pending':4})
                self.assertEqual(len(list(folder.glob('*.txt'))),0)
            finally:await jobs.close();store.close()
