// Toolbar styles, injected with the toolbar itself (nothing to import). Everything is scoped under [data-devbar-ui] and a
// small reset keeps the site's global styles (button, p, textarea…) from leaking in.

export const CSS_TEXT = `
html.db-picking, html.db-picking * { cursor: crosshair !important; }
html.db-editing, html.db-editing * { cursor: pointer !important; }
[data-devbar-ui] { font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #111; letter-spacing: normal; text-transform: none; text-align: left; }
[data-devbar-ui] *, [data-devbar-ui] *::before, [data-devbar-ui] *::after { box-sizing: border-box; letter-spacing: normal; text-transform: none; text-shadow: none; }
[data-devbar-ui] :where(p, ol, li, b, span, em, label, a, img) { margin: 0; padding: 0; font: inherit; color: inherit; }
[data-devbar-ui] :where(button) { margin: 0; cursor: pointer; line-height: 1.3; text-align: center; min-height: 0; min-width: 0; box-shadow: none; }
[data-devbar-ui] :where(button:disabled) { cursor: default; }
[data-devbar-ui] :where(textarea, input) { margin: 0; max-width: none; min-height: 0; box-shadow: none; }

.db-layer { position: fixed; inset: 0; z-index: 2147483600; background: transparent; touch-action: none; }
.db-mark { position: fixed; z-index: 2147483601; pointer-events: none; border: 2px solid #ff3b30; background: rgba(255,59,48,.08); border-radius: 2px; }
.db-bar { position: fixed; right: 12px; bottom: 12px; z-index: 2147483602; display: flex; align-items: center; gap: 6px; padding: 6px; background: #fff; border: 1px solid rgba(0,0,0,.15); border-radius: 10px; box-shadow: 0 4px 16px rgba(0,0,0,.18); }
.db-pop { position: fixed; z-index: 2147483603; display: flex; flex-direction: column; gap: 8px; padding: 10px; background: #fff; border: 1px solid rgba(0,0,0,.15); border-radius: 10px; box-shadow: 0 8px 28px rgba(0,0,0,.25); }
.db-pop__what { font-size: 12px; color: #555; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.db-pop textarea { width: 100%; resize: vertical; padding: 8px; font: inherit; color: #111; background: #fff; border: 1px solid rgba(0,0,0,.2); border-radius: 6px; outline: none; }
.db-pop textarea:focus { border-color: #ff3b30; }
.db-pop__row { display: flex; align-items: center; gap: 6px; }
.db-pop.is-dropping { outline: 2px dashed #ff3b30; outline-offset: 3px; }
.db-thumbs { display: flex; flex-wrap: wrap; gap: 6px; }
.db-thumb { position: relative; display: block; width: 56px; height: 56px; border-radius: 6px; overflow: hidden; background: #f2f2f2; border: 1px solid rgba(0,0,0,.12); }
.db-thumb img { width: 100%; height: 100%; object-fit: cover; }
.db-thumb__x { appearance: none; position: absolute; top: 2px; right: 2px; width: 18px; height: 18px; padding: 0; border: 0; border-radius: 50%; font: 700 12px/18px sans-serif; color: #fff; background: rgba(0,0,0,.65); }
.db-pop__row .db-hint { margin-right: auto; }
.db-pop__err { font-size: 12px; color: #c00; }
.db-btn { appearance: none; border: 0; padding: 6px 10px; font: inherit; font-weight: 600; color: #fff; background: #111; border-radius: 6px; transition: background-color .12s, border-color .12s, transform .12s; }
.db-btn:hover:not(:disabled) { background: #3a3a3a; }
.db-btn:active:not(:disabled) { transform: scale(.96); }
.db-btn:disabled { opacity: .35; }
.db-btn--ghost { color: #111; background: transparent; border: 1px solid rgba(0,0,0,.2); }
.db-btn--ghost:hover:not(:disabled) { background: rgba(0,0,0,.07); border-color: rgba(0,0,0,.35); }
.db-btn--icon { padding: 6px 8px; font-weight: 500; }
.db-btn--hide { min-width: 30px; padding: 6px 8px; color: #666; }
.db-btn--edit { color: #0a64d6; border-color: rgba(10,132,255,.45); }
.db-btn--edit:hover:not(:disabled) { background: rgba(10,132,255,.08); }
.db-hint { font-size: 12px; color: #666; padding: 0 4px; }
.db-count { appearance: none; border: 0; min-width: 22px; height: 22px; padding: 0 6px; display: inline-flex; align-items: center; justify-content: center; font: inherit; font-size: 12px; font-weight: 700; color: #fff; background: #ff3b30; border-radius: 11px; transition: transform .12s, box-shadow .12s; }
.db-count:hover, .db-count[aria-expanded="true"] { box-shadow: 0 0 0 3px rgba(255,59,48,.25); }
.db-count:active { transform: scale(.92); }
.db-x { appearance: none; border: 0; width: 26px; height: 26px; font: inherit; font-size: 18px; line-height: 1; color: #666; background: transparent; border-radius: 6px; transition: background-color .12s; }
.db-x:hover { background: rgba(0,0,0,.07); }

.db-list { position: fixed; right: 12px; bottom: 64px; z-index: 2147483603; width: min(360px, calc(100vw - 24px)); max-height: min(60vh, 520px); display: flex; flex-direction: column; background: #fff; border: 1px solid rgba(0,0,0,.15); border-radius: 10px; box-shadow: 0 8px 28px rgba(0,0,0,.25); overflow: hidden; }
.db-list__head { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border-bottom: 1px solid rgba(0,0,0,.1); }
.db-list__empty { padding: 16px 12px; color: #666; }
.db-list__notify { display: flex; align-items: center; gap: 6px; padding: 8px 12px; border-bottom: 1px solid rgba(0,0,0,.08); background: #fafafa; }
.db-list__listen { margin-right: auto; font-size: 12px; color: #555; }
.db-list__notify .db-btn { padding: 5px 10px; font-size: 12px; }
.db-list__notice { padding: 8px 12px; font-size: 12px; color: #333; background: #f2f7ff; border-bottom: 1px solid rgba(0,0,0,.06); }
.db-dot { width: 8px; height: 8px; border-radius: 50%; background: #c7c7cc; }
.db-dot.is-on { background: #34c759; box-shadow: 0 0 0 3px rgba(52,199,89,.2); }
.db-list__items { list-style: none; margin: 0; padding: 0; overflow-y: auto; overscroll-behavior: contain; }
.db-item { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border-bottom: 1px solid rgba(0,0,0,.08); }
.db-item:last-child { border-bottom: 0; }
.db-item__meta { display: flex; justify-content: space-between; gap: 8px; font-size: 11.5px; color: #777; }
.db-item__meta span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.db-item__status { align-self: flex-start; padding: 2px 7px; font-size: 11px; font-weight: 600; border-radius: 999px; }
.db-item__status.is-sent { color: #0a64d6; background: rgba(10,132,255,.1); }
.db-item__status.is-doing { color: #8a5a00; background: rgba(255,159,10,.15); }
.db-item__comment { color: #111; white-space: pre-wrap; overflow-wrap: anywhere; }
.db-item__what { font-size: 11.5px; color: #888; overflow-wrap: anywhere; }
.db-item__row { display: flex; gap: 6px; }
.db-item__row .db-btn { padding: 4px 8px; font-size: 12px; text-decoration: none; }

.db-edit__backdrop { position: fixed; inset: 0; z-index: 2147483603; background: rgba(0,0,0,.04); }
.db-edit__layer { position: fixed; inset: 0; z-index: 2147483600; background: transparent; touch-action: none; }
.db-edit__mark { position: fixed; z-index: 2147483601; pointer-events: none; border: 2px solid #0a84ff; background: rgba(10,132,255,.07); border-radius: 4px; transition: all .08s; }
.db-edit__mark.is-off { border-color: #8e8e93; border-style: dashed; background: rgba(142,142,147,.06); }
.db-edit__tag { position: fixed; z-index: 2147483602; pointer-events: none; max-width: 70vw; padding: 3px 7px; font-size: 11.5px; font-weight: 600; color: #fff; background: #0a84ff; border-radius: 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.db-edit__tag.is-off { background: #6e6e73; }
.db-edit__pop, .db-edit__panel { position: fixed; z-index: 2147483604; display: flex; flex-direction: column; gap: 8px; padding: 12px; background: #fff; border: 1px solid rgba(0,0,0,.15); border-radius: 10px; box-shadow: 0 10px 32px rgba(0,0,0,.28); }
.db-edit__panel { right: 12px; bottom: 112px; width: min(420px, calc(100vw - 24px)); max-height: min(70vh, 620px, calc(100vh - 124px)); padding: 0; gap: 0; overflow: hidden; }
.db-edit__panel-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border-bottom: 1px solid rgba(0,0,0,.1); }
.db-edit__panel-body { flex: 1; overflow-y: auto; overscroll-behavior: contain; padding: 8px 12px 12px; display: flex; flex-direction: column; gap: 6px; }
.db-edit__panel-foot { padding: 10px 12px; border-top: 1px solid rgba(0,0,0,.1); justify-content: flex-end; }
.db-edit__title { font-weight: 700; font-size: 13.5px; }
.db-edit__doc-line { margin-top: -4px; font-size: 11.5px; color: #777; }
.db-edit__help { font-size: 12.5px; color: #555; }
.db-edit__field { display: flex; flex-direction: column; gap: 4px; }
.db-edit__field-label { font-size: 11.5px; font-weight: 600; color: #444; }
.db-edit__field textarea { width: 100%; resize: vertical; padding: 8px; font: inherit; font-size: 14px; line-height: 1.45; color: #111; background: #fff; border: 1px solid rgba(0,0,0,.22); border-radius: 6px; outline: none; }
.db-edit__field textarea:focus { border-color: #0a84ff; box-shadow: 0 0 0 3px rgba(10,132,255,.18); }
.db-edit__field textarea[readonly] { color: #666; background: #f6f6f7; }
.db-edit__meta { display: flex; gap: 8px; justify-content: space-between; align-items: flex-start; }
.db-edit__desc { font-size: 11.5px; color: #888; }
.db-edit__count { flex: none; font-size: 11.5px; color: #888; font-variant-numeric: tabular-nums; }
.db-edit__count.is-warn { color: #c77c00; font-weight: 700; }
.db-edit__count.is-err { color: #d70015; font-weight: 700; }
.db-edit__err { font-size: 12px; color: #d70015; }
.db-edit__row { display: flex; align-items: center; gap: 6px; justify-content: flex-end; }
.db-edit__row .db-hint { margin-right: auto; }
.db-edit__choices { display: flex; flex-direction: column; gap: 6px; max-height: 50vh; overflow-y: auto; }
.db-edit__choice { appearance: none; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 100%; padding: 8px 10px; text-align: left; font: inherit; color: #111; background: #f6f6f7; border: 1px solid transparent; border-radius: 7px; transition: background-color .12s, border-color .12s; }
.db-edit__choice:hover { background: #eef5ff; border-color: rgba(10,132,255,.4); }
.db-edit__choice b { font-size: 12.5px; font-weight: 700; }
.db-edit__choice span { font-size: 11px; color: #777; }
.db-edit__choice em { font-style: normal; font-size: 12px; color: #333; text-align: left; }
.db-edit__choice--none { background: transparent; border: 1px dashed rgba(0,0,0,.25); }
.db-edit__search { margin: 10px 12px 2px !important; padding: 8px 10px; font: inherit; border: 1px solid rgba(0,0,0,.2); border-radius: 6px; outline: none; }
.db-edit__search:focus { border-color: #0a84ff; }
.db-edit__doc { display: flex; flex-direction: column; gap: 6px; padding: 6px 0; }
.db-edit__doc-title { font-size: 12px; font-weight: 700; color: #333; }
.db-edit__change { display: flex; flex-direction: column; gap: 2px; padding: 6px 8px; background: #f6f6f7; border-radius: 6px; }
.db-edit__change-label { font-size: 11.5px; font-weight: 600; color: #555; }
.db-edit__before { font-size: 12px; color: #a1000f; text-decoration: line-through; white-space: pre-wrap; overflow-wrap: anywhere; }
.db-edit__after { font-size: 12px; color: #0b6b2a; white-space: pre-wrap; overflow-wrap: anywhere; }
.db-edit__status { position: fixed; right: 12px; bottom: 64px; z-index: 2147483602; display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 6px; max-width: calc(100vw - 24px); padding: 6px 8px; background: #fff; border: 1px solid rgba(0,0,0,.15); border-radius: 10px; box-shadow: 0 4px 16px rgba(0,0,0,.18); font-size: 12.5px; }
.db-edit__status .db-btn { padding: 4px 9px; font-size: 12px; }
.db-edit__link { appearance: none; border: 0; padding: 2px 4px; font: inherit; font-weight: 600; color: #0a64d6; background: none; border-radius: 4px; text-decoration: underline; text-underline-offset: 2px; }
.db-edit__link:hover { background: rgba(10,132,255,.08); }
.db-edit__muted { font-weight: 400; color: #666; }
.db-edit__also { font-size: 11.5px; color: #666; }
.db-edit__also .db-edit__link { font-size: 11.5px; font-weight: 500; }
.db-edit__note { font-size: 12px; color: #8a5a00; }
.db-edit__toast { position: fixed; left: 50%; bottom: 24px; z-index: 2147483605; transform: translateX(-50%); max-width: min(520px, calc(100vw - 24px)); padding: 10px 14px; color: #fff; background: #1c1c1e; border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,.3); font-size: 13px; }
.db-edit__toast.is-warn { background: #8a5a00; }

/* position="left": the toolbar and its panels on the bottom left. */
.db-left .db-bar, .db-left .db-list, .db-left .db-edit__status, .db-left .db-edit__panel { right: auto; left: 12px; }
.db-left .db-edit__status { justify-content: flex-start; }
`;
