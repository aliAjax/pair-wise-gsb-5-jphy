import type { Batch, Verdict } from './types';

export const licenseColors: Record<string, string> = {
  MIT: '#35b995',
  'BSD-3-Clause': '#6d9ee8',
  'GPL-3.0': '#ec8c75',
  'Apache-2.0': '#b18ee4',
  ISC: '#57b8c9',
  UNKNOWN: '#d3944d',
};

export const ecosystemName: Record<string, string> = {
  npm: 'npm',
  composer: 'PHP composer',
};

export function licenseColor(license: string): string {
  if (licenseColors[license]) return licenseColors[license];
  if (/GPL|AGPL|SSPL/i.test(license)) return '#ec8c75';
  if (/MIT|ISC|BSD|Apache|MPL/i.test(license)) return '#6d9ee8';
  return '#a0aab0';
}

export const verdictMeta: Record<
  Verdict,
  { label: string; color: string; bg: string }
> = {
  approved: { label: '已确认放行', color: '#159e7e', bg: '#e8f8f2' },
  rejected: { label: '已驳回', color: '#d66c5e', bg: '#fdeeea' },
  pending: { label: '待复核', color: '#c78a43', bg: '#fdf6ec' },
};

export const batchStatusMeta: Record<
  Batch['status'],
  { label: string; color: string; dot: string }
> = {
  parsing: { label: '分析中', color: '#6d9ee8', dot: '#6d9ee8' },
  ready: { label: '已就绪', color: '#159e7e', dot: '#35b995' },
  failed: { label: '失败可重试', color: '#d66c5e', dot: '#ec8c75' },
};

export function formatTime(ts?: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function shortFp(fp: string): string {
  return fp.slice(-8);
}
