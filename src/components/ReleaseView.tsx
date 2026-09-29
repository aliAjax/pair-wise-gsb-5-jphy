import { Download, ShieldCheck, ShieldX, TimerReset } from 'lucide-react';
import { releaseManifest } from '../ledger/engine';
import type { Ledger } from '../ledger/types';
import { ecosystemName, licenseColor, verdictMeta } from '../ledger/ui';

export default function ReleaseView({ ledger }: { ledger: Ledger }) {
  const { batches, packages } = releaseManifest(ledger);
  const approved = packages.filter((p) => p.verdict === 'approved');
  const rejected = packages.filter((p) => p.verdict === 'rejected');
  const pending = packages.filter((p) => p.verdict === 'pending');
  const blocked = rejected.length + pending.length;

  const exportReport = () => {
    const lines = [
      '# 发布许可证清单（仅含当前有效结论）',
      '',
      `> 生成时间 ${new Date().toLocaleString()}`,
      ...batches.map((b) => `> 来源批次：${b.label}（${ecosystemName[b.ecosystem]}，#${b.ord}）`),
      '',
      '## 已确认放行',
      '',
      '| 包 | 版本 | 许可证 | 生态 | 来源 |',
      '|---|---|---|---|---|',
      ...approved.map((p) => `| ${p.name} | ${p.version} | ${p.license} | ${ecosystemName[p.ecosystem]} | ${p.source} |`),
      '',
      '## 未放行（不在本次发布中）',
      '',
      '| 包 | 版本 | 状态 | 原因 |',
      '|---|---|---|---|',
      ...rejected.map((p) => `| ${p.name} | ${p.version} | 已驳回 | ${p.decision?.note ?? ''} |`),
      ...pending.map((p) => `| ${p.name} | ${p.version} | 待复核 | ${p.analysisNote} |`),
      '',
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'release-manifest.md';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <section className="release-view">
      <div className="release-head">
        <div>
          <h2>发布清单</h2>
          <p>每个生态只取最新「已就绪」批次的当前有效结论；失败/分析中批次与历史批次均不参与。</p>
        </div>
        <button className="primary" disabled={!approved.length} onClick={exportReport}>
          <Download size={15} /> 导出发布清单
        </button>
      </div>

      <div className="release-banner">
        <div className={'release-gate ' + (blocked ? 'blocked' : 'pass')}>
          {blocked ? <ShieldX size={18} /> : <ShieldCheck size={18} />}
          <div>
            <b>{blocked ? `发布未通过：${blocked} 个包未放行` : '发布检查通过'}</b>
            <small>
              {blocked
                ? `${pending.length} 个待复核，${rejected.length} 个已驳回——只有「已确认放行」的包进入发布产物`
                : `${approved.length} 个包均已确认放行`}
            </small>
          </div>
        </div>
        <div className="release-sources">
          <TimerReset size={14} />
          <span>
            当前来源：
            {batches.length
              ? batches.map((b) => `${ecosystemName[b.ecosystem]} ← ${b.label}`).join('；')
              : '尚无就绪批次'}
          </span>
        </div>
      </div>

      <div className="release-table">
        <div className="tr th">
          <span>包</span>
          <span>版本</span>
          <span>许可证</span>
          <span>来源批次</span>
          <span>结论</span>
        </div>
        {packages.map((p) => {
          const vm = verdictMeta[p.verdict];
          return (
            <div className="tr" key={p.fp}>
              <span className="dep-name">{p.name}</span>
              <span className="muted">{p.version}</span>
              <span>
                <i className="license" style={{ color: licenseColor(p.license), background: licenseColor(p.license) + '18' }}>
                  {p.license}
                </i>
              </span>
              <span className="muted">{p.source}</span>
              <span>
                <i className="verdict-badge" style={{ color: vm.color, background: vm.bg }}>
                  {vm.label}
                </i>
              </span>
            </div>
          );
        })}
        {!packages.length && (
          <p className="release-empty">还没有已就绪批次。导入一个锁文件，完成复核后这里才会出现可发布的结论。</p>
        )}
      </div>
    </section>
  );
}
