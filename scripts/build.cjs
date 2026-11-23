const { mkdirSync, copyFileSync } = require('node:fs');
const { join } = require('node:path');

const vendor = join(__dirname, '../public/vendor');
mkdirSync(vendor, { recursive: true });
copyFileSync(
  join(__dirname, '../node_modules/@supabase/supabase-js/dist/umd/supabase.js'),
  join(vendor, 'supabase.js'),
);
