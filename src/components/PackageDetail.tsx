import { AlertTriangle, Check, FileCode2, History, RotateCcw, ShieldX, X } from 'lucide-react';
import type { Batch, DecisionInput, ResolvedPackage } from '../ledger/types';
import {
  batchStatusMeta,
  ecosystemName,
  formatTime,
  licenseColor,
  shortFp,
  verdictMeta,
} from '../ledger/ui';

interface Props {
  batch: Batch;
  pkg: ResolvedPackage | null;
  onClose: () => void;
  onDecide: (fp: string, input: DecisionInput) => void;
  onWithdraw: (fp: string) => void;
}

/** 右侧详情：来源始终是当前批次行；裁决按指纹读取并带自己的来源快照 */
export default function PackageDetail({ batch, pkg, onClose, onDecide, onWithdraw }: Props) {
  if (!pkg) {
    return (
      <div className="detail detail-empty">
        <FileCode2 size={26} />
        <b>选择一个包查看详情</b>
        <p>这里会显示内容指纹、来源和当前生效的人工裁决。指纹随包内容变化，内容一改旧裁决自动失效。</p>
      </div>
    );
  }
  const color = licenseColor(pkg.license);
  const vm = verdictMeta[pkg.verdict];
  const findingClass =
    pkg.verdict === 'approved' ? 'ok' : pkg.verdict === 'rejected' ? 'risk' : pkg.analysisStatus;

  return (
    <div className="detail">
      <div className="detail-head">
        <div className="detail-icon" style={{ background: color + '1c', color }}>
          <FileCode2 size={20} />
        </div>
        <div className="detail-title">
          <span>{ecosystemName[pkg.ecosystem]} · 内容指纹 {shortFp(pkg.fp)}</span>
          <h2>{pkg.name}</h2>
        </div>
        <button className="close" onClick={onClose}>
          <X size={16} />
        </button>
      </div>

      <div className="detail-grid">
        <div>
          <label>版本</label>
          <b>{pkg.version}</b>
        </div>
        <div>
          <label>许可证</label>
          <b>
            <i className="license" style={{ color, background: color + '18' }}>
              {pkg.license}
            </i>
          </b>
        </div>
        <div>
          <label>来源</label>
          <b>{pkg.source}</b>
        </div>
      </div>

      <div className={'finding ' + (findingClass === 'unknown' ? 'warn' : findingClass)}>
        <div className="finding-icon">
          {pkg.analysisStatus === 'ok' ? <Check size={16} /> : <AlertTriangle size={16} />}
        </div>
        <div>
          <b>机器初判：{analysisLabel(pkg.analysisStatus)}</b>
          <p>{pkg.analysisNote}（按内容指纹缓存，同指纹跨批次/重试照旧可用）</p>
        </div>
      </div>

      <div className="verdict-box">
        <div className="verdict-head">
          <History size={14} />
          <span>人工裁决（绑定内容指纹）</span>
          <i className="verdict-pill" style={{ color: vm.color, background: vm.bg }}>
            {vm.label}
          </i>
        </div>
        {pkg.decision ? (
          <div className="verdict-body">
            <p>{pkg.decision.note || '（无备注）'}</p>
            <div className="verdict-meta">
              <span>
                裁决于 {formatTime(pkg.decision.decidedAt)} · 当时来源：
                <b>{pkg.decision.source}</b>
              </span>
              <button className="ghost-btn" onClick={() => onWithdraw(pkg.fp)}>
                <RotateCcw size={12} /> 撤回裁决
              </button>
            </div>
            <p className="verdict-hint">
              来源来自裁决快照：切换批次时，包行的来源与裁决来源各自独立，不会互相串写。
            </p>
          </div>
        ) : (
          <div className="verdict-body">
            <p className="pending-hint">
              <ShieldX size={13} /> 当前指纹没有已确认裁决。新导入或内容变更后都会回到这里等待复核。
            </p>
          </div>
        )}
        <div className="verdict-actions">
          <button
            className="approve-btn"
            disabled={batch.status !== 'ready'}
            onClick={() => onDecide(pkg.fp, { verdict: 'approved', note: defaultNote(pkg, 'approved') })}
          >
            <Check size={14} /> 确认放行
          </button>
          <button
            className="reject-btn"
            disabled={batch.status !== 'ready'}
            onClick={() => onDecide(pkg.fp, { verdict: 'rejected', note: defaultNote(pkg, 'rejected') })}
          >
            <ShieldX size={14} /> 驳回
          </button>
        </div>
        {batch.status !== 'ready' && (
          <p className="verdict-hint">批次未就绪（{batchStatusMeta[batch.status].label}），暂不能裁决。</p>
        )}
      </div>
    </div>
  );
}

function analysisLabel(s: ResolvedPackage['analysisStatus']): string {
  return s === 'ok' ? '可直接分发' : s === 'warn' ? '保留声明' : s === 'risk' ? '分发受限' : '信息不足';
}

function defaultNote(pkg: ResolvedPackage, v: 'approved' | 'rejected'): string {
  if (v === 'approved') {
    return pkg.analysisStatus === 'ok'
      ? `已核对 ${pkg.license} 条款，确认放行`
      : '已核对分发义务，确认放行';
  }
  return `${pkg.license} 与当前分发方式冲突，驳回`;
}
