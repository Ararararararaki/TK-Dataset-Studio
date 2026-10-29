"""EXIF-correct image encoding with an explicit wire-byte budget."""
import base64, io
from PIL import Image, ImageOps

def jpeg_block(image, *, max_side=2048, max_bytes=1400000):
    image=ImageOps.exif_transpose(image).convert('RGBA')
    white=Image.new('RGB',image.size,'white');white.paste(image,mask=image.getchannel('A'))
    white.thumbnail((max_side,max_side),Image.Resampling.LANCZOS)
    while True:
        for quality in (90,80,70,60):
            out=io.BytesIO();white.save(out,format='JPEG',quality=quality,optimize=True)
            if out.tell()<=max_bytes:
                return {'type':'image','mediaType':'image/jpeg','data':base64.b64encode(out.getvalue()).decode()}
        if min(white.size)<=96:raise ValueError('无法在请求大小范围内编码图片')
        white.thumbnail((max(1,int(white.width*.8)),max(1,int(white.height*.8))),Image.Resampling.LANCZOS)

def file_block(path, **options):
    with Image.open(path) as image:return jpeg_block(image,**options)
