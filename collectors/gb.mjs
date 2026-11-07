// UK GOV.UK Fuel Finder. NOT CONFIGURED: needs the portal registration (step 0, H1).
// Until FUELFINDER_CLIENT_ID and FUELFINDER_CLIENT_SECRET exist as repo secrets this throws, the run records
// "not configured", and the GB market stays paused in index.json. Never log response bodies or the secrets.
export async function collect() {
  if (!process.env.FUELFINDER_CLIENT_ID || !process.env.FUELFINDER_CLIENT_SECRET) {
    throw new Error('GB not configured: Fuel Finder credentials missing');
  }
  throw new Error('GB adapter not written: finish after reading the Fuel Finder API terms and response shape (H1)');
}
