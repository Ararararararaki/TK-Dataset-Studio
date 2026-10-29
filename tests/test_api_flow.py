import asyncio, json, tempfile, threading, unittest
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from PIL import Image
from backend.api_transport import AnnotationClient
from backend.connections import Connections
from backend.native import NativeFailure, Native
from backend.jobs import Jobs
from backend.presets import BUILTINS, compile_output
from backend.store import Store

@contextmanager
def endpoint(mode='ok'):
    calls=[]
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def do_GET(self):
            data=json.dumps({'data':[{'id':'vision-test'}]}).encode()
            self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
        def do_POST(self):
            calls.append({'path':self.path,'body':json.loads(self.rfile.read(int(self.headers['Content-Length']))),'auth':self.headers.get('Authorization')})
            if mode=='413':self.send_error(413);return
            self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
            if mode=='json':text='{"caption":"Two girls share a blue umbrella."}'
            elif mode=='refusal':text="I'll inspect it.\n\nI can't produce this annotation."
            else:text='Two girls share a blue umbrella.'
            frames=[{'choices':[{'index':0,'delta':{'reasoning_content':'Private thinking, not caption.'}}]}]
            frames += [{'choices':[{'index':0,'delta':{'content':text[:12]}}]},{'choices':[{'index':0,'delta':{'content':text[12:]},'finish_reason':'length' if mode=='length' else 'stop'}]}]
            if mode=='unfinished':frames=frames[:2]
            try:
                for frame in frames:self.wfile.write(('data: '+json.dumps(frame)+'\n\n').encode());self.wfile.flush()
                self.wfile.write(b'data: [DONE]\n\n')
            except (BrokenPipeError,ConnectionResetError):pass
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    try:yield f'http://127.0.0.1:{server.server_port}/v1',calls
    finally:server.shutdown();server.server_close();thread.join()

class NoNative:
    async def annotate(self,*args,**kw):raise AssertionError('API must not start an Agent')
    async def catalog(self):raise AssertionError('API must not require Relay')
    async def cancel_all(self):pass

class ApiFlowTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.folder=self.root/'images';self.folder.mkdir()
        Image.new('RGB',(300,400)).save(self.folder/'one.png')
    async def asyncTearDown(self):self.tmp.cleanup()
    async def test_frontend_key_save_uses_actual_key_not_an_option_name(self):
        from backend.server import Server
        server=Server(self.root/'key-data');server.notify=lambda e:None
        try:
            cfg=server.settings();cfg['dsh']['new_api_key']='ui-test-key'
            result=await server.dispatch('settings.save',cfg)
            self.assertEqual(server.connections.manual_key(),'ui-test-key')
            self.assertTrue(result['settings']['dsh']['api_key_saved'])
            self.assertNotIn('ui-test-key',json.dumps(result))
            self.assertNotIn('new_api_key',server.store.get_setting('config')['dsh'])
        finally:await server.agent.close();await server.jobs.close();server.store.close()
    def client(self,url):
        self.config={'transport':'api','api_source':'manual','api_base':url,'api_model':'vision-test','timeout':20,'max_tokens':8192,'reasoningEffort':'high'}
        conn=Connections(self.root,lambda:self.config);conn.manual_key=lambda:'secret-probe'
        return AnnotationClient(NoNative(),conn)

    async def test_one_stateless_request_saves_text_and_counts(self):
        with endpoint() as (url,calls):
            client=self.client(url);store=Store(self.root/'data');did=store.import_paths([str(self.folder)])[0]
            cfg={'preset':{**BUILTINS[1],'pipeline':'llm'},'dsh':self.config}
            jobs=Jobs(store,client,lambda e:None)
            try:
                await jobs.start(did,cfg);await jobs.task
                self.assertEqual(jobs.snapshot()[0]['counts'],{'done':1})
                self.assertEqual(store.datasets()[0]['completed'],1)
                self.assertEqual((self.folder/'one.txt').read_text(),'Two girls share a blue umbrella.')
                self.assertEqual(len(calls),1);request=calls[0]
                self.assertEqual(request['path'],'/v1/chat/completions')
                self.assertEqual(request['auth'],'Bearer secret-probe')
                image=request['body']['messages'][1]['content'][1]
                self.assertTrue(image['image_url']['url'].startswith('data:image/jpeg;base64,'))
                self.assertEqual(request['body']['model'],'vision-test')
                self.assertNotIn('reasoning_effort',request['body'])
                self.assertNotIn('Private thinking',store.image(store.list_images(did)[0]['id'])['text'])
            finally:await jobs.close();store.close()

    async def test_legacy_json_caption_is_accepted(self):
        with endpoint('json') as (url,calls):
            client=self.client(url)
            async def progress(_):pass
            text,_=await client.annotate({'path':str(self.folder/'one.png')},'Caption only.',self.config,'k',progress,asyncio.Event())
            self.assertEqual(compile_output(text,'caption',300,400),'Two girls share a blue umbrella.')

    async def test_refusal_truncation_and_payload_fail_once_without_sidecars(self):
        for mode,match in [('refusal','拒绝'),('length','截断'),('unfinished','完整'),('413','413')]:
            with self.subTest(mode=mode),endpoint(mode) as (url,calls):
                client=self.client(url)
                async def progress(_):pass
                with self.assertRaisesRegex(NativeFailure,match):
                    await client.annotate({'path':str(self.folder/'one.png')},'Caption.',self.config,'k',progress,asyncio.Event())
                self.assertEqual(len(calls),1);self.assertFalse(list(self.folder.glob('*.txt')))

class ConnectionTests(unittest.TestCase):
    def test_live_static_config_and_stored_key_precedence(self):
        with tempfile.TemporaryDirectory() as tmp:
            home=Path(tmp);profile=home/'profiles/web';profile.mkdir(parents=True)
            path=profile/'cordis.patch.yml'
            prefix='- id: agent-default-model\n  config: {provider: workbuddy, model: vision-a}\n- id: llm-workbuddy\n  config:\n    baseURL: http://127.0.0.1:7863/v1\n    apiKeyEnv: TEST_WB_KEY\n    models: [{id: vision-a}, {id: vision-b}]\n- id: other\n  config: {value: !!js/function "throw new Error()"}\n'
            path.write_text(prefix)
            (home/'.credentials.yaml').write_text('version: 1\nrefs:\n  TEST_WB_KEY: stored\n')
            connections=Connections(home,lambda:{'profile':'web'},home)
            with patch.dict('os.environ',{'TEST_WB_KEY':'environment'}):
                a=connections.resolve();self.assertEqual(a['key'],'stored');self.assertEqual(a['model'],'vision-a')
                path.write_text(prefix.replace('model: vision-a','model: vision-b'))
                self.assertEqual(connections.resolve()['model'],'vision-b')
            with self.assertRaisesRegex(ValueError,'Profile'):connections.resolve({'profile':'../../bad'})

    def test_native_envelope_stays_below_body_limit_for_noisy_large_image(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'noisy.png';Image.effect_noise((2200,2800),100).save(path)
            blocks=[Native.attachment(path),*Native.detail_attachments(path)]
            self.assertLess(len(json.dumps({'content':blocks}).encode()),750000)

    def test_caption_dialogue_does_not_trigger_refusal_detection(self):
        caption='A girl holds a sign reading "I cannot help you" in a crowded cafe.'
        self.assertEqual(compile_output(caption,'caption',300,400),caption)
