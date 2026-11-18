'use strict';
// Practice Numbers: start the module. Settings come from .env (never
// committed) or from the host's environment variables (Hostinger's panel).
//
//   npm start      (or double-click start.cmd on Windows)
const path = require('node:path');
const { loadEnv } = require('./lib/env');
const { createClient } = require('./vendor/opendental-core/odclient');
const { createApp, VERSION } = require('./lib/app');

loadEnv(path.join(__dirname, '.env'));
const env = process.env;

const stage = String(env.TDC_STAGE || '').trim().toLowerCase();
const port = Number(env.PORT || 3104);
// CONTRACT §1: in the live stage, listen on 127.0.0.1 only. On Hostinger
// (design stage) set HOST=0.0.0.0 so Hostinger's front end can reach the app.
const host = stage === 'live' ? '127.0.0.1' : (env.HOST || '127.0.0.1');
const countCodes = String(env.COUNT_CODES || 'D2740,D6058,D6065,D6010,D2950')
  .split(',').map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z0-9]{1,10}$/.test(c)).slice(0, 20);

let app;
try {
  const client = createClient({ gatewayUrl: env.GATEWAY_URL || 'http://127.0.0.1:8787', gatewayKey: env.GATEWAY_KEY });
  app = createApp({
    secret: env.MODULE_SECRET,
    stage,
    client,
    lists: String(env.PATIENT_LISTS || 'on').toLowerCase() !== 'off',
    countCodes,
    tz: env.TDC_TZ || 'America/Los_Angeles',
  });
} catch (err) {
  console.error(`Practice Numbers can't start: ${err.message}`);
  console.error('Copy .env.example to .env and fill it in (see README.md, "Set it up on Windows").');
  process.exit(1);
}

app.server.listen(port, host, () => {
  console.log(`Practice Numbers ${VERSION} (${stage} stage) listening on http://${host}:${port}/`);
});
