/* Journey kinds. The daily trail is five grids that climb quickly. */
export const DAILY_LEN = 5;
const DAILY_LV = [1, 3, 5, 8, 11];

export function levelOf(kind) {
  if (kind === 'daily') return (n) => DAILY_LV[n] ?? n + 7;
  return null;
}
