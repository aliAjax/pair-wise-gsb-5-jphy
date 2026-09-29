import { useCallback, useEffect, useRef, useState } from 'react';
import {
  analyzeRow,
  emptyLedger,
  loadLedger,
  recordAnalysis,
  retryImport,
  saveLedger,
  settleBatch,
  setDecision,
  startImport,
} from './engine';
import type { DecisionInput, Ledger } from './types';

export interface ImportFile {
  name: string;
  content: string;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useLedger() {
  const [ledger, setLedger] = useState<Ledger>(() =>
    typeof localStorage === 'undefined' ? emptyLedger() : loadLedger(),
  );
  const ledgerRef = useRef(ledger);
  ledgerRef.current = ledger;
  const [running, setRunning] = useState<Record<string, boolean>>({});
  const runningGuard = useRef(new Set<string>());
  /** batchId -> 需要注入失败的指纹（只在首次分析生效） */
  const failureAt = useRef(new Map<string, string>());
  /** 等待 watcher 拉起分析的新批次：label -> 是否注入分析失败 */
  const pendingKick = useRef(new Map<string, boolean>());

  useEffect(() => {
    saveLedger(ledger);
    // 旧版本地清单已被台账取代
    localStorage.removeItem('license-lens');
  }, [ledger]);

  const markRunning = useCallback((id: string, on: boolean) => {
    if (on) runningGuard.current.add(id);
    else runningGuard.current.delete(id);
    setRunning((r) => {
      if (on && r[id]) return r;
      const next = { ...r };
      if (on) next[id] = true;
      else delete next[id];
      return next;
    });
  }, []);

  /**
   * 分析一个 parsing 批次：逐包写入【按指纹的全局缓存】，
   * 全部成功才把批次原子置为 ready；中途失败立即把批次置 failed，
   * 已缓存的指纹结果保留——重试时照旧可用，只需补齐剩余部分。
   */
  const runAnalysis = useCallback(
    async (batchId: string) => {
      if (runningGuard.current.has(batchId)) return;
      markRunning(batchId, true);
      try {
        const failAtFp = failureAt.current.get(batchId);
        for (;;) {
          // 让前面的 setState 先提交
          await delay(40);
          const batch = ledgerRef.current.batches[batchId];
          if (!batch || batch.status !== 'parsing') return; // 已重试/被取代

          let failedRowName: string | null = null;
          for (const row of batch.packages) {
            await delay(120 + Math.random() * 100);
            const live = ledgerRef.current.batches[batchId];
            if (!live || live.status !== 'parsing') return;
            if (failAtFp && row.fp === failAtFp) {
              failureAt.current.delete(batchId);
              failedRowName = row.name;
              break;
            }
            if (!ledgerRef.current.analysis[row.fp]) {
              setLedger((l) => recordAnalysis(l, analyzeRow(row)));
            }
          }

          if (failedRowName) {
            // 整批回滚：已缓存的指纹结果留在全局缓存中，重试时直接复用
            setLedger((l) =>
              settleBatch(
                l,
                batchId,
                `分析服务在处理「${failedRowName}」时中断，整批未提交（已确认结果已保留）`,
              ),
            );
            return;
          }
          // settleBatch 会校验：所有指纹都有结果才 ready，否则 failed
          setLedger((l) => settleBatch(l, batchId, null));
          return;
        }
      } finally {
        markRunning(batchId, false);
      }
    },
    [markRunning],
  );

  // 台账中出现 parsing 批次时统一拉起分析（含刷新后的恢复）。
  // 由 effect 驱动，避免在 setState updater 内安排副作用。
  useEffect(() => {
    for (const batch of Object.values(ledger.batches)) {
      if (batch.status !== 'parsing' || runningGuard.current.has(batch.id)) continue;
      const inject = pendingKick.current.get(batch.label) ?? false;
      pendingKick.current.delete(batch.label);
      if (inject && batch.packages.length > 1) {
        failureAt.current.set(
          batch.id,
          batch.packages[Math.min(1, batch.packages.length - 1)].fp,
        );
      }
      void runAnalysis(batch.id);
    }
  }, [ledger, runAnalysis]);

  /** 导入一个或多个锁文件：每个文件形成独立批次，可并行分析 */
  const importFiles = useCallback(
    (files: ImportFile[], opts: { injectAnalysisFailure?: boolean } = {}) => {
      const labels: string[] = [];
      setLedger((l) => {
        let next = l;
        for (const file of files) {
          const r = startImport(next, file.name, file.content);
          next = r.ledger;
          labels.push(r.batch.label);
        }
        return next;
      });
      for (const label of labels) {
        pendingKick.current.set(label, Boolean(opts.injectAnalysisFailure));
      }
    },
    [],
  );

  const retry = useCallback(
    (batchId: string) => {
      setLedger((l) => retryImport(l, batchId).ledger);
      // 状态提交后由 parsing watcher 统一拉起，不在 setState 前抢跑
    },
    [],
  );

  const decide = useCallback((batchId: string, fp: string, input: DecisionInput) => {
    setLedger((l) => {
      const batch = l.batches[batchId];
      return batch ? setDecision(l, batch, fp, input) : l;
    });
  }, []);

  /** 撤销裁决：包回到待复核（裁决本身只与指纹绑定） */
  const withdraw = useCallback((fp: string) => {
    setLedger((l) => {
      if (!l.decisions[fp]) return l;
      const decisions = { ...l.decisions };
      delete decisions[fp];
      return { ...l, decisions };
    });
  }, []);

  const removeBatch = useCallback((batchId: string) => {
    runningGuard.current.delete(batchId);
    failureAt.current.delete(batchId);
    setLedger((l) => {
      if (!l.batches[batchId]) return l;
      const batches = { ...l.batches };
      delete batches[batchId];
      return { ...l, batches };
    });
  }, []);

  return { ledger, running, importFiles, retry, decide, withdraw, removeBatch };
}

export type LedgerApi = ReturnType<typeof useLedger>;
