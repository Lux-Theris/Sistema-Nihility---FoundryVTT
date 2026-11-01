"""Verifica entregáveis e gera folhas de contato para revisão visual."""
from pathlib import Path
import json
import pdfplumber
from pypdf import PdfReader
from PIL import Image, ImageOps, ImageDraw
ROOT=Path(__file__).resolve().parent.parent
TMP=ROOT/'tmp/pdfs'
report={}
for kind,prefix,box in [('Jogador','final-player','player'),('Mestre','final-gm','gm')]:
    p=ROOT/'output/pdf'/f'Nihility-Manual-do-{kind}.pdf';r=PdfReader(p)
    text='\n'.join(page.extract_text() for page in r.pages)
    annotations=sum(len(page.get('/Annots',[])) for page in r.pages)
    assert len(r.pages)>30 and len(r.outline)>=18
    assert ('Guia' in text and '1. Primeiros passos' in text) if kind=='Jogador' else ('O farol entre mundos' in text)
    assert '\ufffd' not in text
    bad=[]
    with pdfplumber.open(p) as pdf:
        for page_no,page in enumerate(pdf.pages,1):
            for char in page.chars:
                if char['x0']<20 or char['x1']>414 or char['top']<5 or char['bottom']>642:
                    bad.append((page_no,char['text']))
    assert not bad,bad[:15]
    report[kind]={'pages':len(r.pages),'bytes':p.stat().st_size,'bookmarks':len(r.outline),'links':annotations,'text_characters':len(text),'out_of_bounds':bad}
    files=sorted(TMP.glob(prefix+'-*.png'))
    for start in range(0,len(files),12):
        sheet=Image.new('RGB',(1200,1410),'#dedde3');d=ImageDraw.Draw(sheet)
        for i,f in enumerate(files[start:start+12]):
            x=(i%4)*300;y=(i//4)*470
            thumb=ImageOps.contain(Image.open(f).convert('RGB'),(288,432))
            sheet.paste(thumb,(x+6,y+4));d.text((x+10,y+440),f.stem,fill='black')
        sheet.save(TMP/f'contact-{box}-{start//12+1}.jpg',quality=90)
(TMP/'qa-report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report,indent=2))
