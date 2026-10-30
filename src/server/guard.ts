// Who may talk to the devbar endpoints.
//
// While the dev server runs, any website open in the same browser could send a request to 127.0.0.1 (create fake
// requests or, with edit mode, change texts). So every write needs:
// - a local Host (127.0.0.1, localhost, [::1]): stops DNS rebinding, a page pointing its own domain at this computer;
// - the `x-devbar: 1` header: a custom header makes the browser ask permission first (CORS), which these routes never give;
// - same origin (Sec-Fetch-Site / Origin).

export const LOCAL_HOST = /^(127\.0\.0\.1|localhost|\[::1\]|[\w-]+\.localhost)(:\d+)?$/;

export function localHost(req: Request, allowed: RegExp = LOCAL_HOST) {
  return allowed.test(req.headers.get('host') ?? '');
}

export function fromToolbar(req: Request, allowed: RegExp = LOCAL_HOST) {
  const host = req.headers.get('host') ?? '';
  if (!allowed.test(host) || req.headers.get('x-devbar') !== '1') return false;
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return false;
  const origin = req.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export const forbidden = () => new Response('Only from the devbar on this site', {status: 403});
export const notFound = () => new Response(null, {status: 404});
