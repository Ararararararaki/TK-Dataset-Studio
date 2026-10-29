import asyncio,json,tempfile,unittest
from pathlib import Path
import httpx
from PIL import Image
from backend.server import Server

class AgentTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.server=Server(self.root/'data');self.server.notify=lambda e:None
        await self.server.agent.start();self.url=self.server.agent.info()['url'];self.token=self.server.agent.token
        self.client=httpx.AsyncClient(trust_env=False,timeout=10)
    async def asyncTearDown(self):
        await self.server.agent.close();await self.client.aclose();self.server.store.close();self.temp.cleanup()
    async def rpc(self,method,params=None,**headers):
        return await self.client.post(self.url,json={'method':method,'params':params or {}},headers={'Authorization':'Bearer '+self.token,**headers})
    async def test_auth_origin_and_read_only(self):
        self.assertEqual((await self.client.post(self.url,json={'method':'bootstrap'})).status_code,401)
        self.assertEqual((await self.rpc('bootstrap',Origin='https://other.example')).status_code,403)
        self.assertEqual((await self.rpc('bootstrap')).status_code,200)
        self.assertEqual((await self.rpc('jobs.cancel')).status_code,403)
        self.assertEqual((await self.rpc('shutdown')).status_code,403)
        audit=(await self.rpc('agent.audit')).json()['result']
        self.assertTrue(any(a['method']=='jobs.cancel' and not a['success'] for a in audit))
    async def test_shared_state_revision_backup_and_close(self):
        await self.server.dispatch('settings.save',{'agent_access':'write'})
        folder=self.root/'images';folder.mkdir();Image.new('RGB',(30,40)).save(folder/'one.png')
        ids=(await self.rpc('datasets.import',{'paths':[str(folder)]})).json()['result']
        image=self.server.store.list_images(ids[0])[0]
        result=(await self.rpc('images.save',{'id':image['id'],'text':'first','revision':0})).json()['result']
        self.assertEqual(self.server.store.image(image['id'])['text'],'first')
        self.assertEqual((folder/'one.txt').read_text(),'first')
        self.assertEqual((await self.rpc('images.save',{'id':image['id'],'text':'stale','revision':0})).status_code,400)
        await self.rpc('images.save',{'id':image['id'],'text':'second','revision':result['revision']})
        self.assertEqual(len(list((self.server.store.root/'backups').rglob('*.txt'))),1)
        await self.server.dispatch('settings.save',{'backup_before_overwrite':False})
        current=self.server.store.image(image['id'])
        saved=await self.rpc('images.save',{'id':image['id'],'text':'third without backup','revision':current['revision']})
        self.assertEqual(saved.status_code,200)
        self.assertEqual((folder/'one.txt').read_text(),'third without backup')
        self.assertEqual(len(list((self.server.store.root/'backups').rglob('*.txt'))),1)
        self.assertTrue(any('Agent' in h['reason'] for h in self.server.store.history(image['id'])))
        visual=(await self.rpc('agent.image',{'id':image['id']})).json()['result'];self.assertEqual(visual['mediaType'],'image/jpeg')
        await self.server.agent.close()
        with self.assertRaises(httpx.ConnectError):await self.rpc('bootstrap')
        self.assertEqual(json.loads(self.server.agent.descriptor.read_text())['status'],'stopped')

if __name__=='__main__':unittest.main()
