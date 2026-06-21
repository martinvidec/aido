// Unit tests for the Markdown <-> Tiptap module (issue #214, epic #212).
// Run via: npm run test:markdown  (no emulator needed)
import { markdownToTiptap, tiptapToMarkdown, appendAnswer } from "../src/lib/tiptap/markdown";

let failures = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures++;
    console.error(`  ✗ ${name}\n    ${(e as Error).message}`);
  }
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

type N = { type: string; attrs?: Record<string, unknown>; content?: N[]; text?: string; marks?: { type: string; attrs?: Record<string, unknown> }[] };

function findNode(node: N | null | undefined, type: string): N | null {
  if (!node) return null;
  if (node.type === type) return node;
  for (const c of node.content ?? []) {
    const r = findNode(c, type);
    if (r) return r;
  }
  return null;
}
function collectTypes(node: N | null | undefined, nodeTypes: Set<string>, markTypes: Set<string>): void {
  if (!node) return;
  nodeTypes.add(node.type);
  for (const m of node.marks ?? []) markTypes.add(m.type);
  for (const c of node.content ?? []) collectTypes(c, nodeTypes, markTypes);
}
function allText(node: N | null | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.text ?? "";
  return (node.content ?? []).map(allText).join("");
}

const ALLOWED_NODES = new Set([
  "doc", "paragraph", "heading", "bulletList", "orderedList", "listItem", "codeBlock", "blockquote", "text",
]);
const ALLOWED_MARKS = new Set(["bold", "italic", "strike", "link", "highlight"]);

console.log("markdownToTiptap:");

check("heading with level", () => {
  const doc = markdownToTiptap("# Title") as N;
  const h = findNode(doc, "heading");
  assert(h, "no heading");
  assert(h!.attrs?.level === 1, `level was ${h!.attrs?.level}`);
  assert(allText(h) === "Title", `text was '${allText(h)}'`);
});

check("bold / italic / strike marks", () => {
  const doc = markdownToTiptap("**b** *i* ~~s~~") as N;
  const marks = new Set<string>();
  collectTypes(doc, new Set(), marks);
  assert(marks.has("bold") && marks.has("italic") && marks.has("strike"), `marks: ${[...marks]}`);
});

check("fenced code block keeps language + content", () => {
  const doc = markdownToTiptap("```ts\nconst x = 1\n```") as N;
  const cb = findNode(doc, "codeBlock");
  assert(cb, "no codeBlock");
  assert(cb!.attrs?.language === "ts", `language was ${cb!.attrs?.language}`);
  assert(allText(cb) === "const x = 1", `code was '${allText(cb)}'`);
});

check("inline code is promoted to a codeBlock", () => {
  const doc = markdownToTiptap("Run `npm run build` first") as N;
  const cb = findNode(doc, "codeBlock");
  assert(cb, "inline code did not become a codeBlock");
  assert(allText(cb) === "npm run build", `code was '${allText(cb)}'`);
  // The surrounding prose survives as paragraphs.
  assert(allText(doc).includes("Run"), "lost surrounding text");
});

check("bullet + ordered lists", () => {
  const b = markdownToTiptap("- a\n- b") as N;
  const bl = findNode(b, "bulletList");
  assert(bl && (bl.content ?? []).length === 2, "bulletList should have 2 items");
  const o = markdownToTiptap("1. a\n2. b") as N;
  const ol = findNode(o, "orderedList");
  assert(ol && (ol.content ?? []).length === 2, "orderedList should have 2 items");
});

check("safe link becomes a link mark", () => {
  const doc = markdownToTiptap("[x](https://example.com)") as N;
  const txt = findNode(doc, "text");
  const link = txt?.marks?.find((m) => m.type === "link");
  assert(link, "no link mark");
  assert(link!.attrs?.href === "https://example.com", `href was ${link!.attrs?.href}`);
});

check("unsafe link is stripped to plain text", () => {
  const doc = markdownToTiptap("[x](javascript:alert(1))") as N;
  const marks = new Set<string>();
  collectTypes(doc, new Set(), marks);
  assert(!marks.has("link"), "javascript: link must not produce a link mark");
  assert(allText(doc).includes("x"), "link text should survive");
});

check("blockquote", () => {
  const doc = markdownToTiptap("> quote") as N;
  assert(findNode(doc, "blockquote"), "no blockquote");
});

check("empty input -> null", () => {
  assert(markdownToTiptap("") === null, "empty should be null");
  assert(markdownToTiptap("   \n  ") === null, "whitespace should be null");
});

check("only allowed node/mark types are emitted", () => {
  const doc = markdownToTiptap(
    "# H\n\ntext **b** [l](https://e.com) `c`\n\n- one\n- two\n\n> q\n\n```js\nx\n```"
  ) as N;
  const nodes = new Set<string>();
  const marks = new Set<string>();
  collectTypes(doc, nodes, marks);
  for (const t of nodes) assert(ALLOWED_NODES.has(t), `disallowed node type: ${t}`);
  for (const t of marks) assert(ALLOWED_MARKS.has(t), `disallowed mark type: ${t}`);
});

console.log("tiptapToMarkdown:");

check("round-trips headings and bold", () => {
  const doc = markdownToTiptap("# H\n\nsome **b** text");
  const out = tiptapToMarkdown(doc);
  assert(out.includes("# H"), `missing heading: ${out}`);
  assert(out.includes("**b**"), `missing bold: ${out}`);
});

check("serializes a code block fence", () => {
  const doc = markdownToTiptap("```ts\nconst x = 1\n```");
  const out = tiptapToMarkdown(doc);
  assert(out.includes("```ts") && out.includes("const x = 1"), `bad fence: ${out}`);
});

console.log("appendAnswer:");

check("preserves original, adds marker + answer", () => {
  const existing = markdownToTiptap("Was ist 2+2?");
  const result = appendAnswer(existing, "Die Antwort ist `4`.", { at: new Date("2026-06-21T10:00:00Z") }) as N;
  const text = allText(result);
  assert(text.includes("Was ist 2+2?"), "lost the original question");
  assert(text.includes("Antwort von aido"), "missing aido marker");
  // The answer's inline code became a codeBlock containing "4".
  const cbs = (result.content ?? []).filter((n) => n.type === "codeBlock");
  assert(cbs.some((cb) => allText(cb) === "4"), "answer code block missing");
});

check("append onto an empty body still works", () => {
  const result = appendAnswer(null, "Hallo", {}) as N;
  assert(allText(result).includes("Hallo"), "answer missing");
  assert(allText(result).includes("Antwort von aido"), "marker missing");
});

if (failures > 0) {
  console.error(`\n${failures} markdown test(s) failed`);
  process.exit(1);
}
console.log("\nAll markdown tests passed");
