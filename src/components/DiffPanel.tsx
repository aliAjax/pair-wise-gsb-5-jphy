import { ArrowRight, GitCompare, MinusCircle, PlusCircle, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { diffBatches } from '../ledger/engine';
import type { Batch, BatchDiff, Ledger } from '../ledger/types';
import { licenseColor } from '../ledger/ui';

interface Props {
  ledger: Ledger;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/** 批次比较：列新增、消失、裁决变化（指纹变更导致旧裁决失效） */
export default function DiffPanel({ ledger, selectedId, onSelect }: Props) {
  const readyBatches = useMemo(
    () =>
      Object.values(ledger.batches)
        .filter((b) => b.status === 'ready')
        .sort((a, b) => a.ord - b.ord),
    [ledger.batches],
  );
  const [baseId, setBaseId] = useState<string>('');

  const target = selectedId ? ledger.batches[selectedId] : null;
  const sameEco = target ? readyBatches.filter((b) => b.ecosystem === target.ecosystem) : readyBatches;
  const base =
    baseId && target && ledger.batches[baseId]?.ecosystem === target.ecosystem && baseId !== target.id
      ? ledger.batches[baseId]
      : null;

  const diff: BatchDiff | null = useMemo(() => {
    if (!target) return null;
    const chosenBase =
      base && base.id !== target.id ? base.id : previousReady(sameEco, target.id);
    return diffBatches(ledger, chosenBase, target.id);
  }, [ledger, target, base, sameEco]);

  if (readyBatches.length < 1) return null;

  return (
    <section className="diff-panel">
      <div className="diff-head">
        <div className="diff-title">
          <GitCompare size={16} />
          <div>
            <h2>批次比较</h2>
            <p>按内容指纹比对两个批次：新增 / 消失 / 裁决失效</p>
          </div>
        </div>
        <div className="diff-selectors">
          <select value={diff?.baseId ?? ''} onChange={(e) => setBaseId(e.target.value)}>
            {sameEco
              .filter((b) => b.id !== target?.id)
              .map((b) => (
                <option key={b.id} value={b.id}>
                  基线：{b.label}
                </option>
              ))}
          </select>
          <ArrowRight size={14} className="diff-arrow" />
          <select value={target?.id ?? ''} onChange={(e) => onSelect(e.target.value)}>
            {readyBatches.map((b) => (
              <option key={b.id} value={b.id}>
                当前：{b.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {diff && <DiffBody diff={diff} baseLabel={base?.label} targetLabel={target?.label} />}
    </section>
  );
}

function previousReady(batches: Batch[], id: string): string | null {
  const idx = batches.findIndex((b) => b.id === id);
  return idx > 0 ? batches[idx - 1].id : null;
}

function DiffBody({
  diff,
}: {
  diff: BatchDiff;
  baseLabel?: string;
  targetLabel?: string;
}) {
  const groups = [
    {
      key: 'added',
      icon: <PlusCircle size={14} />,
      title: '新增包',
      entries: diff.added,
      cls: 'added',
    },
    {
      key: 'removed',
      icon: <MinusCircle size={14} />,
      title: '消失包',
      entries: diff.removed,
      cls: 'removed',
    },
    {
      key: 'changed',
      icon: <RefreshCw size={14} />,
      title: '裁决变化（指纹变了，旧裁决失效）',
      entries: diff.changed,
      cls: 'changed',
    },
  ] as const;

  return (
    <div className="diff-body">
      {groups.map((g) => (
        <div className={'diff-group ' + g.cls} key={g.key}>
          <div className="diff-group-head">
            {g.icon}
            <b>{g.title}</b>
            <span>{g.entries.length}</span>
          </div>
          {g.entries.length === 0 && <p className="diff-empty">无</p>}
          {g.entries.map((e) => (
            <div className="diff-row" key={e.fp}>
              <span className="diff-name">{e.name}</span>
              <span className="muted">{e.version}</span>
              <i className="license" style={{ color: licenseColor(e.license), background: licenseColor(e.license) + '18' }}>
                {e.license}
              </i>
              {g.key === 'changed' && (
                <span className="diff-verdicts">
                  <i className={'vp ' + e.from}>{verdictText(e.from)}</i>
                  <ArrowRight size={11} />
                  <i className={'vp ' + e.to}>{verdictText(e.to)}</i>
                </span>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function verdictText(v?: string): string {
  if (v === 'approved') return '已放行';
  if (v === 'rejected') return '已驳回';
  return '待复核';
}
