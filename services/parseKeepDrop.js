// services/parseKeepDrop.js

/**
 * Parse a keep/drop style message from Ludvig.
 *
 * Supported patterns:
 *   "keep all"
 *   "keep: 1,3"
 *   "keep 1, 2, 4"
 *
 * Returns:
 *   { mode: 'all' }
 *   or { mode: 'indices', indices: [1,3] }
 *   or null if not a keep command.
 */
export function parseKeepDrop(content) {
  if (!content) return null;
  const c = content.trim().toLowerCase();

  if (c.startsWith('keep all')) {
    return { mode: 'all' };
  }

  // Try to match "keep: 1,3" or "keep 1,2"
  const match = c.match(/^keep[:\s]+([\d,\s]+)$/);
  if (!match) return null;

  const group = match[1];
  const nums = group
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isInteger(n) && n > 0);

  if (!nums.length) return null;

  // Deduplicate and sort
  const unique = Array.from(new Set(nums)).sort((a, b) => a - b);

  return {
    mode: 'indices',
    indices: unique
  };
}