import { useMemo, useState } from 'react';
import { AlertTriangle, Check, FileCode2, Info, Search, X, Scale } from 'lucide-react';
import type { Ledger, Verdict } from '../ledger';
import { getActiveBatch, getBatchRows } from '../ledger';
import { LicenseTag, VerdictBadge } from '../components/ui';

type Props = {
  ledger: Ledger;
  selectedFp: string | null;
  onSelect: (fp: string | null) => void;
  onVerdict: (fp: string, v: Verdict) => void;
};

const VERDICTS: { v: Verdict; label: string; cls: string; icon: typeof Check }[] = [
  { v: 'ok', label: '确认安全', cls: 'ok', icon: Check },
  { v: 'warn', label: '标记复核', cls: 'warn', icon: AlertTriangle },
  { v: 'risk', label: '标记高风险', cls: 'risk', icon: AlertTriangle },
];

export default function Overview({ ledger, selectedFp, onSelect, onVerdict }: Props) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | Verdict>('all');

  const batch = getActiveBatch(ledger);
  const rows = useMemo(() => getBatchRows(ledger, batch), [ledger, batch]);
  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          (filter === 'all' || r.verdict === filter) &&
          `${r.pkg.name}${r.pkg.license}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [rows, filter, query],
  );
  const current = rows.find((r) => r.pkg.fingerprint === selectedFp) ?? null;

  const c = {
    total: rows.length,
    ok: rows.filter((r) => r.verdict === 'ok').length,
    warn: rows.filter((r) => r.verdict === 'warn').length,
    risk: rows.filter((r) => r.verdict === 'risk').length,
    pending: rows.filter((r) => r.verdict === 'pending').length,
  };
  const score = c.total ? Math.round((c.ok / c.total) * 100) : 0;

  return (
    <>
      <section className="hero">
        <div>
          <span className="tag">PROJECT · AURORA-WEB</span>
          <h2>发布前，再确认一次。</h2>
          <p>
            当前批次 <b>{batch?.fileName ?? '未选择'}</b> 共 <b>{c.total} 个包</b>，
            <b className="warning"> {c.pending} 项待复核</b>。
          </p>
        </div>
        <div className="scan-score">
          <div className="score-ring">
            <strong>{score}
              <small>%</small>
            </strong>
          </div>
          <div>
            <span>兼容评分</span>
            <b>{score >= 80 ? '良好' : score >= 50 ? '待改进' : '需警惕'}</b>
            <small>已确认 {c.ok}/{c.total}</small>
          </div>
        </div>
      </section>

      <section className="summary">
        <div>
          <span>全部包</span>
          <b>{c.total}</b>
          <small>来自当前批次</small>
        </div>
        <div>
          <span>安全许可</span>
          <b className="teal">{c.ok}</b>
          <small>可直接分发</small>
        </div>
        <div>
          <span>需要复核</span>
          <b className="orange">{c.warn}</b>
          <small>保留声明即可</small>
        </div>
        <div>
          <span>待复核 / 高风险</span>
          <b className="red">{c.pending + c.risk}</b>
          <small>{c.pending} 待裁决 · {c.risk} 高风险</small>
        </div>
      </section>

      <section className="workspace">
        <div className="table-pane">
          <div className="pane-head">
            <div>
              <h2>依赖清单</h2>
              <p>逐项查看许可证义务并作出裁决</p>
            </div>
            <div className="tools">
              <div className="search">
                <Search size={15} />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索依赖" />
              </div>
              <select value={filter} onChange={(e) => setFilter(e.target.value as 'all' | Verdict)}>
                <option value="all">全部状态</option>
                <option value="pending">待复核</option>
                <option value="ok">安全</option>
                <option value="warn">复核</option>
                <option value="risk">高风险</option>
              </select>
            </div>
          </div>
          <div className="table">
            <div className="tr th">
              <span>依赖名称</span>
              <span>版本</span>
              <span>许可证</span>
              <span>状态</span>
            </div>
            {filtered.map((r) => (
              <button
                className={r.pkg.fingerprint === selectedFp ? 'tr selected' : 'tr'}
                key={r.pkg.fingerprint}
                onClick={() => onSelect(r.pkg.fingerprint)}
              >
                <span className="dep-name">
                  <span className="pkg-dot" /> {r.pkg.name}
                </span>
                <span className="muted">{r.pkg.version}</span>
                <span>
                  <LicenseTag license={r.pkg.license} />
                </span>
                <span>
                  <VerdictBadge v={r.verdict} />
                </span>
              </button>
            ))}
            {filtered.length === 0 && <div className="empty">当前批次没有匹配的包</div>}
          </div>
        </div>

        {current ? (
          <div className="detail">
            <div className="detail-head">
              <div
                className="detail-icon"
                style={{
                  background: (current.pkg.license === 'GPL-3.0' ? '#ec8c75' : '#2eab8e') + '1c',
                  color: current.pkg.license === 'GPL-3.0' ? '#ec8c75' : '#2eab8e',
                }}
              >
                <FileCode2 size={20} />
              </div>
              <div>
                <span>SELECTED PACKAGE</span>
                <h2>{current.pkg.name}</h2>
              </div>
              <button className="close" onClick={() => onSelect(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="detail-grid">
              <div>
                <label>版本</label>
                <b>{current.pkg.version}</b>
              </div>
              <div>
                <label>来源批次</label>
                <b className="src-name">{batch?.fileName ?? '-'}</b>
              </div>
              <div>
                <label>许可证</label>
                <b>
                  <LicenseTag license={current.pkg.license} />
                </b>
              </div>
            </div>
            <div className="fp-line">
              内容指纹 <code>{current.pkg.fingerprint}</code>
              <span className="muted">（指纹不变则裁决沿用，版本/许可证一变即回到待复核）</span>
            </div>

            <div className={'finding ' + current.verdict}>
              <div className="finding-icon">
                {current.verdict === 'ok' ? (
                  <Check size={16} />
                ) : (
                  <AlertTriangle size={16} />
                )}
              </div>
              <div>
                <b>
                  {current.verdict === 'ok'
                    ? '可以放心使用'
                    : current.verdict === 'warn'
                      ? '需要保留声明'
                      : current.verdict === 'risk'
                        ? '存在分发限制'
                        : '等待人工复核'}
                </b>
                <p>{current.note}。扫描结果基于包元数据，发布前请核对完整许可证文本。</p>
              </div>
            </div>

            <div className="verdict-block">
              <div className="verdict-title">
                <Scale size={14} />
                <span>人工裁决</span>
              </div>
              <div className="verdict-btns">
                {VERDICTS.map(({ v, label, cls, icon: Icon }) => (
                  <button
                    key={v}
                    className={'vbtn ' + cls + (current.verdict === v ? ' active' : '')}
                    onClick={() => onVerdict(current.pkg.fingerprint, v)}
                  >
                    <Icon size={14} />
                    {label}
                  </button>
                ))}
              </div>
              <p className="verdict-hint">
                裁决按内容指纹记录，只对当前批次生效并随指纹沿用；切换批次时来源与裁决始终来自同一批次，不会串。
              </p>
            </div>

            <div className="full-license">
              <div>
                <Info size={15} />
                <span>许可证摘要</span>
              </div>
              <p>
                {current.pkg.license} 允许在满足其条款的前提下使用和分发代码。详细义务请参考项目仓库中的
                LICENSE 文件。
              </p>
            </div>
          </div>
        ) : (
          <div className="detail detail-empty">
            <FileCode2 size={28} className="empty-icon" />
            <p>从左侧选择一个包查看详情并作出裁决。</p>
          </div>
        )}
      </section>
    </>
  );
}
