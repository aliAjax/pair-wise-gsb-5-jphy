import { AlertTriangle, Check, Clock } from 'lucide-react';
import type { Verdict } from '../ledger';
import { verdictLabel } from '../ledger';

export const licenseColors: Record<string, string> = {
  MIT: '#35b995',
  'BSD-3-Clause': '#6d9ee8',
  'Apache-2.0': '#b18ee4',
  'GPL-3.0': '#ec8c75',
  UNKNOWN: '#9aa8ac',
};

export function LicenseTag({ license }: { license: string }) {
  const c = licenseColors[license] || '#888';
  return (
    <i className="license" style={{ color: c, background: c + '18' }}>
      {license}
    </i>
  );
}

export function VerdictBadge({ v }: { v: Verdict }) {
  const cls = v === 'ok' ? 'ok' : v === 'warn' ? 'warn' : v === 'risk' ? 'risk' : 'pending';
  return (
    <span className={'status ' + cls}>
      {v === 'ok' ? <Check size={13} /> : v === 'pending' ? <Clock size={13} /> : <AlertTriangle size={13} />}
      {verdictLabel(v)}
    </span>
  );
}
