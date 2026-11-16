// Runs before paint:
//  - marks <html class="js"> so scroll reveals / tabs only hide content when
//    scripts actually run;
//  - applies the saved theme (system preference otherwise) — no theme flash;
//  - copies the signed-in hint onto <html data-auth> so the header and account
//    prompts render the right variant on first paint (see auth-state.ts);
//  - marks Apple devices <html data-platform="mac"> so <Kbd> shows ⌘ vs Ctrl
//    with CSS only (no hydration mismatch).
//
// Shared with the admin CSP (src/server/security/csp.ts): the policy allows
// this exact text by its sha256 hash. The root layout is static for public
// pages, so it cannot read the per-request nonce; the hash allows the script
// on admin pages without making every page dynamic. Any edit here changes
// the hash, which the CSP picks up automatically (it hashes this constant).
export const THEME_INIT_SCRIPT = `(function(){var r=document.documentElement;r.classList.add('js');var n=navigator,p=(n.userAgentData&&n.userAgentData.platform)||n.platform||'';if(/mac|iphone|ipad|ipod/i.test(p))r.setAttribute('data-platform','mac');try{var t=localStorage.getItem('sf-theme');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;r.classList.toggle('dark',d);if(localStorage.getItem('sf-auth')==='1')r.setAttribute('data-auth','in');}catch(e){r.classList.add('dark');}})();`;
