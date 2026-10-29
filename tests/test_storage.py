import json, tempfile, unittest
from pathlib import Path
from PIL import Image
from backend.store import Store, Conflict
from backend.presets import compile_output

class StorageTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.folder=self.root/'中文 数据集';self.folder.mkdir()
        Image.new('RGB',(100,150),(120,160,200)).save(self.folder/'画面.png')
        self.store=Store(self.root/'app');self.did=self.store.import_paths([str(self.folder)])[0];self.row=self.store.list_images(self.did)[0]
    def tearDown(self):self.store.close();self.tmp.cleanup()
    def test_import_recursive_and_duplicate(self):
        sub=self.folder/'子目录';sub.mkdir();Image.new('RGB',(70,90)).save(sub/'another.webp')
        self.store.import_paths([str(self.folder)]);self.assertEqual(len(self.store.datasets()),1);self.assertEqual(len(self.store.list_images(self.did)),2)
    def test_source_bytes_unchanged(self):
        original=(self.folder/'画面.png').read_bytes();self.store.save(self.row['id'],'girl, blue sky','tags',0)
        self.assertEqual(original,(self.folder/'画面.png').read_bytes());self.assertEqual((self.folder/'画面.txt').read_text(encoding='utf8'),'girl, blue sky')
    def test_backup_and_history(self):
        row=self.store.save(self.row['id'],'first','tags',0);self.store.save(row['id'],'second','caption',row['revision'])
        backups=list((self.root/'app/backups'/row['id']).glob('*.txt'));self.assertEqual(len(backups),1);self.assertEqual(backups[0].read_text(),'first')
        self.assertEqual(self.store.history(row['id'])[0]['text'],'first')
    def test_manual_edit_conflict(self):
        self.store.save(self.row['id'],'manual','caption',0)
        with self.assertRaises(Conflict):self.store.save(self.row['id'],'late LLM','caption',0)
        self.assertEqual((self.folder/'画面.txt').read_text(),'manual')
    def test_external_edit_conflict(self):
        (self.folder/'画面.txt').write_text('outside',encoding='utf8')
        with self.assertRaises(Conflict):self.store.save(self.row['id'],'overwrite','caption',0)
        self.assertEqual((self.folder/'画面.txt').read_text(),'outside')
    def test_scan_imports_external_sidecar(self):
        (self.folder/'画面.txt').write_text('外部文字',encoding='utf8');self.store.import_paths([str(self.folder)])
        row=self.store.image(self.row['id']);self.assertEqual(row['status'],'external');self.assertEqual(row['text'],'外部文字');self.assertEqual(row['revision'],1)
    def test_same_stem_conflict(self):
        Image.new('RGB',(50,50)).save(self.folder/'画面.jpg');self.store.import_paths([str(self.folder)])
        with self.assertRaises(Conflict):self.store.save(self.row['id'],'unsafe','tags',0)
        self.assertFalse((self.folder/'画面.txt').exists())
    def test_long_output_kept(self):
        text='完整文本'*2000;row=self.store.save(self.row['id'],text,'caption',0);self.assertEqual(row['text'],text)
    def test_thumbnail_exif_size_cache(self):
        first=self.store.thumbnail(self.row['id']);second=self.store.thumbnail(self.row['id']);self.assertEqual(first,second)
        self.assertEqual(len(list((self.root/'app/thumbnails').glob('*.jpg'))),1)
    def test_session_recovery(self):
        self.store.execute("UPDATE images SET status='running' WHERE id=?",(self.row['id'],));self.store.close();self.store=Store(self.root/'app')
        self.assertEqual(self.store.image(self.row['id'])['status'],'failed')
    def test_persistence(self):
        self.store.set_setting('test',{'value':'中文'});self.store.close();self.store=Store(self.root/'app');self.assertEqual(self.store.get_setting('test')['value'],'中文')

class CompilerTests(unittest.TestCase):
    def draft(self):return {'width':101,'height':151,'bbox_coord_space':'abs','bbox_format':'xyxy','summary':{'caption':'Two characters.'},'items':[{'label':'character','caption':'A girl.','bbox':[0,0,101,151]},{'label':'text','caption':'Speech at left.','bbox':[1,2,20,30],'text':'你好\n世界'}]}
    def test_exact_odd_dimensions(self):
        d=json.loads(compile_output(json.dumps(self.draft()),'moss',101,151));self.assertEqual(d['items'][0]['bbox'],[-75,-50,76,51]);self.assertEqual(d['items'][1]['text'],'你好\n世界')
    def test_wrong_canvas(self):
        with self.assertRaises(ValueError):compile_output(json.dumps(self.draft()),'moss',100,150)
    def test_outside_box(self):
        d=self.draft();d['items'][0]['bbox']=[-1,0,50,50]
        with self.assertRaises(ValueError):compile_output(json.dumps(d),'moss',101,151)
    def test_empty_box(self):
        d=self.draft();d['items'][0]['bbox']=[0,0,0,50]
        with self.assertRaises(ValueError):compile_output(json.dumps(d),'moss',101,151)
    def test_hybrid(self):self.assertEqual(compile_output('{"tags":["1girl","1girl"],"caption":"A girl."}','hybrid',100,100),'1girl\n\nA girl.')
    def test_no_truncation(self):self.assertEqual(len(compile_output(json.dumps({'caption':'a'*20000}),'caption',100,100)),20000)
    def test_refusal_not_annotation(self):
        with self.assertRaises(ValueError):compile_output('Refused. This request is illegal.','caption',100,100)
    def test_control_character_json(self):
        with self.assertRaises(ValueError):compile_output('{"tags":["x"],"caption":"bad\njson"}','hybrid',10,10)

if __name__=='__main__':unittest.main()
