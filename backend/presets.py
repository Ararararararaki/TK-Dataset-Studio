from __future__ import annotations
import json, math
from .responses import annotation_only

FAITHFUL = '''Describe only visible facts in the supplied original image. Preserve character count, pose, clothing, expression, perspective, composition, occlusion and distinct features per character. WD14 candidates are fallible image-level hints, never spatial detections. Resolve identity against visible evidence and supplied references, and do not transfer traits across people. If identity is uncertain describe appearance rather than inventing a name. Do not add artistic slogans, quality tokens, unseen lore, decorations or actions. Preserve visible text verbatim unless the user's guidance explicitly requests translation; never invent unreadable words. Avoid repetitive synonyms. Produce useful training annotations, not a newly redesigned scene.'''

BUILTINS = [
 {'id':'tags','name':'Danbooru 标签','description':'WD14 本地识别；角色在前，逗号分隔，可直接用于训练。','format':'tags','pipeline':'wd14','guidance':FAITHFUL,'review':False},
 {'id':'caption','name':'自然语言描述','description':'WD14 提供候选，LLM 直接看原图；一次请求输出英文训练描述。','format':'caption','pipeline':'wd14-llm','guidance':FAITHFUL,'review':False},
 {'id':'hybrid','name':'标签 + 自然语言','description':'第一段标签、第二段英文描述，一次请求兼顾身份与空间关系。','format':'hybrid','pipeline':'wd14-llm','guidance':FAITHFUL,'review':False},
 {'id':'moss','name':'MOSS Layout','description':'逐对象定位，一次请求后本地编译为 MOSS 中心化 yxyx JSON。','format':'moss','pipeline':'wd14-llm','guidance':FAITHFUL,'review':False},
]

def build_task(preset, row, raw, references='', extra=''):
    fmt = preset['format']
    contract = {
      'caption':'Return only the finished English training caption as plain text. No JSON wrapper, Markdown, preface, notes, process explanation or promises. If the image is unavailable, return {"error":"image unavailable"} instead of guessing.',
      'tags':'Return only lowercase Danbooru tags separated by commas. Do not invent unsupported tags.',
      'hybrid':'Return one JSON object with keys tags (array of strings) and caption (English string). No Markdown.',
      'moss':f'''Return one strict JSON pixel draft, no Markdown. Schema: {{"width":{row['width']},"height":{row['height']},"bbox_coord_space":"abs","bbox_format":"xyxy","summary":{{"caption":"English scene description","canvas":"single or multi_panel"}},"items":[{{"label":"character or object or text","caption":"English local description","bbox":[left,top,right,bottom]}}]}}. Every bbox is in absolute source pixels inside the supplied canvas. Every visible character has its own item. A text item additionally requires text with the actual visible words (or requested translation), with its bubble position and speaker identified in caption. Describe each comic panel separately; do not merge different panels' actions. Do not compute centralized coordinates; the application compiler does that.'''
    }[fmt]
    return f'''Analyze the attached image for a training dataset. It is the visual source of truth.
Actual EXIF-oriented image dimensions: {row['width']} x {row['height']} pixels.
{preset.get('guidance',FAITHFUL)}
{contract}
WD14 evidence (image-level candidates with scores): {json.dumps(raw,ensure_ascii=False)}
Character reference evidence (fallible; check against image): {references or 'none available'}
Additional user instruction: {extra or 'none'}
Never create or modify files. Reply with the annotation only.'''

def parse_json(text):
    text=text.strip()
    if text.startswith('```'):
        lines=text.splitlines(); text='\n'.join(lines[1:-1]) if lines[-1].strip()=='```' else text
    return json.loads(text)

def compile_output(text, fmt, width, height):
    text=annotation_only(text)
    if fmt in ('caption','tags'):
        if fmt=='caption':
            if not text.startswith(('{','[','```')):return text
            value=parse_json(text)
            if not isinstance(value,dict) or not isinstance(value.get('caption'),str) or not value['caption'].strip():raise ValueError('模型未返回可用的看图描述')
            return value['caption'].strip()
        return text.removeprefix('```').removesuffix('```').strip()
    value=parse_json(text)
    if fmt=='hybrid':
        if not isinstance(value.get('tags'),list) or not all(isinstance(t,str) for t in value['tags']) or not isinstance(value.get('caption'),str) or not value['caption'].strip(): raise ValueError('标签＋描述应包含 tags 数组与 caption')
        return ', '.join(dict.fromkeys(value['tags']))+'\n\n'+value['caption'].strip()
    if not isinstance(value,dict) or value.get('bbox_coord_space')!='abs' or value.get('bbox_format')!='xyxy': raise ValueError('MOSS 需要 abs/xyxy 像素草稿')
    if (value.get('width'),value.get('height'))!=(width,height): raise ValueError('MOSS 画布尺寸必须匹配原图')
    if not isinstance(value.get('summary'),dict) or not isinstance(value['summary'].get('caption'),str) or not isinstance(value.get('items'),list) or not value['items']: raise ValueError('MOSS 缺少场景或对象')
    output=[]
    for i,item in enumerate(value['items']):
        if not isinstance(item,dict) or item.get('label') not in ('object','character','text') or not isinstance(item.get('caption'),str) or not item['caption'].strip(): raise ValueError(f'MOSS 对象 {i+1} 描述无效')
        box=item.get('bbox')
        if not isinstance(box,list) or len(box)!=4 or any(type(n) not in (int,float) or not math.isfinite(n) for n in box): raise ValueError(f'MOSS 对象 {i+1} 坐标无效')
        l,t,r,b=box
        if not (0<=l<r<=width and 0<=t<b<=height): raise ValueError(f'MOSS 对象 {i+1} 越界或空框')
        if item['label']=='text' and (not isinstance(item.get('text'),str) or not item['text'].strip()): raise ValueError(f'MOSS 文字 {i+1} 缺失')
        row={k:v for k,v in item.items() if k in ('label','caption','text','tags','palette')}
        row['bbox']=[math.floor(t)-height//2,math.floor(l)-width//2,math.ceil(b)-height//2,math.ceil(r)-width//2]
        output.append(row)
    return json.dumps({'summary':value['summary'],'items':output,'bbox_coord_space':'abs_centralized','bbox_format':'yxyx'},ensure_ascii=False,separators=(',',':'),allow_nan=False)
