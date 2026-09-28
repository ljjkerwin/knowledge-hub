"use client";

import Link from "next/link";
import { FormEvent, Fragment, useState } from "react";
import { FileSearch, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { documentService } from "@/services/document.service";
import { FullTextSearchResult } from "@/types/api.types";

const highlightedText = (text?: string) => {
  if (!text) return null;
  return text.split(/(<mark>|<\/mark>)/g).map((part, index, parts) => {
    if (part === "<mark>" || part === "</mark>") return null;
    const marked = parts[index - 1] === "<mark>";
    return marked ? (
      <mark
        key={index}
        className="rounded bg-yellow-200 px-0.5 text-inherit dark:bg-yellow-500/40"
      >
        {part}
      </mark>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    );
  });
};

const resultExcerpt = (result: FullTextSearchResult) =>
  result.highlights.content?.join(" … ") ||
  result.highlights.summary?.join(" … ") ||
  result.content?.slice(0, 220) ||
  result.summary ||
  "正文暂无可展示的摘要";

export default function FullTextSearchPage() {
  const [keyword, setKeyword] = useState("");
  const [items, setItems] = useState<FullTextSearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const search = async (nextPage = 1) => {
    const value = keyword.trim();
    if (!value) return;
    setLoading(true);
    setError("");
    try {
      const result = await documentService.search({
        keyword: value,
        page: nextPage,
        pageSize,
      });
      setItems(result.items);
      setTotal(result.total);
      setPage(result.page);
      setSearched(true);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "搜索失败，请稍后重试",
      );
    } finally {
      setLoading(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void search(1);
  };
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex h-full flex-col overflow-auto">
      <header className="border-b px-6 py-5">
        <div className="flex items-center gap-2">
          <FileSearch className="size-5 text-primary" />
          <h1 className="text-2xl font-semibold">全文搜索</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          在已发布且你有权访问的知识文档中搜索关键词
        </p>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 p-6">
        <form onSubmit={submit} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
            <Input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              className="pl-9"
              placeholder="输入标题、摘要或正文关键词"
            />
          </div>
          <Button disabled={loading || !keyword.trim()} type="submit">
            {loading ? <Loader2 className="animate-spin" /> : <Search />}搜索
          </Button>
        </form>
        {error && (
          <div className="mt-4 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}
        {loading && (
          <div className="flex justify-center p-14">
            <Loader2 className="animate-spin text-muted-foreground" />
          </div>
        )}
        {!loading && searched && (
          <section className="mt-6">
            <p className="mb-3 text-sm text-muted-foreground">
              找到 {total} 条结果
            </p>
            {items.length === 0 ? (
              <div className="rounded-xl border p-12 text-center text-sm text-muted-foreground">
                没有匹配的文档
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border bg-card">
                {items.map((result) => (
                  <Link
                    key={result.id}
                    href={`/documents/${result.id}`}
                    className="block border-b px-5 py-4 transition-colors last:border-0 hover:bg-muted/50"
                  >
                    <h2 className="font-medium text-primary">
                      {highlightedText(
                        result.highlights.title?.[0] || result.title,
                      )}
                    </h2>
                    <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground">
                      {highlightedText(resultExcerpt(result))}
                    </p>
                    <div className="mt-3 flex gap-3 text-xs text-muted-foreground">
                      <span>{result.tags || "未设置标签"}</span>
                      {result.publishTime && (
                        <span>
                          {new Date(result.publishTime).toLocaleDateString(
                            "zh-CN",
                          )}
                        </span>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            )}
            {total > pageSize && (
              <div className="mt-4 flex items-center justify-end gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={loading || page <= 1}
                  onClick={() => void search(page - 1)}
                >
                  上一页
                </Button>
                <span className="text-sm text-muted-foreground">
                  {page} / {pages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={loading || page >= pages}
                  onClick={() => void search(page + 1)}
                >
                  下一页
                </Button>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
