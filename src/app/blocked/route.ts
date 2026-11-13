// /blocked?ref=…: the plain explainer a blocked visitor reaches from
// "You can't do this right now. Why?". Spec: docs/admin/03-features/10-access-control.md
// ("Blocked page").
//
// A route handler on purpose, not a page: static HTML with the theme colours
// inlined, so no app JS, no tracker, no Firebase, no header. It is a page view
// (GET, 200): the proxy matcher never runs on it, and it never reads the
// blocklist. The ref comes only from the query string and is shown only when
// it has the exact ref shape, so nothing else can be injected.

const REF = /^[A-Z0-9]{6}-\d{10}$/;

const STYLE = `
:root{--canvas:#f5f4ef;--surface:#fdfcf9;--fg:#141614;--muted:#50564f;--edge:rgba(20,22,20,.09);--brand:#0a6a5e;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--canvas:#0a0d0c;--surface:#111513;--fg:#f1f3f0;--muted:#aab2ac;--edge:rgba(255,255,255,.08);--brand:#3ddbc9}}
*{box-sizing:border-box}
body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:16px;background:var(--canvas);color:var(--fg);font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
main{width:100%;max-width:440px;background:var(--surface);border:1px solid var(--edge);border-radius:16px;padding:28px 24px}
h1{margin:0 0 12px;font-size:20px;line-height:1.3}
p{margin:0 0 12px;color:var(--muted)}
.ref{margin:16px 0 0;padding:10px 12px;border:1px solid var(--edge);border-radius:10px;color:var(--fg);font:600 15px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.04em;text-align:center;user-select:all}
a{color:var(--brand)}
`;

function blockedPageHtml(ref: string | null): string {
  const reference = ref && REF.test(ref) ? ref : null;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Action not allowed · SyncFlow</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>Action not allowed</h1>
<p>You can still open SyncFlow, but you can't upload, send, download or change anything right now.</p>
<p>If you think this is a mistake, contact support${reference ? ' and quote this reference:' : '.'}</p>
${reference ? `<p class="ref">${reference}</p>` : ''}
<p style="margin:20px 0 0"><a href="/">Back to SyncFlow</a></p>
</main>
</body>
</html>`;
}

export function GET(request: Request): Response {
  const ref = new URL(request.url).searchParams.get('ref');
  return new Response(blockedPageHtml(ref), {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'private, no-store',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
}
