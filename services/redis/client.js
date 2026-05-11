'use strict';
// Redis singleton — gracefully unavailable when ioredis not installed or server unreachable.

let _client   = null;
let _ready    = false;
let _attempted = false;

function _init() {
  if (_attempted) return;
  _attempted = true;

  let Redis;
  try { Redis = require('ioredis'); } catch { return; } // not installed

  const url = process.env.REDIS_URL || process.env.REDIS_TLS_URL || null;
  const opts = {
    lazyConnect:         true,
    enableOfflineQueue:  false,
    maxRetriesPerRequest: 1,
    connectTimeout:      2000,
    commandTimeout:      1000,
  };

  try {
    _client = url ? new Redis(url, opts) : new Redis({ host: '127.0.0.1', port: 6379, ...opts });

    _client.on('ready', () => {
      _ready = true;
      console.log('[redis] connected');
    });
    _client.on('error', (err) => {
      if (_ready) console.warn('[redis] error:', err.message);
      _ready = false;
    });
    _client.on('close', () => { _ready = false; });

    _client.connect().catch(() => {}); // non-blocking attempt
  } catch {
    _client = null;
  }
}

_init();

module.exports = {
  isAvailable() { return _ready && _client !== null; },
  getClient()   { return _ready ? _client : null; },
};
