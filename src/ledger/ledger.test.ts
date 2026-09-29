import { describe, expect, it } from 'vitest';
import { fingerprint, inferLicense, normalizeLicense } from './codec';
import { parseLock } from './parse';
import {
  diffBatches,
  emptyLedger,
  releaseManifest,
  resolveRows,
  retryImport,
  recordAnalysis,
  settleBatch,
  setDecision,
  startImport,
  verdictFor,
} from './engine';
import { lockSample } from './samples';
import type { Ledger } from './types';

const npmV1 = lockSample('v1');
const npmV2 = lockSample('v2');
const composer = lockSample('composer');

/** 把一个批次从 parsing 推到 ready（逐包写缓存后收尾） */
function analyzeAll(ledger: Ledger, batchId: string): Ledger {
  const batch = ledger.batches[batchId];
  let next = ledger;
  for (const row of batch.packages) {
    if (!next.analysis[row.fp]) {
      next = recordAnalysis(next, {
        fp: row.fp,
        status: row.license === 'MIT' ? 'ok' : 'warn',
        note: 'test',
      });
    }
  }
  return settleBatch(next, batchId, null);
}

describe('内容指纹', () => {
  it('名称/版本/许可证任一变化都会改变指纹', () => {
    const base = fingerprint('npm', 'react', '18.3.1', 'MIT');
    expect(fingerprint('npm', 'react', '18.3.1', 'MIT')).toBe(base);
    expect(fingerprint('npm', 'react', '18.3.2', 'MIT')).not.toBe(base);
    expect(fingerprint('npm', 'react', '18.3.1', 'Apache-2.0')).not.toBe(base);
    expect(fingerprint('npm', 'preact', '18.3.1', 'MIT')).not.toBe(base);
    // 生态隔离：同名包不同生态指纹不同
    expect(fingerprint('composer', 'react', '18.3.1', 'MIT')).not.toBe(base);
  });

  it('归一化锁文件里的许可证字段', () => {
    expect(normalizeLicense('MIT')).toBe('MIT');
    expect(normalizeLicense(['MIT', 'Apache-2.0'])).toBe('MIT OR Apache-2.0');
    expect(normalizeLicense({ type: 'ISC' })).toBe('ISC');
    expect(normalizeLicense(undefined)).toBe('UNKNOWN');
    expect(normalizeLicense('(MIT OR Apache-2.0)')).toBe('MIT OR Apache-2.0');
    expect(inferLicense('lodash', 'UNKNOWN')).toBe('MIT');
    expect(inferLicense('totally-new', 'UNKNOWN')).toBe('UNKNOWN');
  });
});

describe('锁文件解析', () => {
  it('解析 package-lock v3，忽略根项目与重复', () => {
    const parsed = parseLock('package-lock.json', npmV1);
    expect(parsed.ecosystem).toBe('npm');
    expect(parsed.packages.map((p) => p.name).sort()).toEqual([
      'chart.js',
      'highlight.js',
      'legacy-parser',
      'lodash',
      'react',
    ]);
    const hl = parsed.packages.find((p) => p.name === 'highlight.js')!;
    expect(hl.license).toBe('BSD-3-Clause');
    expect(hl.source).toBe('registry');
  });

  it('解析 composer.lock（packages + packages-dev）并去掉版本前缀 v', () => {
    const parsed = parseLock('composer.lock', composer);
    expect(parsed.ecosystem).toBe('composer');
    expect(parsed.packages.map((p) => p.name)).toEqual([
      'monolog/monolog',
      'symfony/console',
      'twig/twig',
      'phpunit/phpunit',
    ]);
    expect(parsed.packages[0].version).toBe('3.5.0');
  });

  it('破损/无法识别的文件抛错而不是返回半包', () => {
    expect(() => parseLock('package-lock.json', lockSample('broken'))).toThrow(/JSON/);
    expect(() => parseLock('weird.lock', 'hello world')).toThrow(/无法识别/);
  });
});

describe('独立批次与原子提交', () => {
  it('两个锁文件同时导入形成两个互不影响的批次', () => {
    let l = emptyLedger();
    const a = startImport(l, 'package-lock.json', npmV1);
    l = a.ledger;
    const b = startImport(l, 'composer.lock', composer);
    l = b.ledger;
    expect(Object.keys(l.batches)).toHaveLength(2);
    expect(a.batch.id).not.toBe(b.batch.id);
    expect(a.batch.label).toMatch(/#1$/);
    expect(b.batch.label).toMatch(/#2$/);
    expect(a.batch.packages).not.toBe(b.batch.packages);
  });

  it('分析失败：批次落 failed 且无半成品进入发布视图；重试后整批 ready', () => {
    let l = emptyLedger();
    const { batch, ledger: afterImport } = startImport(l, 'package-lock.json', npmV1);
    l = afterImport;

    // 只缓存前 2 个指纹的结果，然后整批失败
    let cachedFp: string | undefined;
    for (const row of batch.packages.slice(0, 2)) {
      cachedFp = row.fp;
      l = recordAnalysis(l, { fp: row.fp, status: 'ok', note: '已确认' });
    }
    l = settleBatch(l, batch.id, '分析服务中断');
    expect(l.batches[batch.id].status).toBe('failed');
    expect(releaseManifest(l).packages).toHaveLength(0); // 失败批次不进发布

    // 已确认的指纹结果保留
    expect(l.analysis[cachedFp!]).toBeTruthy();

    // 重试：解析结果不丢，剩余指纹补齐后整批原子 ready
    const retry = retryImport(l, batch.id);
    l = retry.ledger;
    expect(l.batches[batch.id].status).toBe('parsing');
    expect(l.batches[batch.id].fingerprints).toHaveLength(5);
    l = analyzeAll(l, batch.id);
    expect(l.batches[batch.id].status).toBe('ready');
    expect(releaseManifest(l).packages).toHaveLength(5);
  });

  it('解析失败的批次没有任何行，重试修好后可用', () => {
    let l = emptyLedger();
    const bad = startImport(l, 'package-lock.json', lockSample('broken'));
    l = bad.ledger;
    expect(bad.batch.status).toBe('failed');
    expect(bad.batch.packages).toEqual([]);

    // 模拟修正原文件后重试
    const fixed = { ...bad.batch, raw: npmV1 };
    l = { ...l, batches: { ...l.batches, [bad.batch.id]: fixed } };
    l = retryImport(l, bad.batch.id).ledger;
    expect(l.batches[bad.batch.id].status).toBe('parsing');
    expect(l.batches[bad.batch.id].packages.length).toBe(5);
  });
});

describe('指纹裁决', () => {
  it('指纹不变：新批次照旧复用已确认的裁决与分析', () => {
    let l = emptyLedger();
    const b1 = startImport(l, 'package-lock.json', npmV1);
    l = analyzeAll(b1.ledger, b1.batch.id);
    const reactFp = b1.batch.packages.find((p) => p.name === 'react')!.fp;
    l = setDecision(l, b1.batch, reactFp, { verdict: 'approved', note: 'OK' });

    // 再次导入同内容（覆盖式发布的安全替代：独立批次）
    const b2 = startImport(l, 'package-lock.json', npmV1);
    l = analyzeAll(b2.ledger, b2.batch.id);
    const react2 = b2.batch.packages.find((p) => p.name === 'react')!;
    expect(react2.fp).toBe(reactFp);
    expect(verdictFor(l, react2.fp)).toBe('approved');
    expect(l.analysis[react2.fp]).toBeTruthy(); // 分析缓存也复用
  });

  it('指纹一变：同名包旧裁决失效，回到待复核', () => {
    let l = emptyLedger();
    const b1 = startImport(l, 'package-lock.json', npmV1);
    l = analyzeAll(b1.ledger, b1.batch.id);
    const lodashV1 = b1.batch.packages.find((p) => p.name === 'lodash')!;
    l = setDecision(l, b1.batch, lodashV1.fp, { verdict: 'approved', note: '放行' });
    const reactV1 = b1.batch.packages.find((p) => p.name === 'react')!;
    l = setDecision(l, b1.batch, reactV1.fp, { verdict: 'approved', note: '放行' });

    const b2 = startImport(l, 'package-lock.json', npmV2);
    l = analyzeAll(b2.ledger, b2.batch.id);
    const lodashV2 = b2.batch.packages.find((p) => p.name === 'lodash')!;
    expect(lodashV2.fp).not.toBe(lodashV1.fp);
    expect(verdictFor(l, lodashV2.fp)).toBe('pending');
    // 旧指纹的裁决仍留在台账里（历史可审计），但不适用于新内容
    expect(verdictFor(l, lodashV1.fp)).toBe('approved');

    // highlight.js 许可证从 BSD 变 MIT，同样失效
    const hl = b2.batch.packages.find((p) => p.name === 'highlight.js')!;
    expect(verdictFor(l, hl.fp)).toBe('pending');
    // react 指纹没变，裁决还在
    const react = b2.batch.packages.find((p) => p.name === 'react')!;
    expect(verdictFor(l, react.fp)).toBe('approved');
  });

  it('裁决快照来源，切换批次不串 source', () => {
    let l = emptyLedger();
    const b1 = startImport(l, 'package-lock.json', npmV1);
    l = analyzeAll(b1.ledger, b1.batch.id);
    const fp = b1.batch.packages[0].fp;
    l = setDecision(l, b1.batch, fp, { verdict: 'approved', note: 'n' });
    expect(l.decisions[fp].source).toBe(b1.batch.packages[0].source);

    const rows = resolveRows(l, b1.batch);
    const row = rows.find((r) => r.fp === fp)!;
    // 行上的 source 来自本批次，裁决上的 source 来自快照
    expect(row.source).toBe(row.decision!.source);
  });
});

describe('批次差异', () => {
  it('列出新增、消失和裁决变化', () => {
    let l = emptyLedger();
    const b1 = startImport(l, 'package-lock.json', npmV1);
    l = analyzeAll(b1.ledger, b1.batch.id);
    for (const p of b1.batch.packages) {
      l = setDecision(l, b1.batch, p.fp, {
        verdict: p.license === 'GPL-3.0' ? 'rejected' : 'approved',
        note: '',
      });
    }
    const b2 = startImport(l, 'package-lock.json', npmV2);
    l = analyzeAll(b2.ledger, b2.batch.id);
    const diff = diffBatches(l, b1.batch.id, b2.batch.id);

    expect(diff.added.map((d) => d.name)).toEqual(['date-fns']);
    expect(diff.removed.map((d) => d.name)).toEqual(['legacy-parser']);
    expect(diff.changed.map((d) => d.name).sort()).toEqual([
      'highlight.js',
      'lodash',
    ]);
    const lodashChange = diff.changed.find((d) => d.name === 'lodash')!;
    expect(lodashChange.from).toBe('approved');
    expect(lodashChange.to).toBe('pending');
  });

  it('无基线时全部算新增', () => {
    let l = emptyLedger();
    const b1 = startImport(l, 'package-lock.json', npmV1);
    l = b1.ledger;
    const diff = diffBatches(l, null, b1.batch.id);
    expect(diff.added).toHaveLength(5);
  });
});

describe('发布清单', () => {
  it('每个生态只取最新 ready 批次，失败批次不参与', () => {
    let l = emptyLedger();
    const b1 = startImport(l, 'package-lock.json', npmV1);
    l = analyzeAll(b1.ledger, b1.batch.id);

    // 第二个 npm 批次失败：发布清单仍取 b1
    const b2 = startImport(l, 'package-lock.json', npmV2);
    l = b2.ledger;
    l = settleBatch(l, b2.batch.id, '中断');

    // composer 批次成功：两个生态各自取最新 ready
    const c = startImport(l, 'composer.lock', composer);
    l = analyzeAll(c.ledger, c.batch.id);

    const manifest = releaseManifest(l);
    expect(manifest.batches.map((b) => b.ecosystem)).toEqual(['composer', 'npm']);
    const npmBatch = manifest.batches.find((b) => b.ecosystem === 'npm')!;
    expect(npmBatch.id).toBe(b1.batch.id); // 失败的 b2 没有顶替掉 b1
    expect(manifest.packages).toHaveLength(5 + 4);

    // b2 修复成功后，发布清单切到 b2
    l = retryImport(l, b2.batch.id).ledger;
    l = analyzeAll(l, b2.batch.id);
    const after = releaseManifest(l);
    expect(after.batches.find((b) => b.ecosystem === 'npm')!.id).toBe(b2.batch.id);
    expect(after.packages.find((p) => p.name === 'date-fns')).toBeTruthy();
    expect(after.packages.find((p) => p.name === 'legacy-parser')).toBeUndefined();
  });

  it('发布视图只带当前有效裁决', () => {
    let l = emptyLedger();
    const b1 = startImport(l, 'package-lock.json', npmV1);
    l = analyzeAll(b1.ledger, b1.batch.id);
    const react = b1.batch.packages.find((p) => p.name === 'react')!;
    l = setDecision(l, b1.batch, react.fp, { verdict: 'approved', note: '' });
    const gpl = b1.batch.packages.find((p) => p.name === 'legacy-parser')!;
    l = setDecision(l, b1.batch, gpl.fp, { verdict: 'rejected', note: '' });

    const pkgs = releaseManifest(l).packages;
    expect(pkgs.find((p) => p.name === 'react')!.verdict).toBe('approved');
    expect(pkgs.find((p) => p.name === 'legacy-parser')!.verdict).toBe('rejected');
    expect(pkgs.find((p) => p.name === 'lodash')!.verdict).toBe('pending');
  });
});
