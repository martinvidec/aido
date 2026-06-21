// Server-safe Markdown <-> Tiptap conversion (issue #214, epic #212).
//
// The MCP session tools let Claude read a todo body as Markdown and write one
// back. The web editor stores Tiptap/ProseMirror JSON, so we convert in both
// directions WITHOUT pulling in `@tiptap/react` / the DOM (`useTiptapConfig` is
// a client hook). This module is pure and runs in the Admin/server context.
//
// It emits ONLY the node/mark types the editor registers (see useTiptapConfig):
// doc, paragraph, heading, bulletList, orderedList, listItem, codeBlock,
// blockquote; marks bold, italic, strike, link, highlight. There is no inline
// `code` mark in the editor, so inline code is promoted to its own codeBlock
// (the surrounding paragraph is split). Links are filtered through linkSecurity.

import MarkdownIt from "markdown-it";
import { isSafeLinkUrl } from "./linkSecurity";
import type { TiptapContent } from "../types";

const md = new MarkdownIt({ html: false, linkify: false, breaks: false });

// --- Minimal shapes (avoids importing markdown-it's Token type name) ---

interface MdToken {
  type: string;
  tag: string;
  nesting: number;
  content: string;
  info: string;
  children: MdToken[] | null;
  attrGet(name: string): string | null;
}

type Mark = { type: string; attrs?: Record<string, unknown> };
type PMNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  text?: string;
  marks?: Mark[];
};

// Index of the token that closes the open token at `openIdx`, by balancing
// nesting (+1 open / -1 close; self-closing tokens are 0 and don't shift depth).
function matchingClose(tokens: MdToken[], openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < tokens.length; i++) {
    depth += tokens[i].nesting;
    if (depth === 0) return i;
  }
  return tokens.length - 1;
}

function uniqueMarks(stack: Mark[]): Mark[] | undefined {
  const real = stack.filter((m) => !m.type.startsWith("__"));
  if (!real.length) return undefined;
  // Keep the last occurrence of each mark type (links carry attrs).
  const byType = new Map<string, Mark>();
  for (const m of real) byType.set(m.type, m);
  return [...byType.values()].map((m) => ({ ...m }));
}

function textNode(text: string, stack: Mark[]): PMNode {
  const node: PMNode = { type: "text", text };
  const marks = uniqueMarks(stack);
  if (marks) node.marks = marks;
  return node;
}

function codeBlockNode(content: string, language: string | null): PMNode {
  const node: PMNode = { type: "codeBlock" };
  if (language) node.attrs = { language };
  const text = content.replace(/\n+$/, "");
  node.content = text ? [{ type: "text", text }] : [];
  return node;
}

// Inline emphasis/link tokens from markdown-it are strictly nested, so a simple
// push/pop stack reconstructs the active marks. (code_inline is handled by the
// callers, since it may turn into a block-level codeBlock.)
function handleInlineToken(c: MdToken, out: PMNode[], stack: Mark[]): void {
  switch (c.type) {
    case "text":
      if (c.content) out.push(textNode(c.content, stack));
      return;
    case "softbreak":
    case "hardbreak":
      // hardBreak is disabled in the editor — collapse to a space.
      out.push(textNode(" ", stack));
      return;
    case "strong_open":
      stack.push({ type: "bold" });
      return;
    case "em_open":
      stack.push({ type: "italic" });
      return;
    case "s_open":
      stack.push({ type: "strike" });
      return;
    case "link_open": {
      const href = c.attrGet("href");
      stack.push(href && isSafeLinkUrl(href) ? { type: "link", attrs: { href } } : { type: "__skip__" });
      return;
    }
    case "strong_close":
    case "em_close":
    case "s_close":
    case "link_close":
      stack.pop();
      return;
    default:
      return; // image, html_inline, … dropped
  }
}

// Inline content where code_inline degrades to plain text (used for headings,
// which cannot contain a codeBlock).
function inlineToContent(children: MdToken[] | null): PMNode[] {
  const out: PMNode[] = [];
  const stack: Mark[] = [];
  for (const c of children ?? []) {
    if (c.type === "code_inline") {
      if (c.content) out.push(textNode(c.content, stack));
      continue;
    }
    handleInlineToken(c, out, stack);
  }
  return out;
}

// Inline content for a paragraph: code_inline is promoted to its own codeBlock,
// splitting the paragraph at that point (issue #214 decision).
function inlineToBlocks(children: MdToken[] | null): PMNode[] {
  const blocks: PMNode[] = [];
  let buf: PMNode[] = [];
  const stack: Mark[] = [];
  const flush = () => {
    if (buf.length) {
      blocks.push({ type: "paragraph", content: buf });
      buf = [];
    }
  };
  for (const c of children ?? []) {
    if (c.type === "code_inline") {
      flush();
      blocks.push(codeBlockNode(c.content, null));
      continue;
    }
    handleInlineToken(c, buf, stack);
  }
  flush();
  return blocks;
}

function listItemsToNodes(tokens: MdToken[]): PMNode[] {
  const items: PMNode[] = [];
  let i = 0;
  while (i < tokens.length) {
    if (tokens[i].type === "list_item_open") {
      const close = matchingClose(tokens, i);
      let content = blockTokensToNodes(tokens.slice(i + 1, close));
      if (!content.length) content = [{ type: "paragraph" }];
      items.push({ type: "listItem", content });
      i = close + 1;
    } else {
      i += 1;
    }
  }
  return items;
}

function blockTokensToNodes(tokens: MdToken[]): PMNode[] {
  const nodes: PMNode[] = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    switch (t.type) {
      case "paragraph_open": {
        const inline = tokens[i + 1];
        const blocks = inline && inline.type === "inline" ? inlineToBlocks(inline.children) : [];
        for (const b of blocks) nodes.push(b);
        i = matchingClose(tokens, i) + 1;
        break;
      }
      case "heading_open": {
        const level = Math.min(6, Math.max(1, Number(t.tag.replace("h", "")) || 1));
        const inline = tokens[i + 1];
        const content = inline && inline.type === "inline" ? inlineToContent(inline.children) : [];
        nodes.push({ type: "heading", attrs: { level }, content });
        i = matchingClose(tokens, i) + 1;
        break;
      }
      case "fence":
      case "code_block": {
        const lang = t.type === "fence" ? (t.info || "").trim().split(/\s+/)[0] || null : null;
        nodes.push(codeBlockNode(t.content, lang));
        i += 1;
        break;
      }
      case "bullet_list_open":
      case "ordered_list_open": {
        const close = matchingClose(tokens, i);
        const items = listItemsToNodes(tokens.slice(i + 1, close));
        nodes.push({
          type: t.type === "bullet_list_open" ? "bulletList" : "orderedList",
          content: items,
        });
        i = close + 1;
        break;
      }
      case "blockquote_open": {
        const close = matchingClose(tokens, i);
        nodes.push({ type: "blockquote", content: blockTokensToNodes(tokens.slice(i + 1, close)) });
        i = close + 1;
        break;
      }
      default:
        // horizontalRule (disabled), html_block, … are dropped.
        i += 1;
    }
  }
  return nodes;
}

/**
 * Parse Markdown into a Tiptap document, or null when empty. Only the editor's
 * registered node/mark types are produced; inline code becomes a codeBlock and
 * unsafe link URLs are stripped to plain text.
 */
export function markdownToTiptap(input: string | null | undefined): TiptapContent | null {
  const src = (input ?? "").replace(/\r\n/g, "\n").trim();
  if (!src) return null;
  const tokens = md.parse(src, {}) as unknown as MdToken[];
  const content = blockTokensToNodes(tokens);
  if (!content.length) return null;
  return { type: "doc", content } as TiptapContent;
}

// --- Tiptap -> Markdown (for reading a body back to the agent) ---

function applyMarks(text: string, marks: Mark[] | undefined): string {
  if (!marks?.length) return text;
  let s = text;
  for (const m of marks) {
    if (m.type === "bold") s = `**${s}**`;
    else if (m.type === "italic") s = `*${s}*`;
    else if (m.type === "strike") s = `~~${s}~~`;
    else if (m.type === "link") s = `[${s}](${String(m.attrs?.href ?? "")})`;
  }
  return s;
}

function inlineToMd(content: PMNode[] | undefined): string {
  if (!content?.length) return "";
  return content
    .map((n) => {
      if (n.type === "text") return applyMarks(n.text ?? "", n.marks);
      if (n.type === "mention") return `@${String(n.attrs?.label ?? n.attrs?.id ?? "")}`;
      if (n.type === "hardBreak") return " ";
      return "";
    })
    .join("");
}

function codeText(node: PMNode): string {
  return (node.content ?? []).map((c) => c.text ?? "").join("");
}

function blockToMd(node: PMNode): string {
  switch (node.type) {
    case "paragraph":
      return inlineToMd(node.content);
    case "heading": {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level ?? 1)));
      return `${"#".repeat(level)} ${inlineToMd(node.content)}`;
    }
    case "codeBlock": {
      const lang = node.attrs?.language ? String(node.attrs.language) : "";
      return `\`\`\`${lang}\n${codeText(node)}\n\`\`\``;
    }
    case "bulletList":
      return (node.content ?? [])
        .map((li) => `- ${inlineToMd((li.content ?? [])[0]?.content)}`)
        .join("\n");
    case "orderedList":
      return (node.content ?? [])
        .map((li, idx) => `${idx + 1}. ${inlineToMd((li.content ?? [])[0]?.content)}`)
        .join("\n");
    case "blockquote":
      return (node.content ?? [])
        .map((b) => `> ${blockToMd(b)}`)
        .join("\n");
    default:
      return "";
  }
}

/** Serialize a Tiptap document to Markdown (best-effort, for the agent to read). */
export function tiptapToMarkdown(doc: TiptapContent | null | undefined): string {
  const d = doc as PMNode | null | undefined;
  if (!d || !Array.isArray(d.content)) return "";
  return d.content
    .map((n) => blockToMd(n))
    .filter((s) => s !== "")
    .join("\n\n")
    .trim();
}

function formatStamp(at: Date | undefined): string {
  if (!(at instanceof Date) || Number.isNaN(at.getTime())) return "";
  return at.toISOString().slice(0, 16).replace("T", " ");
}

/**
 * Append an answer (Markdown) to an existing body, preserving the original and
 * prefixing a "von aido" marker block. Used by update-todo in append mode.
 */
export function appendAnswer(
  existing: TiptapContent | null | undefined,
  answerMarkdown: string,
  opts: { at?: Date; label?: string } = {}
): TiptapContent {
  const answer = markdownToTiptap(answerMarkdown);
  const answerBlocks = (answer as PMNode | null)?.content ?? [];
  const stamp = formatStamp(opts.at);
  const label = opts.label ?? "Antwort von aido";
  const marker: PMNode = {
    type: "paragraph",
    content: [{ type: "text", text: `💬 ${label}${stamp ? ` · ${stamp}` : ""}`, marks: [{ type: "bold" }] }],
  };
  const base = (existing as PMNode | null)?.content ?? [];
  const content = [...base, marker, ...answerBlocks];
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] } as TiptapContent;
}
