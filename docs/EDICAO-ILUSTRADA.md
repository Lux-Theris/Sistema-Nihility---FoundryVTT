# Edição ilustrada dos manuais

Referência: Nihility RPG System 1.78.0, 31/10/2026. Os manuais Markdown e `img/` são as fontes; os PDFs ficam em `output/pdf/`. A edição acrescenta criação guiada, exemplos, orientações de condução e uma aventura introdutória. Não altera as regras implementadas.

Revisão de texto: explicações dos oito Atributos, distinção entre Atributo e Skill e entre tier e nível, e definição dos cinco tiers conforme esclarecimento do autor. Extra concede memória muscular ou conhecimento de capacidades humanas reais, com treino necessário para consolidar e desenvolver o domínio; o exemplo de Karatê nível 1 fica acima de um faixa branca do nosso mundo, sem equivaler a um mestre. Normal introduz o sobrenatural; Racial identifica um poder da Espécie; Único expressa personalidade, emoções e vontade; Ultimate controla aspectos da realidade. A hierarquia entre Única e Ultimate é explicada sem criar percentuais ou imunidades automáticas.

## Gerar novamente

Dependências: Python com ReportLab e Pillow, Node com sharp. Para verificar: pypdf, pdfplumber e Poppler. No Windows, o gerador usa Segoe UI e Georgia de `C:/Windows/Fonts`. O renderizador de diagramas encontra sharp instalado normalmente ou no runtime local do Codex.

```powershell
python docs/build-manuals.py
```

O script converte os SVGs e otimiza as artes em JPEGs intermediários em `tmp/pdfs/`, monta o sumário com os números reais das páginas e gera texto pesquisável, marcadores e links internos. As fontes PNG e SVG permanecem preservadas. Após alterações, renderize os PDFs com Poppler e confira as páginas, sobretudo tabelas e diagramas. O gerador não publica nem envia arquivos.

## Artes e créditos

Sistema de Lux. Diagramas SVG preexistentes do projeto. As imagens de interface são esquemas explicativos e não capturas de um mundo em execução. As três artes raster desta edição foram geradas com a ferramenta integrada ImageGen, sem usar a alternativa CLI/API e sem imagens de referência de terceiros.

- `img/capa-jogador.png`: companhia de aventureiros diante de uma cidadela, portal e nave distante.
- `img/capa-mestre.png`: observador moldando um mundo arcano numa mesa astronômica.
- `img/farol-entre-mundos.png`: farol arcano e ponte danificada; ambientação ilustrativa, não mapa tático.

Prompts enviados à ferramenta:

### Capa do Jogador

Create a premium original tabletop RPG book cover illustration, portrait 2:3. No text, no logos, no letters. Nihility, arcane fantasy meets distant science fiction and isekai. A diverse small fellowship seen from behind: a cloaked elven spellcaster holding a violet luminous sigil, an armored human adventurer with a sword and a subtle cybernetic arm, and a small translucent slime companion. They stand on ancient stone stairs over a vast landscape, a floating ruined citadel and a distant sleek starship near a fractured violet celestial portal. Painterly detailed book illustration, restrained violet and antique gold palette, deep navy shadows, warm ivory highlights, atmospheric wonder, original character and world designs, dramatic readable silhouette. Leave top quarter relatively dark and uncluttered for typography to be added separately. Image must work as an elegant book cover, not a product mockup.

### Capa do Mestre

Original premium tabletop RPG illustration for Nihility Game Master's book. Portrait 2:3, no lettering or symbols that resemble text, no logos. A mysterious robed archivist seen from behind in an immense ancient observatory, hands shaping a luminous violet miniature world above a circular antique gold astrolabe table; floating fragments of a medieval citadel, an alien moon and a sleek starship orbit the magical model. Tall stone arches merge subtly with arcane technological circuits, cosmic nebula beyond the windows. Refined painterly book art, detailed materials, dramatic readable composition, dark navy, restrained violet and antique gold, warm ivory light. Top quarter dark uncluttered for separately added title. Express the wonder and responsibility of creating adventures, not an evil villain. Companion visual identity to a fantasy and arcane sci-fi player's handbook.

### Farol entre mundos

Original horizontal 3:2 interior illustration for a tabletop RPG book called Nihility. No text, no logos. An ancient arcane lighthouse stands on a rocky floating island, its violet beacon bridging medieval fantasy and subtle lost technology. A damaged stone bridge leads toward its open entrance. Tiny cloaked adventurers approach, one translucent slime companion. Warm sunset, distant mountains, dramatic clouds, violet magic and antique gold highlights, sophisticated detailed painterly fantasy book illustration with clear composition. A single self-contained scene suitable for an introductory adventure 'The lighthouse between worlds'. No book mockup, no panels or border.

## Referências editoriais

- [D&D Player's Handbook 2024: organização dos assuntos](https://www.dndbeyond.com/sources/dnd/phb-2024).
- [D&D Dungeon Master's Guide 2024: exemplos e ferramentas de condução](https://wpn.wizards.com/en/products/2024-dungeon-masters-guide).
- [Tormenta20: apresentação, formatos e kit introdutório](https://jamboeditora.com.br/produto/tormenta20-edicao-jogo-do-ano/).

Essas obras serviram como referências editoriais. Não foram reproduzidos seus textos ou ilustrações. A prévia PDF da Jambô excedeu o limite da ferramenta de consulta; não houve acesso integral ao miolo dos livros comerciais.
