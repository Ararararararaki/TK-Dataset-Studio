import asyncio, tempfile, unittest
from pathlib import Path
from PIL import Image
from backend.native import final_text, NativeFailure
from backend.presets import compile_output, BUILTINS
from backend.jobs import Jobs
from backend.store import Store

class ResultRegressionTests(unittest.TestCase):
    def test_caption_rejects_tag_lists_in_plain_and_json_output(self):
        import json
        for tags in ['1girl, solo, blue_hair, looking_at_viewer', 'blue hair, red eyes, white dress', '1girl\nsolo\nlong_hair', 'solo', '1girl, solo, standing, holding a cup, long hair']:
            for text in (tags,json.dumps({'caption':tags})):
                with self.subTest(text=text),self.assertRaisesRegex(ValueError,'自然语言.*标签'):
                    compile_output(text,'caption',900,1200)
            with self.assertRaisesRegex(ValueError,'自然语言.*标签'):
                compile_output(json.dumps({'tags':['1girl'],'caption':tags}),'hybrid',900,1200)

    def test_natural_captions_keep_commas_and_short_noun_phrases(self):
        for text in ['A blue-haired girl.', 'Two girls sharing an umbrella in the rain', 'A girl in a blue coat, carrying a red umbrella, stands beside a crowded street.', 'Close-up of a woman in glasses, her eyes looking left.', 'She smiles, blue eyes bright, wind lifting her hair', 'Night sky.']:
            self.assertEqual(compile_output(text,'caption',900,1200),text)
        self.assertEqual(compile_output('1girl, solo, blue_hair','tags',900,1200),'1girl, solo, blue_hair')
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
    async def test_tag_reply_never_becomes_a_completed_caption(self):
        class TagsOnly:
            async def catalog(self):return {'connected':True}
            async def annotate(self,*args,**kwargs):return '1girl, solo, blue_hair',{'transport':'api','runId':''}
            async def cancel_all(self):pass
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);folder=root/'images';folder.mkdir();Image.new('RGB',(20,30)).save(folder/'one.png')
            store=Store(root/'data');did=store.import_paths([str(folder)])[0];jobs=Jobs(store,TagsOnly(),lambda e:None)
            try:
                await jobs.start(did,{'preset':{**BUILTINS[1],'pipeline':'llm'},'dsh':{'transport':'api'}});await jobs.task
                self.assertEqual(jobs.snapshot()[0]['counts'],{'failed':1})
                self.assertEqual(store.datasets()[0]['completed'],0)
                self.assertFalse((folder/'one.txt').exists())
            finally:await jobs.close();store.close()

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
