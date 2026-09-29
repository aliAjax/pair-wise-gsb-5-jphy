// 扫描台账核心类型
//
// 设计要点（对应需求）：
// - 每个锁文件导入后形成一个【独立批次】，批次之间互不覆盖。
// - 包按 (生态, 名称, 版本, 许可证) 的内容指纹识别；指纹变化即视为新内容，
//   旧人工裁决失效，包回到「待复核」。
// - 批次解析/分析要么整体成功、要么整体失败（原子提交），失败重试时
//   已经确认的分析结果按指纹缓存复用，不会留下半批。

export type Ecosystem = 'npm' | 'composer';

/** 发布结论：只有 approved / rejected 是人工裁决；pending 表示待复核 */
export type Verdict = 'approved' | 'rejected' | 'pending';

export interface DecisionInput {
  verdict: 'approved' | 'rejected';
  note: string;
}

export type BatchStatus =
  | 'parsing' // 刚落盘，等待/正在分析
  | 'ready' // 分析成功，结论可用
  | 'failed'; // 分析失败，可重试（无任何半成品包被发布）

/** 批次内单个包的不可变记录 */
export interface PackageRow {
  /** 内容指纹：同生态下 name@version|license，内容一变指纹就变 */
  fp: string;
  ecosystem: Ecosystem;
  name: string;
  version: string;
  license: string;
  /** 该包在本批次中的来源（锁文件中的声明来源），如 registry、手动 */
  source: string;
}

export interface Batch {
  id: string;
  /** 导入序号（单调递增），同生态取「最新」有效批次的权威依据 */
  ord: number;
  /** 批次来源标签：锁文件名 + 导入次序，批次之间不串用 */
  label: string;
  ecosystem: Ecosystem;
  status: BatchStatus;
  /** 原始锁文件内容，失败重试时重新解析，不保留任何半成品行 */
  raw: string;
  /** 解析阶段得到的原始内容指纹（parse 是同步确定性的，解析成功即落定） */
  fingerprints: string[];
  /** 解析得到的包行（不可变，随批次持久化，失败时为空） */
  packages: PackageRow[];
  /** 分析阶段已完成的指纹，原子提交时才整体写回批次 */
  analyzed: string[];
  attempts: number;
  error?: string;
  createdAt: number;
  /** ready/failed 落定时间，用于「同生态取最新有效批次」 */
  settledAt?: number;
}

/**
 * 人工裁决按【内容指纹】存放，而不是按批次：
 * 指纹不变时，跨批次/重试后裁决照旧可用；指纹一变就查不到，自动回到待复核。
 */
export interface DecisionRecord {
  verdict: 'approved' | 'rejected';
  note: string;
  /** 裁决所依据的来源，随裁决走，切换批次时不串 */
  source: string;
  decidedAt: number;
}

/** 按指纹缓存的分析结果，供失败重试复用「已确认结果」 */
export interface AnalysisResult {
  fp: string;
  status: 'ok' | 'warn' | 'risk';
  note: string;
}

export interface Ledger {
  version: 1;
  batches: Record<string, Batch>;
  /** fp -> 人工裁决 */
  decisions: Record<string, DecisionRecord>;
  /** fp -> 分析结果 */
  analysis: Record<string, AnalysisResult>;
  /** 单调递增的导入序号，用于批次标签 */
  seq: number;
}

/** 列表里展示的包：批次行 + 当前生效裁决/分析的合成视图 */
export interface ResolvedPackage extends PackageRow {
  analysisStatus: 'ok' | 'warn' | 'risk' | 'unknown';
  analysisNote: string;
  decision: DecisionRecord | null;
  verdict: Verdict;
}

export type DiffKind = 'added' | 'removed' | 'decision-changed';

export interface DiffEntry {
  kind: DiffKind;
  fp: string;
  ecosystem: Ecosystem;
  name: string;
  version: string;
  license: string;
  from?: Verdict;
  to?: Verdict;
}

export interface BatchDiff {
  baseId: string | null;
  targetId: string;
  added: DiffEntry[];
  removed: DiffEntry[];
  changed: DiffEntry[];
}
