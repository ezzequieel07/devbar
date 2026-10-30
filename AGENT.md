## devbar requests

This project uses [devbar](https://github.com/ezzequieel07/devbar): while the dev server runs, the site has a small toolbar
where the user marks an element, an area or a piece of text and writes what should change. Each request is a JSON file
in `.devbar/pending/`.

**When the user says "check the devbar requests" (or similar), or when `npx devbar listen` wakes you up:**

1. Run `npx devbar list` to read every open request (or read `.devbar/pending/*.json` directly).
2. For each one, run `npx devbar start <id>` (the toolbar shows "<agent> is on it"), make the change, then
   `npx devbar done <id>` (it moves to `.devbar/done/` and disappears from the toolbar's counter).
3. If a request has `images`, open them (paths are relative to `.devbar/`): they are reference screenshots.
4. When you finish, if the user wants you to keep listening, run `npx devbar listen` again in the background.

**What a request tells you:**

- `comment`: what the user wants.
- `page`: the page it was made on (path + query + hash). `viewport` and `scrollY` say what they were looking at: open
  the page at that size and scroll to see it.
- `target.kind`: `element` (one clicked element), `area` (a dragged rectangle) or `text` (selected text).
- `target.selector`, `target.tag`, `target.text`, `target.html`: the element, to find it in the code. For areas,
  `target.inside` lists the elements with text inside the rectangle. For text, `target.selectedText` is the selection.

**Listening for the "Notify" button:** run `npx devbar listen` in the background. It keeps the toolbar's
"<agent> is listening" light on and exits as soon as the user presses "Notify", printing the open requests. Do them, then
start it again. It gives up after 8 hours (`--hours` to change it).

**Edit mode:** texts the user edits from the toolbar are saved straight to the content source (a JSON file, or a draft in
the CMS) and logged in `.devbar/edits/`. Requests that come from edit mode ("Request the change") are texts that live in
the code: find them by `target.text` and change them there.
