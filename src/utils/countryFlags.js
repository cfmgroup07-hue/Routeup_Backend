const EMOJI_TO_CODE = {
  '🇦🇪': 'ae', '🇦🇺': 'au', '🇨🇦': 'ca', '🇩🇪': 'de', '🇬🇧': 'gb', '🇳🇿': 'nz',
  '🇸🇬': 'sg', '🇺🇸': 'us', '🇮🇳': 'in', '🇫🇷': 'fr', '🇮🇹': 'it', '🇯🇵': 'jp',
  '🇶🇦': 'qa', '🇸🇦': 'sa', '🇴🇲': 'om', '🇰🇼': 'kw', '🇧🇭': 'bh', '🇳🇴': 'no'
};

const COUNTRY_ALIASES = {
  'uae / dubai': 'ae',
  'uae': 'ae',
  'dubai': 'ae',
  'united arab emirates': 'ae',
  'saudi arabia': 'sa',
  'australia': 'au',
  'canada': 'ca',
  'germany': 'de',
  'united kingdom': 'gb',
  'uk': 'gb',
  'great britain': 'gb',
  'usa': 'us',
  'united states': 'us',
  'new zealand': 'nz',
  'singapore': 'sg',
  'norway': 'no',
  'qatar': 'qa',
  'kuwait': 'kw',
  'oman': 'om',
  'bahrain': 'bh',
  'india': 'in'
};

const resolveCountryFlag = (countryName = '', fallbackFlag = '') => {
  const normalizedName = countryName.trim().toLowerCase();

  if (normalizedName && COUNTRY_ALIASES[normalizedName]) {
    return COUNTRY_ALIASES[normalizedName];
  }

  if (normalizedName) {
    const aliasMatch = Object.entries(COUNTRY_ALIASES).find(([alias]) =>
      normalizedName.includes(alias) || alias.includes(normalizedName)
    );
    if (aliasMatch) return aliasMatch[1];
  }

  if (fallbackFlag) {
    if (EMOJI_TO_CODE[fallbackFlag]) return EMOJI_TO_CODE[fallbackFlag];
    const cleaned = fallbackFlag.trim().toLowerCase();
    if (/^[a-z]{2}$/.test(cleaned)) return cleaned;
  }

  return fallbackFlag?.trim().toLowerCase() || '';
};

module.exports = { resolveCountryFlag };
