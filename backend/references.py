"""Fallible character evidence. One local owner; no image or weight downloads."""
import asyncio, gzip, json, re, time
from pathlib import Path

def norm(value):return re.sub(r'\s+',' ',str(value).replace('_',' ').strip().casefold())

class References:
    def __init__(self,store,settings,notify):self.store=store;self.settings=settings;self.notify=notify;self.index={};self.loaded=None;self.lock=asyncio.Lock();self.closed=False
    def save(self,value):
        if not isinstance(value.get('tag'),str) or not value['tag'].strip():raise ValueError('请填写角色标签')
        record={**value,'tag':norm(value['tag']),'source':'user','updated':time.time()}
        self.store.execute('INSERT OR REPLACE INTO characters VALUES(?,?,?)',(record['tag'],json.dumps(record,ensure_ascii=False),time.time()))
        return True
    def snapshot(self):
        path=Path(self.settings().get('character_snapshot') or '')
        if not path.is_file():return
        key=(str(path),path.stat().st_mtime_ns)
        if self.loaded==key:return
        data=path.read_bytes();rows=json.loads(gzip.decompress(data) if path.suffix=='.gz' else data.decode('utf-8-sig'))
        if isinstance(rows,dict):rows=list(rows.get('records',{}).values())
        if not isinstance(rows,list):raise ValueError('角色快照应包含角色列表')
        index={}
        for row in rows:
            if not isinstance(row,dict):continue
            slug=row.get('s') or row.get('slug') or row.get('tag')
            if not slug:continue
            item={'tag':slug,'name':row.get('n') or row.get('name') or slug,'series':row.get('cn') or row.get('copyright_name',''),
                  'traits':row.get('g') or row.get('tags') or row.get('traits',[]),'source':'local snapshot; not a spatial detection'}
            index[norm(slug)]=item
        self.index=index;self.loaded=key

    async def fetch(self,query=None):
        import httpx
        config=self.settings()
        async with httpx.AsyncClient(proxy=config.get('proxy') or 'http://127.0.0.1:7890',trust_env=False,timeout=8) as client:
            params={'q':query,'page':1,'page_size':3} if query else {'page':self.store.get_setting('character_cursor',1),'page_size':50}
            r=await client.get('https://animadex.net/api/characters/search',params=params);r.raise_for_status();data=r.json()
        rows=data.get('results') if isinstance(data,dict) else None
        if not isinstance(rows,list):raise ValueError('角色资料格式不匹配')
        for row in rows:
            if not isinstance(row,dict) or not isinstance(row.get('slug'),str) or not isinstance(row.get('tags',[]),list):continue
            existing=self.store.query('SELECT body FROM characters WHERE tag=?',(norm(row['slug']),))
            if existing and json.loads(existing[0]['body']).get('source')!='https://animadex.net/api/characters/search':continue
            value={'tag':row['slug'],'name':row.get('name',row['slug']),'series':row.get('copyright_name',''),'traits':row.get('tags',[]),'source':'https://animadex.net/api/characters/search','updated':time.time()}
            self.store.execute('INSERT OR REPLACE INTO characters VALUES(?,?,?)',(norm(row['slug']),json.dumps(value,ensure_ascii=False),time.time()))
        if not query:self.store.set_setting('character_cursor',params['page']+1 if rows else 1)
        return len(rows)

    async def lookup(self,tags):
        if not self.settings().get('lookup_characters',True):return []
        try:await asyncio.to_thread(self.snapshot)
        except (OSError,ValueError) as e:self.notify({'kind':'reference','message':'角色快照不可用：'+str(e)})
        found=[]
        for tag in tags:
            key=norm(tag);rows=self.store.query('SELECT body FROM characters WHERE tag=?',(key,))
            item=json.loads(rows[0]['body']) if rows else self.index.get(key)
            if not item and self.settings().get('lookup_missing',True):
                try:
                    async with self.lock:await self.fetch(tag)
                    rows=self.store.query('SELECT body FROM characters WHERE tag=?',(key,));item=json.loads(rows[0]['body']) if rows else None
                except Exception as e:self.notify({'kind':'reference','message':f'角色 {tag} 补查失败，继续按原图与 WD14 候选处理：{type(e).__name__}'})
            found.append(item or {'tag':tag,'status':'not found; identity unverified'})
        return found

    async def maintenance(self):
        while not self.closed:
            config=self.settings()
            if config.get('character_update',True) and time.time()-self.store.get_setting('character_last_attempt',0)>86400:
                self.store.set_setting('character_last_attempt',time.time())
                try:
                    async with self.lock:count=await self.fetch()
                    self.store.set_setting('character_last_success',time.time());self.notify({'kind':'reference','message':f'角色资料后台更新完成：核对 {count} 条资料'})
                except Exception as e:self.store.set_setting('character_last_error',type(e).__name__)
            await asyncio.sleep(300)
