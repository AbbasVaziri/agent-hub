"use client";

import { memo, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { useI18n } from "../i18n-provider";

function CodeBlock({ children, lang }: { children: React.ReactNode; lang: string | null }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const text = extractText(children);
  return (
    <div className="relative">
      <div dir="ltr" className="flex items-center justify-between px-1 pb-1 text-[12px] text-muted">
        <span>{lang ?? "text"}</span>
        <button
          type="button"
          className="min-h-11 rounded px-2 hover:text-ink sm:min-h-7"
          onClick={() => {
            void navigator.clipboard.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? t.common.copied : t.common.copy}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

function extractText(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (node && typeof node === "object" && "props" in node) return extractText((node as { props: { children?: React.ReactNode } }).props.children);
  return "";
}

const components: Components = {
  // Raw HTML is never rendered (no rehype-raw), and react-markdown drops javascript: URLs.
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" dir="auto">
      {children}
    </a>
  ),
  pre: ({ children }) => {
    const child = Array.isArray(children) ? children[0] : children;
    const cls = (child as { props?: { className?: string } })?.props?.className ?? "";
    const lang = /language-([\w-]+)/.exec(cls)?.[1] ?? null;
    return <CodeBlock lang={lang}>{children}</CodeBlock>;
  },
  p: ({ children }) => <p dir="auto">{children}</p>,
  li: ({ children }) => <li dir="auto">{children}</li>,
  img: ({ alt }) => <span className="text-muted">[{alt || "image"}]</span>,
};

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="prose-chat">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
