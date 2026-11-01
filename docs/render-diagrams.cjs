// Usa sharp instalado no ambiente ou a biblioteca do runtime do Codex.
const fs = require('node:fs');
const path = require('node:path');
let sharp;
try { sharp = require('sharp'); }
catch {
  const bundled = path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');
  sharp = require(bundled);
}
const root = path.resolve(__dirname, '..');
const dest = path.join(root, 'tmp/pdfs');
fs.mkdirSync(dest, { recursive: true });
(async () => {
  for (const f of fs.readdirSync(path.join(__dirname, 'img')).filter(f => f.endsWith('.svg'))) {
    await sharp(path.join(__dirname, 'img', f), { density: 160 }).resize({width:1600,withoutEnlargement:true}).flatten({background:'#ffffff'}).jpeg({quality:91,mozjpeg:true}).toFile(path.join(dest, f.replace('.svg', '.jpg')));
  }
  for (const f of ['capa-jogador.png','capa-mestre.png','farol-entre-mundos.png']) {
    await sharp(path.join(__dirname,'img',f)).resize({width:1400,withoutEnlargement:true}).jpeg({quality:88,mozjpeg:true}).toFile(path.join(dest,f.replace('.png','.jpg')));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
