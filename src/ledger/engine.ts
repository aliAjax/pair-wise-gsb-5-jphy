import { assessLicense, fingerprint } from './codec';
import { fingerprintsOf, parseLock, type ParsedPackage } from './parse';
import type {
  AnalysisResult,
  Batch,
  BatchDiff,
  DecisionInput,
  DiffEntry,
  Ecosystem,
  Ledger,
  PackageRow,
  ResolvedPackage,
  Verdict,
} from './types';

const STORAGE_KEY = 'license-scan-ledger-v1';

export function emptyLedger(): Ledger {
  return { version: 1, batches: {}, decisions: {}, analysis: {}, seq: 0 };
}

export function loadLedger(): Ledger {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyLedger();
    const parsed = JSON.parse(raw) as Partial<Ledger>;
    if (!parsed || parsed.version !== 1 || typeof parsed.batches !== 'object') {
      return emptyLedger();
    }
    return {
      version: 1,
      batches: parsed.batches ?? {},
      decisions: parsed.decisions ?? {},
      analysis: parsed.analysis ?? {},
      seq: parsed.seq ?? 0,
    };
  } catch {
    return emptyLedger();
  }
}

export function saveLedger(ledger: Ledger): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ledger));
  } catch {
    // 配额不足等情况下本次状态仍在内存中可用
  }
}

function newBatchId(): string {
  return `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function toRows(eco: Ecosystem, pkgs: ParsedPackage[]): PackageRow[] {
  return pkgs.map((p) => ({
    fp: fingerprint(eco, p.name, p.version, p.license),
    ecosystem: eco,
    name: p.name,
    version: p.version,
    license: p.license,
    source: p.source,
  }));
}

function guessEcosystemQuiet(filename: string): Ecosystem {
  return filename.toLowerCase().endsWith('composer.lock') ? 'composer' : 'npm';
}

/**
 * 导入一个锁文件 = 建立【独立批次】。
 * 解析是同步原子的：成功则批次进入 parsing 并带上完整包行；
 * 失败则批次落 failed、packages 为空，只保留原文与错误。
 * 任何情况下都不触碰既有批次，两个窗口同时提交也只会得到两个独立批次。
 */
export function startImport(
  ledger: Ledger,
  filename: string,
  content: string,
  now = Date.now(),
): { ledger: Ledger; batch: Batch } {
  const seq = ledger.seq + 1;
  const id = newBatchId();
  let batch: Batch;
  try {
    const parsed = parseLock(filename, content);
    batch = {
      id,
      ord: seq,
      label: `${filename} #${seq}`,
      ecosystem: parsed.ecosystem,
      status: 'parsing',
      raw: content,
      fingerprints: fingerprintsOf(parsed),
      packages: toRows(parsed.ecosystem, parsed.packages),
      analyzed: [],
      attempts: 1,
      createdAt: now,
    };
  } catch (e) {
    // 解析失败：没有指纹、没有行，只有原文与错误，绝不产生半批
    batch = {
      id,
      ord: seq,
      label: `${filename} #${seq}`,
      ecosystem: guessEcosystemQuiet(filename),
      status: 'failed',
      raw: content,
      fingerprints: [],
      packages: [],
      analyzed: [],
      attempts: 1,
      error: (e as Error).message,
      createdAt: now,
      settledAt: now,
    };
  }
  return {
    ledger: { ...ledger, seq, batches: { ...ledger.batches, [id]: batch } },
    batch,
  };
}

/**
 * 重试失败批次：重新解析（若上次没解析出来），回到 parsing 等待分析。
 * 已按指纹缓存的分析结果与人工裁决都原样保留、直接复用。
 */
export function retryImport(
  ledger: Ledger,
  batchId: string,
  now = Date.now(),
): { ledger: Ledger; batch: Batch } {
  const prev = mustBatch(ledger, batchId);
  if (prev.status !== 'failed') return { ledger, batch: prev };
  const attempts = prev.attempts + 1;
  let batch: Batch = { ...prev, attempts };

  if (!prev.fingerprints.length) {
    try {
      const filename = prev.label.replace(/\s+#\d+$/, '');
      const parsed = parseLock(filename, prev.raw);
      batch = {
        ...batch,
        ecosystem: parsed.ecosystem,
        fingerprints: fingerprintsOf(parsed),
        packages: toRows(parsed.ecosystem, parsed.packages),
      };
    } catch (e) {
      return {
        ledger: {
          ...ledger,
          batches: {
            ...ledger.batches,
            [batchId]: { ...batch, status: 'failed', error: (e as Error).message, settledAt: now },
          },
        },
        batch: { ...batch, status: 'failed', error: (e as Error).message, settledAt: now },
      };
    }
  }
  batch = { ...batch, status: 'parsing', error: undefined, settledAt: undefined };
  return {
    ledger: { ...ledger, batches: { ...ledger.batches, [batchId]: batch } },
    batch,
  };
}

/** 缓存一个指纹的分析结果（失败重试时这就是「照旧可用的已确认结果」） */
export function recordAnalysis(ledger: Ledger, result: AnalysisResult): Ledger {
  if (ledger.analysis[result.fp]) return ledger;
  return { ...ledger, analysis: { ...ledger.analysis, [result.fp]: result } };
}

/**
 * 批次分析收尾，整批一次提交：
 * - 全部指纹都有分析结果 -> ready；
 * - 缺任何一个 -> failed，批次 packages 不进入任何发布视图。
 */
export function settleBatch(
  ledger: Ledger,
  batchId: string,
  failure: string | null,
  now = Date.now(),
): Ledger {
  const prev = mustBatch(ledger, batchId);
  const allDone =
    prev.fingerprints.length > 0 &&
    prev.fingerprints.every((fp) => Boolean(ledger.analysis[fp]));
  const batch: Batch =
    failure || !allDone
      ? {
          ...prev,
          status: 'failed',
          error: failure ?? '分析未完成，已回滚整批',
          settledAt: now,
        }
      : { ...prev, status: 'ready', error: undefined, settledAt: now };
  return { ...ledger, batches: { ...ledger.batches, [batchId]: batch } };
}

function mustBatch(ledger: Ledger, id: string): Batch {
  const b = ledger.batches[id];
  if (!b) throw new Error(`批次不存在：${id}`);
  return b;
}

/** 当前指纹的生效裁决；指纹查不到就返回 null（自动回待复核） */
export function decisionFor(ledger: Ledger, fp: string) {
  return ledger.decisions[fp] ?? null;
}

export function verdictFor(ledger: Ledger, fp: string): Verdict {
  return ledger.decisions[fp]?.verdict ?? 'pending';
}

/** 合成批次行视图：分析与裁决都按指纹查，source 始终用本行（不串批） */
export function resolveRows(ledger: Ledger, batch: Batch): ResolvedPackage[] {
  return batch.packages.map((row) => {
    const analysis = ledger.analysis[row.fp];
    const decision = decisionFor(ledger, row.fp);
    return {
      ...row,
      analysisStatus: analysis?.status ?? 'unknown',
      analysisNote: analysis?.note ?? assessLicense(row.license).note,
      decision,
      verdict: decision?.verdict ?? 'pending',
    };
  });
}

/**
 * 记人工裁决：与【当前内容指纹】绑定，并快照来源。
 * 内容一变指纹就变，这里自然查不到，旧裁决失效、回到待复核。
 * 只允许裁决本批次包含的指纹，防止跨批串写。
 */
export function setDecision(
  ledger: Ledger,
  batch: Batch,
  fp: string,
  input: DecisionInput,
  now = Date.now(),
): Ledger {
  const row = batch.packages.find((r) => r.fp === fp);
  if (!row) return ledger;
  const record = {
    verdict: input.verdict,
    note: input.note,
    source: row.source,
    decidedAt: now,
  };
  return { ...ledger, decisions: { ...ledger.decisions, [fp]: record } };
}

const keyOf = (r: PackageRow): string => `${r.ecosystem}:${r.name}`;

function diffEntry(row: PackageRow, kind: DiffEntry['kind'], extra?: Partial<DiffEntry>): DiffEntry {
  return {
    kind,
    fp: row.fp,
    ecosystem: row.ecosystem,
    name: row.name,
    version: row.version,
    license: row.license,
    ...extra,
  };
}

/**
 * 两个批次之间列：
 * - added   ：目标批次中新出现的内容指纹；
 * - removed ：基线批次中消失的内容指纹；
 * - changed ：同名包指纹变化（内容被改过），旧裁决随之失效 -> pending。
 */
export function diffBatches(ledger: Ledger, baseId: string | null, targetId: string): BatchDiff {
  const target = mustBatch(ledger, targetId);
  const added: DiffEntry[] = [];
  const removed: DiffEntry[] = [];
  const changed: DiffEntry[] = [];

  if (!baseId) {
    return {
      baseId: null,
      targetId,
      added: target.packages.map((r) => diffEntry(r, 'added')),
      removed,
      changed,
    };
  }

  const base = mustBatch(ledger, baseId);
  const baseByFp = new Map(base.packages.map((r) => [r.fp, r]));
  const targetByFp = new Map(target.packages.map((r) => [r.fp, r]));
  const baseByName = new Map<string, PackageRow>();
  for (const r of base.packages) baseByName.set(keyOf(r), r);
  const changedBaseFps = new Set<string>();

  for (const row of target.packages) {
    if (!baseByFp.has(row.fp)) {
      const old = baseByName.get(keyOf(row));
      if (old && !targetByFp.has(old.fp)) {
        // 同名包内容指纹变化：旧裁决失效，回到待复核
        changed.push(
          diffEntry(row, 'decision-changed', {
            from: verdictFor(ledger, old.fp),
            to: 'pending',
          }),
        );
        changedBaseFps.add(old.fp);
      } else {
        added.push(diffEntry(row, 'added'));
      }
    }
  }
  for (const row of base.packages) {
    if (!targetByFp.has(row.fp) && !changedBaseFps.has(row.fp)) {
      removed.push(diffEntry(row, 'removed'));
    }
  }
  return { baseId, targetId, added, removed, changed };
}

/**
 * 发布清单：每个生态只取【最新一个 ready 批次】。
 * failed / parsing 批次永远进不来；更早的 ready 批次是历史台账，不参与发布。
 */
export function releaseManifest(ledger: Ledger): {
  batches: Batch[];
  packages: ResolvedPackage[];
} {
  const latest = new Map<Ecosystem, Batch>();
  const orderOf = (b: Batch): number => b.ord ?? b.createdAt;
  for (const batch of Object.values(ledger.batches)) {
    if (batch.status !== 'ready') continue;
    const cur = latest.get(batch.ecosystem);
    if (!cur || orderOf(batch) > orderOf(cur)) latest.set(batch.ecosystem, batch);
  }
  const batches = [...latest.values()].sort((a, b) => a.ecosystem.localeCompare(b.ecosystem));
  const packages = batches
    .flatMap((b) => resolveRows(ledger, b))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { batches, packages };
}

/** 单个包的机器初判（结果以 fp 为键，重试/跨批次直接复用） */
export function analyzeRow(row: PackageRow): AnalysisResult {
  const { status, note } = assessLicense(row.license);
  return { fp: row.fp, status, note };
}
