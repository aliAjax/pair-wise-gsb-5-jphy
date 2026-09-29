// 可恢复的扫描台账（recoverable scan ledger）
//
// 核心约定：
// 1. 每个锁文件导入都先形成一个独立批次（batch），批次有自己的 id、状态和包列表，
//    并行解析的两个批次不会混成一批。
// 2. 包按“内容指纹”识别：指纹由 name@version::license 计算。指纹不变则视为同一个包，
//    历史裁决沿用；指纹一变（版本/许可证变化）就是新包，旧裁决失效、回到待复核。
// 3. 解析是原子的：parseLockfile 要么返回全部包，要么抛错，期间绝不写入台账；
//    只有解析成功才一次性 commit 整个批次，失败批次不留半包，已确认批次照旧可用。
// 4. 裁决（verdict）按批次记录在 batch.verdicts 中，切换当前批次时来源（fileName）
//    与裁决都来自同一个批次对象，不会串。

export type Verdict = 'pending' | 'ok' | 'warn' | 'risk';
export type BatchStatus = 'parsing' | 'ready' | 'failed';

export type PackageInfo = {
  fingerprint: string;
  name: string;
  version: string;
  license: string;
};

export type Batch = {
  id: string;
  fileName: string;
  createdAt: number;
  status: BatchStatus;
  error: string | null;
  fingerprints: string[]; // 该批次包含的包（有序）
  verdicts: Record<string, Verdict>; // fingerprint -> 裁决
  notes: Record<string, string>; // fingerprint -> 裁决说明
};

export type Ledger = {
  version: number;
  batches: Batch[];
  registry: Record<string, PackageInfo>; // fingerprint -> 包内容（与批次无关）
  activeBatchId: string | null;
};

export type Row = { pkg: PackageInfo; verdict: Verdict; note: string };

const STORAGE_KEY = 'license-lens-ledger-v1';

/* ----------------------------- 工具函数 ----------------------------- */

export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// 内容指纹：FNV-1a 32 位，基于 name@version::license。
// 注意：来源（fileName）不参与指纹——同一个包在不同锁文件里应被识别为同一个包。
export function fingerprintOf(name: string, version: string, license: string): string {
  const s = `${name}@${version}::${license}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return 'fp-' + (h >>> 0).toString(36);
}

export function verdictLabel(v: Verdict): string {
  switch (v) {
    case 'ok':
      return '安全';
    case 'warn':
      return '复核';
    case 'risk':
      return '高风险';
    default:
      return '待复核';
  }
}

export function defaultNote(v: Verdict): string {
  switch (v) {
    case 'ok':
      return '宽松许可，可商用';
    case 'warn':
      return '再发布需保留版权声明';
    case 'risk':
      return '可能与闭源分发冲突';
    default:
      return '等待人工复核';
  }
}

/* ----------------------------- 持久化 ----------------------------- */

export function loadLedger(): Ledger {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (raw && raw.version === 1 && Array.isArray(raw.batches) && raw.registry) {
      return raw as Ledger;
    }
  } catch {
    /* 落盘数据损坏时回到空台账，避免半批状态污染 */
  }
  return { version: 1, batches: [], registry: {}, activeBatchId: null };
}

export function saveLedger(l: Ledger): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(l));
  } catch {
    /* 存储不可用时静默失败，不影响内存中的台账 */
  }
}

/* ----------------------------- 种子数据 ----------------------------- */

export function seedLedger(): Ledger {
  const id = 'seed';
  const seed: { name: string; version: string; license: string; verdict: Verdict; note: string }[] = [
    { name: 'react', version: '18.3.1', license: 'MIT', verdict: 'ok', note: '宽松许可，可商用' },
    { name: 'lodash', version: '4.17.21', license: 'MIT', verdict: 'ok', note: '宽松许可，可商用' },
    { name: 'chart.js', version: '4.4.4', license: 'MIT', verdict: 'ok', note: '宽松许可，可商用' },
    { name: 'highlight.js', version: '11.10.0', license: 'BSD-3-Clause', verdict: 'warn', note: '再发布需保留版权声明' },
    { name: 'legacy-parser', version: '2.1.0', license: 'GPL-3.0', verdict: 'risk', note: '可能与闭源分发冲突' },
  ];
  const registry: Record<string, PackageInfo> = {};
  const fingerprints: string[] = [];
  const verdicts: Record<string, Verdict> = {};
  const notes: Record<string, string> = {};
  for (const p of seed) {
    const fp = fingerprintOf(p.name, p.version, p.license);
    registry[fp] = { fingerprint: fp, name: p.name, version: p.version, license: p.license };
    fingerprints.push(fp);
    verdicts[fp] = p.verdict;
    notes[fp] = p.note;
  }
  return {
    version: 1,
    batches: [
      {
        id,
        fileName: 'seed-lock.json',
        createdAt: Date.now(),
        status: 'ready',
        error: null,
        fingerprints,
        verdicts,
        notes,
      },
    ],
    registry,
    activeBatchId: id,
  };
}

/* ----------------------------- 解析（原子） ----------------------------- */

// 解析锁文件。纯函数式异步：要么返回全部包，要么抛错；不读写台账。
// 支持 package-lock.json（lockfileVersion 2/3，packages 字段）与 package.json（dependencies）。
export async function parseLockfile(fileName: string, text: string): Promise<PackageInfo[]> {
  await delay(450 + Math.random() * 650); // 模拟异步解析，期间可并行导入其它批次
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('不是有效的 JSON 锁文件');
  }

  const raw: { name: string; version: string; license: string }[] = [];
  if (data && typeof data.packages === 'object' && data.packages !== null) {
    for (const [key, val] of Object.entries<any>(data.packages)) {
      if (!key.startsWith('node_modules/')) continue;
      const name = (val && val.name) || key.slice('node_modules/'.length);
      raw.push({ name, version: val?.version, license: val?.license || 'UNKNOWN' });
    }
  } else if (data && typeof data.dependencies === 'object' && data.dependencies !== null) {
    for (const [name, val] of Object.entries<any>(data.dependencies)) {
      raw.push({ name, version: (val && val.version) || '?', license: (val && val.license) || 'UNKNOWN' });
    }
  }

  if (raw.length === 0) {
    throw new Error('未在锁文件中找到任何依赖包');
  }

  const seen = new Set<string>();
  const out: PackageInfo[] = [];
  for (const p of raw) {
    if (!p.name || !p.version) {
      throw new Error(`包 ${p.name || '?'} 缺少名称或版本，整批回滚`);
    }
    const license = String(p.license || 'UNKNOWN');
    const fp = fingerprintOf(p.name, String(p.version), license);
    if (seen.has(fp)) continue;
    seen.add(fp);
    out.push({ fingerprint: fp, name: p.name, version: String(p.version), license });
  }
  return out;
}

/* ----------------------------- 批次状态流转（纯函数） ----------------------------- */

// 找某个包在“更早的就绪批次”里最近一次的裁决（指纹不变则沿用）。
function findLatestVerdict(
  ledger: Ledger,
  fp: string,
  excludeBatchId?: string,
): { verdict: Verdict; note: string } | null {
  for (let i = ledger.batches.length - 1; i >= 0; i--) {
    const b = ledger.batches[i];
    if (b.id === excludeBatchId) continue;
    if (b.status !== 'ready') continue;
    if (!b.fingerprints.includes(fp)) continue;
    const verdict = b.verdicts[fp];
    if (verdict) return { verdict, note: b.notes[fp] ?? defaultNote(verdict) };
  }
  return null;
}

// 创建一个“解析中”的批次（先占位，状态 parsing，无包）。
export function createParsingBatch(ledger: Ledger, batchId: string, fileName: string): Ledger {
  const batch: Batch = {
    id: batchId,
    fileName,
    createdAt: Date.now(),
    status: 'parsing',
    error: null,
    fingerprints: [],
    verdicts: {},
    notes: {},
  };
  return { ...ledger, batches: [...ledger.batches, batch] };
}

// 解析成功后原子提交：一次性写入整批包与裁决，绝不留半包。
export function commitBatch(
  ledger: Ledger,
  batchId: string,
  fileName: string,
  packages: PackageInfo[],
): Ledger {
  const registry = { ...ledger.registry };
  const fingerprints: string[] = [];
  const verdicts: Record<string, Verdict> = {};
  const notes: Record<string, string> = {};

  for (const pkg of packages) {
    fingerprints.push(pkg.fingerprint);
    if (!registry[pkg.fingerprint]) registry[pkg.fingerprint] = pkg;
    const prior = findLatestVerdict(ledger, pkg.fingerprint, batchId);
    const verdict: Verdict = prior?.verdict ?? 'pending';
    verdicts[pkg.fingerprint] = verdict;
    notes[pkg.fingerprint] = prior?.note ?? defaultNote(verdict);
  }

  return {
    ...ledger,
    registry,
    activeBatchId: ledger.activeBatchId ?? batchId,
    batches: ledger.batches.map((b) =>
      b.id === batchId
        ? { ...b, fileName, status: 'ready', error: null, fingerprints, verdicts, notes }
        : b,
    ),
  };
}

// 解析失败：把批次标记为 failed，不写入任何包。
export function failBatch(ledger: Ledger, batchId: string, error: string): Ledger {
  return {
    ...ledger,
    batches: ledger.batches.map((b) =>
      b.id === batchId ? { ...b, status: 'failed', error, fingerprints: [], verdicts: {}, notes: {} } : b,
    ),
  };
}

// 重试：先回到 parsing（清空半包），再由调用方重新解析并 commit/fail。
export function retryToParsing(ledger: Ledger, batchId: string): Ledger {
  return {
    ...ledger,
    batches: ledger.batches.map((b) =>
      b.id === batchId
        ? { ...b, status: 'parsing', error: null, fingerprints: [], verdicts: {}, notes: {} }
        : b,
    ),
  };
}

// 人工裁决：只改当前批次、当前包的裁决，不影响其它批次。
export function setVerdict(
  ledger: Ledger,
  batchId: string,
  fp: string,
  verdict: Verdict,
  note?: string,
): Ledger {
  return {
    ...ledger,
    batches: ledger.batches.map((b) =>
      b.id === batchId
        ? {
            ...b,
            verdicts: { ...b.verdicts, [fp]: verdict },
            notes: { ...b.notes, [fp]: note ?? b.notes[fp] ?? defaultNote(verdict) },
          }
        : b,
    ),
  };
}

export function setActive(ledger: Ledger, batchId: string): Ledger {
  return { ...ledger, activeBatchId: batchId };
}

export function removeBatch(ledger: Ledger, batchId: string): Ledger {
  const batches = ledger.batches.filter((b) => b.id !== batchId);
  const activeBatchId =
    ledger.activeBatchId === batchId
      ? (batches.filter((b) => b.status === 'ready').slice(-1)[0]?.id ?? null)
      : ledger.activeBatchId;
  return { ...ledger, batches, activeBatchId };
}

/* ----------------------------- 查询 ----------------------------- */

export function getActiveBatch(ledger: Ledger): Batch | null {
  const active = ledger.batches.find((b) => b.id === ledger.activeBatchId);
  if (active && active.status === 'ready') return active;
  const ready = ledger.batches.filter((b) => b.status === 'ready');
  return ready.length ? ready[ready.length - 1] : null;
}

export function getBatchRows(ledger: Ledger, batch: Batch | null): Row[] {
  if (!batch) return [];
  return batch.fingerprints
    .map((fp) => {
      const pkg = ledger.registry[fp];
      if (!pkg) return null;
      return { pkg, verdict: batch.verdicts[fp] ?? 'pending', note: batch.notes[fp] ?? '' };
    })
    .filter((r): r is Row => r !== null);
}

export type Diff = {
  added: PackageInfo[];
  removed: PackageInfo[];
  changed: { pkg: PackageInfo; from: Verdict; to: Verdict }[];
};

// 批次之间的差异：新增、消失、裁决变化。
export function diffBatches(ledger: Ledger, aId: string, bId: string): Diff {
  const a = ledger.batches.find((b) => b.id === aId);
  const b = ledger.batches.find((b) => b.id === bId);
  if (!a || !b) return { added: [], removed: [], changed: [] };
  const aFps = new Set(a.fingerprints);
  const bFps = new Set(b.fingerprints);

  const added = [...bFps]
    .filter((fp) => !aFps.has(fp))
    .map((fp) => ledger.registry[fp])
    .filter((p): p is PackageInfo => Boolean(p));
  const removed = [...aFps]
    .filter((fp) => !bFps.has(fp))
    .map((fp) => ledger.registry[fp])
    .filter((p): p is PackageInfo => Boolean(p));
  const changed = [...aFps, ...bFps]
    .filter((fp) => aFps.has(fp) && bFps.has(fp))
    .map((fp) => {
      const from = a.verdicts[fp] ?? 'pending';
      const to = b.verdicts[fp] ?? 'pending';
      return { pkg: ledger.registry[fp], from, to };
    })
    .filter((x) => x.pkg && x.from !== x.to);

  return { added, removed, changed };
}

// 发布清单只取当前有效结论：当前批次里已确认（ok/warn/risk）的包。
// pending 表示尚无有效结论，不计入发布，需先复核。
export function getManifest(ledger: Ledger, batch: Batch | null) {
  const rows = getBatchRows(ledger, batch);
  return {
    ok: rows.filter((r) => r.verdict === 'ok'),
    warn: rows.filter((r) => r.verdict === 'warn'),
    risk: rows.filter((r) => r.verdict === 'risk'),
    pending: rows.filter((r) => r.verdict === 'pending'),
    total: rows.length,
  };
}

// 发布清单 Markdown：只包含当前批次已确认的有效结论，待复核项单独列出、不计入发布。
export function buildManifestMarkdown(ledger: Ledger): string {
  const batch = getActiveBatch(ledger);
  const m = getManifest(ledger, batch);
  const table = (rows: Row[]) =>
    rows.map((r) => `| ${r.pkg.name} | ${r.pkg.version} | ${r.pkg.license} |`).join('\n');
  let md = `# 发布清单 · ${batch?.fileName ?? ''}\n\n`;
  md += `> 仅包含当前批次中已确认的结论。生成时间：${new Date().toLocaleString('zh-CN')}\n\n`;
  md += `## 可直接分发（${m.ok.length}）\n\n| 依赖 | 版本 | 许可证 |\n|---|---|---|\n${table(m.ok) || '_无_'}\n\n`;
  md += `## 需保留声明（${m.warn.length}）\n\n| 依赖 | 版本 | 许可证 |\n|---|---|---|\n${table(m.warn) || '_无_'}\n\n`;
  md += `## 高风险（${m.risk.length}）\n\n| 依赖 | 版本 | 许可证 |\n|---|---|---|\n${table(m.risk) || '_无_'}\n`;
  if (m.pending.length) {
    md += `\n## 待复核（不计入发布，${m.pending.length}）\n\n`;
    md += m.pending.map((r) => `- ${r.pkg.name}@${r.pkg.version} ${r.pkg.license}`).join('\n') + '\n';
  }
  return md;
}
