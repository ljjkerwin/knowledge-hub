import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import DocumentDetailClient from "./document-detail-client";
import { KnowledgeDocument } from "@/types/api.types";

const apiBaseUrl = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:5002")
  .replace(/\/$/, "")
  .replace(/\/api$/, "");

async function getDocument(id: string): Promise<KnowledgeDocument> {
  const token = (await cookies()).get("kh_token")?.value;
  const response = await fetch(`${apiBaseUrl}/api/documents/${id}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    next: { revalidate: 60 },
  });

  if (response.status === 404) notFound();
  if (!response.ok) throw new Error("无法加载文档");

  const json = await response.json();
  return (json.data ?? json) as KnowledgeDocument;
}

function DocumentDetailLoading() {
  return <div className="p-6 text-muted-foreground">正在加载文档…</div>;
}

async function DocumentDetail({
  params,
}: { params: PageProps<"/documents/[id]">["params"] }) {
  const { id } = await params;
  const document = await getDocument(id);

  return <DocumentDetailClient initialDocument={document} />;
}

export default function DocumentDetailPage({
  params,
}: PageProps<"/documents/[id]">) {
  return (
    <Suspense fallback={<DocumentDetailLoading />}>
      <DocumentDetail params={params} />
    </Suspense>
  );
}
