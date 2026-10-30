import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {EditCapabilities, Locale, Rect, RequestSummary, Target} from '../types';
import {UI_ATTR, cut, describe, isOurs, pageElementAt, selectorOf, toBase64, toRect} from './dom';
import EditMode from './EditMode';
import {MESSAGES, translator, type Messages} from './i18n';
import {CSS_TEXT} from './styles';

// The toolbar (dev only): mark an element (click), an area (drag) or selected text, write what should change, and it is
// saved as a JSON request in .devbar/pending/ for your coding agent. Alt+C marks (or takes the selected text), Esc cancels.
// The red counter opens the open requests; "Notify <agent>" wakes up an agent running `npx devbar listen`.
// "Edit" (Alt+E): change texts right on the page through a content adapter (JSON files, Sanity…); texts that live in the
// code come back here as a request ("Request the change").
// Alt+H (or "–") hides the whole toolbar, e.g. to record the site; it stays hidden on reload until shown again.

export type DevbarProps = {
  /** Where the server handler is mounted. Default: "/devbar". */
  endpoint?: string;
  /** Toolbar language. Default: "en". */
  locale?: Locale;
  /** Override any text. */
  messages?: Partial<Messages>;
  /** Name of the agent in "Notify …" and "… is listening". Default: "Claude". */
  agent?: string;
  /** Selector of page parts whose texts live in the code (charts, demos), besides `[data-devbar-code]`. */
  codeZones?: string;
  /** Corner of the screen. Default: "right". */
  position?: 'right' | 'left';
};

type Mode = 'idle' | 'element' | 'area' | 'write' | 'sent';
/** Reference image pasted, dropped or picked in the request box (sent with the request). */
type Attachment = {id: string; file: File; url: string};

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_IMAGES = 6;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const HIDDEN_KEY = 'devbar-hidden';

export default function Devbar({endpoint = '/devbar', locale = 'en', messages, agent = 'Claude', codeZones, position = 'right'}: DevbarProps) {
  const base = endpoint.replace(/\/+$/, '');
  const t = useMemo(() => translator({...MESSAGES[locale], ...messages}, agent), [locale, messages, agent]);
  const headers = useMemo(() => ({'x-devbar': '1', 'x-devbar-locale': locale}), [locale]);

  const [mode, setMode] = useState<Mode>('idle');
  const [hover, setHover] = useState<Rect | null>(null);
  const [drag, setDrag] = useState<{x0: number; y0: number; x1: number; y1: number} | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [comment, setComment] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dropping, setDropping] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<RequestSummary[]>([]);
  const [listOpen, setListOpen] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [caps, setCaps] = useState<EditCapabilities>({enabled: false, drafts: false, undo: false});
  const [hidden, setHidden] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const pending = items.length;

  useEffect(() => { try { setHidden(sessionStorage.getItem(HIDDEN_KEY) === '1'); } catch {} }, []);

  // The list is fetched again when coming back to the tab: the agent moves finished requests to done/.
  const [listening, setListening] = useState(false);
  const [notifying, setNotifying] = useState(false);
  const [notice, setNotice] = useState('');
  const apply = (d: {items?: RequestSummary[]; listening?: boolean; edit?: EditCapabilities}) => {
    setItems(d.items ?? []);
    setListening(!!d.listening);
    if (d.edit) setCaps(d.edit);
  };
  const load = useCallback(() => {
    fetch(`${base}/feedback`, {cache: 'no-store', headers}).then(r => r.json()).then(apply).catch(() => {});
  }, [base, headers]);
  useEffect(() => {
    load();
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [load]);
  // With the list open, or with requests notified or in progress, it refreshes itself (so you see when the agent is done).
  const working = items.some(it => it.status === 'notified' || it.status === 'in-progress');
  useEffect(() => {
    if (!listOpen && !working) return;
    const id = window.setInterval(load, 4000);
    return () => window.clearInterval(id);
  }, [listOpen, working, load]);

  const notify = async () => {
    setNotifying(true);
    setNotice('');
    try {
      const res = await fetch(`${base}/feedback`, {method: 'PATCH', headers});
      if (!res.ok) throw new Error(await res.text());
      const d = await res.json();
      apply(d);
      setNotice(d.listening ? t('notifiedOk') : t('notifiedSaved'));
    } catch {
      setNotice(t('notifyFailed'));
    } finally {
      setNotifying(false);
    }
  };

  const discard = async (id: string) => {
    const res = await fetch(`${base}/feedback?id=${encodeURIComponent(id)}`, {method: 'DELETE', headers}).catch(() => null);
    if (res?.ok) apply(await res.json());
  };

  const clearAttachments = useCallback(() => {
    setAttachments(list => { list.forEach(a => URL.revokeObjectURL(a.url)); return []; });
  }, []);
  const reset = useCallback(() => { setMode('idle'); setHover(null); setDrag(null); setTarget(null); setComment(''); setError(''); clearAttachments(); }, [clearAttachments]);

  /** Adds images to the box (pasted, dropped or picked): PNG/JPG/WebP/GIF only, up to 6 and 12 MB each. */
  const addFiles = useCallback((files: Iterable<File>) => {
    const list = [...files].filter(f => IMAGE_TYPES.includes(f.type));
    if (!list.length) return false;
    const big = list.filter(f => f.size > MAX_IMAGE_BYTES);
    setAttachments(prev => {
      const room = MAX_IMAGES - prev.length;
      const ok = list.filter(f => f.size <= MAX_IMAGE_BYTES).slice(0, Math.max(0, room));
      return [...prev, ...ok.map(file => ({id: Math.random().toString(36).slice(2), file, url: URL.createObjectURL(file)}))];
    });
    setError(big.length ? t('imageTooBig') : '');
    return true;
  }, [t]);
  const removeAttachment = (id: string) => setAttachments(list => list.filter(a => { if (a.id === id) URL.revokeObjectURL(a.url); return a.id !== id; }));

  // With text selected on the page, the request goes straight onto that text.
  const fromSelection = useCallback((): boolean => {
    const sel = window.getSelection();
    const txt = sel?.toString().trim();
    if (!sel || !txt || sel.rangeCount === 0) return false;
    const range = sel.getRangeAt(0);
    const node = range.commonAncestorContainer;
    const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    if (!el || isOurs(el)) return false;
    setTarget({kind: 'text', rect: toRect(range.getBoundingClientRect()), selectedText: cut(txt, 600), ...describe(el)});
    setMode('write');
    return true;
  }, []);

  const start = useCallback((m: 'element' | 'area') => {
    setError('');
    if (m === 'element' && fromSelection()) return;
    setTarget(null); setHover(null); setDrag(null); setMode(m);
  }, [fromSelection]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && listOpen) { e.preventDefault(); setListOpen(false); return; }
      if (e.key === 'Escape' && mode !== 'idle') { e.preventDefault(); reset(); }
      if (e.altKey && e.code === 'KeyC' && mode === 'idle' && !editing) { e.preventDefault(); start('element'); }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [mode, listOpen, editing, reset, start]);

  // Entering edit mode (also with Alt+E) closes whatever was open on the requests side: one layer at a time.
  useEffect(() => { if (editing) { reset(); setListOpen(false); } }, [editing, reset]);

  const toggleHidden = useCallback((next?: boolean) => {
    setHidden(h => {
      const value = next ?? !h;
      try { if (value) sessionStorage.setItem(HIDDEN_KEY, '1'); else sessionStorage.removeItem(HIDDEN_KEY); } catch {}
      return value;
    });
    reset();
    setListOpen(false);
    setEditing(false);
  }, [reset]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.closest?.('textarea,input,[contenteditable="true"]');
      if (e.altKey && e.code === 'KeyH' && !typing) { e.preventDefault(); toggleHidden(); }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [toggleHidden]);

  // "Request the change" from edit mode: the clicked element becomes the target of a new request.
  const ask = useCallback((el: Element) => {
    setListOpen(false);
    setError('');
    setComment('');
    setTarget({kind: 'element', rect: toRect(el.getBoundingClientRect()), ...describe(el)});
    setMode('write');
  }, []);

  useEffect(() => {
    const html = document.documentElement;
    html.classList.toggle('db-picking', mode === 'element' || mode === 'area');
    return () => html.classList.remove('db-picking');
  }, [mode]);

  useEffect(() => { if (mode === 'write') box.current?.focus(); }, [mode]);

  const onMove = (e: React.PointerEvent) => {
    if (mode === 'element') {
      const el = pageElementAt(e.clientX, e.clientY);
      setHover(el ? toRect(el.getBoundingClientRect()) : null);
    } else if (mode === 'area' && drag) {
      setDrag({...drag, x1: e.clientX, y1: e.clientY});
    }
  };

  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    if (mode === 'area') setDrag({x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY});
  };

  const onUp = (e: React.PointerEvent) => {
    if (mode === 'element') {
      const el = pageElementAt(e.clientX, e.clientY);
      if (!el) return;
      setTarget({kind: 'element', rect: toRect(el.getBoundingClientRect()), ...describe(el)});
      setHover(null); setMode('write');
    } else if (mode === 'area' && drag) {
      const r = {x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1), w: Math.abs(drag.x1 - drag.x0), h: Math.abs(drag.y1 - drag.y0)};
      setDrag(null);
      if (r.w < 8 || r.h < 8) return;
      const center = pageElementAt(r.x + r.w / 2, r.y + r.h / 2);
      // Elements with their own text inside the area, to find it in the code.
      const inside = [...document.body.querySelectorAll('h1,h2,h3,h4,h5,h6,p,a,button,li,span,img,video,svg,figure,label,td,th')]
        .filter(el => {
          if (isOurs(el)) return false;
          const b = el.getBoundingClientRect();
          return b.width > 0 && b.left < r.x + r.w && b.right > r.x && b.top < r.y + r.h && b.bottom > r.y;
        })
        .map(el => ({selector: selectorOf(el), text: cut((el as HTMLElement).innerText || el.getAttribute('alt') || el.getAttribute('aria-label'), 120)}))
        .filter((it, i, all) => it.text.length > 1 && all.findIndex(o => o.text === it.text) === i)
        .slice(0, 12);
      setTarget({kind: 'area', rect: r, ...(center ? describe(center) : {}), inside});
      setMode('write');
    }
  };

  const send = async () => {
    if (!target || (!comment.trim() && !attachments.length)) return;
    setError('');
    try {
      const images = await Promise.all(attachments.map(async a => ({type: a.file.type, data: await toBase64(a.file)})));
      const res = await fetch(`${base}/feedback`, {
        method: 'POST',
        headers: {...headers, 'content-type': 'application/json'},
        body: JSON.stringify({
          comment: comment.trim(),
          page: location.pathname + location.search + location.hash,
          viewport: {w: innerWidth, h: innerHeight, dpr: devicePixelRatio},
          scrollY: Math.round(scrollY),
          target,
          images,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      apply(await res.json());
      setMode('sent'); setTarget(null); setComment(''); clearAttachments();
      setTimeout(() => setMode(m => (m === 'sent' ? 'idle' : m)), 1600);
    } catch (err) {
      setError(err instanceof Error && err.message && !/fetch/i.test(err.message) ? err.message : t('saveFailed'));
      console.error(err);
    }
  };

  const when = (iso: string) => {
    const d = new Date(iso), today = new Date().toDateString() === d.toDateString();
    const hm = d.toLocaleTimeString(locale, {hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});
    return today ? `${t('today')} ${hm}` : `${d.toLocaleDateString(locale, {day: 'numeric', month: 'short'})} ${hm}`;
  };

  const picking = mode === 'element' || mode === 'area';
  const mark = target?.rect ?? hover;
  const dragRect = drag && {x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1), w: Math.abs(drag.x1 - drag.x0), h: Math.abs(drag.y1 - drag.y0)};
  // The box goes under the marked thing, or above if it doesn't fit.
  const pop = target && (() => {
    const w = Math.min(340, innerWidth - 20), h = attachments.length ? 290 : 220, below = target.rect.y + target.rect.h + 10;
    const top = below + h < innerHeight ? below : Math.max(10, target.rect.y - h - 10);
    return {left: Math.min(Math.max(10, target.rect.x), innerWidth - w - 10), top: Math.max(10, Math.min(top, innerHeight - h - 10)), width: w};
  })();
  const hasNew = items.some(it => it.status === 'new');
  const file = (src: string) => `${base}/file?path=${encodeURIComponent(src)}`;

  if (hidden) return null;

  return (
    <div {...{[UI_ATTR]: ''}} className={position === 'left' ? 'db-left' : undefined}>
      <style>{CSS_TEXT}</style>

      {picking && <div className="db-layer" onPointerMove={onMove} onPointerDown={onDown} onPointerUp={onUp} />}
      {mark && !dragRect && <div className="db-mark" style={{left: mark.x, top: mark.y, width: mark.w, height: mark.h}} />}
      {dragRect && <div className="db-mark" style={{left: dragRect.x, top: dragRect.y, width: dragRect.w, height: dragRect.h}} />}

      {mode === 'write' && target && pop && (
        <div className={`db-pop${dropping ? ' is-dropping' : ''}`} style={pop}
          onDragOver={e => { if ([...e.dataTransfer.items].some(i => i.kind === 'file')) { e.preventDefault(); setDropping(true); } }}
          onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropping(false); }}
          onDrop={e => { e.preventDefault(); setDropping(false); addFiles(e.dataTransfer.files); }}>
          <div className="db-pop__what">
            {target.kind === 'text' ? t('whatText', {text: cut(target.selectedText, 70)}) : target.kind === 'area' ? t('whatArea') : t('whatElement', {text: cut(target.text, 60) || `<${target.tag}>`})}
          </div>
          <textarea
            ref={box}
            value={comment}
            onChange={e => setComment(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }}
            // A copied image (screenshot, Figma) is pasted here with ⌘V; text pastes as usual.
            onPaste={e => { const files = [...e.clipboardData.files]; if (files.length && addFiles(files)) e.preventDefault(); }}
            placeholder={t('placeholder')}
            rows={4}
          />
          {attachments.length > 0 && (
            <div className="db-thumbs">
              {attachments.map(a => (
                <span key={a.id} className="db-thumb">
                  <img src={a.url} alt="" />
                  <button type="button" className="db-thumb__x" onClick={() => removeAttachment(a.id)} aria-label={t('removeImage')}>×</button>
                </span>
              ))}
            </div>
          )}
          {error && <div className="db-pop__err">{error}</div>}
          <div className="db-pop__row">
            <input ref={fileInput} type="file" accept={IMAGE_TYPES.join(',')} multiple hidden onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
            <button type="button" className="db-btn db-btn--ghost db-btn--icon" onClick={() => fileInput.current?.click()} disabled={attachments.length >= MAX_IMAGES} title={t('imageTitle')}>{t('image')}</button>
            <span className="db-hint">{t('sendHint')}</span>
            <button type="button" className="db-btn db-btn--ghost" onClick={reset}>{t('cancel')}</button>
            <button type="button" className="db-btn" onClick={send} disabled={!comment.trim() && !attachments.length}>{t('send')}</button>
          </div>
        </div>
      )}

      {listOpen && (
        <div className="db-list" role="dialog" aria-label={t('listTitle')}>
          <div className="db-list__head">
            <b>{t('listTitle')}</b>
            <button type="button" className="db-x" onClick={() => setListOpen(false)} aria-label={t('close')}>×</button>
          </div>
          {items.length > 0 && (
            <div className="db-list__notify">
              <span className={`db-dot${listening ? ' is-on' : ''}`} aria-hidden="true" />
              <span className="db-list__listen">{listening ? t('listening') : t('notListening')}</span>
              <button type="button" className="db-btn" onClick={notify} disabled={notifying || !hasNew} title={hasNew ? t('notifyTitle') : t('allNotified')}>
                {notifying ? t('notifying') : t('notify')}
              </button>
            </div>
          )}
          {notice && <p className="db-list__notice">{notice}</p>}
          {items.length === 0 ? <p className="db-list__empty">{t('empty')}</p> : (
            <ol className="db-list__items" data-lenis-prevent="">
              {items.map(it => (
                <li key={it.id} className="db-item">
                  <div className="db-item__meta">
                    <span>{it.page === '/' ? t('home') : it.page}</span>
                    <span>{when(it.createdAt)}</span>
                  </div>
                  {it.status !== 'new' && <span className={`db-item__status is-${it.status === 'in-progress' ? 'doing' : 'sent'}`}>{it.status === 'in-progress' ? t('statusInProgress') : t('statusNotified')}</span>}
                  <p className="db-item__comment">{it.comment}</p>
                  {it.images.length > 0 && (
                    <div className="db-thumbs">
                      {it.images.map(src => (
                        <a key={src} className="db-thumb" href={file(src)} target="_blank" rel="noreferrer" title={t('viewImage')}>
                          <img src={file(src)} alt={t('referenceImage')} />
                        </a>
                      ))}
                    </div>
                  )}
                  {it.what && <p className="db-item__what">{it.kind === 'area' ? t('kindArea') : it.kind === 'text' ? t('kindText') : t('kindElement')}: {cut(it.what, 90)}</p>}
                  <div className="db-item__row">
                    {it.page.split('#')[0] !== location.pathname + location.search && <a className="db-btn db-btn--ghost" href={it.page}>{t('goToPage')}</a>}
                    <button type="button" className="db-btn db-btn--ghost" onClick={() => discard(it.id)}>{t('discard')}</button>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {caps.enabled && <EditMode base={base} headers={headers} caps={caps} t={t} codeZones={codeZones} active={editing} onActive={setEditing} onAsk={ask} />}

      <div className="db-bar">
        {picking ? (
          <>
            <span className="db-hint">{mode === 'area' ? t('pickArea') : t('pickElement')} · {t('escCancels')}</span>
            <button type="button" className="db-btn db-btn--ghost" onClick={reset}>{t('cancel')}</button>
          </>
        ) : mode === 'sent' ? (
          <span className="db-hint">{t('saved')}</span>
        ) : editing ? (
          <>
            <span className="db-hint">{t('editHint')}</span>
            <button type="button" className="db-btn" onClick={() => setEditing(false)}>{t('done')}</button>
          </>
        ) : (
          <>
            {/* onMouseDown keeps the click from clearing the selected text before it is read. */}
            <button type="button" className="db-btn" onMouseDown={e => e.preventDefault()} onClick={() => start('element')} title={t('markTitle')}>{t('mark')}</button>
            <button type="button" className="db-btn db-btn--ghost" onClick={() => start('area')} title={t('areaTitle')}>{t('area')}</button>
            {caps.enabled && <button type="button" className="db-btn db-btn--ghost db-btn--edit" onClick={() => { reset(); setListOpen(false); setEditing(true); }} title={t('editTitle')}>{t('edit')}</button>}
            <button type="button" className="db-btn db-btn--ghost db-btn--hide" onClick={() => toggleHidden(true)} title={t('hideTitle')} aria-label={t('hide')}>–</button>
          </>
        )}
        {pending > 0 && (
          <button type="button" className="db-count" aria-expanded={listOpen} title={t('openList')}
            onClick={() => { if (!listOpen) load(); setListOpen(o => !o); }}>{pending}</button>
        )}
      </div>
    </div>
  );
}
