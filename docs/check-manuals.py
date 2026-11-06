"""Verifica entregáveis e gera folhas de contato para revisão visual."""
from pathlib import Path
import json
import re
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
    assert len(r.pages)>30 and len(r.outline)>=12
    assert ('1. Jogar Nihility' in text and 'No Foundry' in text) if kind=='Jogador' else ('O farol entre mundos' in text and 'No Foundry' in text)
    assert '\ufffd' not in text
    normalized=re.sub(r'\s+',' ',text).casefold()
    source=(ROOT/'docs'/f'manual-do-{kind.lower()}.md').read_text(encoding='utf-8').casefold()
    if kind=='Jogador':
        # A edição compartilhável preserva apenas o conhecimento básico da alma.
        forbidden=['circuitos mágicos','armazenamento na alma','apoteose','faísca','divindade','qualidade da alma','skill-oceano-alma.png','titulos-divindade.png']
        leaked=[term for term in forbidden if term in normalized or term in source]
        assert not leaked,leaked
        assert 'skills estão ligadas à alma' in normalized
        sheet=(ROOT/'docs/img/ficha-jogador-livro.svg').read_text(encoding='utf-8')
        assert 'Zerar pontos (Mestre)' not in sheet and 'Moldura tracejada dourada' not in sheet
    else:
        for term in ['títulos, fé e divindade','apoteose','conjunto de títulos','estilhaçada','faísca']:
            assert term in normalized,term
    bad=[]
    with pdfplumber.open(p) as pdf:
        for page_no,page in enumerate(pdf.pages,1):
            for char in page.chars:
                if char['x0']<20 or char['x1']>page.width-18 or char['top']<5 or char['bottom']>page.height-6:
                    bad.append((page_no,char['text']))
    assert not bad,bad[:15]
    layout=json.loads((TMP/f'layout-{kind.lower()}.json').read_text(encoding='utf-8'))
    assert set(layout)=={str(n) for n in range(2,len(r.pages)+1)},'Faltou vinheta em alguma página'
    for info in layout.values():
        assert (ROOT/'docs'/info['path']).exists()
    report[kind]={'pages':len(r.pages),'bytes':p.stat().st_size,'bookmarks':len(r.outline),'links':annotations,'text_characters':len(text),'out_of_bounds':bad,'pages_with_vignettes':len(layout),'different_vignettes':len({v['asset'] for v in layout.values()})}
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
