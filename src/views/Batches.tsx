import { useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  FileCode2,
  GitCompareArrows,
  Plus,
  RefreshCw,
  Trash2,
  XCircle,
} from 'lucide-react';
import type { Ledger } from '../ledger';
import { diffBatches } from '../ledger';
import { VerdictBadge } from '../components/ui';

type Props = {
  ledger: Ledger;
  onImportFile: (file: File) => void;
  onRetryFile: (batchId: string, file: File) => void;
  onActivate: (batchId: string) => void;
  onRemove: (batchId: string) => void;
};

function fmtTime(ts: number) {
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

export default function Batches({ ledger, onImportFile, onRetryFile, onActivate, onRemove }: Props) {
  const importRef = useRef<HTMLInputElement>(null);
  const retryRef = useRef<HTMLInputElement>(null);
  const [retryFor, setRetryFor] = useState<string | null>(null);
  const [diffA, setDiffA] = useState('');
  const [diffB, setDiffB] = useState('');

  const ready = ledger.batches.filter((b) => b.status === 'ready');
  const diff = useMemo(
    () => (diffA && diffB ? diffBatches(ledger, diffA, diffB) : null),
    [diffA, diffB, ledger],
  );

  const pickFile = (ref: React.RefObject<HTMLInputElement | null>) => ref.current?.click();

  return (
    <div className="batches-view">
      <div className="batches-head">
        <div>
          <h2>批次台账</h2>
          <p>每个锁文件形成独立批次；按内容指纹识别包，指纹不变裁决沿用、指纹一变即回到待复核。</p>
        </div>
        <button className="primary" onClick={() => pickFile(importRef)}>
          <Plus size={15} />
          导入锁文件
        </button>
        <input
          ref={importRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onImportFile(f);
            e.target.value = '';
          }}
        />
      </div>

      <div className="diff-panel">
        <div className="diff-head">
          <GitCompareArrows size={16} />
          <h3>批次对比</h3>
          <span className="muted">列出两个就绪批次之间的新增、消失与裁决变化</span>
        </div>
        <div className="diff-selects">
          <select value={diffA} onChange={(e) => setDiffA(e.target.value)}>
            <option value="">选择基准批次</option>
            {ready.map((b) => (
              <option key={b.id} value={b.id}>
                {b.fileName}
              </option>
            ))}
          </select>
          <span className="diff-arrow">→</span>
          <select value={diffB} onChange={(e) => setDiffB(e.target.value)}>
            <option value="">选择目标批次</option>
            {ready.map((b) => (
              <option key={b.id} value={b.id}>
                {b.fileName}
              </option>
            ))}
          </select>
        </div>
        {diff && (
          <div className="diff-results">
            <div className="diff-col added">
              <h4>新增 {diff.added.length}</h4>
              {diff.added.length ? (
                <ul>
                  {diff.added.map((p) => (
                    <li key={p.fingerprint}>
                      {p.name} <span className="muted">{p.version}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">无</p>
              )}
            </div>
            <div className="diff-col removed">
              <h4>消失 {diff.removed.length}</h4>
              {diff.removed.length ? (
                <ul>
                  {diff.removed.map((p) => (
                    <li key={p.fingerprint}>
                      {p.name} <span className="muted">{p.version}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">无</p>
              )}
            </div>
            <div className="diff-col changed">
              <h4>裁决变化 {diff.changed.length}</h4>
              {diff.changed.length ? (
                <ul>
                  {diff.changed.map((c) => (
                    <li key={c.pkg.fingerprint}>
                      {c.pkg.name} <VerdictBadge v={c.from} /> <span className="muted">→</span>{' '}
                      <VerdictBadge v={c.to} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">无</p>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="batch-list">
        {ledger.batches.length === 0 && <div className="empty">还没有批次，点击右上角「导入锁文件」。</div>}
        {ledger.batches.map((b) => {
          const isActive = b.id === ledger.activeBatchId;
          return (
            <div key={b.id} className={'batch-card' + (isActive ? ' active' : '') + (b.status === 'failed' ? ' failed' : '')}>
              <div className="batch-icon">
                <FileCode2 size={18} />
              </div>
              <div className="batch-body">
                <div className="batch-title">
                  <b>{b.fileName}</b>
                  {isActive && <span className="active-tag">当前发布批次</span>}
                </div>
                <div className="batch-meta">
                  <span>{fmtTime(b.createdAt)}</span>
                  {b.status === 'ready' && <span>{b.fingerprints.length} 个包</span>}
                </div>
                {b.status === 'parsing' && (
                  <div className="batch-status parsing">
                    <Clock size={13} /> 正在解析…（独立批次，不影响其它批次）
                  </div>
                )}
                {b.status === 'failed' && (
                  <div className="batch-status failed">
                    <XCircle size={13} /> 解析失败：{b.error}（未写入任何包，无半包）
                  </div>
                )}
                {b.status === 'ready' && (
                  <div className="batch-status ready">
                    <CheckCircle2 size={13} /> 就绪 · 已原子提交
                  </div>
                )}
              </div>
              <div className="batch-actions">
                {b.status === 'ready' && !isActive && (
                  <button className="outline small" onClick={() => onActivate(b.id)}>
                    设为当前
                  </button>
                )}
                {b.status === 'failed' && (
                  <button
                    className="outline small"
                    onClick={() => {
                      setRetryFor(b.id);
                      retryRef.current?.click();
                    }}
                  >
                    <RefreshCw size={13} /> 重试
                  </button>
                )}
                <button className="ghost small" title="删除批次" onClick={() => onRemove(b.id)}>
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <input
        ref={retryRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f && retryFor) onRetryFile(retryFor, f);
          setRetryFor(null);
          e.target.value = '';
        }}
      />
    </div>
  );
}
