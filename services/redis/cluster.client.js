'use strict';
// Redis Cluster-aware client.
// Auto-detects topology from env:
//   REDIS_CLUSTER_NODES=host1:6379,host2:6379   → Cluster mode (ioredis.Cluster)
//   REDIS_URL / REDIS_TLS_URL                   → Standalone (existing client)
//   (nothing)                                   → tries localhost standalone
//
// Exposes same surface as services/redis/client.js so callers are swappable.

const baseClient = require('./client'); // existing standalone singleton

let _cluster     = null;
let _clusterReady = false;
let _attempted   = false;

function _initCluster() {
  if (_attempted) return;
  _attempted = true;

  const nodesEnv = process.env.REDIS_CLUSTER_NODES;
  if (!nodesEnv) return; // no cluster configured — use standalone

  let Redis;
  try { Redis = require('ioredis'); } catch { return; }

  const nodes = nodesEnv.split(',').map(n => {
    const [host, port] = n.trim().split(':');
    return { host, port: parseInt(port) || 6379 };
  }).filter(n => n.host);

  if (!nodes.length) return;

  try {
    _cluster = new Redis.Cluster(nodes, {
      enableOfflineQueue:   false,
      clusterRetryStrategy: (times) => Math.min(times * 200, 5_000),
      redisOptions: {
        maxRetriesPerRequest: 1,
        connectTimeout:       2_000,
        commandTimeout:       1_000,
      },
    });

    _cluster.on('ready', () => {
      _clusterReady = true;
      console.log(`[redis:cluster] connected (${nodes.length} nodes)`);
    });
    _cluster.on('error',   (e) => { if (_clusterReady) console.warn('[redis:cluster] error:', e.message); _clusterReady = false; });
    _cluster.on('close',   ()  => { _clusterReady = false; });
    _cluster.on('reconnecting', () => console.log('[redis:cluster] reconnecting…'));
  } catch (err) {
    console.warn('[redis:cluster] init failed:', err.message);
    _cluster = null;
  }
}

_initCluster();

// Prefer cluster → standalone → null
function getClient() {
  if (_clusterReady && _cluster) return _cluster;
  return baseClient.getClient(); // falls back to standalone
}

function isAvailable() {
  return (_clusterReady && _cluster !== null) || baseClient.isAvailable();
}

function isClusterMode() { return _clusterReady && _cluster !== null; }

module.exports = { getClient, isAvailable, isClusterMode };
