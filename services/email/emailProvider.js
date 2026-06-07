'use strict';
const https = require('https');

const FROM_EMAIL = process.env.FROM_EMAIL || 'StudyAI <onboarding@resend.dev>';

function detectProvider() {
  if (process.env.RESEND_API_KEY)   return 'resend';
  if (process.env.SENDGRID_API_KEY) return 'sendgrid';
  if (process.env.POSTMARK_API_KEY) return 'postmark';
  return 'console';
}

function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...headers }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Email request timeout')); });
    req.write(payload);
    req.end();
  });
}

async function sendViaResend({ from, to, subject, html }) {
  const res = await httpsPost('api.resend.com', '/emails',
    { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    { from, to, subject, html });
  if (res.status >= 400) throw new Error(`Resend ${res.status}: ${res.body.slice(0, 200)}`);
  return { provider: 'resend', status: res.status };
}

async function sendViaSendgrid({ from, to, subject, html }) {
  const res = await httpsPost('api.sendgrid.com', '/v3/mail/send',
    { Authorization: `Bearer ${process.env.SENDGRID_API_KEY}` },
    { personalizations: [{ to: [{ email: to }] }], from: { email: from }, subject,
      content: [{ type: 'text/html', value: html }] });
  if (res.status >= 400) throw new Error(`Sendgrid ${res.status}: ${res.body.slice(0, 200)}`);
  return { provider: 'sendgrid', status: res.status };
}

async function sendViaPostmark({ from, to, subject, html }) {
  const [fromName, fromEmail] = from.includes('<')
    ? [from.split('<')[0].trim(), from.split('<')[1].replace('>', '').trim()]
    : ['StudyAI', from];
  const res = await httpsPost('api.postmarkapp.com', '/email',
    { 'X-Postmark-Server-Token': process.env.POSTMARK_API_KEY },
    { From: `${fromName} <${fromEmail}>`, To: to, Subject: subject,
      HtmlBody: html, MessageStream: 'outbound' });
  if (res.status >= 400) throw new Error(`Postmark ${res.status}: ${res.body.slice(0, 200)}`);
  return { provider: 'postmark', status: res.status };
}

async function sendViaConsole({ to, subject }) {
  console.log(`[email:dev] TO=${to} | SUBJECT=${subject}`);
  return { provider: 'console', status: 200 };
}

const PROVIDER = detectProvider();

async function send({ to, subject, html }) {
  const payload = { from: FROM_EMAIL, to, subject, html };
  switch (PROVIDER) {
    case 'resend':   return sendViaResend(payload);
    case 'sendgrid': return sendViaSendgrid(payload);
    case 'postmark': return sendViaPostmark(payload);
    default:         return sendViaConsole(payload);
  }
}

module.exports = { send, PROVIDER, FROM_EMAIL };
