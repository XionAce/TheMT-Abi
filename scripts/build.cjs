const { mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync } = require('node:fs');
const { join,dirname } = require('node:path');

const vendor = join(__dirname, '../public/vendor');
mkdirSync(vendor, { recursive: true });
copyFileSync(
  join(__dirname, '../node_modules/@supabase/supabase-js/dist/umd/supabase.js'),
  join(vendor, 'supabase.js'),
);

copyFileSync(join(__dirname, '../node_modules/ts-fsrs/dist/index.umd.js'), join(vendor,'fsrs.js'));
copyFileSync(join(__dirname, '../node_modules/ts-fsrs/LICENSE'), join(vendor,'fsrs-LICENSE.txt'));
copyFileSync(join(__dirname, '../node_modules/@open-spaced-repetition/srs-kit/LICENSE'), join(vendor,'srs-kit-LICENSE.txt'));

// Only the public Spotify app identifier belongs in the browser bundle.
const clientId = (process.env.SPOTIFY_CLIENT_ID || '').trim();
if (clientId && !/^[a-f0-9]{32}$/i.test(clientId)) {
  throw new Error('SPOTIFY_CLIENT_ID must be a 32-character public Spotify client ID.');
}
writeFileSync(join(vendor, 'spotify-config.js'), 'window.ABIVERSE_SPOTIFY_CLIENT_ID = ' + JSON.stringify(clientId) + ';');

const publicDir = join(__dirname, '../public');
const pdfAssets = [
  ['pdf-lib/dist/pdf-lib.min.js','pdf-lib.js'],['pdf-lib/LICENSE.md','pdf-lib-LICENSE.txt'],
  ['pdfjs-dist/legacy/build/pdf.mjs','pdf.mjs'],['pdfjs-dist/legacy/build/pdf.worker.mjs','pdf.worker.mjs'],
  ['pdfjs-dist/LICENSE','pdfjs-LICENSE.txt'],
];
for (const [src,dest] of pdfAssets) copyFileSync(join(__dirname,'../node_modules',src),join(vendor,dest));
// Less common font maps and image decoders are cached when a PDF needs them.
const optionalFiles=[];
for (const dir of ['cmaps','standard_fonts','wasm','iccs']) {
  const sourceDir=join(__dirname,'../node_modules/pdfjs-dist',dir);
  for (const name of readdirSync(sourceDir)) {
    const file='/vendor/pdf-resources/'+dir+'/'+name,dest=join(publicDir,file);
    mkdirSync(dirname(dest),{recursive:true});
    copyFileSync(join(sourceDir,name),dest);
    optionalFiles.push(file);
  }
}
const files = readdirSync(publicDir, { withFileTypes: true })
  .filter(file => file.isFile() && file.name !== 'sw.js')
  .map(file => '/' + file.name).concat(pdfAssets.map(([,dest])=>'/vendor/'+dest),'/vendor/supabase.js', '/vendor/spotify-config.js', '/vendor/fsrs.js', '/vendor/fsrs-LICENSE.txt', '/vendor/srs-kit-LICENSE.txt').sort();
const template = readFileSync(join(__dirname, 'service-worker.js'), 'utf8');
const hash = require('node:crypto').createHash('sha256').update(template);
for (const file of [...files,...optionalFiles]) hash.update(file).update(readFileSync(join(publicDir, file)));
const name = 'abiverse-shell-' + hash.digest('hex').slice(0, 16);
writeFileSync(join(publicDir, 'sw.js'), template.replace('__CACHE_NAME__', JSON.stringify(name))
  .replace('__SHELL_FILES__', JSON.stringify(files)).replace('__OPTIONAL_FILES__',JSON.stringify(optionalFiles)));
