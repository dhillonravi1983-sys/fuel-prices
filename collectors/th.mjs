// Thailand EPPO. NOT CONFIGURED: terms and a structured endpoint are unconfirmed (step 0, H3).
// Throws until EPPO answers; the TH market stays paused. No scraping workaround.
export async function collect() {
  throw new Error('TH not configured: EPPO terms and endpoint unconfirmed (H3)');
}
