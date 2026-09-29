import {
  AlertTriangle,
  Check,
  ChevronDown,
  FileWarning,
  FolderGit2,
  Layers3,
  Loader2,
  PackagePlus,
  Play,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import DiffPanel from './components/DiffPanel';
import PackageDetail from './components/PackageDetail';
import ReleaseView from './components/ReleaseView';
import { resolveRows } from './ledger/engine';
import { lockSample } from './ledger/samples';
import type { DecisionInput } from './ledger/types';
import { useLedger } from './ledger/useLedger';
import {
  batchStatusMeta,
  ecosystemName,
  formatTime,
  licenseColor,
  shortFp,
  verdictMeta,
} from './ledger/ui';

type View = 'ledger' | 'release';

export default function App() {
  const api = useLedger();
  const { ledger, running } = api;
  const [view, setView] = useState<View>('ledger');
  const [selectedBatch, setSelectedBatch] = useState<string | null>(null);
  const [selectedFp, setSelectedFp] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [showImport, setShowImport] = useState(false);

  const batches = useMemo(
    () => Object.values(ledger.batches).sort((a, b) => b.ord - a.ord),
    [ledger.batches],
  );
  const batch = selectedBatch ? ledger.batches[selectedBatch] ?? null : null;
  const rows = useMemo(() => (batch ? resolveRows(ledger, batch) : []), [ledger, batch]);
  const filtered = rows.filter((r) =>
    `${r.name}${r.version}${r.license}`.toLowerCase().includes(query.toLowerCase()),
  );
  const selectedPkg = rows.find((r) => r.fp === selectedFp) ?? null;

  const stats = useMemo(() => {
    const ready = batches.filter((b) => b.status === 'ready');
    const failed = batches.filter((b) => b.status === 'failed').length;
    const parsing = batches.filter((b) => b.status === 'parsing').length;
    const pendingFps = new Set(
      ready.flatMap((b) => b.packages.map((p) => p.fp)),
    );
    const decided = [...pendingFps].filter((fp) => ledger.decisions[fp]).length;
    return { ready: ready.length, failed, parsing, total: pendingFps.size, decided };
  }, [batches, ledger.decisions]);

  const selectBatch = (id: string) => {
    setSelectedBatch(id);
    setSelectedFp(null);
  };

  const onDecide = (fp: string, input: DecisionInput) => {
    if (batch) api.decide(batch.id, fp, input);
  };

  return (
    <div className="shell">
      <aside>
        <div className="brand">
          <div className="brand-icon">
            <ShieldCheck size={18} />
          </div>
          <div>
            <b>License Lens</b>
            <small>RECOVERABLE SCAN LEDGER</small>
          </div>
        </div>
        <div className="nav-title">SCAN LEDGER</div>
        <button className={'nav ' + (view === 'ledger' ? 'active' : '')} onClick={() => setView('ledger')}>
          <Layers3 size={16} />
          扫描台账
          <span>{batches.length}</span>
        </button>
        <button className={'nav ' + (view === 'release' ? 'active' : '')} onClick={() => setView('release')}>
          <ShieldCheck size={16} />
          发布清单
        </button>
        <div className="nav-title ledger-stats-title">状态</div>
        <div className="ledger-side-stats">
          <div><Check size={12} /> 就绪批次 <b>{stats.ready}</b></div>
          <div><Loader2 size={12} className="spin" /> 分析中 <b>{stats.parsing}</b></div>
          <div><AlertTriangle size={12} /> 失败可重试 <b className="red">{stats.failed}</b></div>
          <div><Sparkles size={12} /> 已裁决指纹 <b>{stats.decided}/{stats.total}</b></div>
        </div>
        <div className="aside-bottom">
          <div className="mini-card">
            <FolderGit2 size={16} />
            <div>
              <b>锁文件 = 独立批次</b>
              <small>按内容指纹追踪，盖文件不再冲掉裁决</small>
            </div>
          </div>
          <div className="user"><div className="avatar">ZL</div><span>Zen Li</span><ChevronDown size={14} /></div>
        </div>
      </aside>

      <main>
        <header>
          <div>
            <div className="crumb">WORKSPACE / <b>SCAN LEDGER</b></div>
            <h1>{view === 'ledger' ? '可恢复的扫描台账' : '发布清单'}</h1>
            <p>
              {view === 'ledger'
                ? '每个锁文件形成独立批次；包按内容指纹识别，指纹一变旧裁决失效；失败整批回滚、重试复用已确认结果。'
                : '只汇总每个生态最新就绪批次的当前有效结论。'}
            </p>
          </div>
          {view === 'ledger' && (
            <div className="head-actions">
              <button className="outline" onClick={() => setShowImport(true)}>
                <Zap size={15} /> 演练场景
              </button>
              <button className="primary" onClick={() => setShowImport(true)}>
                <Upload size={15} /> 导入锁文件
              </button>
            </div>
          )}
        </header>

        {view === 'release' ? (
          <ReleaseView ledger={ledger} />
        ) : (
          <>
            <section className="batch-strip">
              {batches.length === 0 && (
                <div className="batch-empty">
                  <PackagePlus size={22} />
                  <b>还没有批次</b>
                  <p>导入 package-lock.json / composer.lock，或用「演练场景」快速体验完整流程。</p>
                </div>
              )}
              {batches.map((b) => {
                const meta = batchStatusMeta[b.status];
                const active = b.id === selectedBatch;
                const pending = b.status === 'ready'
                  ? b.packages.filter((p) => !ledger.decisions[p.fp]).length
                  : 0;
                return (
                  <button
                    key={b.id}
                    className={'batch-card ' + b.status + (active ? ' selected' : '')}
                    onClick={() => selectBatch(b.id)}
                  >
                    <div className="batch-card-top">
                      <i className="batch-dot" style={{ background: meta.dot }} />
                      <span className="batch-status" style={{ color: meta.color }}>
                        {running[b.id] && <Loader2 size={11} className="spin" />}
                        {meta.label}
                      </span>
                      <span className="batch-ord">#{b.ord}</span>
                    </div>
                    <b className="batch-label" title={b.label}>{b.label}</b>
                    <small>{ecosystemName[b.ecosystem]} · {b.fingerprints.length || b.packages.length} 包 · {formatTime(b.createdAt)}</small>
                    {b.status === 'ready' && (
                      <small className={'batch-pending ' + (pending ? '' : 'done')}>
                        {pending ? `${pending} 个待复核` : '全部已裁决'}
                      </small>
                    )}
                    {b.status === 'failed' && (
                      <small className="batch-error" title={b.error}>
                        <FileWarning size={11} /> {b.error}
                      </small>
                    )}
                    {b.attempts > 1 && <small className="batch-attempts">已重试 {b.attempts - 1} 次</small>}
                    <span className="batch-card-actions" onClick={(e) => e.stopPropagation()}>
                      {b.status === 'failed' && (
                        <span className="icon-btn" title="重试本批" onClick={() => api.retry(b.id)}>
                          <RotateCcw size={13} />
                        </span>
                      )}
                      <span className="icon-btn danger" title="删除批次（历史台账）" onClick={() => {
                        api.removeBatch(b.id);
                        if (selectedBatch === b.id) setSelectedBatch(null);
                      }}>
                        <Trash2 size={13} />
                      </span>
                    </span>
                  </button>
                );
              })}
            </section>

            {batch && (
              <>
                {batch.status === 'failed' && (
                  <div className="batch-failed-banner">
                    <FileWarning size={16} />
                    <div>
                      <b>批次未提交：{batch.error}</b>
                      <p>没有任何半成品进入发布清单；重试时已确认的指纹结果会直接复用，只补跑剩余部分。</p>
                    </div>
                    <button className="primary small" onClick={() => api.retry(batch.id)} disabled={running[batch.id]}>
                      <RotateCcw size={13} /> {running[batch.id] ? '重试中…' : '重试本批'}
                    </button>
                  </div>
                )}

                <section className="workspace">
                  <div className="table-pane">
                    <div className="pane-head">
                      <div>
                        <h2>{batch.label}</h2>
                        <p>
                          {ecosystemName[batch.ecosystem]} · 来源独立 · 共 {rows.length} 个内容指纹
                        </p>
                      </div>
                      <div className="tools">
                        <div className="search">
                          <Search size={15} />
                          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索包" />
                        </div>
                      </div>
                    </div>
                    <div className="table">
                      <div className="tr th">
                        <span>包</span>
                        <span>版本</span>
                        <span>许可证</span>
                        <span>结论</span>
                      </div>
                      {filtered.map((d) => {
                        const vm = verdictMeta[d.verdict];
                        const color = licenseColor(d.license);
                        return (
                          <button
                            className={'tr ' + (d.fp === selectedFp ? 'selected' : '')}
                            key={d.fp}
                            onClick={() => setSelectedFp(d.fp)}
                          >
                            <span className="dep-name">
                              <span className="pkg-dot" style={{ background: color }} />
                              {d.name}
                              <i className="fp-tag" title="内容指纹">{shortFp(d.fp)}</i>
                            </span>
                            <span className="muted">{d.version}</span>
                            <span>
                              <i className="license" style={{ color, background: color + '18' }}>
                                {d.license}
                              </i>
                            </span>
                            <span>
                              <i className="verdict-badge" style={{ color: vm.color, background: vm.bg }}>
                                {vm.label}
                              </i>
                            </span>
                          </button>
                        );
                      })}
                      {filtered.length === 0 && <p className="table-empty">该批次没有可显示的包。</p>}
                    </div>
                  </div>
                  <PackageDetail
                    batch={batch}
                    pkg={selectedPkg}
                    onClose={() => setSelectedFp(null)}
                    onDecide={onDecide}
                    onWithdraw={api.withdraw}
                  />
                </section>

                <DiffPanel ledger={ledger} selectedId={selectedBatch} onSelect={selectBatch} />
              </>
            )}
          </>
        )}
      </main>

      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onImport={(files, opts) => {
            api.importFiles(files, opts);
            setShowImport(false);
          }}
        />
      )}
    </div>
  );
}

function ImportModal({
  onClose,
  onImport,
}: {
  onClose: () => void;
  onImport: (files: { name: string; content: string }[], opts: { injectAnalysisFailure?: boolean }) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const readFiles = (list: FileList | null, injectFailure = false) => {
    if (!list || !list.length) return;
    setBusy(true);
    Promise.all(
      [...list].map(
        (f) =>
          new Promise<{ name: string; content: string }>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve({ name: f.name, content: String(reader.result ?? '') });
            reader.readAsText(f);
          }),
      ),
    ).then((files) => {
      setBusy(false);
      onImport(files, { injectAnalysisFailure: injectFailure && files.length === 1 });
    });
  };

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal import-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>导入锁文件</h2>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <p className="modal-tip">可一次选多个文件：每个文件都是独立批次，互不覆盖；分析并行进行。</p>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".json,.lock"
          style={{ display: 'none' }}
          onChange={(e) => readFiles(e.target.files)}
        />
        <button className="primary full" disabled={busy} onClick={() => fileRef.current?.click()}>
          <Upload size={15} /> {busy ? '读取中…' : '选择锁文件（支持多选）'}
        </button>

        <div className="demo-title">演练场景（使用内置示例锁文件）</div>
        <div className="demo-grid">
          <DemoBtn
            icon={<Play size={14} />}
            title="两个窗口同时提交"
            desc="npm 与 composer 两个批次并行解析/分析，不会混成一批"
            onClick={() =>
              onImport(
                [
                  { name: 'package-lock.json', content: lockSample('v1') },
                  { name: 'composer.lock', content: lockSample('composer') },
                ],
                {},
              )
            }
          />
          <DemoBtn
            icon={<RotateCcw size={14} />}
            title="分析中断 → 重试"
            desc="某批次分析到一半失败（不留半批），重试复用已确认结果"
            onClick={() =>
              onImport([{ name: 'package-lock.json', content: lockSample('v1') }], {
                injectAnalysisFailure: true,
              })
            }
          />
          <DemoBtn
            icon={<FileWarning size={14} />}
            title="导入破损锁文件"
            desc="解析即失败、批次空行，修正内容后可重试"
            onClick={() => onImport([{ name: 'package-lock.json', content: lockSample('broken') }], {})}
          />
          <DemoBtn
            icon={<Layers3 size={14} />}
            title="新锁文件盖到旧清单"
            desc="v1→v2：同指纹裁决保留，版本/许可证变化的包回待复核"
            onClick={() =>
              onImport(
                [
                  { name: 'package-lock.json', content: lockSample('v1') },
                  { name: 'package-lock.json', content: lockSample('v2') },
                ],
                {},
              )
            }
          />
        </div>
      </div>
    </div>
  );
}

function DemoBtn({
  icon,
  title,
  desc,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button className="demo-btn" onClick={onClick}>
      <span className="demo-icon">{icon}</span>
      <b>{title}</b>
      <small>{desc}</small>
    </button>
  );
}
