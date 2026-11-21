/**
 * Global Percentage Formatting Utilities
 *
 * Provides centralized, reusable helpers to identify percentage-based fields,
 * format display values with '%' suffix, prevent duplicate symbols (e.g. '5%%'),
 * and strip '%' suffixes for clean numeric storage in databases and API payloads.
 */

/**
 * Checks whether a given field name or column header represents a percentage value.
 * Explicitly excludes monetary rates (Room Rate, Base Rate, ADR, RevPAR), IDs, ratings, and counts.
 *
 * @param {string} fieldName - Field name, column title, or attribute label.
 * @returns {boolean} True if field is percentage-based.
 */
export const isPercentageField = (fieldName) => {
  if (!fieldName || typeof fieldName !== 'string') return false;
  const s = fieldName.trim().toLowerCase();

  // Explicit exclusions (currency, monetary rates, scores/ratings, counts, codes)
  if (
    s.includes('₹') ||
    s.includes('$') ||
    s.includes('eur') ||
    s.includes('gbp') ||
    s.includes('amount') ||
    s.includes('price') ||
    s.includes('cost (₹)') ||
    s.includes('fee') ||
    s.includes('charge') ||
    s.includes('adr') ||
    s.includes('revpar') ||
    s.includes('rating') ||
    s.includes('score') ||
    s.includes('id') ||
    s.includes('code') ||
    s.includes('room rate') ||
    s.includes('base rate') ||
    s.includes('daily rate') ||
    s.includes('hourly rate') ||
    s.includes('bar rate') ||
    s.includes('hurdle rate') ||
    s.includes('ceiling rate') ||
    s.includes('starting rate') ||
    s.includes('standard rate') ||
    s.includes('corporate rate') ||
    s.includes('competitor rate') ||
    s.includes('new rate') ||
    s.includes('old rate') ||
    s.includes('weekend rate') ||
    s.includes('weekday rate')
  ) {
    return false;
  }

  // Positive matching for percentage fields
  if (s.includes('%') || s.includes('percent')) return true;
  if (s === 'cancel rate' || s === 'cancellation rate' || s.endsWith('cancel rate') || s.endsWith('cancellation rate')) return true;
  if (s.includes('occupancy')) return true;
  if (s.includes('commission')) return true;
  if (s.includes('eligibility')) return true;
  if (s === 'share') return true;
  if (s === 'profit margin' || s === 'margin' || s === 'net margin') return true;
  if (s === 'growth' || s === 'growth rate' || s === 'vs last period' || s === 'vs last year') return true;
  if (s === 'resolution rate' || s === 'error rate' || s === 'performance' || s === 'achievement') return true;
  if (s === 'rate' && (s === 'rate' || s.includes('discount') || s.includes('cancel') || s.includes('refund'))) return true;

  return false;
};

/**
 * Formats a value with a single '%' symbol.
 * Handles numbers, numeric strings, integer, and decimal values.
 * Prevents duplicate symbols (e.g. '5%%' -> '5%').
 * Preserves leading sign for variances (e.g. '+4%' -> '+4%', '-5%' -> '-5%').
 *
 * @param {string|number|null|undefined} value - Raw value to format.
 * @param {string} [emptyFallback=''] - String to return if value is empty/null/undefined.
 * @returns {string} Formatted percentage string.
 */
export const formatPercentage = (value, emptyFallback = '') => {
  if (value === null || value === undefined) return emptyFallback;
  const s = String(value).trim();
  if (s === '' || s === '—' || s === '-') return emptyFallback || s;

  // Clean all duplicate or existing '%' characters from the end
  const clean = s.replace(/%+$/, '').trim();

  // Match optional leading +/- sign and valid integer/decimal number
  const match = clean.match(/^([+-]?)\s*([0-9]+(?:\.[0-9]+)?)$/);
  if (match) {
    const sign = match[1];
    const num = match[2];
    return `${sign}${num}%`;
  }

  // If passed a valid JavaScript number directly
  if (typeof value === 'number' && !isNaN(value)) {
    return `${value}%`;
  }

  // If already ends with single % and has extra descriptive text (e.g. "100% Operational")
  if (s.endsWith('%') && !s.endsWith('%%')) {
    return s;
  }

  return s;
};

/**
 * Strips '%' symbols and extra whitespace to return a clean numeric string for editing or API submission.
 *
 * @param {string|number|null|undefined} value - Raw input.
 * @returns {string} Clean string without '%' symbol.
 */
export const stripPercentage = (value) => {
  if (value === null || value === undefined) return '';
  return String(value).replace(/%/g, '').trim();
};

/**
 * Normalizes user input for percentage fields.
 * Ensures the value is numeric (or decimal) and within optional bounds (0 - 100).
 *
 * @param {string|number} input - User typed input.
 * @returns {string} Clean numeric string.
 */
export const normalizePercentageInput = (input) => {
  if (input === null || input === undefined) return '';
  const clean = String(input).replace(/[^0-9.]/g, '');
  // Prevent multiple decimal points
  const parts = clean.split('.');
  if (parts.length > 2) {
    return `${parts[0]}.${parts.slice(1).join('')}`;
  }
  return clean;
};

