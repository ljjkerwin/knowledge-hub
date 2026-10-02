import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Citation } from "@/types/api.types";

interface MarkdownContentProps {
  content: string;
  className?: string;
  citations?: Citation[];
  showCursor?: boolean;
}

interface MarkdownNode {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: MarkdownNode[];
}

interface CitationTarget {
  href: string;
  title: string;
}

export function MarkdownContent({
  content,
  className,
  citations = [],
  showCursor = false,
}: MarkdownContentProps) {
  const citationLinksPlugin = createCitationLinksPlugin(citations);
  const streamingCursorPlugin = createStreamingCursorPlugin(showCursor);

  return (
    <div className={`text-sm leading-6 break-words ${className ?? ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[citationLinksPlugin, streamingCursorPlugin]}
        components={{
          h1: ({ children }) => (
            <h1 className="mb-3 text-xl font-bold">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="mb-2 mt-4 text-lg font-semibold">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="mb-2 mt-3 font-semibold">{children}</h3>
          ),
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          ul: ({ children }) => (
            <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">
              {children}
            </ol>
          ),
          li: ({ children }) => <li>{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-current/30 pl-3 italic opacity-90">
              {children}
            </blockquote>
          ),
          a: ({ href, children, title }) => {
            const isCitation = /^\[\d+\]$/.test(String(children));
            return (
              <a
                href={href}
                title={title}
                target="_blank"
                rel="noopener noreferrer"
                className={
                  isCitation
                    ? "mx-0.5 inline-flex align-super text-[0.75em] font-semibold leading-none text-primary no-underline hover:underline"
                    : "underline underline-offset-2 hover:opacity-80"
                }
              >
                {children}
              </a>
            );
          },
          pre: ({ children }) => (
            <pre className="my-2 overflow-x-auto rounded-md bg-black/10 p-3 text-xs leading-5 last:mb-0">
              {children}
            </pre>
          ),
          code: ({ className, children }) => (
            <code
              className={
                className ?? "rounded bg-black/10 px-1 py-0.5 text-[0.85em]"
              }
            >
              {children}
            </code>
          ),
          hr: () => <hr className="my-3 border-current/20" />,
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-current/20 px-2 py-1 font-semibold">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-current/20 px-2 py-1">{children}</td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function createStreamingCursorPlugin(enabled: boolean) {
  return () => (tree: unknown) => {
    if (enabled) appendStreamingCursor(tree as MarkdownNode);
  };
}

/** 将生成光标插入最后一段可见内容中，避免它落到 Markdown 块元素的下一行。 */
function appendStreamingCursor(node: MarkdownNode): boolean {
  if (!node.children?.length) return false;

  for (let index = node.children.length - 1; index >= 0; index -= 1) {
    const child = node.children[index];

    if (child.type === "text" && child.value?.trim()) {
      node.children.splice(index + 1, 0, createStreamingCursorNode());
      return true;
    }

    if (child.type !== "element") continue;

    // 光标放在链接和代码之后，不能成为链接或代码内容的一部分。
    if (["a", "code", "pre"].includes(child.tagName ?? "")) {
      if (!hasVisibleText(child)) continue;
      node.children.splice(index + 1, 0, createStreamingCursorNode());
      return true;
    }

    if (appendStreamingCursor(child)) return true;
  }

  return false;
}

function hasVisibleText(node: MarkdownNode): boolean {
  if (node.type === "text") return Boolean(node.value?.trim());
  return node.children?.some(hasVisibleText) ?? false;
}

function createStreamingCursorNode(): MarkdownNode {
  return {
    type: "element",
    tagName: "span",
    properties: {
      className: [
        "ml-0.5",
        "inline-block",
        "h-4",
        "w-2",
        "animate-pulse",
        "motion-reduce:animate-none",
        "bg-primary",
        "relative",
        "top-1",
        "align-baseline",
      ],
      ariaHidden: "true",
    },
    children: [],
  };
}

function createCitationLinksPlugin(citations: Citation[]) {
  const targets = new Map<number, CitationTarget>();
  citations.forEach((citation, position) => {
    const index = citation.index || position + 1;
    const fileName = citation.originalFileName || citation.documentTitle;
    const isWebSource =
      citation.sourceType === "web" && Boolean(citation.sourceUrl);
    targets.set(index, {
      href: isWebSource
        ? citation.sourceUrl!
        : `/documents/${citation.documentId}?citation=${encodeURIComponent(citation.chunkId)}`,
      title: `打开引用 [${index}]：${fileName}`,
    });
  });

  return () => (tree: unknown) => {
    transformCitationText(tree as MarkdownNode, targets);
  };
}

function transformCitationText(
  node: MarkdownNode,
  targets: ReadonlyMap<number, CitationTarget>,
): void {
  if (!node.children?.length) return;
  if (
    node.type === "element" &&
    ["a", "code", "pre"].includes(node.tagName ?? "")
  ) {
    return;
  }

  node.children = node.children.flatMap((child) => {
    if (child.type !== "text" || !child.value) {
      transformCitationText(child, targets);
      return child;
    }
    return splitCitationText(child.value, targets);
  });
}

function splitCitationText(
  value: string,
  targets: ReadonlyMap<number, CitationTarget>,
): MarkdownNode[] {
  const nodes: MarkdownNode[] = [];
  const citationPattern = /\[(\d+)\]/g;
  let cursor = 0;

  for (const match of value.matchAll(citationPattern)) {
    const matchIndex = match.index;
    const citationIndex = Number(match[1]);
    const target = targets.get(citationIndex);
    if (!target) continue;

    if (matchIndex > cursor) {
      nodes.push({ type: "text", value: value.slice(cursor, matchIndex) });
    }
    nodes.push({
      type: "element",
      tagName: "a",
      properties: { href: target.href, title: target.title },
      children: [{ type: "text", value: match[0] }],
    });
    cursor = matchIndex + match[0].length;
  }

  if (cursor === 0) return [{ type: "text", value }];
  if (cursor < value.length) {
    nodes.push({ type: "text", value: value.slice(cursor) });
  }
  return nodes;
}
