"""Gera os livros ilustrados a partir dos manuais Markdown. Sem alterar regras."""
from pathlib import Path
import re, html, json, unicodedata, subprocess
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Image, Table, TableStyle, KeepTogether
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus.tableofcontents import TableOfContents
from PIL import Image as PILImage, ImageStat

ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'output/pdf'; OUT.mkdir(parents=True,exist_ok=True)
CACHE=ROOT/'tmp/pdfs'; CACHE.mkdir(parents=True,exist_ok=True)
FONT=Path('C:/Windows/Fonts')
for name,file in [('Body','georgia.ttf'),('Bold','georgiab.ttf'),('Italic','georgiai.ttf'),('Display','georgia.ttf'),('UI','segoeui.ttf'),('UIBold','segoeuib.ttf')]:
    pdfmetrics.registerFont(TTFont(name,str(FONT/file)))
pdfmetrics.registerFontFamily('Body',normal='Body',bold='Bold',italic='Italic',boldItalic='Bold')
pdfmetrics.registerFontFamily('UI',normal='UI',bold='UIBold',italic='UI',boldItalic='UIBold')
INK=colors.HexColor('#24292d'); PURPLE=colors.HexColor('#40566a'); GOLD=colors.HexColor('#985b46')
W,H=480,720; M=36; CW=W-2*M-12
styles=getSampleStyleSheet()
styles.add(ParagraphStyle(name='Text',fontName='Body',fontSize=10.3,leading=15,textColor=INK,spaceAfter=7,allowWidows=0,allowOrphans=0))
styles.add(ParagraphStyle(name='H1N',fontName='Display',fontSize=25,leading=29,textColor=INK,spaceAfter=16,keepWithNext=True))
styles.add(ParagraphStyle(name='H2N',fontName='UIBold',fontSize=13,leading=17,textColor=PURPLE,spaceBefore=15,spaceAfter=8,keepWithNext=True))
styles.add(ParagraphStyle(name='H3N',parent=styles['H2N'],fontSize=11.3,leading=15))
styles.add(ParagraphStyle(name='FoundryN',parent=styles['H2N'],fontSize=12,leading=16,backColor=colors.HexColor('#e8eef1'),borderPadding=7,spaceBefore=20,spaceAfter=12))
styles.add(ParagraphStyle(name='CellN',parent=styles['Text'],fontName='UI',fontSize=8.5,leading=11.5,spaceAfter=0))
styles.add(ParagraphStyle(name='QuoteN',parent=styles['Text'],fontSize=9.5,leading=14,leftIndent=12,rightIndent=8,borderColor=GOLD,borderWidth=0,borderPadding=7,backColor=colors.HexColor('#f2eee6')))
styles.add(ParagraphStyle(name='SmallN',parent=styles['Text'],fontName='UI',fontSize=7.4,leading=10,textColor=PURPLE))
styles.add(ParagraphStyle(name='CodeN',parent=styles['Text'],fontName='Body',fontSize=7.2,leading=10,backColor=colors.HexColor('#f4f1eb'),borderPadding=6,wordWrap='CJK'))
styles.add(ParagraphStyle(name='TOCN',parent=styles['Text'],fontSize=9,leading=12,leftIndent=0,firstLineIndent=0,spaceBefore=3))
ANCHORS=set()

def slug(s):
    return re.sub(r'[^\w\- ]','',s.lower()).replace(' ','-')

def plain(s): return re.sub(r'[*`_]', '',s)

def fmt(s):
    s=html.escape(s.strip())
    s=re.sub(r'`([^`]+)`',r'<font color="#40566a">\1</font>',s)
    s=re.sub(r'\*\*([^*]+)\*\*',r'<b>\1</b>',s)
    s=re.sub(r'(?<!\*)\*([^*]+)\*(?!\*)',r'<i>\1</i>',s)
    def link(m):
        label,url=m.groups()
        if url.startswith('#'): return f'<a href="{url}" color="#40566a">{label}</a>' if url[1:] in ANCHORS else label
        if url.startswith('manual-do-'): return label
        return f'<a href="{url}" color="#40566a">{label}</a>'
    s=re.sub(r'\[([^\]]+)\]\(([^)]+)\)',link,s)
    # Glyphs absent from the body font become readable text, never tofu boxes.
    for a,b in {'🎲':'d20','⚡':'','☢':'Radiação','✦':'','✕':'x','✎':'Editar','↩':'Desfazer','⟳':'Recarregar','ⓘ':'(i)','⌊':'[','⌋':']','✔':'Sim','∞':'sem prazo','▸':'>','▾':'v','▲':'+','▼':'-','½':'1/2','↳':'>','−':'-','—':' - ','–':'-','‑':'-'}.items(): s=s.replace(a,b)
    for a,b in {'↺':'Voltar','⏫':'Subir','⏬':'Descer','⏳':'Recarga','⑂':'Dividir','★':'Destaque','⚙':'Concedida','⚠':'Atenção','⛓':'Soltar','✓':'Sim'}.items(): s=s.replace(a,b)
    s=''.join(c for c in s if ord(c)<0x10000)
    return s

class Book(SimpleDocTemplate):
    def beforeDocument(self):
        self.chapter='Primeiras páginas'
        self.section=''
        self.spot_index={}
        self.last_spot=None
        self.page_art={}

    def afterFlowable(self,f):
        if isinstance(f,Paragraph) and getattr(f,'toc_key',None):
            self.chapter=f.getPlainText()
            self.section=''
            self.canv.bookmarkPage(f.toc_key)
            self.canv.addOutlineEntry(f.getPlainText(),f.toc_key,level=0,closed=False)
            self.notify('TOCEntry',(0,f.getPlainText(),self.page,f.toc_key))
        elif isinstance(f,Paragraph) and f.style.name in ('H2N','H3N','FoundryN'):
            self.section=f.getPlainText()

    def afterPage(self):
        page(self.canv,self)


def spot_group(d):
    title=(d.chapter+' '+d.section).casefold()
    for terms,group in [
        (('nave','veículo','tripulação','pad','comunicação'),'espaco'),
        (('equipamento','inventário','moeda','recurso','recuperação','vida,'),'recursos'),
        (('skill','habilidade','magia','título','divindade','antimagia'),'magia'),
        (('atributo','teste','rolage','investiga'),'investigacao'),
        (('combate','encontro','anatomia','perigo'),'acao'),
        (('foundry','administra','problema','números'),'ferramentas'),
    ]:
        if any(term in title for term in terms):return group
    return 'viagem'

def page(c,d):
    if d.page==1:return
    c.saveState()
    c.setStrokeColor(colors.HexColor('#b4a28e'));c.setLineWidth(.45);c.line(M,H-27,W-M,H-27)
    c.setFont('UI',7);c.setFillColor(PURPLE)
    c.drawString(M,H-20,'NIHILITY  /  '+d.book_label.upper())
    manifest=d.spots
    group=spot_group(d)
    pool=manifest['groups'][group]
    index=d.spot_index.get(group,0)
    chosen=pool[index%len(pool)]
    if chosen==d.last_spot: index+=1;chosen=pool[index%len(pool)]
    d.spot_index[group]=index+1;d.last_spot=chosen
    item=manifest['assets'][chosen]
    original=ROOT/'docs'/item['path']
    if not original.exists():raise FileNotFoundError(original)
    art=CACHE/('vinheta-'+original.name)
    if not art.exists() or art.stat().st_mtime<original.stat().st_mtime:
        im=PILImage.open(original).convert('RGBA');im.thumbnail((420,420));im.save(art,optimize=True)
    iw,ih=PILImage.open(art).size;scale=min(100/iw,88/ih)
    # A pequena arte alterna de lado no rodapé; o texto tem uma área própria.
    right=d.page%2==1
    x=W-M-iw*scale if right else M
    c.drawImage(str(art),x,27,width=iw*scale,height=ih*scale,mask='auto')
    tx=M if right else M+118
    c.setFont('UI',7.2);c.setFillColor(INK)
    chapter=d.chapter
    if len(chapter)>48:chapter=chapter[:45]+'…'
    c.drawString(tx,65,chapter)
    c.setFillColor(PURPLE);c.setFont('UI',7)
    cap=item['caption']
    if len(cap)>63:cap=cap[:60]+'…'
    c.drawString(tx,49,cap)
    c.setFont('UI',8);c.drawRightString(W-M,14,str(d.page))
    d.page_art[d.page]={'asset':chosen,'path':item['path'],'chapter':d.chapter,'group':group}
    c.restoreState()

class Cover(Image):
    def __init__(self,path,label): super().__init__(str(path),width=CW,height=H-190);self.label=label
    def draw(self):
        c=self.canv; x=0; y=0
        c.saveState();ax,ay=c.absolutePosition(0,0);c.translate(-ax,-ay);c.drawImage(self.filename,x,y,width=W,height=H,mask='auto',preserveAspectRatio=False)
        im=PILImage.open(self.filename).convert('L');iw,ih=im.size
        top=ImageStat.Stat(im.crop((int(iw*.06),int(ih*.02),int(iw*.87),int(ih*.24)))).mean[0]
        bottom=ImageStat.Stat(im.crop((int(iw*.06),int(ih*.88),int(iw*.94),int(ih*.98)))).mean[0]
        title_ink=INK if top>130 else colors.HexColor('#fff8e9')
        c.setFillColor(title_ink);c.setFont('Body',9);c.drawString(M,H-39,'SISTEMA MODULAR DE RPG')
        c.setFont('Display',43);c.drawString(M,H-89,'NIHILITY')
        c.setFont('Body',20);c.drawString(M,H-122,self.label)
        c.setStrokeColor(title_ink);c.setLineWidth(1);c.line(M,H-140,M+42,H-140)
        c.setFillColor(INK if bottom>130 else colors.HexColor('#fff8e9'))
        c.setFont('Body',10);c.drawString(M,48,'EDIÇÃO REVISTA  •  NOVEMBRO 2026')
        c.setFont('UI',8);c.drawString(M,30,'Um sistema de RPG de Lux');c.restoreState()

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
            if not p.exists(): raise FileNotFoundError(f'Imagem do manual não encontrada: {path}')
            if p.exists():
                iw,ih=PILImage.open(p).size
                small=cap.startswith('Vinheta:')
                scale=min((CW*.68 if small else CW)/iw,(160 if small else 355)/ih)
                group=[Image(str(p),width=iw*scale,height=ih*scale),Spacer(1,5),Paragraph(fmt(cap),styles['SmallN'])]
                if flow and isinstance(flow[-1],Paragraph) and flow[-1].style.name in ('H1N','H2N','H3N','FoundryN'):
                    group.insert(0,flow.pop())
                flow.append(KeepTogether(group))
            i+=1;continue
        h=re.match(r'^(#{1,6})\s+(.+)',l)
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
            else:flow.append(Paragraph(heading,styles['FoundryN' if title.startswith('No Foundry') else ('H2N' if level==3 else 'H3N')]))
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
            t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#e8e2d7')),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.HexColor('#f7f5f0'),colors.white]),('VALIGN',(0,0),(-1,-1),'TOP'),('BOTTOMPADDING',(0,0),(-1,-1),7),('TOPPADDING',(0,0),(-1,-1),7),('LINEBELOW',(0,0),(-1,0),.6,GOLD)]))
            flow.extend([t,Spacer(1,10)]);continue
        if l.startswith('>'):
            q=[]
            while i<len(lines) and lines[i].strip().startswith('>'):q.append(lines[i].strip().lstrip('> '));i+=1
            group=[Paragraph('<br/>'.join(fmt(x) for x in q),styles['QuoteN'])]
            if flow and isinstance(flow[-1],Paragraph) and flow[-1].style.name=='FoundryN':
                group.insert(0,flow.pop())
            flow.append(KeepTogether(group));continue
        bullet=re.match(r'^(\s*)([-*]|\d+\.)\s+(.+)',lines[i])
        if bullet:
            depth=min(len(bullet[1]),6)
            st=ParagraphStyle('li',parent=styles['Text'],leftIndent=12+depth*5,firstLineIndent=-9,spaceAfter=5)
            prefix='•' if bullet[2] in '-*' else bullet[2]
            flow.append(Paragraph(prefix+' '+fmt(bullet[3]),st));i+=1;continue
        para=[l];i+=1
        while i<len(lines) and lines[i].strip() and not re.match(r'^(#|>|\||!\[|```|---|\s*[-*] |\s*\d+\. )',lines[i]):para.append(lines[i].strip());i+=1
        flow.append(Paragraph(fmt(' '.join(para)),styles['Text']))
    return flow

def build(kind,label):
    p=ROOT/'docs'/f'manual-do-{kind}.md';dest=OUT/f'Nihility-Manual-do-{kind.title()}.pdf'
    doc=Book(str(dest),pagesize=(W,H),rightMargin=M,leftMargin=M,topMargin=42,bottomMargin=121,title='Nihility - '+label,author='Lux',allowSplitting=True)
    doc.book_label=label
    doc.spots=json.loads((ROOT/'docs/vinhetas-editoriais.json').read_text(encoding='utf-8'))
    cover=CACHE/f'capa-{kind}-elenco.jpg'
    audience='Para jogadores: regras, exemplos e controles da própria ficha.' if kind=='jogador' else 'Reservado ao Mestre: inclui os bastidores do mundo e as ferramentas de condução.'
    story=[Cover(cover,label),PageBreak(),
        Paragraph('Créditos e consulta',styles['H1N']),
        Paragraph('Nihility — '+label,styles['H2N']),
        Paragraph('Criação do sistema: Lux.<br/>Edição editorial de 5 de novembro de 2026.<br/>Regras de referência: 1.84. Foundry VTT 13 e 14.',styles['Text']),
        Paragraph(audience,styles['Text']),
        Paragraph('Como consultar',styles['H2N']),
        Paragraph('Leia os capítulos iniciais para aprender a jogar. Durante a sessão, use o sumário, os marcadores do PDF e o glossário para localizar uma regra. Os blocos No Foundry explicam como executar as operações na ficha.',styles['Text']),
        Paragraph('Os valores apresentados seguem a configuração inicial do sistema. Consulte as Regras desta mesa para as escolhas da sua campanha. Anatomia, Naves, PAD e outros módulos são usados conforme a proposta do grupo.',styles['Text']),
        Paragraph('Ilustrações',styles['H2N']),
        Paragraph('Artes geradas com a ImageGen integrada. Diagramas vetoriais do projeto. Neris, Cora, Ícaro, Lia e Doran formam o elenco dos exemplos. Suas cenas e objetos ajudam a acompanhar as decisões descritas no texto.',styles['SmallN']),
        Paragraph('Referências editoriais: D&D 2024, Tormenta20 — Kit Introdutório e Basic Roleplaying — Quickstart 2025. Textos e artes dessas obras não são reproduzidos nesta edição.',styles['SmallN']),
        PageBreak(),Paragraph('Sumário',styles['H1N'])]
    toc=TableOfContents();toc.levelStyles=[styles['TOCN']];story.append(toc)
    source=p.read_text(encoding='utf-8')
    ANCHORS.clear();ANCHORS.update(slug(plain(x)) for x in re.findall(r'^#{1,6}\s+(.+)$',source,re.M))
    source=source.split('<!-- LIVRO -->',1)[1] if '<!-- LIVRO -->' in source else source[source.index('## Guia'):]
    story+=content(source)
    doc.multiBuild(story)
    (CACHE/f'layout-{kind}.json').write_text(json.dumps(doc.page_art,ensure_ascii=False,indent=2),encoding='utf-8')
    print(dest)

if __name__=='__main__':
    subprocess.run([__import__('sys').executable,str(ROOT/'docs/render-editorial-diagrams.py')],check=True)
    subprocess.run(['node',str(ROOT/'docs/render-diagrams.cjs')],check=True)
    build('jogador','Livro do Jogador');build('mestre','Livro do Mestre')
