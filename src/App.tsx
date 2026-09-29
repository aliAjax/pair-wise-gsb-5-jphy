import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  Download,
  FileCode2,
  Layers3,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import {
  buildManifestMarkdown,
  commitBatch,
  createParsingBatch,
  failBatch,
  getActiveBatch,
  getManifest,
  loadLedger,
  parseLockfile,
  removeBatch,
  retryToParsing,
  saveLedger,
  seedLedger,
  setActive,
  setVerdict,
  uid,
  type Ledger,
  type Verdict,
} from './ledger';
import Overview from './views/Overview';
import Batches from './views/Batches';
import Manifest from './views/Manifest';

type View = 'overview' | 'batches' | 'manifest';

export default function App() {
  const [ledger, setLedger] = useState<Ledger>(() => {
    const loaded = loadLedger();
    return loaded.batches.length > 0 ? loaded : seedLedger();
  });
  const [view, setView] = useState<View>('overview');
  const [selectedFp, setSelectedFp] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    saveLedger(ledger);
  }, [ledger]);

  // 跨窗口同步：另一个标签页写入台账时，若本页没有在途解析（parsing）批次，
  // 就采用对方的最新台账，避免旧状态覆盖新批次。有在途导入时不打断，提交走函数式合并。
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== 'license-lens-ledger-v1') return;
      setLedger((prev) => {
        if (prev.batches.some((b) => b.status === 'parsing')) return prev;
        try {
          const next = JSON.parse(e.newValue || 'null');
          if (next && next.version === 1 && Array.isArray(next.batches) && next.registry) {
            return next as Ledger;
          }
        } catch {
          /* 忽略损坏的跨窗口数据 */
        }
        return prev;
      });
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3600);
    return () => clearTimeout(t);
  }, [toast]);

  const activeBatch = getActiveBatch(ledger);
  const manifest = getManifest(ledger, activeBatch);
  const pendingCount = manifest.pending.length;
  const batchCount = ledger.batches.length;

  // 导入：先占位“解析中”批次，解析成功才原子提交，失败只标记 failed（不留半包）。
  // 两个并行导入各自持有独立 batchId，并通过函数式 setState 合并，不会混成一批。
  const importFile = async (file: File) => {
    const text = await file.text();
    const batchId = uid('batch');
    setLedger((prev) => createParsingBatch(prev, batchId, file.name));
    try {
      const packages = await parseLockfile(file.name, text);
      setLedger((prev) => commitBatch(prev, batchId, file.name, packages));
      setToast(`已导入「${file.name}」，解析出 ${packages.length} 个包`);
      setView('overview');
      setSelectedFp(null);
    } catch (e) {
      setLedger((prev) => failBatch(prev, batchId, (e as Error).message));
      setToast(`导入失败：${(e as Error).message}`);
    }
  };

  // 重试：回到 parsing 重新解析，成功提交、失败仍为 failed，已确认批次不受影响。
  const retryFile = async (batchId: string, file: File) => {
    const text = await file.text();
    setLedger((prev) => retryToParsing(prev, batchId));
    try {
      const packages = await parseLockfile(file.name, text);
      setLedger((prev) => commitBatch(prev, batchId, file.name, packages));
      setToast(`重试成功：「${file.name}」已就绪，${packages.length} 个包`);
    } catch (e) {
      setLedger((prev) => failBatch(prev, batchId, (e as Error).message));
      setToast(`重试仍失败：${(e as Error).message}`);
    }
  };

  const doVerdict = (fp: string, v: Verdict) => {
    if (!activeBatch) return;
    setLedger((prev) => setVerdict(prev, activeBatch.id, fp, v));
  };

  const activate = (batchId: string) => {
    setLedger((prev) => setActive(prev, batchId));
    setView('overview');
    setSelectedFp(null);
  };

  const remove = (batchId: string) => {
    setLedger((prev) => removeBatch(prev, batchId));
  };

  const exportReport = () => {
    const text = buildManifestMarkdown(ledger);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
    a.download = 'release-manifest.md';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const nav = (
    <>
      <button className={'nav' + (view === 'overview' ? ' active' : '')} onClick={() => setView('overview')}>
        <Layers3 size={16} />
        依赖总览
      </button>
      <button className={'nav' + (view === 'batches' ? ' active' : '')} onClick={() => setView('batches')}>
        <FileCode2 size={16} />
        批次台账
        <span>{batchCount}</span>
      </button>
      <button className={'nav' + (view === 'manifest' ? ' active' : '')} onClick={() => setView('manifest')}>
        <ShieldCheck size={16} />
        发布清单
        {pendingCount > 0 && <span className="red">{pendingCount}</span>}
      </button>
    </>
  );

  return (
    <div className="shell">
      <aside>
        <div className="brand">
          <div className="brand-icon">
            <ShieldCheck size={18} />
          </div>
          <div>
            <b>License Lens</b>
            <small>dependency ledger</small>
          </div>
        </div>
        <div className="nav-title">WORKSPACE</div>
        {nav}
        <div className="aside-bottom">
          <div className="mini-card">
            <Sparkles size={16} />
            <div>
              <b>台账可恢复</b>
              <small>批次独立 · 指纹识别 · 失败不留半包</small>
            </div>
          </div>
          <div className="user">
            <div className="avatar">ZL</div>
            <span>Zen Li</span>
            <ChevronDown size={14} />
          </div>
        </div>
      </aside>

      <main>
        <header>
          <div>
            <div className="crumb">
              WORKSPACE / <b>{view === 'overview' ? 'PROJECT SCAN' : view === 'batches' ? 'BATCH LEDGER' : 'RELEASE MANIFEST'}</b>
            </div>
            <h1>许可证兼容性分析</h1>
            <p>批次化扫描台账：每个锁文件独立成批，按内容指纹继承裁决。</p>
          </div>
          <div className="head-actions">
            <button className="outline" onClick={exportReport}>
              <Download size={15} />
              导出报告
            </button>
            <button className="primary" onClick={() => importRef.current?.click()}>
              <Plus size={16} />
              导入锁文件
            </button>
            <input
              ref={importRef}
              type="file"
              accept=".json,application/json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importFile(f);
                e.target.value = '';
              }}
            />
          </div>
        </header>

        {view === 'overview' && (
          <Overview ledger={ledger} selectedFp={selectedFp} onSelect={setSelectedFp} onVerdict={doVerdict} />
        )}
        {view === 'batches' && (
          <Batches
            ledger={ledger}
            onImportFile={importFile}
            onRetryFile={retryFile}
            onActivate={activate}
            onRemove={remove}
          />
        )}
        {view === 'manifest' && <Manifest ledger={ledger} />}
      </main>

      {toast && (
        <div className="toast">
          <RefreshCw size={14} />
          <span>{toast}</span>
          <button onClick={() => setToast(null)}>
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
