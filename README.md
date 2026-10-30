# devbar

**A dev-only toolbar for the site you're building. Point at something, say what should change, and your coding agent
picks it up. Edit texts right on the page.**

[Leer en español](README.es.md)

While your dev server runs, devbar adds a small toolbar to the corner of your site:

- **Mark** an element (click), an **Area** (drag) or some selected text, and write what should change. Paste or drop a
  reference image if it helps.
- Each request is saved as a JSON file in `.devbar/pending/`, with everything an agent needs to find it in the code: the
  page, the viewport, the scroll position, a CSS selector, the element's text and HTML.
- **Notify Claude** (or any agent): if your agent is running `npx devbar listen`, it wakes up and does the requests. The
  toolbar shows when it's listening, when it's working on each request and when it's done.
- **Edit**: click any text on the page and change it in place. devbar saves it to where the text lives (a JSON file, a
  Sanity draft, or your own source through an adapter). Texts that live in the code turn into a request instead.

No screenshots to annotate, no "the second button on the left, the blue one". No API keys either: it works with the
coding agent you already use (Claude Code, Codex, Cursor, Aider…) through plain files.

devbar only runs with your dev server. In a production build the toolbar is not rendered (and not even downloaded) and
the endpoints answer 404.

## Contents

- [Setup (Next.js)](#setup-nextjs)
- [Working with your agent](#working-with-your-agent)
- [Edit mode](#edit-mode): [JSON files](#json-files), [Sanity](#sanity), [your own source](#your-own-source)
- [Telling devbar where texts are](#telling-devbar-where-texts-are)
- [Toolbar options](#toolbar-options)
- [Other frameworks](#other-frameworks)
- [Security](#security)
- [What gets stored](#what-gets-stored)

## Setup (Next.js)

```bash
npm install devbar
npx devbar init
```

`init` adds `.devbar/` to your `.gitignore` and the agent instructions to `CLAUDE.md` / `AGENTS.md`.

**1. The endpoints** — `app/devbar/[...devbar]/route.ts`:

```ts
import {createDevbarHandler} from 'devbar/server';

export const {GET, POST, PATCH, DELETE} = createDevbarHandler();
```

**2. The toolbar** — in your root layout (`app/layout.tsx`), inside `<body>`:

```tsx
import {Devbar} from 'devbar';

{process.env.NODE_ENV === 'development' && <Devbar />}
```

Run `next dev`, open the site and you'll see the toolbar on the bottom right.

| Shortcut | |
| --- | --- |
| `Alt+C` | Mark an element (or the selected text) |
| `Alt+E` | Edit mode |
| `Alt+H` | Hide / show the toolbar (e.g. to record your site) |
| `Esc` | Cancel |
| `⌘ Enter` | Send |

## Working with your agent

Requests are plain JSON files, so any agent can read them. The CLI makes it smoother:

```bash
npx devbar list            # open requests, readable
npx devbar start <id>      # the toolbar shows "Claude is on it"
npx devbar done <id>       # moves it to .devbar/done/ (leaves the counter)
npx devbar listen          # waits for "Notify", prints the requests and exits
```

**The loop with Claude Code:** ask Claude to run `npx devbar listen` in the background. Mark things on your site, then
press **Notify Claude**: the listener exits, Claude gets woken up with the list, does the changes, marks each one done
and starts listening again. Not listening? Press Notify anyway and later tell your agent "check the devbar requests".

`npx devbar init` writes these instructions into `CLAUDE.md` / `AGENTS.md` so the agent knows the workflow. You can also
print them with `npx devbar instructions`. Change the agent's name in the toolbar with `<Devbar agent="Codex" />`.

A request looks like this:

```json
{
  "id": "2026-10-29_14-03-11-k3f9",
  "status": "new",
  "comment": "Less space above this title, and make it bold",
  "page": "/pricing",
  "viewport": {"w": 1440, "h": 900, "dpr": 2},
  "scrollY": 1240,
  "target": {
    "kind": "element",
    "selector": "section.plans > h2",
    "tag": "h2",
    "text": "Simple pricing",
    "html": "<h2 class=\"plans__title\">Simple pricing</h2>",
    "rect": {"x": 120, "y": 88, "w": 640, "h": 48}
  },
  "images": ["attachments/2026-10-29_14-03-11-k3f9-1.png"]
}
```

## Edit mode

Pass a content adapter and the toolbar gets an **Edit** button. Hover any text: blue means it can be edited here, gray
means it lives in the code (clicking it offers "Request the change"). **Other texts** lists texts that don't show on the
page, such as SEO titles or email copy.

After saving, the page reloads at the same scroll position and checks that the new text is visible. **Undo** restores
the last change.

### JSON files

Translation files, site copy, anything with strings. Saving writes the file directly (keeping its indentation); git is
your history.

```ts
import {jsonAdapter} from 'devbar/adapters/json';
import {createDevbarHandler} from 'devbar/server';

export const {GET, POST, PATCH, DELETE} = createDevbarHandler({
  content: jsonAdapter({
    files: ['messages/en.json', {file: 'messages/es.json', path: '/es'}],
    scope: {'hero.': '#hero', 'footer.': 'footer'},
  }),
});
```

Your page must read the file at request time (or rely on hot reload) to show the change after the reload.

### Sanity

Like the Studio, saving writes a **draft** (`drafts.<id>`): nothing changes on your published site until you press
**Publish…**, which shows every unpublished change (before → after) and publishes or discards them. It refuses to
overwrite anything that changed in the Studio meanwhile.

```ts
import {createClient} from '@sanity/client';
import {sanityAdapter} from 'devbar/adapters/sanity';
import {createDevbarHandler} from 'devbar/server';

const client = createClient({
  projectId: process.env.SANITY_PROJECT_ID,
  dataset: 'production',
  apiVersion: '2025-01-01',
  token: process.env.SANITY_WRITE_TOKEN, // a token that can write; only used on the server
  useCdn: false,
});

export const {GET, POST, PATCH, DELETE} = createDevbarHandler({
  content: sanityAdapter({
    client,
    documents: [
      // A singleton, with the fields you want to edit.
      {type: 'siteSettings', id: 'siteSettings', title: 'Site', fields: [
        'hero.title',
        {path: 'hero.intro', multiline: true, max: 180},
        'nav.links[].label',           // every item of a list (by _key)
        {path: 'seo.description', onPage: false},
      ]},
      // Every post, all of its texts (Portable Text included).
      {type: 'post', filter: 'defined(slug.current)', path: doc => `/blog/${(doc.slug as {current: string}).current}`},
    ],
  }),
});
```

- Without `fields`, every string in the document is editable (except system fields, slugs, references and URLs).
- Portable Text blocks (paragraphs, headings, list items, quotes) are edited as light markdown: `**bold**`, `*italic*`,
  `[link](https://…)`. Unchanged spans and links keep their keys. Blocks with other marks are shown read-only.
- **Your site has to show drafts in development** (e.g. `perspective: 'drafts'` when `NODE_ENV === 'development'`),
  or you won't see your edits before publishing.

### Your own source

An adapter is a small object. Here's the shape (see `ContentAdapter` in the types):

```ts
import {DevbarError, type ContentAdapter} from 'devbar/server';

export const myAdapter: ContentAdapter = {
  name: 'my-cms',
  async list(ctx) {
    // Every editable text: [{id, label, docTitle, value, multiline?, max?, scope?, bind?, …}]
    return [];
  },
  async set({id, value, expected}, ctx) {
    // Validate the id (never trust it), check `expected` against the current value, save.
    // Throw new DevbarError(ctx.t('English message', 'Mensaje en español')) to show an error in the toolbar.
    return {warnings: []};
  },
  async undo(ctx) { return null; },    // optional: ctx.log keeps a change log in .devbar/edits/
  // drafts: {status, publish, discard} // optional, for sources with drafts
};
```

## Telling devbar where texts are

Edit mode finds the clicked text by comparing what the page shows with your saved texts. It handles headings split
into letters, templates such as `Hello, {name}`, fields shown together (first + last name) and texts saved in two
places (it asks). When that's not enough:

- **`data-devbar="<bind>"`** on an element edits that text directly. The JSON adapter binds by key (`hero.title`), the
  Sanity adapter by `<docId>:<path>` for fields and by `_key` for Portable Text blocks — handy in your block renderer:
  `<p data-devbar={block._key}>`.
- **`scope`** (adapter option): key prefix → CSS selector of where it shows, to tell apart the same text in two places.
- **`data-devbar-code`** on an element (or `<Devbar codeZones=".chart, .demo" />`) marks parts whose text lives in the
  code, such as charts or demos: clicking them offers "Request the change".

## Toolbar options

```tsx
<Devbar
  endpoint="/devbar"   // where the handler is mounted
  locale="es"          // "en" (default) or "es"
  agent="Claude"       // name in "Notify …"
  position="left"      // bottom-left instead of bottom-right
  codeZones=".chart"   // parts whose texts live in the code
  messages={{notify: 'Ping {agent}'}} // override any text
/>
```

## Other frameworks

The toolbar is a React component and the server is a standard `Request → Response` handler, so it works anywhere both
run. With Vite, Remix, Astro or Hono, mount the handler under `/devbar/*` and render `<Devbar />` in development. Pass
`endpoint` if you mount it elsewhere.

## Security

devbar can write files and CMS drafts, so the endpoints are locked down:

- They answer **only in development** (`NODE_ENV === 'development'`, override with `enabled`). Otherwise: 404.
- **Only local hosts** (127.0.0.1, localhost, [::1], *.localhost), which blocks DNS rebinding. Change with `allowedHosts`.
- Every write needs the toolbar's own header plus a **same-origin** request, so other websites open in your browser
  can't create requests or edit texts.
- Adapters never trust what the browser sends: the JSON adapter only edits the files you list, the Sanity adapter only
  the documents and fields you configure, and both refuse to overwrite a text that changed since it was opened.

Want the route out of production builds entirely? In Next.js, name it `route.dev.ts` and add `'dev.ts'` to
`pageExtensions` only for the dev server (`PHASE_DEVELOPMENT_SERVER`).

## What gets stored

Everything lives in `.devbar/` (keep it out of git; `init` does it):

| | |
| --- | --- |
| `pending/` | open requests |
| `done/` | finished (moved here by `devbar done`) |
| `discarded/` | discarded from the toolbar |
| `attachments/` | reference images |
| `notices/` | "Notify" presses (`devbar listen` consumes them) |
| `listening` | heartbeat of `devbar listen` |
| `edits/` | edit mode log (used by Undo) |

## License

MIT
