// Ticket descriptions and comments are written by requesters and arrive as
// HTML. Only a short list of formatting tags is let through; everything else
// (scripts, styles, event handlers, embedded content) is dropped.

const KEEP = new Set([
  'P', 'BR', 'HR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'DEL', 'INS', 'SUB', 'SUP', 'CODE', 'PRE', 'TT', 'BLOCKQUOTE',
  'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'A', 'SPAN', 'DIV',
]);
// Removed together with everything inside them.
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'LINK', 'META', 'SVG', 'MATH', 'TEMPLATE', 'NOSCRIPT']);

function clean(from: Node, into: Node, doc: Document) {
  from.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      into.appendChild(doc.createTextNode(node.textContent ?? ''));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    const tag = el.tagName.toUpperCase();
    if (DROP.has(tag)) return;
    if (tag === 'IMG') {
      // Images need a Jira sign-in to load, so only their presence is shown.
      const note = doc.createElement('span');
      note.className = 'attachment-note';
      note.textContent = el.getAttribute('alt') ? `[이미지: ${el.getAttribute('alt')}]` : '[이미지]';
      into.appendChild(note);
      return;
    }
    if (!KEEP.has(tag)) {
      clean(el, into, doc); // unknown wrapper: keep its text, drop the tag
      return;
    }
    const out = doc.createElement(tag.toLowerCase());
    if (tag === 'A') {
      const href = el.getAttribute('href') ?? '';
      if (/^https?:\/\//i.test(href)) out.setAttribute('data-href', href); // opened by the app, never navigated
    }
    for (const name of ['colspan', 'rowspan']) {
      const v = el.getAttribute(name);
      if (v && /^\d{1,3}$/.test(v)) out.setAttribute(name, v);
    }
    clean(el, out, doc);
    into.appendChild(out);
  });
}

/** Returns a safe copy of untrusted HTML as a document fragment. */
export function sanitize(html: string): DocumentFragment {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const out = document.createDocumentFragment();
  clean(parsed.body, out, document);
  return out;
}
