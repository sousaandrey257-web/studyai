'use strict';
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const FILE = path.join(__dirname, '../../data/invite_codes.json');

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch { return {}; }
}

function save(codes) {
  fs.writeFileSync(FILE, JSON.stringify(codes, null, 2));
}

function generate({ email = null, createdBy = 'admin', expiresIn = 7 * 24 * 3600 * 1000, maxUses = 1 } = {}) {
  const codes = load();
  const code  = crypto.randomBytes(4).toString('hex').toUpperCase(); // e.g. A1B2C3D4
  codes[code] = {
    code,
    email,           // if set, only this email can use it
    createdBy,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + expiresIn).toISOString(),
    maxUses,
    uses: 0,
    usedBy: [],
  };
  save(codes);
  return code;
}

function verify(code, email = null) {
  if (!code) return { valid: false, reason: 'No code provided' };
  const codes = load();
  const entry = codes[code.toUpperCase().trim()];
  if (!entry) return { valid: false, reason: 'Code invalide' };
  if (new Date(entry.expiresAt) < new Date()) return { valid: false, reason: 'Code expiré' };
  if (entry.uses >= entry.maxUses) return { valid: false, reason: 'Code déjà utilisé' };
  if (entry.email && email && entry.email.toLowerCase() !== email.toLowerCase())
    return { valid: false, reason: 'Ce code est réservé à une autre adresse' };
  return { valid: true, entry };
}

function redeem(code, email) {
  const result = verify(code, email);
  if (!result.valid) return result;
  const codes = load();
  const entry = codes[code.toUpperCase().trim()];
  entry.uses++;
  entry.usedBy.push({ email, redeemedAt: new Date().toISOString() });
  save(codes);
  return { valid: true, entry };
}

function revoke(code) {
  const codes = load();
  delete codes[code.toUpperCase().trim()];
  save(codes);
}

function list() {
  return Object.values(load());
}

// Generate batch of codes
function generateBatch(count, options = {}) {
  const results = [];
  for (let i = 0; i < count; i++) results.push(generate(options));
  return results;
}

module.exports = { generate, generateBatch, verify, redeem, revoke, list };
