import tempfile, unittest
from unittest.mock import patch
from backend.store import Store
from backend.references import References

class ReferenceTests(unittest.IsolatedAsyncioTestCase):
    async def test_user_evidence_survives_public_refresh_and_can_be_disabled(self):
        with tempfile.TemporaryDirectory() as directory:
            store=Store(directory);config={'lookup_characters':True,'lookup_missing':False}
            refs=References(store,lambda:config,lambda event:None)
            refs.save({'tag':'Hina_(Blue_Archive)','traits':['user verified armband']})
            self.assertEqual((await refs.lookup(['hina_(blue_archive)']))[0]['traits'],['user verified armband'])
            class Response:
                def raise_for_status(self):pass
                def json(self):return {'results':[{'slug':'hina_(blue_archive)','tags':['public description']}]}
            class Client:
                def __init__(self,**kwargs):pass
                async def __aenter__(self):return self
                async def __aexit__(self,*args):pass
                async def get(self,*args,**kwargs):return Response()
            with patch('httpx.AsyncClient',Client):await refs.fetch()
            self.assertEqual((await refs.lookup(['hina_(blue_archive)']))[0]['traits'],['user verified armband'])
            config['lookup_characters']=False
            self.assertEqual(await refs.lookup(['hina_(blue_archive)']),[])
            store.close()

if __name__=='__main__':unittest.main()
