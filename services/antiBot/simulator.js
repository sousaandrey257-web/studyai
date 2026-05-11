'use strict';
// Adversarial Bot Simulation Engine — admin-only testing tool.
// Simulates known bot traffic patterns and measures detection effectiveness.
// Never sends real HTTP requests — operates on the scoring pipeline directly.

const BotDetect    = require('./detector');
const Attestation  = require('./attestation');
const BehaviorModel = require('./behaviorModel');
const ChallengeRouter = require('./challengeRouter');

// ── Bot profiles ──────────────────────────────────────────────────────────────

const BOT_PROFILES = {
  // Selenium/Puppeteer headless — most common automated bot
  headless_chrome: {
    name: 'Headless Chrome (Selenium)',
    headers: {
      'user-agent':      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36',
      'x-webdriver':     'true',
      'x-automation':    'false',
      'accept-language': 'en-US,en;q=0.9',
      'x-client-tz':     'UTC',
      'x-client-screen': '1280x720',
    },
  },

  // Script/curl — simplest bot
  curl_script: {
    name: 'curl/wget Script',
    headers: {
      'user-agent': 'curl/8.0.1',
    },
  },

  // Sophisticated bot with spoofed UA but no interaction signals
  stealth_bot: {
    name: 'Stealth Bot (spoofed UA, no interaction)',
    headers: {
      'user-agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'accept-language': 'en-US,en;q=0.9',
      'x-client-tz':     'UTC',
      'x-client-screen': '1024x768',
      // No canvas/webgl/audio hashes → flags no_canvas, no_webgl
      // No mouse entropy / type timing → behavioral gap
    },
  },

  // Bot with perfect uniform timing
  uniform_timing_bot: {
    name: 'Uniform Timing Bot',
    headers: {
      'user-agent':      'Mozilla/5.0 (compatible)',
      'x-type-timing':  '100,100,100,100,100,100,100,100,100,100', // perfect uniformity
      'x-mouse-entropy': '0.001', // near-zero entropy
      'x-time-to-action': '50',   // acts immediately
      'x-session-actions': '200', // very high
    },
  },

  // Credential stuffing bot
  credential_stuffing: {
    name: 'Credential Stuffing Bot',
    headers: {
      'user-agent': 'python-requests/2.31.0',
      'x-forwarded-for': '185.220.101.1', // known Tor exit
    },
  },

  // Human baseline (for comparison)
  human_baseline: {
    name: 'Human Baseline',
    headers: {
      'user-agent':       'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'accept-language':  'fr-FR,fr;q=0.9,en;q=0.8',
      'x-client-tz':      'Europe/Paris',
      'x-client-screen':  '1440x900',
      'x-webgl-hash':     'a1b2c3d4',
      'x-canvas-hash':    'e5f6a7b8',
      'x-audio-hash':     'c9d0e1f2',
      'x-webdriver':      'false',
      'x-automation':     'false',
      'x-mouse-entropy':  '0.45',
      'x-type-timing':    '120,95,180,85,210,145,90,165,130,200',
      'x-time-to-action': '3500',
      'x-session-actions': '12',
      'x-scroll-count':   '8',
      'x-click-count':    '5',
      'x-pow-solved':     'true',
    },
  },
};

// ── Simulation runner ─────────────────────────────────────────────────────────

function _fakeReq(headers, ip = '1.2.3.4') {
  return {
    headers: { ...headers, 'x-forwarded-for': headers['x-forwarded-for'] || ip },
    socket:  { remoteAddress: ip },
    ip,
    _powMissing: !headers['x-pow-solved'],
    _powValid:    headers['x-pow-solved'] === 'true',
  };
}

function _simulateProfile(profileKey, profile) {
  const req = _fakeReq(profile.headers);

  // Run full detection pipeline
  const bot         = BotDetect.computeBotScore(req, 'sim-fp');
  const attestation = Attestation.computeAttestation(req);
  const behavior    = BehaviorModel.analyze(req);

  req._botScore          = bot.score;
  req._attestation       = attestation;
  req._behavior          = behavior;

  const compositeScore = ChallengeRouter.aggregateScore(req);
  const tier           = ChallengeRouter.routeChallenge(compositeScore);
  const botTier        = BotDetect.adaptiveTier(bot.score);

  return {
    profile:        profileKey,
    name:           profile.name,
    scores: {
      bot:          bot.score,
      attestation:  attestation.attestationScore,
      behavior:     behavior.score,
      composite:    compositeScore,
    },
    detection: {
      botTier,
      challengeTier: tier,
      botReasons:   bot.reasons,
      attFlags:     attestation.flags,
      behaviorCat:  behavior.category,
      behaviorConf: behavior.confidence,
    },
    verdict: {
      wouldBlock:  bot.isBot || compositeScore >= 90,
      shadowMode:  botTier === 'shadow' || compositeScore >= 40,
      degraded:    botTier === 'degraded' || compositeScore >= 70,
      requiresPoW: tier !== 'none',
    },
  };
}

// Run all profiles and return full report
function runSimulation(profileKeys = Object.keys(BOT_PROFILES)) {
  const results = {};
  let detected = 0; let total = 0;

  for (const key of profileKeys) {
    const profile = BOT_PROFILES[key];
    if (!profile) continue;
    const result = _simulateProfile(key, profile);
    results[key] = result;
    total++;
    if (key !== 'human_baseline' && result.verdict.wouldBlock) detected++;
    if (key === 'human_baseline' && !result.verdict.wouldBlock) detected++; // human not blocked = good
  }

  return {
    simulatedAt:    new Date().toISOString(),
    profilesTested: total,
    detectionRate:  total ? `${Math.round(detected / total * 100)}%` : '0%',
    results,
  };
}

// Run a single custom profile (used for ad-hoc testing)
function simulateCustom(headers, label = 'custom') {
  const profile = { name: label, headers };
  return _simulateProfile(label, profile);
}

module.exports = { runSimulation, simulateCustom, BOT_PROFILES };
