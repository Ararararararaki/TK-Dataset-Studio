from __future__ import annotations
import hashlib, json, os, sqlite3, threading, time, uuid
from pathlib import Path
from PIL import Image, ImageOps

EXTENSIONS = {'.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.tif', '.tiff', '.avif'}

def digest(path: Path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None

def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))

class Conflict(ValueError): pass

class Store:
    def __init__(self, root):
        self.root = Path(root).resolve(); self.root.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.db = sqlite3.connect(self.root / 'studio.sqlite3', check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''
        PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
        CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS datasets(id TEXT PRIMARY KEY,path TEXT UNIQUE,name TEXT,created REAL);
        CREATE TABLE IF NOT EXISTS images(id TEXT PRIMARY KEY,dataset_id TEXT REFERENCES datasets(id),
          path TEXT UNIQUE,relative TEXT,width INTEGER,height INTEGER,mtime INTEGER,size INTEGER,
          status TEXT DEFAULT 'pending',error TEXT DEFAULT '',raw TEXT DEFAULT '{}',
          text TEXT DEFAULT '',format TEXT DEFAULT '',revision INTEGER DEFAULT 0,sidecar_sha TEXT,
          updated REAL, native TEXT DEFAULT '{}');
        CREATE INDEX IF NOT EXISTS dataset_images ON images(dataset_id,relative);
        CREATE TABLE IF NOT EXISTS revisions(id INTEGER PRIMARY KEY,image_id TEXT,text TEXT,format TEXT,reason TEXT,created REAL);
        CREATE TABLE IF NOT EXISTS presets(id TEXT PRIMARY KEY,body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,dataset_id TEXT,config TEXT,state TEXT,created REAL);
        CREATE TABLE IF NOT EXISTS job_items(job_id TEXT,image_id TEXT,status TEXT,stage TEXT DEFAULT '',attempt INTEGER DEFAULT 0,
          run_id TEXT DEFAULT '',error TEXT DEFAULT '',base_revision INTEGER,draft TEXT DEFAULT '',PRIMARY KEY(job_id,image_id));
        CREATE TABLE IF NOT EXISTS characters(tag TEXT PRIMARY KEY,body TEXT,updated REAL);
        ''')
        self.db.execute("UPDATE images SET status='failed',error='上次任务中断；可重试并核对原生运行记录' WHERE status='running'")
        self.db.execute("UPDATE jobs SET state='paused' WHERE state='running'")
        self.db.execute("UPDATE job_items SET status='pending' WHERE status='running'")
        self.db.commit()

    def query(self, sql, args=()):
        with self.lock: return [dict(x) for x in self.db.execute(sql, args).fetchall()]

    def execute(self, sql, args=()):
        with self.lock:
            self.db.execute(sql, args); self.db.commit()

    def get_setting(self, key, default=None):
        rows = self.query('SELECT value FROM settings WHERE key=?', (key,))
        return json.loads(rows[0]['value']) if rows else default

    def set_setting(self, key, value):
        self.execute('INSERT OR REPLACE INTO settings VALUES(?,?)', (key, encoded(value)))

    def datasets(self):
        rows = self.query('''SELECT d.*,COUNT(i.id) count,
          SUM(CASE WHEN i.status IN ('done','external') THEN 1 ELSE 0 END) completed,
          SUM(CASE WHEN i.status='failed' THEN 1 ELSE 0 END) failed
          FROM datasets d LEFT JOIN images i ON i.dataset_id=d.id GROUP BY d.id ORDER BY d.created DESC''')
        for row in rows: row['online'] = Path(row['path']).is_dir()
        return rows

    def import_paths(self, paths, progress=None):
        dataset_ids = []
        groups = {}
        for raw in paths:
            path = Path(raw).expanduser().resolve(strict=True)
            if path.is_dir(): groups[str(path)] = None
            elif path.suffix.lower() in EXTENSIONS:
                if str(path.parent) not in groups: groups[str(path.parent)]=[]
                if groups[str(path.parent)] is not None: groups[str(path.parent)].append(path)
        for directory, supplied in groups.items():
            existing = self.query('SELECT id FROM datasets WHERE path=?', (directory,))
            did = existing[0]['id'] if existing else uuid.uuid4().hex
            if not existing: self.execute('INSERT INTO datasets VALUES(?,?,?,?)', (did, directory, Path(directory).name, time.time()))
            dataset_ids.append(did)
            def candidates():
                if supplied is not None: yield from supplied; return
                for root, dirs, files in os.walk(directory, followlinks=False):
                    dirs[:] = [d for d in dirs if not d.startswith('.') and not Path(root, d).is_symlink()]
                    for name in sorted(files):
                        p = Path(root, name)
                        if p.suffix.lower() in EXTENSIONS and not p.is_symlink(): yield p
            seen = 0
            imported = 0
            failures = []
            for path in candidates():
                try:
                    stat = path.stat(); text_path = path.with_suffix('.txt'); sha = digest(text_path)
                    text = text_path.read_text(encoding='utf-8-sig') if sha else ''
                    previous = self.query('SELECT * FROM images WHERE path=?', (str(path),))
                    with Image.open(path) as im:
                        width, height = im.size
                        if im.getexif().get(274) in (5,6,7,8): width, height = height, width
                    if not previous:
                        self.execute('''INSERT INTO images(id,dataset_id,path,relative,width,height,mtime,size,status,text,sidecar_sha,updated)
                          VALUES(?,?,?,?,?,?,?,?,?,?,?,?)''', (uuid.uuid4().hex,did,str(path),str(path.relative_to(directory)),width,height,stat.st_mtime_ns,stat.st_size,'external' if sha else 'pending',text,sha,time.time()))
                    else:
                        old = previous[0]
                        changed = (old['mtime'],old['size']) != (stat.st_mtime_ns,stat.st_size)
                        self.execute('UPDATE images SET width=?,height=?,mtime=?,size=?,status=CASE WHEN ? THEN ? ELSE status END WHERE id=?',
                            (width,height,stat.st_mtime_ns,stat.st_size,changed,'external' if sha else 'pending',old['id']))
                        if sha != old['sidecar_sha']:
                            self.execute('INSERT INTO revisions(image_id,text,format,reason,created) VALUES(?,?,?,?,?)', (old['id'],old['text'],old['format'],'外部文件变动',time.time()))
                            self.execute("UPDATE images SET text=?,sidecar_sha=?,revision=revision+1,status=?,error='' WHERE id=?", (text,sha,'external' if sha else 'pending',old['id']))
                    imported += 1
                except (OSError,ValueError,Image.DecompressionBombError) as e:
                    if len(failures) < 5: failures.append({'path':str(path),'error':str(e)})
                    if progress: progress({'kind':'import-warning','path':str(path),'error':str(e)})
                seen += 1
                if progress and seen % 50 == 0: progress({'kind':'import-progress','dataset_id':did,'count':seen})
            if progress: progress({'kind':'import-progress','dataset_id':did,'count':seen,'imported':imported,'failed':seen-imported,'samples':failures,'done':True})
        return dataset_ids

    def list_images(self, dataset_id, search='', status='all'):
        sql = 'SELECT id,relative,width,height,status,error,revision,format,updated FROM images WHERE dataset_id=?'
        args = [dataset_id]
        if search: sql += ' AND (relative LIKE ? OR text LIKE ? OR raw LIKE ?)'; args += ['%'+search+'%'] * 3
        if status != 'all': sql += ' AND status=?'; args.append(status)
        return self.query(sql+' ORDER BY relative COLLATE NOCASE LIMIT 100000', args)

    def image(self, iid):
        rows = self.query('SELECT * FROM images WHERE id=?', (iid,))
        if not rows: raise ValueError('图片不存在')
        result = rows[0]; result['raw'] = json.loads(result['raw']); result['native'] = json.loads(result['native'])
        return result

    def thumbnail(self, iid, full=False):
        row = self.image(iid); src = Path(row['path'])
        size = 2400 if full else 768
        key = hashlib.sha256(f"{row['path']}:{src.stat().st_mtime_ns}:{size}".encode()).hexdigest()
        dest = self.root / 'thumbnails' / (key + '.jpg')
        if not dest.exists():
            dest.parent.mkdir(exist_ok=True)
            with Image.open(src) as im:
                image = ImageOps.exif_transpose(im).convert('RGBA'); image.thumbnail((size,size))
                bg = Image.new('RGBA',image.size,'white'); bg.alpha_composite(image)
                bg.convert('RGB').save(dest,'JPEG',quality=90)
        return str(dest)

    def save(self, iid, text, fmt, revision, *, reason='手动编辑', expected_sha=None, overwrite=True, backup=True):
        if not isinstance(text,str): raise ValueError('文本格式不正确')
        with self.lock:
            row = self.image(iid); sidecar = Path(row['path']).with_suffix('.txt')
            if row['revision'] != revision: raise Conflict('内容已被编辑，本次结果保存在历史；请刷新后选择')
            if sidecar.is_symlink(): raise Conflict('同名 TXT 是符号链接，请先人工检查')
            siblings = self.query('SELECT path FROM images WHERE dataset_id=? AND id<>?', (row['dataset_id'],iid))
            if any(os.path.normcase(str(Path(p['path']).with_suffix('.txt'))) == os.path.normcase(str(sidecar)) for p in siblings):
                raise Conflict('同目录有同名不同格式图片，TXT 名称冲突；请先重命名图片')
            actual = digest(sidecar)
            if actual != (row['sidecar_sha'] if expected_sha is None else expected_sha): raise Conflict('TXT 已在其他程序中改变，请重新扫描后编辑')
            if actual is not None and not overwrite: raise Conflict('已有 TXT，按当前配置跳过')
            if actual is not None and backup:
                backup_path = self.root / 'backups' / iid / f'{time.time_ns()}.txt'
                backup_path.parent.mkdir(parents=True,exist_ok=True); backup_path.write_bytes(sidecar.read_bytes())
            temp = sidecar.parent / f'.{sidecar.name}.{uuid.uuid4().hex}.studio-tmp'
            try:
                with temp.open('w',encoding='utf-8',newline='\n') as f:
                    f.write(text); f.flush(); os.fsync(f.fileno())
                os.replace(temp,sidecar)
            finally:
                if temp.exists(): temp.unlink()
            self.db.execute('INSERT INTO revisions(image_id,text,format,reason,created) VALUES(?,?,?,?,?)', (iid,row['text'],row['format'],reason,time.time()))
            self.db.execute("UPDATE images SET text=?,format=?,revision=revision+1,sidecar_sha=?,status='done',error='',updated=? WHERE id=?",(text,fmt,digest(sidecar),time.time(),iid))
            self.db.commit()
        return self.image(iid)

    def preserve_result(self,iid,text,fmt,reason):
        self.execute('INSERT INTO revisions(image_id,text,format,reason,created) VALUES(?,?,?,?,?)',(iid,text,fmt,reason,time.time()))

    def history(self,iid):
        return self.query('SELECT * FROM revisions WHERE image_id=? ORDER BY id DESC LIMIT 100',(iid,))

    def close(self):
        with self.lock: self.db.execute('PRAGMA wal_checkpoint(TRUNCATE)'); self.db.close()
