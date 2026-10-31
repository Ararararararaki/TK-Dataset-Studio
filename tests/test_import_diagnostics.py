import tempfile, unittest
from pathlib import Path
from PIL import Image
from backend.store import Store


class ImportDiagnosticsTests(unittest.TestCase):
    """Regression: unreadable files must be counted and reported, never silently dropped."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.folder = self.root / '扫描失败'
        self.folder.mkdir()
        Image.new('RGB', (80, 60), (10, 20, 30)).save(self.folder / '正常.png')
        (self.folder / '伪图片.png').write_bytes(b'not an image at all')
        self.store = Store(self.root / 'app')
        self.events = []

    def tearDown(self):
        self.store.close()
        self.tmp.cleanup()

    def done_event(self):
        finals = [e for e in self.events if e.get('kind') == 'import-progress' and e.get('done')]
        self.assertTrue(finals, 'import must emit a terminal progress event')
        return finals[-1]

    def test_unreadable_file_is_counted_and_explained(self):
        did = self.store.import_paths([str(self.folder)], self.events.append)[0]
        done = self.done_event()
        self.assertEqual(done['count'], 2)
        self.assertEqual(done['imported'], 1)
        self.assertEqual(done['failed'], 1)
        self.assertEqual(len(done['samples']), 1)
        self.assertIn('伪图片', done['samples'][0]['path'])
        self.assertTrue(done['samples'][0]['error'])
        self.assertEqual(len(self.store.list_images(did)), 1)
        warnings = [e for e in self.events if e.get('kind') == 'import-warning']
        self.assertEqual(len(warnings), 1)

    def test_directory_of_broken_files_reports_zero_imported(self):
        empty = self.root / '全坏'
        empty.mkdir()
        for index in range(3):
            (empty / f'坏{index}.jpg').write_bytes(b'broken')
        self.events.clear()
        did = self.store.import_paths([str(empty)], self.events.append)[0]
        done = self.done_event()
        self.assertEqual((done['count'], done['imported'], done['failed']), (3, 0, 3))
        self.assertEqual(self.store.list_images(did), [])
        self.assertEqual(len(done['samples']), 3)

    def test_sample_list_is_capped_at_five(self):
        many = self.root / '很多坏'
        many.mkdir()
        for index in range(9):
            (many / f'x{index}.png').write_bytes(b'broken')
        self.events.clear()
        self.store.import_paths([str(many)], self.events.append)
        done = self.done_event()
        self.assertEqual(done['failed'], 9)
        self.assertEqual(len(done['samples']), 5)


if __name__ == '__main__':
    unittest.main()
