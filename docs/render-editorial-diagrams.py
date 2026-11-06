"""Diagramas claros para a edição do livro; preserva os SVGs anteriores."""
from pathlib import Path
from html import escape
import re, textwrap
import xml.etree.ElementTree as ET

IMG = Path(__file__).resolve().parent / 'img'
INK, MUTED, RULE, PAPER = '#24292d', '#40566a', '#985b46', '#ffffff'

def text(x, y, value, size=23, color=INK, family='Segoe UI', weight='normal'):
    return f'<text x="{x}" y="{y}" fill="{color}" font-family="{family}" font-size="{size}" font-weight="{weight}">{escape(value)}</text>'

def steps(name, title, entries, note):
    """Uma sequência de leitura vertical, com texto grande e margens claras."""
    shapes = [text(28, 43, title, 29, INK, 'Georgia')]
    shapes.append(f'<path d="M28 64 H632" stroke="{RULE}" stroke-width="2"/>')
    y = 102
    for i, (label, description) in enumerate(entries, 1):
        lines = textwrap.wrap(description, 48)
        shapes.append(text(28, y, f'{i:02}', 24, RULE, weight='bold'))
        shapes.append(text(82, y, label, 24, MUTED, weight='bold'))
        for line in lines:
            y += 31
            shapes.append(text(82, y, line, 22))
        y += 44
    shapes.append(f'<path d="M28 {y-14} H632" stroke="#c7b9aa"/>')
    for line in textwrap.wrap(note, 57):
        shapes.append(text(28, y+17, line, 20, MUTED)); y += 28
    height=y+30
    svg=f'<svg xmlns="http://www.w3.org/2000/svg" width="660" height="{height}" viewBox="0 0 660 {height}"><rect width="660" height="{height}" fill="{PAPER}"/>'+''.join(shapes)+'</svg>'
    (IMG/f'{name}-livro.svg').write_text(svg,encoding='utf-8')

def main():
    # Interfaces mantêm seus campos e posições, mas adotam papel claro e tinta.
    backgrounds = {'#12141c','#232738','#2a2346','#1d2744','#2b1a1c','#172340','#1f3a2e','#3a2317','#171a26','#20243a','#1b1e2b','#16303a','#2a2618'}
    mapping = {'#9aa1c2':'#52636c','#3a4060':'#a99b8a','#4a5380':'#a99b8a',
               '#a78bfa':'#87634f','#7c63d6':'#87634f','#4f8cff':'#486678',
               '#5fd08f':'#527565','#ff9f43':'#a46c40','#ff7043':'#a85c42',
               '#e5534b':'#a35042','#6ee7ff':'#4c7b83','#e8c170':'#8a6933'}
    for p in IMG.glob('*.svg'):
        if p.stem.endswith('-livro'): continue
        source=p.read_text(encoding='utf-8')
        def recolor(m):
            c=m[0].lower()
            if c in backgrounds: return '#f4f1eb' if c!='#12141c' else '#ffffff'
            if c in mapping: return mapping[c]
            rgb=c[1:];rgb=''.join(x*2 for x in rgb) if len(rgb)==3 else rgb
            if len(rgb)!=6:return c
            r,g,b=(int(rgb[i:i+2],16) for i in (0,2,4))
            return INK if max(r,g,b)>170 else '#a99b8a'
        source=re.sub(r'#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b',recolor,source)
        source=source.replace("'Helvetica Neue'", "'Georgia'")
        (IMG/f'{p.stem}-livro.svg').write_text(source,encoding='utf-8')
    steps('atributo-camadas','Do Atributo à rolagem',[
        ('Total permanente','12 pontos + 3 de Título = 15.'),
        ('Total Efetivo','15 + 6 de bônus temporário = 21.'),
        ('Bônus','21 dividido por 3, arredondando para baixo: 7.'),
        ('Dados e bônus de item','Com Bônus 7: 1d20 + 7. Um item de +2 acrescenta +2 por fora: 1d20 + 7 + 2.')
    ],'Exemplo didático. Vida e Mana usam o Total permanente, não o Total Efetivo da rolagem.')
    steps('ciclo-nivel-skill','O ciclo de uma Skill',[
        ('Nível 1','É o ponto de partida da Skill.'),
        ('Níveis 2 e 3: Poder','Cada avanço multiplica o efeito por 1,10, no padrão da mesa.'),
        ('Níveis 4 e 5: Desconto','Cada avanço reduz em 20% o Custo que estava valendo.'),
        ('O ciclo continua','Dois avanços de Poder, depois dois de Desconto. Os valores são configuráveis.')
    ],'O piso padrão de Custo é 10% do original. Quando já está no piso, o avanço de Desconto vira Poder.')
    steps('dano-por-elemento','Um golpe, dois elementos',[
        ('Dano inicial: 100','Fogo + Gelo: divida em duas partes de 50.'),
        ('A metade de Fogo','O alvo é imune a Fogo. Esta parte e os efeitos desse elemento não passam: sobra 0.'),
        ('A metade de Gelo','50 menos 20% de Resistência Geral = 40. Depois, menos 30% de Resistência a Gelo = 28.'),
        ('Resultado','0 + 28 = 28 de dano após essas Resistências.')
    ],'Este exemplo isola elementos e Resistências. Outras defesas dependem das características do golpe e do alvo.')
    steps('resistencia','Resistência e Imunidade',[
        ('10% por nível','Uma Skill de Resistência bloqueia uma fração do dano ao qual se aplica.'),
        ('Resistência Geral','Chega ao nível 5: 50%. Não existe Imunidade Geral.'),
        ('Resistência elemental','Chega ao nível 10: 100%, tornando-se Imunidade àquele elemento.'),
        ('Fontes do mesmo tipo','Duas Skills do mesmo alvo não somam: vale a melhor. Skill e Título podem somar.')
    ],'As reduções de Resistência Geral e elemental são sucessivas, não uma soma simples dos percentuais.')
    steps('cascata-dano-nave','As defesas de uma Nave',[
        ('Evasão','Evita uma fração do golpe, quando o módulo de movimento e Evasão está ligado.'),
        ('Escudo','Absorve dano em um pool próprio. Penetração e elementos podem mudar o que atravessa.'),
        ('Casco','A Blindagem protege enquanto tem Vida; a Redução diminui o dano que chega a ela.'),
        ('Integridade Estrutural','O dano restante atinge os Módulos. O card registra as camadas e os sistemas atingidos.')
    ],'Dano Absoluto ignora Escudo e Casco. A Evasão ainda se aplica. Consulte as exceções de cada arma.')
    steps('pipeline-dano','O percurso de um golpe',[
        ('Produzir o dano','Role a fórmula e aplique os multiplicadores, modificadores e escalas pertinentes.'),
        ('Encontrar obstáculos','Estruturas no caminho podem interceptar o golpe.'),
        ('Resolver cada alvo','Considere Penetração, elementos e defesas. Um alvo pode sofrer um resultado diferente de outro.'),
        ('Chegar aos recursos','No personagem, o Escudo absorve primeiro; o restante chega à Vida. Confira Condições e consequências.')
    ],'Este é o percurso geral. Dano Absoluto, naves e outros efeitos têm exceções próprias, descritas no texto.')
    steps('escala','Tamanhos diferentes',[
        ('Pessoal → Veículo','Um degrau de diferença.'),
        ('Veículo → Nave','Mais um degrau.'),
        ('Nave → Capital','Mais um degrau.'),
        ('Fator padrão: 10 por degrau','Do maior para o menor, multiplique. Do menor para o maior, divida.')
    ],'Use apenas se a mesa ativar Escala. Uma diferença de dois degraus usa o fator 100 no padrão da mesa.')
    # A edição do jogador mostra a própria visão da ficha, sem controles do Mestre.
    ET.register_namespace('', 'http://www.w3.org/2000/svg')
    sheet=ET.fromstring((IMG/'ficha-personagem-livro.svg').read_text(encoding='utf-8'))
    parents={child:parent for parent in sheet.iter() for child in parent}
    for element in list(sheet.iter()):
        value=''.join(element.itertext()).strip()
        remove=element.attrib.get('class')=='gm'
        if element.tag.endswith('text'):
            remove=remove or 'Zerar pontos (Mestre)' in value or 'Moldura tracejada dourada' in value
            remove=remove or (element.attrib.get('x')=='376' and value=='+')
        if remove: parents[element].remove(element)
    (IMG/'ficha-jogador-livro.svg').write_text(ET.tostring(sheet,encoding='unicode'),encoding='utf-8')

if __name__=='__main__': main()
