"""Empacota os livros e suas fontes, preservando a separação entre públicos."""
from pathlib import Path
from shutil import copy2
from zipfile import ZipFile, ZIP_DEFLATED
from pypdf import PdfReader
import argparse
import json
import re

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / 'docs'
OUT = ROOT / 'output'


def assets(source):
    return set(re.findall(r'!\[[^\]]*\]\((img/[^)]+)\)', source.read_text(encoding='utf-8')))


def archive(dest, paths, readme):
    with ZipFile(dest, 'w', ZIP_DEFLATED) as z:
        for p in sorted(set(paths)):
            z.write(p, p.relative_to(ROOT))
        z.writestr('LEIA-ME.txt', readme)
    with ZipFile(dest) as z:
        assert z.testzip() is None


def package(tag):
    if not re.fullmatch(r'[A-Za-z0-9-]+', tag):
        raise ValueError('Use apenas letras sem acento, números e hífens na etiqueta.')
    player = DOCS / 'manual-do-jogador.md'
    gm = DOCS / 'manual-do-mestre.md'
    spots = json.loads((DOCS / 'vinhetas-editoriais.json').read_text(encoding='utf-8'))
    public = assets(player) | {'img/capa-jogador-elenco.png'} | {v['path'] for v in spots['assets'].values()}
    secrets = {'img/skill-oceano-alma.png', 'img/titulos-divindade.png', 'img/skill-inscrita-alma.png'}
    assert not public & secrets
    public_paths = [player, DOCS / 'vinhetas-editoriais.json'] + [DOCS / p for p in public]
    player_zip = OUT / f'Nihility-Jogador-Fontes-Publicas-{tag}.zip'
    archive(player_zip, public_paths,
            'Nihility - fontes do Livro do Jogador\n\n'
            'Este pacote pode ser compartilhado com os jogadores. Contém somente o Markdown do jogador, sua capa e as imagens usadas nele.\n'
            'As ilustrações foram geradas com a ImageGen integrada; os diagramas vetoriais são do projeto.\n'
            'Para editar, abra docs/manual-do-jogador.md e mantenha a pasta img ao lado do texto. Para ler no celular, use o PDF entregue separadamente.\n')
    with ZipFile(player_zip) as z:
        for name in z.namelist():
            assert 'mestre' not in name.lower() and (not name.endswith('.json') or name.endswith('vinhetas-editoriais.json'))
            if name.endswith(('.md', '.svg', '.txt', '.json')):
                text = z.read(name).decode('utf-8').casefold()
                assert not any(word in text for word in ['apoteose', 'faísca', 'circuitos mágicos', 'armazenamento na alma', 'qualidade da alma', 'divindade']), name

    all_assets = public | assets(gm) | {'img/capa-mestre-elenco.png'}
    files = [player, gm] + [DOCS / p for p in all_assets]
    files += list((DOCS / 'img').glob('*.svg'))
    files += list(DOCS.glob('artes-*.json'))
    files += [DOCS / p for p in ['build-manuals.py', 'render-diagrams.cjs', 'render-editorial-diagrams.py', 'check-manuals.py', 'package-manuals.py', 'EDICAO-ILUSTRADA.md', 'elenco-editorial.json', 'vinhetas-editoriais.json']]
    master_zip = OUT / f'Nihility-Mestre-Fontes-Reservadas-{tag}.zip'
    archive(master_zip, files,
            'Nihility - fontes completas RESERVADAS AO MESTRE\n\n'
            'Este pacote contém os dois livros, suas imagens, diagramas, prompts e histórico editorial. Inclui os bastidores da alma, das Skills, dos Títulos, da fé e da divindade.\n'
            'Para compartilhar com jogadores, use apenas o PDF e o pacote de fontes públicas do jogador.\n'
            'Geração: Python com reportlab, Pillow e pypdf; Node com sharp. Execute python docs/build-manuals.py. Tipografia Segoe UI e Georgia do Windows.\n'
            'As ilustrações foram geradas com a ImageGen integrada. Os prompts estão nos arquivos artes-*.json.\n')
    result = {'illustrations': sum(p.endswith('.png') for p in all_assets), 'archives': []}
    for p in (player_zip, master_zip):
        result['archives'].append({'file': str(p), 'bytes': p.stat().st_size})
    result['pdfs'] = []
    for kind in ('Jogador', 'Mestre'):
        src = OUT / 'pdf' / f'Nihility-Manual-do-{kind}.pdf'
        dest = OUT / 'pdf' / f'Nihility-Livro-do-{kind}-{tag}.pdf'
        copy2(src, dest)
        assert dest.read_bytes() == src.read_bytes()
        result['pdfs'].append({'file': str(dest), 'pages': len(PdfReader(dest).pages), 'bytes': dest.stat().st_size})
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--tag', default='Atualizado')
    package(parser.parse_args().tag)
