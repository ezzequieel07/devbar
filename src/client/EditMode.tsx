import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {DraftStatus, EditCapabilities, Leaf, Rect} from '../types';
import {UI_ATTR, elementAt, isOurs} from './dom';
import type {Translate} from './i18n';
import {bindIndex, displayOf, isClear, match, norm, prepare, type Match, type Option} from './match';

// Edit mode: click a text on the page, change it in a box, save it through the content adapter. Blue = editable here;
// gray = lives in the code ("Request the change" creates a request for the agent). "Other texts" lists what doesn't show
// on the page (SEO, emails, error messages). With a CMS adapter, saving writes a draft: "Publish…" reviews and publishes.
// With `viewCookie`, "View published" sets that cookie (`<name>=published`) so the site shows what is live; editing
// waits until "View drafts" clears it. Shortcut: Alt+E. Esc exits.

type Editing = {options: Option[]; rect: Rect | null; el: Element | null};
type Saved = {message: string; warnings: string[]; expect: string[]; scrollY: number; editing: boolean};
type Props = {
  base: string;
  headers: Record<string, string>;
  caps: EditCapabilities;
  t: Translate;
  codeZones?: string;
  boundZones?: string;
  viewCookie?: string;
  active: boolean;
  onActive: (on: boolean) => void;
  onAsk: (el: Element) => void;
};

const SAVED_KEY = 'devbar-edit-saved';
const toRect = (r: DOMRect): Rect => ({x: r.left, y: r.top, w: r.width, h: r.height});

/** Reloads the page at the same place and leaves a message to show after (and whether to stay in edit mode). */
function reloadWith(saved: Omit<Saved, 'scrollY'>) {
  try { sessionStorage.setItem(SAVED_KEY, JSON.stringify({...saved, scrollY: Math.round(window.scrollY)})); } catch {}
  window.location.reload();
}

/** The saved message is read once per load (React runs effects twice in development). */
let savedHandled = false;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Emojis (and their joiners): some sites drop them when rendering, so the check after saving ignores them. */
const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;

/** How a saved text reads on the page: without [links](url), asterisks, \escapes or emojis. */
const shown = (v: string) =>
  v.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\\([\\*[\]])|\*+/g, (_, c?: string) => c ?? '').replace(EMOJI, '').trim().split('\n')[0].slice(0, 40);

const readCookie = (name: string) => document.cookie.split('; ').find(c => c.startsWith(`${name}=`))?.slice(name.length + 1) ?? '';

/** Current pathname, also on client-side navigation (any router). */
function usePathname() {
  const [path, setPath] = useState(() => (typeof location === 'undefined' ? '' : location.pathname));
  useEffect(() => {
    const check = () => setPath(location.pathname);
    window.addEventListener('popstate', check);
    const id = window.setInterval(check, 500);
    return () => { window.removeEventListener('popstate', check); window.clearInterval(id); };
  }, []);
  return path;
}

/** Name of an option: the field ("Hero › Title") or the group ("Hero › First name + Last name"). */
function optionLabel(o: Leaf[]) {
  if (o.length === 1) return o[0].label;
  const parts = o[0].label.split(' › ');
  const head = parts.slice(0, -1).join(' › ');
  return `${head ? `${head} › ` : ''}${o.map(l => l.label.split(' › ').pop()).join(' + ')}`;
}

export default function EditMode({base, headers, caps, t, codeZones, boundZones, viewCookie, active, onActive, onAsk}: Props) {
  const [leaves, setLeaves] = useState<Leaf[]>([]);
  const [status, setStatus] = useState<DraftStatus[]>([]);
  const [loadError, setLoadError] = useState('');
  const [hover, setHover] = useState<{rect: Rect; label: string; ok: boolean} | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [outside, setOutside] = useState<{el: Element; rect: Rect; code: boolean; bound: boolean} | null>(null);
  const [others, setOthers] = useState(false);
  const [review, setReview] = useState(false);
  const [toast, setToast] = useState<{text: string; tone: 'ok' | 'warn'} | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [published, setPublished] = useState(false);
  const pointer = useRef<{x: number; y: number} | null>(null);
  const dirty = useRef(false);
  const pathname = usePathname();
  const prepared = useMemo(() => prepare(leaves), [leaves]);
  const byBind = useMemo(() => bindIndex(leaves), [leaves]);

  const call = useCallback(async <T,>(method: 'GET' | 'POST', body?: Record<string, unknown>): Promise<T> => {
    const page = location.pathname + location.search;
    const res = await fetch(method === 'GET' ? `${base}/edit?page=${encodeURIComponent(page)}` : `${base}/edit`, {
      method,
      headers: {...headers, ...(body ? {'content-type': 'application/json'} : {})},
      body: body ? JSON.stringify({...body, page}) : undefined,
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({error: t('loadFailed')}));
    if (!res.ok || data.error) throw new Error(data.error ?? t('saveError'));
    return data as T;
  }, [base, headers, t]);

  // Drafts never published (started in the CMS) are listed, but not published or discarded from here.
  const ours = status.filter(d => d.canPublish);
  const changes = ours.reduce((n, d) => n + Math.max(1, d.changes.length), 0);
  const blocked = ours.some(d => d.problems.length);

  const load = useCallback(async () => {
    try {
      const d = await call<{leaves: Leaf[]; status: DraftStatus[]}>('GET');
      setLeaves(d.leaves);
      setStatus(d.status);
      setLoadError('');
      setLoaded(true);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t('loadFailed'));
    }
  }, [call, t]);

  // The texts, again on every page (each page may have its own).
  useEffect(() => { load(); }, [load, pathname]);

  const viewing = !!viewCookie && caps.drafts;
  useEffect(() => { if (viewing) setPublished(readCookie(viewCookie!) === 'published'); }, [viewing, viewCookie]);
  const toggleView = () => {
    if (!viewCookie) return;
    document.cookie = published ? `${viewCookie}=; path=/; max-age=0; samesite=lax` : `${viewCookie}=published; path=/; samesite=lax`;
    window.location.reload();
  };

  // On load: what was left by a save (message, scroll position, keep editing).
  useEffect(() => {
    if (savedHandled) return;
    let saved: Saved | null = null;
    try { saved = JSON.parse(sessionStorage.getItem(SAVED_KEY) ?? 'null'); } catch {}
    if (!saved) return;
    const y = saved.scrollY;
    const restore = () => window.scrollTo(0, y);
    requestAnimationFrame(restore);
    const id = window.setTimeout(restore, 400);
    if (saved.editing) onActive(true);
    // Is the new text visible? If not, that part of the page uses another value (or a text from the code).
    const s = saved;
    const check = window.setTimeout(() => {
      savedHandled = true;
      try { sessionStorage.removeItem(SAVED_KEY); } catch {}
      // textContent also counts what an animation has not revealed yet. {templates} match any name.
      const page = norm((document.body.textContent ?? '').replace(EMOJI, ''));
      const missing = s.expect.filter(e => e && !new RegExp(norm(e).split(/\{\w+\}/).map(escapeRe).join('.{1,60}?')).test(page));
      const warnings = [...s.warnings, ...(missing.length ? [t('notVisible')] : [])];
      setToast({text: [s.message, ...warnings].join(' '), tone: warnings.length ? 'warn' : 'ok'});
    }, 900);
    return () => { window.clearTimeout(id); window.clearTimeout(check); };
  }, [onActive, t]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), toast.tone === 'warn' ? 9000 : 3500);
    return () => window.clearTimeout(id);
  }, [toast]);

  const close = useCallback(() => { setEditing(null); setOutside(null); setOthers(false); setReview(false); dirty.current = false; }, []);
  /** Closing the box with unsaved text asks first. */
  const cancel = useCallback(() => {
    if (dirty.current && !window.confirm(t('unsaved'))) return;
    close();
  }, [close, t]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.closest?.('textarea,input');
      if (e.altKey && e.code === 'KeyE' && !typing) { e.preventDefault(); close(); onActive(!active); return; }
      if (e.key !== 'Escape') return;
      if (editing || outside || others || review) { e.preventDefault(); e.stopPropagation(); cancel(); return; }
      if (active) { e.preventDefault(); e.stopPropagation(); onActive(false); }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [active, editing, outside, others, review, close, cancel, onActive]);

  useEffect(() => {
    document.documentElement.classList.toggle('db-editing', active);
    if (!active) { setHover(null); close(); }
    return () => document.documentElement.classList.remove('db-editing');
  }, [active, close]);

  const inspect = useCallback((x: number, y: number): Match | null => {
    const el = elementAt(x, y);
    return el ? match(el, prepared, byBind, isOurs, codeZones, boundZones) : null;
  }, [prepared, byBind, codeZones, boundZones]);

  const updateHover = useCallback(() => {
    const p = pointer.current;
    if (!p || !active || editing || outside || others || review) return;
    if (!loaded) { setHover(null); return; }
    const m = inspect(p.x, p.y);
    if (!m) { setHover(null); return; }
    const label = m.kind === 'none' ? (m.code ? t('inCodeZone') : m.bound ? t('inBound') : t('inCode'))
      : isClear(m.options) ? optionLabel(m.options[0].leaves) : m.options.length === 1 ? `${optionLabel(m.options[0].leaves)}?` : t('places', {n: m.options.length});
    setHover({rect: toRect(m.el.getBoundingClientRect()), label, ok: m.kind !== 'none'});
  }, [active, editing, outside, others, review, loaded, inspect, t]);

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(updateHover); };
    window.addEventListener('scroll', onScroll, {passive: true});
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); };
  }, [active, updateHover]);

  const onMove = (e: React.PointerEvent) => {
    pointer.current = {x: e.clientX, y: e.clientY};
    updateHover();
  };

  const onClick = (e: React.PointerEvent) => {
    e.preventDefault();
    if (published) { setToast({text: t('publishedNoEdit'), tone: 'warn'}); return; }
    if (!loaded) { setToast({text: loadError || t('loading'), tone: 'warn'}); return; }
    const m = inspect(e.clientX, e.clientY);
    if (!m) return;
    setHover(null);
    if (m.kind === 'none') { setOutside({el: m.el, rect: toRect(m.el.getBoundingClientRect()), code: m.code, bound: !!m.bound}); return; }
    setEditing({options: m.options, rect: toRect(m.el.getBoundingClientRect()), el: m.el});
  };

  const runOp = async (op: 'publish' | 'discard' | 'undo') => {
    try {
      // Publish and discard: only what the panel shows, at the revision that was seen (if it changed in the CMS, nothing is touched).
      const reviewed = Object.fromEntries(ours.map(d => [d.id, d.rev]));
      const d = await call<{undone?: {label: string} | null}>('POST', op === 'undo' ? {op} : {op, reviewed});
      const message = op === 'publish' ? t('published') : op === 'discard' ? t('discarded')
        : d.undone ? t('undone', {label: d.undone.label}) : t('nothingToUndo');
      if (op === 'undo' && !d.undone) { setToast({text: message, tone: 'warn'}); return; }
      reloadWith({message, warnings: [], expect: [], editing: active});
    } catch (err) {
      setToast({text: err instanceof Error ? err.message : t('saveError'), tone: 'warn'});
    }
  };

  const showStatus = !!loadError || published || (caps.drafts ? active || changes > 0 : active);

  return (
    <div {...{[UI_ATTR]: ''}}>
      {active && !editing && !outside && !others && !review && (
        <div className="db-edit__layer" onPointerMove={onMove} onPointerDown={onClick} onPointerLeave={() => setHover(null)} />
      )}
      {hover && (
        <>
          <div className={`db-edit__mark${hover.ok ? '' : ' is-off'}`} style={{left: hover.rect.x - 3, top: hover.rect.y - 3, width: hover.rect.w + 6, height: hover.rect.h + 6}} />
          <div className={`db-edit__tag${hover.ok ? '' : ' is-off'}`} style={{left: Math.max(6, hover.rect.x - 3), top: hover.rect.y > 30 ? hover.rect.y - 26 : hover.rect.y + hover.rect.h + 6}}>{hover.label}</div>
        </>
      )}

      {/* Backdrop while the box is open: clicking outside closes it (asks if there is unsaved text) and the page gets no click. */}
      {(editing || outside) && <div className="db-edit__backdrop" onPointerDown={e => { e.preventDefault(); cancel(); }} />}

      {editing && <Editor key={editing.options.map(o => o.leaves.map(l => l.id).join('+')).join(',')} editing={editing} t={t} call={call}
        onCancel={cancel}
        onDirty={d => { dirty.current = d; }}
        onPick={o => setEditing({...editing, options: [o, ...editing.options.filter(x => x !== o)].map((x, i) => ({...x, s: i ? 0 : 1000}))})}
        onAsk={editing.el ? () => { const el = editing.el!; close(); onActive(false); onAsk(el); } : undefined}
        onSaved={(warnings, expect) => reloadWith({message: caps.drafts ? t('savedDraft') : t('savedFile'), warnings, expect, editing: true})} />}

      {outside && (
        <Popover rect={outside.rect} width={300}>
          <p className="db-edit__title">{outside.code ? t('zoneTitle') : outside.bound ? t('boundTitle') : t('codeTitle')}</p>
          <p className="db-edit__help">{outside.code ? t('zoneHelp') : outside.bound ? t('boundHelp') : t('codeHelp')}</p>
          <div className="db-edit__row">
            <button type="button" className="db-btn db-btn--ghost" onClick={close}>{t('close')}</button>
            <button type="button" className="db-btn" onClick={() => { const el = outside.el; close(); onActive(false); onAsk(el); }}>{t('requestChange')}</button>
          </div>
        </Popover>
      )}

      {others && <OtherTexts leaves={leaves} t={t} onPick={l => { setOthers(false); setEditing({options: [{leaves: [l], s: 100}], rect: null, el: null}); }} onClose={close} />}

      {review && (
        <div className="db-edit__panel" role="dialog" aria-label={t('reviewTitle')}>
          <div className="db-edit__panel-head"><b>{t('reviewTitle')}</b><button type="button" className="db-x" onClick={close} aria-label={t('close')}>×</button></div>
          <div className="db-edit__panel-body" data-lenis-prevent="">
            {status.length === 0 ? <p className="db-edit__help">{t('noChanges')}</p> : status.map(d => (
              <div key={d.id} className="db-edit__doc">
                <p className="db-edit__doc-title">{d.title}</p>
                {!d.canPublish && <p className="db-edit__note">{t('neverPublished')}</p>}
                {d.canPublish && d.problems.map(x => <p key={x} className="db-edit__err">{x}</p>)}
                {d.changes.length === 0 ? <p className="db-edit__help">{t('noDiff')}</p> : d.changes.map((c, i) => (
                  <div key={i} className="db-edit__change">
                    <span className="db-edit__change-label">{c.label}</span>
                    {c.before && <span className="db-edit__before">{c.before}</span>}
                    <span className="db-edit__after">{c.after || t('emptyValue')}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          {ours.length > 0 && (
            <div className="db-edit__row db-edit__panel-foot">
              {blocked && <span className="db-hint">{t('fixRed')}</span>}
              <button type="button" className="db-btn db-btn--ghost" onClick={() => { if (window.confirm(t('discardConfirm'))) runOp('discard'); }}>{t('discard')}</button>
              <button type="button" className="db-btn" disabled={blocked} onClick={() => runOp('publish')}>{t('publish')}</button>
            </div>
          )}
        </div>
      )}

      {showStatus && (
        <div className="db-edit__status">
          {loadError ? <span className="db-edit__err">{loadError}</span> : published ? (
            <>
              <span>{t('viewingPublished')}</span>
              <button type="button" className="db-btn db-btn--ghost" onClick={toggleView}>{t('viewDrafts')}</button>
            </>
          ) : (
            <>
              {caps.drafts && (changes > 0
                ? <button type="button" className="db-edit__link" onClick={() => { close(); setReview(true); }}>{changes === 1 ? t('changesOne') : t('changesMany', {n: changes})}</button>
                : <span>{t('changesNone')}</span>)}
              {caps.drafts && changes > 0 && <button type="button" className="db-btn" onClick={() => { close(); setReview(true); }}>{t('publishEllipsis')}</button>}
              {caps.undo && (!caps.drafts || changes > 0) && <button type="button" className="db-btn db-btn--ghost" onClick={() => runOp('undo')} title={t('undoTitle')}>{t('undo')}</button>}
              {active && <button type="button" className="db-btn db-btn--ghost" onClick={() => { close(); setOthers(true); }}>{t('otherTexts')}</button>}
              {viewing && <button type="button" className="db-edit__link db-edit__muted" onClick={toggleView} title={t('viewPublishedTitle')}>{t('viewPublished')}</button>}
            </>
          )}
        </div>
      )}

      {toast && <div className={`db-edit__toast${toast.tone === 'warn' ? ' is-warn' : ''}`} role="status">{toast.text}</div>}
    </div>
  );
}

/** Box anchored to the element (below if it fits; otherwise above), or centered with no element. */
function Popover({rect, width, children}: {rect: Rect | null; width: number; children: React.ReactNode}) {
  const ref = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(220);
  useEffect(() => { if (ref.current && ref.current.offsetHeight !== h) setH(ref.current.offsetHeight); });
  const w = Math.min(width, window.innerWidth - 20);
  let style: React.CSSProperties;
  if (!rect) style = {left: (window.innerWidth - w) / 2, top: Math.max(20, (window.innerHeight - h) / 2), width: w};
  else {
    const below = rect.y + rect.h + 10;
    const top = below + h < window.innerHeight - 70 ? below : Math.max(10, rect.y - h - 10);
    style = {left: Math.min(Math.max(10, rect.x), window.innerWidth - w - 10), top: Math.min(top, window.innerHeight - h - 10), width: w};
  }
  return <div ref={ref} className="db-edit__pop" style={style} data-lenis-prevent="">{children}</div>;
}

function Editor({editing, t, call, onCancel, onPick, onAsk, onDirty, onSaved}: {
  editing: Editing; t: Translate;
  call: <T>(method: 'GET' | 'POST', body?: Record<string, unknown>) => Promise<T>;
  onCancel: () => void; onPick: (o: Option) => void; onAsk?: () => void; onDirty: (dirty: boolean) => void;
  onSaved: (warnings: string[], expect: string[]) => void;
}) {
  const {options, rect} = editing;
  const choose = !isClear(options);
  const leaves = options[0].leaves;
  const elsewhere = options.slice(1);
  const [values, setValues] = useState(() => Object.fromEntries(leaves.map(l => [l.id, l.value])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const first = useRef<HTMLTextAreaElement>(null);
  // Short texts: all selected (typing replaces them). Paragraphs: cursor at the end, so they aren't wiped by accident.
  useEffect(() => {
    const ta = first.current;
    if (choose || !ta) return;
    ta.focus();
    if (!leaves[0].multiline && ta.value.length <= 30) ta.select(); else ta.setSelectionRange(ta.value.length, ta.value.length);
  }, [choose, leaves]);

  const errors = leaves.map(l => {
    const v = values[l.id] ?? '';
    if (l.required && !v.trim()) return t('notEmpty');
    if (l.max != null && l.maxLevel === 'error' && v.length > l.max) return t('maxChars', {n: l.max});
    return '';
  });
  const changed = leaves.filter(l => !l.locked && (values[l.id] ?? '') !== l.value);
  const canSave = !busy && changed.length > 0 && errors.every(e => !e);
  const isDirty = changed.length > 0;
  useEffect(() => { onDirty(isDirty); }, [isDirty, onDirty]);

  if (choose) return (
    <Popover rect={rect} width={360}>
      <p className="db-edit__title">{t('chooseTitle')}</p>
      <p className="db-edit__help">{t('chooseHelp')}</p>
      <div className="db-edit__choices">
        {options.map(o => (
          <button key={o.leaves.map(l => l.id).join('+')} type="button" className="db-edit__choice" onClick={() => onPick(o)}>
            <b>{optionLabel(o.leaves)}</b><span>{o.leaves[0].docTitle}</span><em>{o.leaves.map(displayOf).join(' · ').slice(0, 90)}</em>
          </button>
        ))}
        {onAsk && (
          <button type="button" className="db-edit__choice db-edit__choice--none" onClick={onAsk}>
            <b>{t('noneOfThese')}</b><span>{t('noneHelp')}</span>
          </button>
        )}
      </div>
      <div className="db-edit__row"><button type="button" className="db-btn db-btn--ghost" onClick={onCancel}>{t('cancel')}</button></div>
    </Popover>
  );

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    setError('');
    const warnings: string[] = [];
    try {
      for (const l of changed) {
        const d = await call<{warnings: string[]}>('POST', {op: 'set', id: l.id, value: values[l.id], expected: l.value});
        warnings.push(...(d.warnings ?? []));
      }
      // What should show on the page after the reload.
      onSaved(warnings, changed.filter(l => l.onPage !== false).map(l => shown(values[l.id] ?? '')));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('saveError'));
      setBusy(false);
    }
  };

  return (
    <Popover rect={rect} width={leaves.some(l => l.multiline) ? 420 : 360}>
      <p className="db-edit__title">{optionLabel(leaves)}</p>
      <p className="db-edit__doc-line">{leaves[0].docTitle}{leaves.some(l => l.onPage === false && !l.value) ? t('willCreate') : ''}</p>
      {leaves.map(l => l.note && <p key={`n-${l.id}`} className="db-edit__note">{l.note}</p>)}
      {leaves.map((l, i) => {
        const v = values[l.id] ?? '';
        const over = l.max != null && v.length > l.max;
        return (
          <label key={l.id} className="db-edit__field">
            {leaves.length > 1 && <span className="db-edit__field-label">{l.label.split(' › ').pop()}</span>}
            {l.locked && <span className="db-edit__note">{l.locked}</span>}
            <textarea
              ref={i === 0 ? first : undefined}
              value={v}
              readOnly={!!l.locked}
              rows={l.multiline ? Math.min(8, Math.max(3, Math.ceil(v.length / 48))) : Math.max(1, Math.ceil(v.length / 44))}
              onChange={e => setValues({...values, [l.id]: l.multiline ? e.target.value : e.target.value.replace(/\n/g, ' ')})}
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || !l.multiline)) { e.preventDefault(); save(); }
              }}
            />
            <span className="db-edit__meta">
              <span className="db-edit__desc">{l.description}</span>
              {l.max != null && <span className={`db-edit__count${over ? (l.maxLevel === 'error' ? ' is-err' : ' is-warn') : ''}`}>{v.length}/{l.max}</span>}
            </span>
            {errors[i] && <span className="db-edit__err">{errors[i]}</span>}
          </label>
        );
      })}
      {error && <p className="db-edit__err">{error}</p>}
      {elsewhere.length > 0 && (
        <p className="db-edit__also">{t('alsoIn')} {elsewhere.map((o, i) => (
          <button key={i} type="button" className="db-edit__link" onClick={() => onPick(o)}>{optionLabel(o.leaves)}</button>
        ))}</p>
      )}
      <div className="db-edit__row">
        <span className="db-hint">{leaves.some(l => l.multiline) ? t('cmdEnterSaves') : t('enterSaves')}</span>
        <button type="button" className="db-btn db-btn--ghost" onClick={onCancel}>{t('cancel')}</button>
        <button type="button" className="db-btn" onClick={save} disabled={!canSave}>{busy ? t('saving') : t('save')}</button>
      </div>
    </Popover>
  );
}

function OtherTexts({leaves, t, onPick, onClose}: {leaves: Leaf[]; t: Translate; onPick: (l: Leaf) => void; onClose: () => void}) {
  const [q, setQ] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const list = leaves.filter(l => !q || norm(`${l.label} ${l.docTitle} ${l.value}`).includes(norm(q)));
  // Texts that don't show on the page first (SEO, emails, errors): that's what this list is for.
  list.sort((a, b) => Number(a.onPage !== false) - Number(b.onPage !== false));
  return (
    <div className="db-edit__panel" role="dialog" aria-label={t('otherTexts')}>
      <div className="db-edit__panel-head"><b>{t('otherTexts')}</b><button type="button" className="db-x" onClick={onClose} aria-label={t('close')}>×</button></div>
      <input ref={input} className="db-edit__search" placeholder={t('search')} value={q} onChange={e => setQ(e.target.value)} />
      <div className="db-edit__panel-body" data-lenis-prevent="">
        {list.slice(0, 120).map(l => (
          <button key={l.id} type="button" className="db-edit__choice" onClick={() => onPick(l)}>
            <b>{l.label}</b><span>{l.docTitle}{l.onPage === false ? t('notOnPage') : ''}</span><em>{displayOf(l).slice(0, 90) || t('emptyValue')}</em>
          </button>
        ))}
        {list.length === 0 && <p className="db-edit__help">{t('noResults')}</p>}
        {list.length > 120 && <p className="db-edit__help">{t('showing', {n: list.length})}</p>}
      </div>
    </div>
  );
}
