'use strict';
// Tiny .env reader (no dependencies). Values already set in the real
// environment win, so the host's settings panel overrides the file.
const fs = require('node:fs');

function parseEnv(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    out[key] = val;
  }
  return out;
}

function loadEnv(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return {}; }
  const vals = parseEnv(text);
  for (const [k, v] of Object.entries(vals)) if (process.env[k] === undefined) process.env[k] = v;
  return vals;
}

module.exports = { parseEnv, loadEnv };
