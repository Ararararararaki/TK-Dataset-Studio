"""Client contract for the in-DSH bridge: loopback only, SSE assembly, no session fields."""
import asyncio, json, tempfile, unittest
from pathlib import Path
from PIL import Image
from backend.host_bridge import Bridge, endpoint
from backend.native import NativeFailure

def reply(status, body, content_type='application/json'):
    return (f'HTTP/1.1 {status} X\r\nContent-Type: {content_type}\r\n'
            f'Content-Length: {len(body.encode())}\r\nConnection: close\r\n\r\n{body}').encode()

class Stub:
    """Minimal HTTP/1.1 server that records requests and replays canned responses."""
    def __init__(self, handler):
        self.handler=handler;self.seen=[];self.server=None;self.port=None
    async def __aenter__(self):
        self.server=await asyncio.start_server(self.serve,'127.0.0.1',0)
        self.port=self.server.sockets[0].getsockname()[1]
        return self
    async def __aexit__(self,*_):
        self.server.close();await self.server.wait_closed()
    async def serve(self,reader,writer):
        try:
            head=await reader.readuntil(b'\r\n\r\n')
            lines=head.decode().split('\r\n');method,path,_=lines[0].split(' ')
            length=0
            for line in lines[1:]:
                if line.lower().startswith('content-length:'):length=int(line.split(':')[1])
            body=await reader.readexactly(length) if length else b''
            self.seen.append((method,path,json.loads(body) if body else None))
            await writer.drain()
            for chunk in self.handler(method,path,json.loads(body) if body else None):
                writer.write(chunk);await writer.drain()
        except (asyncio.IncompleteReadError,ConnectionResetError):pass
        finally:
            writer.close()

class EndpointTests(unittest.TestCase):
    def test_loopback_only(self):
        self.assertEqual(endpoint('http://127.0.0.1:3080/'),'http://127.0.0.1:3080')
        self.assertEqual(endpoint('http://localhost:8080'),'http://localhost:8080')
        for bad in ('https://127.0.0.1:3080','http://10.0.0.5:3080','http://127.0.0.1','http://user:pw@127.0.0.1:3080','http://127.0.0.1:3080/?x=1'):
            with self.assertRaises(NativeFailure,msg=bad):endpoint(bad)

class BridgeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        self.image=self.root/'one.png';Image.new('RGB',(40,50),(10,20,30)).save(self.image)
        self.row={'id':'i1','path':str(self.image),'relative':'one.png'}
        self.bridge=Bridge(None)

    async def asyncTearDown(self):self.tmp.cleanup()

    def config(self,port,**extra):return {'bridge_url':f'http://127.0.0.1:{port}','provider':'workbuddy','model':'deepseek-v4.1-flash','timeout':60,'max_tokens':4096,**extra}

    async def test_status_reports_tools_and_purge(self):
        def handler(method,path,body):
            yield reply(200,json.dumps({'ok':True,'service':'tk-annotate-bridge','port':3099,'providers':['workbuddy'],'tools':{'available':True,'names':['purge_status','read_image']},'purge':True,'tokenRequired':False}))
        async with Stub(handler) as stub:
            value=await self.bridge.status(self.config(stub.port))
        self.assertEqual(value['service'],'tk-annotate-bridge');self.assertTrue(value['purge'])
        self.assertEqual(value['tools']['names'],['purge_status','read_image'])

    async def test_annotate_streams_and_sends_no_session(self):
        def handler(method,path,body):
            yield reply(200,'data: {"delta":"1girl, "}\n\ndata: {"delta":"solo"}\n\ndata: {"done":true,"chars":12,"usage":{"total_tokens":12}}\n\n','text/event-stream')
        async with Stub(handler) as stub:
            text,meta=await self.bridge.annotate(self.row,'describe',self.config(stub.port),'k',lambda m:_noop(),asyncio.Event())
        self.assertEqual(text,'1girl, solo')
        self.assertEqual(meta['transport'],'bridge')
        method,path,payload=stub.seen[0]
        self.assertEqual((method,path),('POST','/tk-annotate/run'))
        self.assertNotIn('sessionId',payload)
        self.assertNotIn('sessionMode',payload)
        self.assertEqual(payload['provider'],'workbuddy')
        self.assertEqual(payload['maxTokens'],4096)
        self.assertTrue(payload['images'][0]['mediaType'].startswith('image/'))
        self.assertTrue(payload['images'][0]['data'])

    async def test_error_frame_is_failure_without_retry(self):
        def handler(method,path,body):
            yield reply(200,'data: {"error":"宿主未挂载 llm"}\n\n','text/event-stream')
        async with Stub(handler) as stub:
            with self.assertRaises(NativeFailure) as caught:
                await self.bridge.annotate(self.row,'describe',self.config(stub.port),'k',lambda m:_noop(),asyncio.Event())
        self.assertFalse(caught.exception.retryable)

    async def test_missing_final_frame_is_failure(self):
        def handler(method,path,body):
            yield reply(200,'data: {"delta":"half"}\n\n','text/event-stream')
        async with Stub(handler) as stub:
            with self.assertRaises(NativeFailure):
                await self.bridge.annotate(self.row,'describe',self.config(stub.port),'k',lambda m:_noop(),asyncio.Event())

    async def test_requires_provider_and_model(self):
        with self.assertRaises(NativeFailure) as caught:
            await self.bridge.annotate(self.row,'describe',{'bridge_url':'http://127.0.0.1:3080'},'k',lambda m:_noop(),asyncio.Event())
        self.assertIn('provider',str(caught.exception))

    async def test_tool_round_trip(self):
        def handler(method,path,body):
            self.assertEqual(path,'/tk-annotate/tool')
            yield reply(200,json.dumps({'ok':True,'name':body['name'],'value':{'status':'idle'}}))
        async with Stub(handler) as stub:
            value=await self.bridge.tool(self.config(stub.port),'purge_status',{})
        self.assertTrue(value['ok']);self.assertEqual(value['value'],{'status':'idle'})

async def _noop():return None

if __name__=='__main__':unittest.main()
