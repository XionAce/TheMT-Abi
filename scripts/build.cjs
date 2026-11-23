const { mkdirSync, copyFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const vendor = join(__dirname, '../public/vendor');
mkdirSync(vendor, { recursive: true });
copyFileSync(
  join(__dirname, '../node_modules/@supabase/supabase-js/dist/umd/supabase.js'),
  join(vendor, 'supabase.js'),
);

// Only the public Spotify app identifier belongs in the browser bundle.
const clientId = (process.env.SPOTIFY_CLIENT_ID || '').trim();
if (clientId && !/^[a-f0-9]{32}$/i.test(clientId)) {
  throw new Error('SPOTIFY_CLIENT_ID must be a 32-character public Spotify client ID.');
}
writeFileSync(join(vendor, 'spotify-config.js'), 'window.ABIVERSE_SPOTIFY_CLIENT_ID = ' + JSON.stringify(clientId) + ';');
