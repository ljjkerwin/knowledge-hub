import type {
  AgentWorkflow,
  AgentWorkflowRound,
} from '@/types/chat.types';
import {
  Check,
  ChevronRight,
  Circle,
  Database,
  Globe2,
  Loader2,
  Search,
  Sparkles,
} from 'lucide-react';
import type { ReactNode } from 'react';

interface WorkflowProgressProps {
  workflow: AgentWorkflow;
}

export function WorkflowProgress({ workflow }: WorkflowProgressProps) {
  if (workflow.completed) {
    return (
      <details className="group w-full text-xs text-muted-foreground">
        <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-md px-1 py-1 select-none transition-colors hover:bg-muted/40 [&::-webkit-details-marker]:hidden">
          <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
          <span>思考过程</span>
          {workflow.rounds.length > 0 && (
            <span>· {workflow.rounds.length} 轮检索</span>
          )}
        </summary>
        <div className="mt-1 pl-1">
          <WorkflowSteps workflow={workflow} />
        </div>
      </details>
    );
  }

  return (
    <div className="w-full px-1 py-1 text-xs text-muted-foreground">
      <WorkflowSteps workflow={workflow} />
    </div>
  );
}

function WorkflowSteps({ workflow }: WorkflowProgressProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <FlowPill
        label="分析问题"
        status={workflow.analysis}
        icon={<Search className="size-3" />}
      />

      {workflow.rounds.map((round) => (
        <RoundPill key={round.iteration} round={round} />
      ))}

      {workflow.generation !== 'pending' && (
        <FlowPill
          label="生成回答"
          status={workflow.generation}
          icon={<Sparkles className="size-3" />}
        />
      )}
    </div>
  );
}

function RoundPill({ round }: { round: AgentWorkflowRound }) {
  const sourceLabel = round.source === 'web' ? '联网搜索' : '知识库检索';
  const detail = getRoundDetail(round);

  return (
    <div
      className="flex min-w-0 items-center gap-1.5 py-1"
      title={`${sourceLabel}：${round.query}${detail ? ` · ${detail}` : ''}`}
    >
      {round.status === 'running' ? (
        <Loader2 className="size-3 shrink-0 animate-spin text-primary" />
      ) : (
        <Check className="size-3 shrink-0 text-emerald-600" />
      )}
      {round.source === 'web' ? (
        <Globe2 className="size-3 shrink-0" />
      ) : (
        <Database className="size-3 shrink-0" />
      )}
      <span className="whitespace-nowrap">
        第 {round.iteration} 轮 · {sourceLabel}
        {detail ? ` · ${detail}` : ''}
      </span>
    </div>
  );
}

function FlowPill({
  label,
  status,
  icon,
}: {
  label: string;
  status: 'pending' | 'running' | 'completed';
  icon: ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5 py-1">
      {status === 'completed' ? (
        <Check className="size-3 text-emerald-600" />
      ) : status === 'running' ? (
        <Loader2 className="size-3 animate-spin text-primary" />
      ) : (
        <Circle className="size-3" />
      )}
      {icon}
      <span>{label}</span>
    </div>
  );
}

function getRoundDetail(round: AgentWorkflowRound): string {
  if (round.status === 'running') return '进行中';
  if (round.verdict === 'sufficient') return '证据充足';
  if (round.verdict === 'partial') return '部分可用';
  if (round.verdict === 'irrelevant') return '未找到相关证据';
  if (round.verdict === 'empty') return '无结果';
  if (round.acceptedCount !== undefined) return `${round.acceptedCount} 条有效资料`;
  return '已完成';
}
