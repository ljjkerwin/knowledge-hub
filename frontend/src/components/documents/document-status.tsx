import { Badge } from '@/components/ui/badge';
import { DocumentStatus } from '@/types/api.types';

const labels: Record<DocumentStatus, string> = {
  0: '草稿', 1: '已发布', 2: '已归档', 3: '待审核',
};

const styles: Record<DocumentStatus, string> = {
  0: 'bg-slate-100 text-slate-700',
  1: 'bg-emerald-100 text-emerald-700',
  2: 'bg-amber-100 text-amber-700',
  3: 'bg-blue-100 text-blue-700',
};

export function DocumentStatusBadge({ status }: { status: DocumentStatus }) {
  return <Badge className={styles[status]}>{labels[status]}</Badge>;
}

export const statusLabel = (status: DocumentStatus) => labels[status];
