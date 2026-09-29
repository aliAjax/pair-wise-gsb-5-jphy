// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { releaseManifest } from './engine';
import { lockSample } from './samples';
import { useLedger } from './useLedger';

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => localStorage.clear());

describe('useLedger 集成流程', () => {
  it('两个锁文件同时导入：成为两个并行、独立的就绪批次', async () => {
    const { result } = renderHook(() => useLedger());
    act(() => {
      result.current.importFiles([
        { name: 'package-lock.json', content: lockSample('v1') },
        { name: 'composer.lock', content: lockSample('composer') },
      ]);
    });

    await waitFor(
      () => {
        const statuses = Object.values(result.current.ledger.batches).map((b) => b.status);
        expect(statuses).toEqual(['ready', 'ready']);
      },
      { timeout: 4000 },
    );

    const batches = Object.values(result.current.ledger.batches);
    expect(batches[0].packages.length).toBe(5);
    expect(batches[1].packages.length).toBe(4);
    // 包行互不串：生态、来源各自独立
    expect(batches[0].ecosystem).toBe('npm');
    expect(batches[1].ecosystem).toBe('composer');
    expect(batches[0].packages.every((p) => p.source === 'registry')).toBe(true);
    expect(batches[1].packages.some((p) => p.source === 'packagist')).toBe(true);
  });

  it('分析中断：批次 failed 且无半批；重试后复用已确认结果整批 ready', async () => {
    const { result } = renderHook(() => useLedger());
    act(() => {
      result.current.importFiles(
        [{ name: 'package-lock.json', content: lockSample('v1') }],
        { injectAnalysisFailure: true },
      );
    });

    // 等批次落 failed
    await waitFor(
      () => {
        const b = Object.values(result.current.ledger.batches)[0];
        expect(b.status).toBe('failed');
      },
      { timeout: 3000 },
    );
    const batchId = Object.keys(result.current.ledger.batches)[0];
    expect(releaseManifest(result.current.ledger).packages).toHaveLength(0);
    const cachedBefore = Object.keys(result.current.ledger.analysis).length;
    expect(cachedBefore).toBeGreaterThan(0); // 已确认结果保留
    expect(cachedBefore).toBeLessThan(5); // 但没跑完整批

    // 重试
    act(() => {
      result.current.retry(batchId);
    });
    await waitFor(
      () => {
        expect(result.current.ledger.batches[batchId].status).toBe('ready');
      },
      { timeout: 4000 },
    );
    const batch = result.current.ledger.batches[batchId];
    expect(batch.attempts).toBe(2);
    expect(releaseManifest(result.current.ledger).packages).toHaveLength(5);
    // 所有指纹都有分析结果
    expect(batch.fingerprints.every((fp) => result.current.ledger.analysis[fp])).toBe(true);
  }, 8000);

  it('解析失败批次可重试（修复原文后）', async () => {
    const { result } = renderHook(() => useLedger());
    act(() => {
      result.current.importFiles(
        [{ name: 'package-lock.json', content: lockSample('broken') }],
      );
    });
    await tick(0);
    const id = Object.keys(result.current.ledger.batches)[0];
    expect(result.current.ledger.batches[id].status).toBe('failed');
    expect(result.current.ledger.batches[id].packages).toEqual([]);
  });

  it('指纹裁决跨批次保留，指纹变化自动失效', async () => {
    const { result } = renderHook(() => useLedger());
    act(() => {
      result.current.importFiles(
        [{ name: 'package-lock.json', content: lockSample('v1') }],
      );
    });
    await waitFor(
      () => expect(Object.values(result.current.ledger.batches)[0].status).toBe('ready'),
      { timeout: 3000 },
    );
    const b1 = Object.values(result.current.ledger.batches)[0];
    const lodashV1 = b1.packages.find((p) => p.name === 'lodash')!.fp;
    const react = b1.packages.find((p) => p.name === 'react')!.fp;
    act(() => {
      result.current.decide(b1.id, lodashV1, { verdict: 'approved', note: 'v1 放行' });
      result.current.decide(b1.id, react, { verdict: 'approved', note: '' });
    });

    // 导入 v2（同批次演进）
    act(() => {
      result.current.importFiles(
        [{ name: 'package-lock.json', content: lockSample('v2') }],
      );
    });
    await waitFor(
      () => {
        const list = Object.values(result.current.ledger.batches);
        expect(list.every((b) => b.status === 'ready')).toBe(true);
      },
      { timeout: 3000 },
    );
    const b2 = Object.values(result.current.ledger.batches).find((b) => b.ord === 2)!;
    const lodashV2 = b2.packages.find((p) => p.name === 'lodash')!;
    const reactV2 = b2.packages.find((p) => p.name === 'react')!;

    // lodash 升级，指纹变，旧裁决失效
    expect(lodashV2.fp).not.toBe(lodashV1);
    expect(result.current.ledger.decisions[lodashV2.fp]).toBeUndefined();
    // react 指纹不变，裁决照旧
    expect(result.current.ledger.decisions[reactV2.fp]?.verdict).toBe('approved');
  }, 6000);

  it('台账持久化到 localStorage，刷新后恢复 parsing 批次', async () => {
    const view1 = renderHook(() => useLedger());
    act(() => {
      view1.result.current.importFiles(
        [{ name: 'package-lock.json', content: lockSample('v1') }],
      );
    });
    await tick(60); // 中途「刷新」
    const raw = localStorage.getItem('license-scan-ledger-v1');
    expect(raw).toBeTruthy();

    const view2 = renderHook(() => useLedger());
    await waitFor(
      () => expect(Object.values(view2.result.current.ledger.batches)[0].status).toBe('ready'),
      { timeout: 4000 },
    );
  });
});
