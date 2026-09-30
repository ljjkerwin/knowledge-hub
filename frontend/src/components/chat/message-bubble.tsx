"use client";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { Citation } from "@/types/api.types";
import {
  getMessageCitations,
  getMessageStatus,
  getMessageText,
  type KnowledgeUIMessage,
} from "@/types/chat.types";
import {
  User,
  Bot,
  File,
  FileArchive,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  Loader2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { MarkdownContent } from "./markdown-content";
import Link from "next/link";

interface MessageBubbleProps {
  message: KnowledgeUIMessage;
  isStreaming?: boolean;
}

export function MessageBubble({ message, isStreaming = false }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const content = getMessageText(message);
  const citations = getMessageCitations(message);
  const status = getMessageStatus(message);

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      <Avatar className="h-8 w-8">
        <AvatarFallback className={isUser ? "bg-[#d4daff]" : ""}>
          {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
        </AvatarFallback>
      </Avatar>

      <div
        className={`flex flex-col gap-2 max-w-[80%] ${isUser ? "items-end" : "items-start"}`}
      >
        {isStreaming && status && (
          <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span className="italic">{status}</span>
          </div>
        )}

        {content && (
          <div
            className={`rounded-xl px-3 py-2 ring-1 ring-foreground/10 ${
              isUser ? "bg-primary text-primary-foreground" : "bg-card"
            }`}
          >
            <MarkdownContent content={content} />
            {isStreaming && !isUser && (
              <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-primary" />
            )}
          </div>
        )}

        {citations.length > 0 && (
          <div className="flex w-full flex-wrap gap-2">
            {citations.map((citation, index) => (
              <CitationBadge
                key={index}
                citation={citation}
                index={index + 1}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CitationBadge({
  citation,
  index,
}: {
  citation: Citation;
  index: number;
}) {
  const fileName = citation.originalFileName || citation.documentTitle;
  const { Icon, iconClassName } = getFilePresentation(fileName);

  return (
    <Link
      href={`/documents/${citation.documentId}?citation=${encodeURIComponent(citation.chunkId)}`}
      target="_blank"
      rel="noopener noreferrer"
      title={`打开阅读页：${fileName}`}
      className="group flex min-w-0 max-w-full items-center gap-2 rounded-lg border bg-card px-2.5 py-2 text-left shadow-sm transition-colors hover:bg-muted/60"
    >
      <span className={`flex size-8 shrink-0 items-center justify-center rounded-md ${iconClassName}`}>
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium text-foreground group-hover:text-primary">
          [{index}] {fileName}
        </span>
        <span className="block text-[11px] text-muted-foreground">
          {formatFileSize(citation.fileSize)}
        </span>
      </span>
    </Link>
  );
}

function getFilePresentation(fileName: string): {
  Icon: LucideIcon;
  iconClassName: string;
} {
  const extension = fileName.split(".").pop()?.toLowerCase();

  if (["xlsx", "xls", "csv", "tsv"].includes(extension ?? "")) {
    return { Icon: FileSpreadsheet, iconClassName: "bg-emerald-100 text-emerald-700" };
  }
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"].includes(extension ?? "")) {
    return { Icon: FileImage, iconClassName: "bg-violet-100 text-violet-700" };
  }
  if (["zip", "rar", "7z", "tar", "gz"].includes(extension ?? "")) {
    return { Icon: FileArchive, iconClassName: "bg-amber-100 text-amber-700" };
  }
  if (["json", "xml", "html", "css", "js", "ts", "tsx", "jsx", "py", "java", "sql", "md"].includes(extension ?? "")) {
    return { Icon: FileCode2, iconClassName: "bg-sky-100 text-sky-700" };
  }
  if (["pdf", "doc", "docx", "ppt", "pptx", "txt", "rtf"].includes(extension ?? "")) {
    return { Icon: FileText, iconClassName: "bg-rose-100 text-rose-700" };
  }
  return { Icon: File, iconClassName: "bg-slate-100 text-slate-700" };
}

function formatFileSize(fileSize?: string | number | null): string {
  const bytes = typeof fileSize === "string" ? Number(fileSize) : fileSize;
  if (!Number.isFinite(bytes) || bytes == null || bytes < 0) return "大小未知";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
