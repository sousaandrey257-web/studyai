'use strict';
const fs   = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '../../data/waitlist.json');

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch { return []; }
}

function save(list) {
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2));
}

function join(email) {
  email = email.toLowerCase().trim();
  const list = load();
  const existing = list.find(e => e.email === email);
  if (existing) return { already: true, position: list.indexOf(existing) + 1, entry: existing };
  const entry = { email, joinedAt: new Date().toISOString(), notified: false };
  list.push(entry);
  save(list);
  return { already: false, position: list.length, entry };
}

function getPosition(email) {
  email = email.toLowerCase().trim();
  const list = load();
  const idx  = list.findIndex(e => e.email === email);
  return idx === -1 ? null : idx + 1;
}

function getAll() { return load(); }

function markNotified(email) {
  const list = load();
  const e = list.find(e => e.email === email.toLowerCase().trim());
  if (e) { e.notified = true; e.notifiedAt = new Date().toISOString(); }
  save(list);
}

function remove(email) {
  const list = load().filter(e => e.email !== email.toLowerCase().trim());
  save(list);
}

module.exports = { join, getPosition, getAll, markNotified, remove };
