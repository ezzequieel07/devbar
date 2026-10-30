import type {Rect} from '../types';

/** Everything the toolbar draws carries this attribute, so it never picks itself. */
export const UI_ATTR = 'data-devbar-ui';
export const isOurs = (el: Element | null) => !!el?.closest(`[${UI_ATTR}]`);

export const cut = (s: string | null | undefined, n: number) => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
};

export const toRect = (r: DOMRect): Rect => ({x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height)});

/** Short, readable CSS path to the element: its id if it has one; otherwise tag + classes (+ :nth-of-type when needed). */
export function selectorOf(el: Element): string {
  const parts: string[] = [];
  for (let n: Element | null = el; n && n !== document.body && parts.length < 6; n = n.parentElement) {
    if (n.id) { parts.unshift(`#${CSS.escape(n.id)}`); break; }
    let part = n.tagName.toLowerCase();
    const cls = [...n.classList].filter(c => !c.startsWith('db-')).slice(0, 3);
    if (cls.length) part += '.' + cls.map(c => CSS.escape(c)).join('.');
    const parent = n.parentElement;
    if (parent) {
      const same = [...parent.children].filter(c => c.tagName === n!.tagName);
      if (same.length > 1) part += `:nth-of-type(${same.indexOf(n) + 1})`;
    }
    parts.unshift(part);
  }
  return parts.join(' > ');
}

export const describe = (el: Element) => ({
  selector: selectorOf(el),
  tag: el.tagName.toLowerCase(),
  text: cut((el as HTMLElement).innerText ?? el.textContent, 300),
  html: cut(el.outerHTML, 800),
});

/** Page element under the pointer, skipping the toolbar and its layers. */
export const elementAt = (x: number, y: number) =>
  document.elementsFromPoint(x, y).find(el => !isOurs(el) && el !== document.documentElement && el !== document.body) ?? null;

/**
 * Element to mark under the pointer. Animated headings are often split into one piece per letter or word: it climbs
 * up to something with text that makes sense on its own.
 */
export function pageElementAt(x: number, y: number): Element | null {
  let el = elementAt(x, y);
  const short = (n: Element) => { const t = (n.textContent ?? '').trim(); return t.length > 0 && t.length < 12; };
  while (el?.parentElement && el.parentElement !== document.body && short(el) && !el.matches('a,button,label,input,li,p,h1,h2,h3,h4,h5,h6')) el = el.parentElement;
  return el;
}

/** File contents in base64 (without the leading "data:…;base64,"). */
export const toBase64 = (file: File) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
  r.onerror = () => reject(r.error);
  r.readAsDataURL(file);
});
