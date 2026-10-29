"""Independent WD14 worker; preprocessing adapted from MIT pythongosssss.
Copyright (c) 2024 pythongosssss. Full notice: THIRD-PARTY-NOTICES.md.
Only this worker imports ONNX Runtime; stopping it releases model allocations.
"""
from __future__ import annotations
import csv, io, json, os, sys, time
from pathlib import Path

def models(directories):
    result=[]
    for directory in directories:
        p=Path(directory).expanduser()
        for model in sorted(p.glob('*.onnx')):
            labels=model.with_suffix('.csv')
            if labels.is_file(): result.append({'id':str(model.resolve()),'name':model.stem,'bytes':model.stat().st_size,'labels':str(labels.resolve())})
    return list({m['id']:m for m in result}.values())

def infer(path, options, cache):
    import numpy as np
    import onnxruntime as ort
    from PIL import Image, ImageOps
    model=Path(options['model']); device=options.get('device','cpu')
    if not model.is_file() or not model.with_suffix('.csv').is_file(): raise ValueError('请选择完整的 WD14 ONNX + CSV 模型')
    key=(str(model),model.stat().st_mtime_ns,device)
    if cache.get('key')!=key:
        providers=['CPUExecutionProvider']
        if device=='cuda':
            if 'CUDAExecutionProvider' not in ort.get_available_providers(): raise ValueError('独立运行时未安装 CUDA provider；可在参数中选择 CPU')
            providers=['CUDAExecutionProvider','CPUExecutionProvider']
        opts=ort.SessionOptions(); opts.intra_op_num_threads=min(4,os.cpu_count() or 1);opts.inter_op_num_threads=1
        cache.clear(); session=ort.InferenceSession(str(model),sess_options=opts,providers=providers)
        if device=='cuda' and session.get_providers()[0]!='CUDAExecutionProvider': raise ValueError('CUDA 初始化失败；未静默切到 CPU')
        with model.with_suffix('.csv').open(encoding='utf-8-sig',newline='') as f: rows=[(r['name'],r['category']) for r in csv.DictReader(f)]
        cache.update(key=key,session=session,rows=rows)
    session,rows=cache['session'],cache['rows']; input_info=session.get_inputs()[0]; size=input_info.shape[1]
    if not isinstance(size,int): raise ValueError('模型输入尺寸不受支持')
    with Image.open(path) as im:
        image=ImageOps.exif_transpose(im).convert('RGBA');bg=Image.new('RGBA',image.size,'white');bg.alpha_composite(image);image=bg.convert('RGB')
        ratio=size/max(image.size); image=image.resize(tuple(max(1,round(n*ratio)) for n in image.size),Image.Resampling.LANCZOS)
        square=Image.new('RGB',(size,size),'white');square.paste(image,((size-image.width)//2,(size-image.height)//2))
        array=np.asarray(square,dtype=np.float16 if input_info.type=='tensor(float16)' else np.float32)[:,:,::-1][None,...]
    values=session.run([session.get_outputs()[0].name],{input_info.name:array})[0][0]
    if len(values)!=len(rows): raise ValueError('模型与 CSV 标签数量不一致')
    general,characters,scores=[],[],{}
    excludes={t.strip().replace(' ','_').casefold() for t in options.get('exclude_tags','').split(',')}
    for (name,cat),value in zip(rows,values):
        cutoff=options.get('character_threshold',.85) if cat=='4' else options.get('threshold',.35)
        if cat in ('0','4') and float(value)>=cutoff and name.casefold() not in excludes:
            (characters if cat=='4' else general).append(name);scores[name]=round(float(value),5)
    return {'tags':characters+general,'characters':characters,'scores':scores,'model':model.stem,'provider':session.get_providers()[0]}

def main():
    sys.stdout.reconfigure(encoding='utf-8');sys.stdin.reconfigure(encoding='utf-8');cache={}
    for line in sys.stdin:
        try:
            request=json.loads(line);start=time.monotonic(); result=infer(request['path'],request['options'],cache);result['elapsed']=round(time.monotonic()-start,3)
            print(json.dumps({'result':result},ensure_ascii=False),flush=True)
        except Exception as e: print(json.dumps({'error':str(e)},ensure_ascii=False),flush=True)

if __name__=='__main__': main()
