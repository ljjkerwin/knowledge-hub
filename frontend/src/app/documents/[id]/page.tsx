import { Suspense } from "react";
import DocumentDetailClient from "./document-detail-client";

function DocumentDetailLoading() {
  return <div className="p-6 text-muted-foreground">正在加载文档…</div>;
}

async function DocumentDetail({
  params,
}: { params: PageProps<"/documents/[id]">["params"] }) {
  const { id } = await params;
  // access token 不持久化，服务端渲染阶段没有可转发的 Bearer token。
  // 由客户端恢复会话后请求受保护的文档接口。
  return <DocumentDetailClient documentId={id} />;
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
