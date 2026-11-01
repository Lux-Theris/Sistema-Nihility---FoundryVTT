"""Gera os livros ilustrados a partir dos manuais Markdown. Sem alterar regras."""
from pathlib import Path
import re, html, json, unicodedata, subprocess
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Image, Table, TableStyle, KeepTogether
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus.tableofcontents import TableOfContents
from PIL import Image as PILImage

ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'output/pdf'; OUT.mkdir(parents=True,exist_ok=True)
CACHE=ROOT/'tmp/pdfs'; CACHE.mkdir(parents=True,exist_ok=True)
FONT=Path('C:/Windows/Fonts')
for name,file in [('Body','segoeui.ttf'),('Bold','segoeuib.ttf'),('Italic','segoeuii.ttf'),('Display','georgia.ttf')]:
    pdfmetrics.registerFont(TTFont(name,str(FONT/file)))
pdfmetrics.registerFontFamily('Body',normal='Body',bold='Bold',italic='Italic',boldItalic='Bold')
INK=colors.HexColor('#26243a'); PURPLE=colors.HexColor('#664b92'); GOLD=colors.HexColor('#b18b45')
W,H=432,648; M=34; CW=W-2*M-12
styles=getSampleStyleSheet()
styles.add(ParagraphStyle(name='Text',fontName='Body',fontSize=10.2,leading=15,textColor=INK,spaceAfter=8))
styles.add(ParagraphStyle(name='H1N',fontName='Display',fontSize=25,leading=29,textColor=INK,spaceAfter=16,keepWithNext=True))
styles.add(ParagraphStyle(name='H2N',fontName='Bold',fontSize=14,leading=18,textColor=PURPLE,spaceBefore=15,spaceAfter=8,keepWithNext=True))
styles.add(ParagraphStyle(name='H3N',parent=styles['H2N'],fontSize=11.3,leading=15))
styles.add(ParagraphStyle(name='CellN',parent=styles['Text'],fontSize=8.1,leading=11,spaceAfter=0))
styles.add(ParagraphStyle(name='QuoteN',parent=styles['Text'],fontSize=9.5,leading=14,leftIndent=12,rightIndent=8,borderColor=GOLD,borderWidth=0,borderPadding=7,backColor=colors.HexColor('#f0ebf5')))
styles.add(ParagraphStyle(name='SmallN',parent=styles['Text'],fontSize=8,leading=11,textColor=PURPLE))
styles.add(ParagraphStyle(name='CodeN',parent=styles['Text'],fontName='Body',fontSize=7.2,leading=10,backColor=colors.HexColor('#efedf4'),borderPadding=6,wordWrap='CJK'))
styles.add(ParagraphStyle(name='TOCN',parent=styles['Text'],fontSize=9,leading=12,leftIndent=0,firstLineIndent=0,spaceBefore=3))
ANCHORS=set()

def slug(s):
    return re.sub(r'[^\w\- ]','',s.lower()).replace(' ','-')

def plain(s): return re.sub(r'[*`_]', '',s)

def fmt(s):
    s=html.escape(s.strip())
    s=re.sub(r'`([^`]+)`',r'<font color="#664b92">\1</font>',s)
    s=re.sub(r'\*\*([^*]+)\*\*',r'<b>\1</b>',s)
    def link(m):
        label,url=m.groups()
        if url.startswith('#'): return f'<a href="{url}" color="#664b92">{label}</a>' if url[1:] in ANCHORS else label
        if url.startswith('manual-do-'): return label
        return f'<a href="{url}" color="#664b92">{label}</a>'
    s=re.sub(r'\[([^\]]+)\]\(([^)]+)\)',link,s)
    # Glyphs absent from the body font become readable text, never tofu boxes.
    for a,b in {'🎲':'d20','⚡':'','☢':'Radiação','✦':'','✕':'x','✎':'Editar','↩':'Desfazer','⟳':'Recarregar','ⓘ':'(i)','⌊':'[','⌋':']','✔':'Sim','∞':'sem prazo','▸':'>','▾':'v','▲':'+','▼':'-','½':'1/2','↳':'>','−':'-','—':' - ','–':'-','‑':'-'}.items(): s=s.replace(a,b)
    for a,b in {'↺':'Voltar','⏫':'Subir','⏬':'Descer','⏳':'Recarga','⑂':'Dividir','★':'Destaque','⚙':'Concedida','⚠':'Atenção','⛓':'Soltar','✓':'Sim'}.items(): s=s.replace(a,b)
    s=''.join(c for c in s if ord(c)<0x10000)
    return s

class Book(SimpleDocTemplate):
    def afterFlowable(self,f):
        if isinstance(f,Paragraph) and getattr(f,'toc_key',None):
            self.canv.bookmarkPage(f.toc_key)
            self.canv.addOutlineEntry(f.getPlainText(),f.toc_key,level=0,closed=False)
            self.notify('TOCEntry',(0,f.getPlainText(),self.page,f.toc_key))

def page(c,d):
    if d.page==1:return
    c.saveState(); c.setStrokeColor(GOLD); c.setLineWidth(.5); c.line(M,H-24,W-M,H-24)
    c.setFont('Body',7); c.setFillColor(PURPLE)
    c.drawString(M,H-18,'NIHILITY  /  '+d.book_label.upper())
    c.drawString(M,18,'Edição ilustrada • Regras 1.78.0');c.drawRightString(W-M,18,str(d.page));c.restoreState()

class Cover(Image):
    def __init__(self,path,label): super().__init__(str(path),width=CW,height=H-90);self.label=label
    def draw(self):
        c=self.canv; x=0; y=0
        c.saveState();ax,ay=c.absolutePosition(0,0);c.translate(-ax,-ay);c.drawImage(self.filename,x,y,width=W,height=H,mask='auto',preserveAspectRatio=False)
        c.setFillColor(colors.HexColor('#171527'));c.setFillAlpha(.83);c.rect(x,y+H-175,W,175,fill=1,stroke=0)
        c.rect(x,y,W,92,fill=1,stroke=0);c.setFillAlpha(1)
        c.setFillColor(colors.HexColor('#d9bd7a'));c.setFont('Body',10);c.drawString(M,H-60,'FANTASIA  /  ISEKAI  /  SCI-FI ARCANO')
        c.setFillColor(colors.white);c.setFont('Display',43);c.drawString(M,H-111,'NIHILITY')
        c.setFont('Body',20);c.drawString(M,H-146,self.label)
        c.setFont('Body',10);c.drawString(M,48,'EDIÇÃO ILUSTRADA  •  OUTUBRO 2026')
        c.setFont('Body',8);c.drawString(M,30,'Sistema de Lux  |  Foundry VTT 13+  |  Regras 1.78.0');c.restoreState()

def content(src):
    lines=src.splitlines(); flow=[];i=0;started=False; keys={}; part=''
    while i<len(lines):
        l=lines[i].strip()
        if not l or l=='---': i+=1;continue
        if l.startswith('# ') and not started: started=True;i+=1;continue
        if l=='## Sumário':
            while i<len(lines) and not (lines[i].startswith('## ') and lines[i].strip()!='## Sumário'): i+=1
            continue
        if l.startswith('```'):
            block=[];i+=1
            while i<len(lines) and not lines[i].startswith('```'): block.append(lines[i]);i+=1
            flow.append(Paragraph('<br/>'.join(fmt(x) for x in block),styles['CodeN']));flow.append(Spacer(1,8));i+=1;continue
        im=re.match(r'!\[([^\]]*)\]\(([^)]+)\)',l)
        if im:
            cap,path=im.groups();p=ROOT/'docs'/path
            if p.suffix in ('.svg','.png'):p=CACHE/(p.stem+'.jpg')
            if p.exists():
                iw,ih=PILImage.open(p).size;scale=min(CW/iw,355/ih)
                suffix=' • diagrama esquemático' if path.endswith('.svg') else ' • arte de ambientação'
                flow.append(KeepTogether([Image(str(p),width=iw*scale,height=ih*scale),Spacer(1,5),Paragraph(fmt(cap)+suffix,styles['SmallN'])]))
            i+=1;continue
        h=re.match(r'^(#{1,4})\s+(.+)',l)
        if h:
            level=len(h[1]);title=h[2]
            if level==1 and title.startswith('Parte '): part=title;i+=1;continue
            k=slug(plain(title));keys[k]=keys.get(k,0)+1
            key=k if keys[k]==1 else k+'-'+str(keys[k]-1)
            heading=f'<a name="{key}"/>'+fmt(title)
            if level<=2:
                flow.append(PageBreak())
                if part: flow.append(Paragraph(fmt(part.upper()),styles['SmallN']));part=''
                p=Paragraph(heading,styles['H1N']);p.toc_key='toc-'+key;flow.append(p)
                if any(x in title for x in ['Anatomia:','Naves e Veículos','PAD —']):
                    flow.append(Paragraph('MÓDULO OPCIONAL • Consulte as opções usadas pela sua mesa.',styles['SmallN']))
            else:flow.append(Paragraph(heading,styles['H2N' if level==3 else 'H3N']))
            i+=1;continue
        if l.startswith('|'):
            rows=[]
            while i<len(lines) and lines[i].strip().startswith('|'):
                cells=lines[i].strip().strip('|').split('|')
                if not all(re.match(r'^\s*:?-+:?\s*$',c) for c in cells):rows.append(cells)
                i+=1
            n=max(map(len,rows)); widths=[CW/n]*n
            if n==2:widths=[CW*.34,CW*.66]
            if n==3:widths=[CW*.24,CW*.29,CW*.47]
            if n==4:
                widths=[CW*.10,CW*.20,CW*.17,CW*.53] if plain(rows[0][0].strip())=='#' else [CW*.31,CW*.23,CW*.23,CW*.23]
            data=[[Paragraph(fmt(c),styles['CellN']) for c in row]+['']*(n-len(row)) for row in rows]
            t=Table(data,colWidths=widths,repeatRows=1,hAlign='LEFT',rowSplitRange=(2,-2) if len(data)>4 else None)
            t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#e5deef')),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.HexColor('#f7f5f9'),colors.white]),('VALIGN',(0,0),(-1,-1),'TOP'),('BOTTOMPADDING',(0,0),(-1,-1),7),('TOPPADDING',(0,0),(-1,-1),7),('LINEBELOW',(0,0),(-1,0),.6,GOLD)]))
            flow.extend([t,Spacer(1,10)]);continue
        if l.startswith('>'):
            q=[]
            while i<len(lines) and lines[i].strip().startswith('>'):q.append(lines[i].strip().lstrip('> '));i+=1
            flow.append(KeepTogether([Paragraph('<br/>'.join(fmt(x) for x in q),styles['QuoteN'])]));continue
        bullet=re.match(r'^(\s*)([-*]|\d+\.)\s+(.+)',lines[i])
        if bullet:
            st=ParagraphStyle('li',parent=styles['Text'],leftIndent=12,firstLineIndent=-9,spaceAfter=5)
            prefix='•' if bullet[2] in '-*' else bullet[2]
            flow.append(Paragraph(prefix+' '+fmt(bullet[3]),st));i+=1;continue
        para=[l];i+=1
        while i<len(lines) and lines[i].strip() and not re.match(r'^(#|>|\||!\[|```|---|\s*[-*] |\s*\d+\. )',lines[i]):para.append(lines[i].strip());i+=1
        flow.append(Paragraph(fmt(' '.join(para)),styles['Text']))
    return flow

def build(kind,label):
    p=ROOT/'docs'/f'manual-do-{kind}.md';dest=OUT/f'Nihility-Manual-do-{kind.title()}.pdf'
    doc=Book(str(dest),pagesize=(W,H),rightMargin=M,leftMargin=M,topMargin=40,bottomMargin=34,title='Nihility - '+label,author='Lux',allowSplitting=True)
    doc.book_label=label
    cover=CACHE/f'capa-{kind}.jpg'
    story=[Cover(cover,label),PageBreak(),Paragraph('Entre mundos',styles['H1N']),Paragraph('Um manual para aprender, imaginar e consultar durante a sessão.',styles['Text']),Paragraph('Nihility RPG System • Sistema de Lux<br/>Edição ilustrada • 31 de outubro de 2026<br/>Referência de regras: 1.78.0 • Foundry VTT 13 e 14',styles['Text']),Paragraph('Como ler este livro',styles['H2N']),Paragraph('Comece pelo guia de entrada. Depois consulte os capítulos conforme a sua campanha. Os valores descritos como padrão são os de fábrica; o Mestre pode alterá-los. Anatomia, Naves, PAD e outros subsistemas dependem das opções da mesa.',styles['Text']),Paragraph('Exemplos narrativos e sugestões de condução ensinam possibilidades de uso. Eles não acrescentam regras obrigatórias. As imagens de interface são esquemas didáticos, não capturas de uma sessão em funcionamento.',styles['Text']),Paragraph('Artes de capa e de ambientação geradas com IA para esta edição. Diagramas vetoriais do projeto. Referências editoriais: D&D Player’s Handbook (2024), Dungeon Master’s Guide (2024) e Tormenta20, sem reprodução de textos ou artes dessas obras.',styles['SmallN']),PageBreak(),Paragraph('Sumário',styles['H1N'])]
    toc=TableOfContents();toc.levelStyles=[styles['TOCN']];story.append(toc)
    source=p.read_text(encoding='utf-8')
    ANCHORS.clear();ANCHORS.update(slug(plain(x)) for x in re.findall(r'^#{1,4}\s+(.+)$',source,re.M))
    source=source[source.index('## Guia'):]
    story+=content(source)
    doc.multiBuild(story,onFirstPage=page,onLaterPages=page)
    print(dest)

if __name__=='__main__':
    subprocess.run(['node',str(ROOT/'docs/render-diagrams.cjs')],check=True)
    build('jogador','Manual do Jogador');build('mestre','Manual do Mestre')
