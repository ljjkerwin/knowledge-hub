"use client";

import { Suspense, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Archive,
  ArrowLeft,
  CalendarDays,
  Clock3,
  FileText,
  FileType2,
  FolderTree,
  Globe2,
  Hash,
  LockKeyhole,
  Edit,
  Eye,
  Loader2,
  MessageCircle,
  Star,
  Send,
  Tag,
  Upload,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { documentService } from "@/services/document.service";
import { KnowledgeDocument, ReviewTask } from "@/types/api.types";
import {
  DocumentStatusBadge,
} from "@/components/documents/document-status";
import { useAuthStore } from "@/stores/auth.store";
import { DocumentKnowledgeGraphDialog } from "@/components/documents/document-knowledge-graph-dialog";

interface DocumentDetailClientProps {
  documentId: string;
}

function InfoRow({
  icon: Icon,
  label,
  value,
  valueIcon: ValueIcon,
  mono = false,
  title,
  children,
}: {
  icon: LucideIcon;
  label: string;
  value?: string;
  valueIcon?: LucideIcon;
  mono?: boolean;
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[18px_minmax(0,1fr)] gap-x-2.5">
      <Icon className="mt-0.5 size-4 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd
          className={`mt-1 flex min-w-0 items-center gap-1 text-sm ${mono ? "truncate font-mono text-xs" : ""}`}
          title={title}
        >
          {ValueIcon && <ValueIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
          {children || <span className="truncate">{value}</span>}
        </dd>
      </div>
    </div>
  );
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "未知" : date.toLocaleString("zh-CN");
}

function fileExtension(fileName: string): string {
  const extension = fileName.split(".").pop();
  return extension && extension !== fileName ? extension.toUpperCase() : "未知";
}

function formatFileSize(fileSize?: string | null): string {
  const bytes = Number(fileSize);
  if (!Number.isFinite(bytes) || bytes < 0) return "未知";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export default function DocumentDetailClient({
  documentId,
}: DocumentDetailClientProps) {
  return (
    <Suspense fallback={null}>
      <DocumentDetailPageContent
        key={documentId}
        documentId={documentId}
      />
    </Suspense>
  );
}

function DocumentDetailPageContent({
  documentId,
}: DocumentDetailClientProps) {
  // console.log('clent render DocumentDetailPageContent')
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loadFromStorage } = useAuthStore();
  const [doc, setDoc] = useState<KnowledgeDocument | null>(null);
  const [history, setHistory] = useState<ReviewTask[]>([]);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const canManage = (document: KnowledgeDocument) =>
    Boolean(
      user &&
      (user.roles.includes("ROLE_ADMIN") ||
        document.authorId === user.id ||
        document.createBy === user.id),
    );
  const citationChunkId = searchParams.get("citation");
  useEffect(() => {
    let cancelled = false;
    void loadFromStorage().then(async (authed) => {
      if (!authed) {
        router.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      try {
        const loaded = await documentService.get(documentId);
        if (!cancelled) setDoc(loaded);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "无法加载文档");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [documentId, loadFromStorage, router]);
  useEffect(() => {
    const manageable = Boolean(
      doc &&
      user &&
      (user.roles.includes("ROLE_ADMIN") || doc.authorId === user.id || doc.createBy === user.id),
    );
    if (!doc || !manageable) return;
    let cancelled = false;
    void documentService
      .reviewHistory(doc.id)
      .then((items) => {
        if (!cancelled) setHistory(items);
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "无法加载审核记录");
      });
    return () => {
      cancelled = true;
    };
  }, [doc, user]);
  const action = async (
    name: "publish" | "archive" | "saveDraft" | "submitReview",
  ) => {
    if (!doc) return;
    setRunning(true);
    try {
      setDoc(await documentService[name](doc.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setRunning(false);
    }
  };
  if (error && !doc) return <div className="p-6 text-destructive">{error}</div>;
  if (!doc)
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="animate-spin" />
      </div>
    );
  const editable = canManage(doc);
  const graphLink = <DocumentKnowledgeGraphDialog documentId={doc.id} />;
  return (
    <div className="h-full overflow-auto">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-background/95 px-6 py-4 backdrop-blur">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push("/documents")}
          >
            <ArrowLeft />
          </Button>
          <DocumentStatusBadge status={doc.status} />
        </div>
        <div className="flex gap-2">
          {graphLink}
          {editable && (
            <>
              <Button
                nativeButton={false}
                variant="outline"
                render={
                  <Link href={`/documents/${doc.id}/edit`}>
                    <Edit />
                    编辑
                  </Link>
                }
                disabled={doc.status === 3}
              />
              {doc.status === 0 && (
                <Button
                  onClick={() => void action("publish")}
                  disabled={running}
                >
                  <Send />
                  发布 / 提审
                </Button>
              )}
              {doc.status === 1 && (
                <>
                  <Button
                    variant="outline"
                    onClick={() => void action("saveDraft")}
                    disabled={running}
                  >
                    <Upload />
                    下架
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void action("archive")}
                    disabled={running}
                  >
                    <Archive />
                    归档
                  </Button>
                  <Button
                    onClick={() => void action("submitReview")}
                    disabled={running}
                  >
                    <Send />
                    提交审核
                  </Button>
                </>
              )}
              {doc.status === 2 && (
                <Button
                  onClick={() => void action("publish")}
                  disabled={running}
                >
                  <Send />
                  重新发布
                </Button>
              )}
            </>
          )}
        </div>
      </header>
      <div className="mx-auto grid max-w-6xl gap-8 px-8 py-10 lg:grid-cols-[minmax(0,1fr)_290px]">
        <article className="min-w-0">
          <div className="mb-8 border-b pb-7">
            <h1 className="text-3xl font-bold tracking-tight">{doc.title}</h1>
            <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <span>{new Date(doc.createdAt).toLocaleString("zh-CN")}</span>
              <span className="flex items-center gap-1">
                <Eye className="size-4" />
                {doc.viewCount} 次浏览
              </span>
              {doc.tags
                ?.split(",")
                .filter(Boolean)
                .map((tag) => (
                  <span className="rounded-full bg-muted px-2 py-0.5" key={tag}>
                    {tag.trim()}
                  </span>
                ))}
            </div>
            {doc.summary && (
              <p className="mt-5 rounded-r-lg border-l-4 border-primary/50 bg-muted/50 px-4 py-3 text-muted-foreground">
                {doc.summary}
              </p>
            )}
          </div>
          {citationChunkId && (
            <section className="mb-6 rounded-lg border-l-4 border-primary bg-primary/5 px-4 py-3">
              <p className="text-sm text-muted-foreground">
                此文档是当前 AI 回答的引用来源。
              </p>
            </section>
          )}
          <div>
            <div className="prose prose-slate max-w-none dark:prose-invert">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {doc.content || ""}
              </ReactMarkdown>
            </div>
          </div>
        </article>
        <aside className="h-fit rounded-xl border bg-card p-5">
          <h2 className="font-semibold">文档信息</h2>
          <dl className="mt-4 space-y-4 text-sm">
            <InfoRow icon={FileText} label="状态">
              <DocumentStatusBadge status={doc.status} />
            </InfoRow>
            <InfoRow icon={Hash} label="文档 ID" value={doc.id} mono />
            <InfoRow
              icon={FileText}
              label="来源"
              value={doc.originalFileName || "在线编辑文档"}
              title={doc.originalFileName || undefined}
            />
            {doc.originalFileName && (
              <>
                <InfoRow icon={FileType2} label="文件格式" value={fileExtension(doc.originalFileName)} />
                <InfoRow icon={Upload} label="文件大小" value={formatFileSize(doc.fileSize)} />
              </>
            )}
            <InfoRow
              icon={Globe2}
              label="访问范围"
              value={doc.isPublic ? "全员可见" : "仅受权限控制"}
              valueIcon={doc.isPublic ? Globe2 : LockKeyhole}
            />
            <InfoRow
              icon={FileText}
              label="字数"
              value={`${(doc.wordCount || doc.content?.length || 0).toLocaleString()} 字`}
            />
            <InfoRow icon={Eye} label="浏览次数" value={`${doc.viewCount ?? 0} 次`} />
            <InfoRow icon={Star} label="收藏 / 点赞" value={`${doc.favouriteCount ?? 0} / ${doc.likeCount ?? 0}`} />
            <InfoRow icon={MessageCircle} label="评论" value={`${doc.commentCount ?? 0} 条`} />
            <InfoRow icon={CalendarDays} label="创建时间" value={formatDateTime(doc.createdAt)} />
            <InfoRow icon={Clock3} label="最近更新" value={formatDateTime(doc.updatedAt)} />
            {doc.publishTime && <InfoRow icon={Upload} label="发布时间" value={formatDateTime(doc.publishTime)} />}
            {doc.categoryId && <InfoRow icon={FolderTree} label="分类 ID" value={doc.categoryId} mono />}
            {doc.teamId && <InfoRow icon={FolderTree} label="团队 ID" value={doc.teamId} mono />}
          </dl>
          {doc.tags && (
            <section className="mt-5 border-t pt-4">
              <h3 className="flex items-center gap-2 text-sm font-medium"><Tag className="size-4 text-muted-foreground" />标签</h3>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {doc.tags.split(",").map((tag) => tag.trim()).filter(Boolean).map((tag) => (
                  <span key={tag} className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">{tag}</span>
                ))}
              </div>
            </section>
          )}
          {doc.remark && (
            <section className="mt-5 border-t pt-4">
              <h3 className="text-sm font-medium">备注</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{doc.remark}</p>
            </section>
          )}
          {editable && history.length > 0 && (
            <>
              <h2 className="mt-7 border-t pt-5 font-semibold">审核记录</h2>
              <ol className="mt-4 space-y-4 border-l pl-4">
                {history.map((item) => (
                  <li
                    key={item.id}
                    className="relative text-sm before:absolute before:-left-[21px] before:top-1 before:size-2 before:rounded-full before:bg-primary"
                  >
                    <p>
                      {item.reviewResult === 1
                        ? "审核通过"
                        : item.reviewResult === 2
                          ? "审核驳回"
                          : "等待审核"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {new Date(item.createdAt).toLocaleString("zh-CN")}
                    </p>
                    {item.reviewComment && (
                      <p className="mt-1 text-muted-foreground">
                        {item.reviewComment}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            </>
          )}
        </aside>
      </div>
      {error && (
        <div className="fixed right-4 bottom-4 rounded-lg bg-destructive px-4 py-3 text-sm text-destructive-foreground">
          {error}
        </div>
      )}
    </div>
  );
}
