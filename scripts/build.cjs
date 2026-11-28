const { mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');

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
const files = readdirSync(publicDir, { withFileTypes: true })
  .filter(file => file.isFile() && file.name !== 'sw.js')
  .map(file => '/' + file.name).concat('/vendor/supabase.js', '/vendor/spotify-config.js', '/vendor/fsrs.js', '/vendor/fsrs-LICENSE.txt', '/vendor/srs-kit-LICENSE.txt').sort();
const template = readFileSync(join(__dirname, 'service-worker.js'), 'utf8');
const hash = require('node:crypto').createHash('sha256').update(template);
for (const file of files) hash.update(file).update(readFileSync(join(publicDir, file)));
const name = 'abiverse-shell-' + hash.digest('hex').slice(0, 16);
writeFileSync(join(publicDir, 'sw.js'), template.replace('__CACHE_NAME__', JSON.stringify(name))
  .replace('__SHELL_FILES__', JSON.stringify(files)));
