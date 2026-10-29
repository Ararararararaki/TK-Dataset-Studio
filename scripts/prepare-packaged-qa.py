import json, shutil, os
from pathlib import Path
from backend.store import Store
from backend.server import DEFAULTS

root=Path(__file__).resolve().parents[1]
receipt=json.loads((root/'.scratch/evidence/close.json').read_text())
previous=Store(root/'.scratch/desktop-state')
row=previous.image(receipt['image_id'])
previous.save(row['id'],receipt['original'],row['format'],row['revision'],reason='QA restore after close-flush test')
previous.close()
folder=root/'.scratch/packaged-dataset';folder.mkdir(exist_ok=True)
for source in (root/'.scratch/示例数据集').glob('*.jpg'):
    target=folder/source.name
    if not target.exists():shutil.copyfile(source,target)
store=Store(root/'.scratch/packaged-state')
model_dir=os.environ['TKDS_WD14_MODEL_DIR']
config={**DEFAULTS,'model_dirs':[model_dir],'wd14':{**DEFAULTS['wd14'],'model':model_dir+'/wd-v1-4-moat-tagger-v2.onnx'},'character_update':False,'lookup_missing':False}
store.set_setting('config',config)
did=store.import_paths([str(folder)])[0]
store.set_setting('ui',{'dataset':did,'preset':'tags','view':'list'})
store.close()
print('Prepared isolated packaged QA data; source images unchanged.')
