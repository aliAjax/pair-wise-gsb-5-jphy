import { useMemo } from 'react';
import { AlertTriangle, Check, Download, FileCheck, ShieldAlert } from 'lucide-react';
import type { Ledger, Row } from '../ledger';
import { buildManifestMarkdown, getActiveBatch, getManifest } from '../ledger';
import { LicenseTag } from '../components/ui';

export default function Manifest({ ledger }: { ledger: Ledger }) {
  const batch = getActiveBatch(ledger);
  const m = useMemo(() => getManifest(ledger, batch), [ledger, batch]);

  const exportMd = () => {
    const text = buildManifestMarkdown(ledger);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
    a.download = 'release-manifest.md';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (!batch) {
    return <div className="empty">暂无就绪批次，请先在「批次台账」中导入锁文件。</div>;
  }

  return (
    <div className="manifest-view">
      <div className="manifest-head">
        <div>
          <h2>发布清单</h2>
          <p>
            当前批次：<b>{batch.fileName}</b> · 只取已确认的有效结论，待复核项不计入发布。
          </p>
        </div>
        <button className="outline" onClick={exportMd}>
          <Download size={15} />
          导出清单
        </button>
      </div>

      {m.pending.length > 0 && (
        <div className="manifest-block warning">
          <ShieldAlert size={18} />
          <div>
            <b>发布前还有 {m.pending.length} 项待复核</b>
            <p>待复核包尚未形成有效结论，未计入发布清单。请在「依赖总览」中完成裁决。</p>
          </div>
        </div>
      )}

      <ManifestSection title="可直接分发" count={m.ok.length} cls="ok" icon={<Check size={16} />} rows={m.ok} />
      <ManifestSection title="需保留声明" count={m.warn.length} cls="warn" icon={<AlertTriangle size={16} />} rows={m.warn} />
      <ManifestSection title="高风险" count={m.risk.length} cls="risk" icon={<AlertTriangle size={16} />} rows={m.risk} />
      <ManifestSection
        title="待复核（不计入发布）"
        count={m.pending.length}
        cls="pending"
        icon={<FileCheck size={16} />}
        rows={m.pending}
      />
    </div>
  );
}

function ManifestSection({
  title,
  count,
  cls,
  icon,
  rows,
}: {
  title: string;
  count: number;
  cls: string;
  icon: React.ReactNode;
  rows: Row[];
}) {
  return (
    <div className={'manifest-section ' + cls}>
      <div className="ms-head">
        <span className="ms-icon">{icon}</span>
        <h3>{title}</h3>
        <b>{count}</b>
      </div>
      {rows.length === 0 ? (
        <p className="muted">无</p>
      ) : (
        <div className="ms-rows">
          {rows.map((r) => (
            <div key={r.pkg.fingerprint} className="ms-row">
              <span className="dep-name">
                <span className="pkg-dot" /> {r.pkg.name}
              </span>
              <span className="muted">{r.pkg.version}</span>
              <LicenseTag license={r.pkg.license} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
