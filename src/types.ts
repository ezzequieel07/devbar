// Types shared by the toolbar (browser), the request handler (server) and the content adapters.

export type Locale = 'en' | 'es';

/** Where a request points on the page. */
export type Rect = {x: number; y: number; w: number; h: number};

export type Target = {
  /** `element`: one clicked element. `area`: a dragged rectangle. `text`: text selected on the page. */
  kind: 'element' | 'area' | 'text';
  rect: Rect;
  /** Short CSS path to the element (id, or tag + classes + :nth-of-type). */
  selector?: string;
  tag?: string;
  /** Visible text of the element (cut to 300 characters). */
  text?: string;
  /** Start of its outerHTML (cut to 800 characters). */
  html?: string;
  selectedText?: string;
  /** For areas: elements with their own text inside the rectangle, to find it in the code. */
  inside?: {selector: string; text: string}[];
};

/** `new`: not notified yet. `notified`: the agent was told. `in-progress`: the agent is working on it. */
export type RequestStatus = 'new' | 'notified' | 'in-progress';

/** A change request as saved in `.devbar/pending/<id>.json`. */
export type FeedbackRequest = {
  id: string;
  createdAt: string;
  status?: RequestStatus;
  comment: string;
  /** Path + query + hash of the page it was made on. */
  page: string;
  viewport: {w: number; h: number; dpr: number};
  scrollY: number;
  target: Target;
  /** Reference images, relative to the devbar folder (e.g. `attachments/<id>-1.png`). */
  images?: string[];
};

/** What the toolbar lists for each open request. */
export type RequestSummary = {
  id: string;
  createdAt: string;
  comment: string;
  page: string;
  kind?: Target['kind'];
  what?: string;
  status: RequestStatus;
  images: string[];
};

// ---------- Edit mode ----------

/**
 * One editable text. Adapters build them from their source (a JSON file, a CMS document…); the toolbar finds which one
 * was clicked by comparing the page's visible text with `display` (or through a `data-devbar="<bind>"` attribute).
 */
export type Leaf = {
  /** Opaque and unique: the toolbar sends it back when saving. The adapter must validate it (never trust the browser). */
  id: string;
  /** Field name shown to the user, e.g. "Hero › Title". Use " › " between levels. */
  label: string;
  /** Where it lives, e.g. "messages/en.json" or "Site settings". */
  docTitle: string;
  /** Value as it is edited. */
  value: string;
  /** How it reads on the page, if different (e.g. without markdown). Defaults to `value`. */
  display?: string;
  /** Allows line breaks (a textarea). Single-line texts save on Enter. */
  multiline?: boolean;
  description?: string;
  required?: boolean;
  max?: number;
  /** `error`: can't save past `max`. `warning` (default): only shows the counter in orange. */
  maxLevel?: 'error' | 'warning';
  /** Leaves with the same group can be edited together when, combined, they make up what the page shows (e.g. first + last name). */
  group?: string;
  /** False for texts that never show on the page (SEO, emails, errors): they are only listed under "Other texts". */
  onPage?: boolean;
  /** Page elements with `data-devbar="<bind>"` (or inside one) edit this leaf directly, without guessing by text. */
  bind?: string;
  /** With several leaves on the same bind, `data-devbar-field="<bindField>"` picks which one goes first. */
  bindField?: string;
  /** False: only reachable through `bind` (or "Other texts"), never by matching the page text. Default true. */
  textMatch?: boolean;
  /** CSS selector of the page part where this text shows. Clicks inside it rank it higher; clicks elsewhere, lower. */
  scope?: string;
  /** Pathname prefix of the pages where it shows (ranks it higher there). */
  path?: string;
  /** If set, the text is shown read-only with this reason. */
  locked?: string;
  /** Extra warning shown above the field. */
  note?: string;
};

export type Change = {label: string; before: string; after: string};

/** A draft with unpublished changes (adapters with drafts only). */
export type DraftStatus = {
  id: string;
  title: string;
  /** Revision seen by the user: publish/discard refuse to touch a draft that changed since. */
  rev: string;
  /** False for documents that were never published: those are published (or deleted) from the CMS. */
  canPublish: boolean;
  /** Validation problems: while there are any, nothing is published. */
  problems: string[];
  changes: Change[];
};

export type SetInput = {id: string; value: string; expected?: string};

/** Edit log kept in `.devbar/edits/` (used to undo). */
export interface EditLog {
  add(entry: Record<string, unknown>): Promise<string>;
  /** Newest first. */
  list(): Promise<{id: string; entry: Record<string, unknown>}[]>;
  update(id: string, patch: Record<string, unknown>): Promise<void>;
}

export type EditContext = {
  /** Page the toolbar is on (path + query). */
  page: string;
  locale: Locale;
  /** Picks the message in the user's language. */
  t: (en: string, es: string) => string;
  log: EditLog;
};

/** Thrown by adapters with a message meant for the person using the toolbar. */
export class DevbarError extends Error {}

/** A source of editable texts. See `devbar/adapters/json` and `devbar/adapters/sanity`, or write your own. */
export interface ContentAdapter {
  name: string;
  /** Every editable text (the toolbar asks again on each page). */
  list(ctx: EditContext): Promise<Leaf[]>;
  /** Saves one text. Must check `expected` against the current value and refuse if it changed meanwhile. */
  set(input: SetInput, ctx: EditContext): Promise<{warnings?: string[]}>;
  /** Restores the last change made from the toolbar. Returns what was undone, or null if there is nothing. */
  undo?(ctx: EditContext): Promise<{label: string} | null>;
  /** For sources with drafts (CMS): saving writes a draft, and the toolbar offers Publish / Discard. */
  drafts?: {
    status(ctx: EditContext): Promise<DraftStatus[]>;
    /** `reviewed`: draft id → revision the user reviewed. */
    publish(reviewed: Record<string, string>, ctx: EditContext): Promise<number>;
    discard(reviewed: Record<string, string>, ctx: EditContext): Promise<number>;
  };
}

/** What the toolbar learns about edit mode when it loads. */
export type EditCapabilities = {enabled: boolean; drafts: boolean; undo: boolean};
