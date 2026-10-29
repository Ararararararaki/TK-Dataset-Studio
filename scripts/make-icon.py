"""Original geometric application mark; no downloaded artwork or fonts."""
from pathlib import Path
from PIL import Image, ImageDraw

root=Path(__file__).resolve().parents[1]/'assets'
root.mkdir(exist_ok=True)
image=Image.new('RGBA',(1024,1024))
d=ImageDraw.Draw(image)
d.rounded_rectangle((40,40,984,984),radius=230,fill='#24272f')
d.rounded_rectangle((220,190,724,736),radius=74,fill='#8fbdaf')
d.rounded_rectangle((306,284,810,830),radius=74,fill='#faf9f6')
d.rounded_rectangle((378,360,738,606),radius=30,fill='#d9e2df')
d.polygon([(390,587),(493,466),(557,532),(615,482),(730,587)],fill='#497466')
d.ellipse((638,396,690,448),fill='#faf9f6')
d.rounded_rectangle((378,668,654,696),radius=14,fill='#24272f')
d.rounded_rectangle((378,726,564,752),radius=13,fill='#9ba49f')
image.resize((512,512),Image.Resampling.LANCZOS).save(root/'icon.png')
image.save(root/'icon.ico',sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
