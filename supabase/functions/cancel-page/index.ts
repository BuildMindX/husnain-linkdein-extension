const html = String.raw`
<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Checkout Cancelled — LinkPilot AI</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:       #0e0e28;
    --surface:  #16163a;
    --border:   rgba(124,58,237,0.18);
    --purple:   #7c3aed;
    --lavender: #c4b5fd;
    --muted:    rgba(196,181,253,0.55);
    --text:     #f1f5f9;
  }

  body {
    min-height: 100vh;
    background: var(--bg);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    color: var(--text);
    background-image: radial-gradient(ellipse 60% 50% at 50% -10%, rgba(124,58,237,0.12) 0%, transparent 70%);
  }

  .card {
    width: 100%;
    max-width: 440px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 24px;
    padding: 48px 40px 40px;
    text-align: center;
    box-shadow: 0 32px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04);
    animation: rise 0.5s cubic-bezier(0.22,1,0.36,1) both;
  }

  @keyframes rise {
    from { opacity: 0; transform: translateY(20px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .icon-wrap {
    width: 72px; height: 72px;
    border-radius: 50%;
    background: rgba(255,255,255,0.04);
    border: 1.5px solid rgba(255,255,255,0.1);
    display: flex; align-items: center; justify-content: center;
    margin: 0 auto 24px;
  }

  h1 {
    font-size: 26px;
    font-weight: 800;
    color: var(--text);
    letter-spacing: -0.02em;
    margin-bottom: 10px;
    text-wrap: balance;
  }

  .sub {
    font-size: 14.5px;
    color: var(--muted);
    line-height: 1.65;
    margin-bottom: 32px;
    text-wrap: balance;
  }

  .btn-primary {
    width: 100%;
    padding: 13px;
    border-radius: 50px;
    background: linear-gradient(135deg, #7c3aed, #4f46e5);
    border: none;
    color: #fff;
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
    box-shadow: 0 6px 20px rgba(124,58,237,0.35);
    transition: box-shadow 0.2s, transform 0.15s;
    text-decoration: none;
    display: block;
    margin-bottom: 12px;
  }
  .btn-primary:hover { box-shadow: 0 8px 28px rgba(124,58,237,0.5); transform: translateY(-1px); }

  .btn-secondary {
    width: 100%;
    padding: 12px;
    border-radius: 50px;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.1);
    color: rgba(196,181,253,0.7);
    font-size: 13.5px;
    font-weight: 600;
    cursor: pointer;
    text-decoration: none;
    display: block;
    transition: background 0.18s;
  }
  .btn-secondary:hover { background: rgba(255,255,255,0.09); }

  .wordmark {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    margin-top: 32px;
    padding-top: 24px;
    border-top: 1px solid rgba(255,255,255,0.06);
    font-size: 11.5px;
    color: rgba(148,163,184,0.3);
  }
</style>
</head>
<body>
<div class="card">

  <div class="icon-wrap">
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none"
         stroke="rgba(196,181,253,0.5)" stroke-width="1.8" stroke-linecap="round">
      <path d="M18 6 6 18M6 6l12 12"/>
    </svg>
  </div>

  <h1>No problem.</h1>
  <p class="sub">Your checkout was cancelled — nothing was charged and your plan hasn't changed. You can upgrade any time from the extension.</p>

  <a href="https://www.linkedin.com" class="btn-primary">Back to LinkedIn</a>
  <a href="javascript:window.close()" class="btn-secondary">Close this tab</a>

  <div class="wordmark">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.5">
      <rect x="2" y="2" width="20" height="20" rx="5"/>
      <path d="M7 10h2v7H7zm0-3h2v2H7zm4 3h2v1.5a2.5 2.5 0 0 1 5 0V17h-2v-5.5a.5.5 0 0 0-1 0V17h-2v-4a2 2 0 0 0-2-2z"/>
    </svg>
    LinkPilot AI by Satyron Private Limited
  </div>

</div>
</body>
</html>
`

Deno.serve(() => new Response(html, {
  headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' },
}))
