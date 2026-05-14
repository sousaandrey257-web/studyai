'use strict';
// ============================================================
//  StudyAI — Pricing Service
//  Centralise toute la logique tarifaire (PPP-aware)
//  Règles :
//    · Pays riches (EU/US/UK/CA/AU/SG/JP/KR) → prix plein
//    · Pays intermédiaires (BR/MX/CN/TR/PL/UA/EG) → −30 à −50 %
//    · Pays faible PA (IN/ID/TH/PH/PK/VN/MY/NG/BD/AR) → −50 % max
//    · Marge cible : 85-95 % (coûts API Groq ~0,001 €/session)
// ============================================================

const PRICE_MONTHLY  =  999;  // EUR centimes
const PRICE_YEARLY   = 6999;  // EUR centimes

// Stripe : montants en plus petites unités (centimes, sauf JPY/KRW)
const CURRENCY_PRICES = {
  // ── Pays riches ────────────────────────────────────────────
  EUR: { monthly:  999, yearly:  6999 },
  USD: { monthly:  999, yearly:  6999 },
  GBP: { monthly:  849, yearly:  5999 },
  CAD: { monthly: 1399, yearly:  9999 },
  AUD: { monthly: 1599, yearly: 10999 },
  SGD: { monthly: 1399, yearly:  9999 },
  JPY: { monthly: 1500, yearly: 10900 }, // pas de décimales
  KRW: { monthly:14900, yearly: 99900 }, // pas de décimales
  // ── Pays intermédiaires ────────────────────────────────────
  BRL: { monthly: 2999, yearly: 21999 }, // ~6 USD/mois
  MXN: { monthly: 7900, yearly: 57900 }, // ~4 USD/mois (PPP)
  CNY: { monthly: 6800, yearly: 49900 }, // ~9 USD/mois
  TRY: { monthly: 8900, yearly: 64900 }, // ~2.5 USD/mois (PPP)
  PLN: { monthly: 1999, yearly: 13999 }, // ~5 USD/mois (PPP)
  UAH: { monthly:11900, yearly: 83900 }, // ~2.9 USD/mois (PPP)
  EGP: { monthly:14900, yearly:109900 }, // ~3 USD/mois (PPP)
  // ── Faible pouvoir d'achat ─────────────────────────────────
  INR: { monthly:  499, yearly:  3499 }, // ~6 USD/mois
  ARS: { monthly:599000, yearly:4390000 }, // ~6 USD/mois (PPP)
  NGN: { monthly:350000, yearly:2499000 }, // ~2.4 USD/mois (PPP)
  BDT: { monthly: 19900, yearly:139900 }, // ~1.8 USD/mois (PPP)
};

// Devises sans décimales pour Stripe
const ZERO_DECIMAL_CURRENCIES = new Set([
  'JPY','KRW','BIF','CLP','DJF','GNF','ISK',
  'KMF','MGA','PYG','RWF','UGX','VND','VUV','XAF','XOF','XPF',
]);

const EU_COUNTRIES = [
  'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR',
  'HU','IE','IT','LV','LT','LU','MT','NL','PT','RO','SK',
  'SI','ES','SE','CH','NO',
];

// Affichage — les prix low-income sont facturés dans la devise locale via Stripe
const REGIONAL_PRICING = {
  // ── Pays riches ─────────────────────────────────────────────
  EU: { currency:'EUR', monthly:'9,99 €',    yearly:'69,99 €'    },
  GB: { currency:'GBP', monthly:'£8.49',     yearly:'£59.99'     },
  US: { currency:'USD', monthly:'$9.99',     yearly:'$69.99'     },
  CA: { currency:'CAD', monthly:'CA$13.99',  yearly:'CA$99.99'   },
  AU: { currency:'AUD', monthly:'AU$15.99',  yearly:'AU$109.99'  },
  JP: { currency:'JPY', monthly:'¥1,500',    yearly:'¥10,900'    },
  KR: { currency:'KRW', monthly:'₩14,900',   yearly:'₩99,900'    },
  SG: { currency:'SGD', monthly:'S$13.99',   yearly:'S$99.99'    },
  // ── Pays intermédiaires ─────────────────────────────────────
  BR: { currency:'BRL', monthly:'R$29,99',   yearly:'R$219,99'   },
  MX: { currency:'MXN', monthly:'$79 MX',    yearly:'$579 MX'    },
  CN: { currency:'CNY', monthly:'¥68',       yearly:'¥499'       },
  TR: { currency:'TRY', monthly:'₺89',       yearly:'₺649'       },
  PL: { currency:'PLN', monthly:'19,99 zł',  yearly:'139,99 zł'  },
  UA: { currency:'UAH', monthly:'₴119',      yearly:'₴839'       },
  EG: { currency:'EGP', monthly:'E£149',     yearly:'E£1.049'    },
  // ── Faible pouvoir d'achat ──────────────────────────────────
  IN: { currency:'INR', monthly:'₹499',      yearly:'₹3,499'     },
  ID: { currency:'USD', monthly:'$3.99',     yearly:'$29.99'     },
  TH: { currency:'USD', monthly:'$3.99',     yearly:'$29.99'     },
  MY: { currency:'USD', monthly:'$3.99',     yearly:'$29.99'     },
  PH: { currency:'USD', monthly:'$3.99',     yearly:'$29.99'     },
  VN: { currency:'USD', monthly:'$3.99',     yearly:'$29.99'     },
  PK: { currency:'USD', monthly:'$2.99',     yearly:'$21.99'     },
  AR: { currency:'ARS', monthly:'AR$5.990',  yearly:'AR$43.990'  },
  NG: { currency:'NGN', monthly:'₦3.500',    yearly:'₦24.990'    },
  BD: { currency:'BDT', monthly:'৳199',      yearly:'৳1.399'     },
};

function getCurrencyForCountry(country) {
  if (!country || country === 'XX') return 'EUR';
  if (EU_COUNTRIES.includes(country)) return 'EUR';
  const map = {
    GB:'GBP', US:'USD', CA:'CAD', AU:'AUD', SG:'SGD',
    JP:'JPY', KR:'KRW', CN:'CNY', BR:'BRL', IN:'INR', MX:'MXN',
    TR:'TRY', PL:'PLN', UA:'UAH', EG:'EGP', AR:'ARS', NG:'NGN', BD:'BDT',
  };
  return map[country] || 'EUR';
}

function getPricesForCurrency(cur) {
  return CURRENCY_PRICES[cur] || CURRENCY_PRICES.EUR;
}

function getRegionalPricing(code) {
  if (REGIONAL_PRICING[code]) return { country: code, ...REGIONAL_PRICING[code] };
  if (EU_COUNTRIES.includes(code)) return { country: code, ...REGIONAL_PRICING.EU };
  return { country: code || 'XX', ...REGIONAL_PRICING.EU };
}

module.exports = {
  PRICE_MONTHLY, PRICE_YEARLY,
  CURRENCY_PRICES, ZERO_DECIMAL_CURRENCIES, EU_COUNTRIES, REGIONAL_PRICING,
  getCurrencyForCountry, getPricesForCurrency, getRegionalPricing,
};
