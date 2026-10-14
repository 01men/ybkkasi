/**
 * 执行中枢纯决策层（domain）—— 无 IO、无时钟、无数据库。
 *
 * 移植自 Paperclip wake-queue 的核心设计：策略从 IO 中彻底剥离，
 * 因此可以表驱动穷举边界（对齐其 policy.test.ts 的测试强度思路）。
 * 这里只放决策函数与纯工具；任何「读库/读时钟」的逻辑一律留在服务层
 * （application），把事实（facts）算好再喂进来。
 */

// ---------------------------------------------------------------------------
// 唤醒准入（Paperclip decideWakeAdmission 三态）
// ---------------------------------------------------------------------------

export type WakeAdmissionFacts = {
  /** 目标 issue 的执行锁持有者是否为同一 Agent（按归一化名称键比较）。 */
  isSameExecutionAgent: boolean
  /** 该唤醒是否应推迟（上游显式要求，如审批未决）。 */
  shouldDeferFollowupWake: boolean
  /** 是否应并入正在运行的唤醒（跟随唤醒语义）。 */
  shouldQueueFollowupForRunningWake: boolean
  /** 目标 issue 上是否存在活跃执行 run（executionRunId 非空即视为存在）。 */
  availableActiveExecutionRunPresent: boolean
  /** 是否允许 run 合并（缺省允许）。 */
  allowRunCoalescing?: boolean
  /** 是否同一持久执行者（缺省视为是；跨执行者合并是治理风险）。 */
  sameDurableActor?: boolean
}

export type WakeAdmissionDecision =
  | { kind: 'proceed' }   // 无活跃 run → 正常起新 run
  | { kind: 'coalesce' }  // 同 Agent + 可合并 → 并入现有 run
  | { kind: 'defer' }     // 有活跃 run 但不满足合并条件 → 进延迟队列

/**
 * 唤醒准入三态裁决。决策与 CAS 是两层机制：
 * 本函数在事务外给出决策；存储层的 `executionRunId IS NULL` 守卫只是
 * 防重复取锁的兜底护栏，不作为决策信号（Paperclip 原设计）。
 */
export function decideWakeAdmission(f: WakeAdmissionFacts): WakeAdmissionDecision {
  if (
    f.allowRunCoalescing !== false &&
    f.sameDurableActor !== false &&
    f.isSameExecutionAgent &&
    !f.shouldDeferFollowupWake &&
    !f.shouldQueueFollowupForRunningWake &&
    f.availableActiveExecutionRunPresent
  ) {
    return { kind: 'coalesce' }
  }
  if (f.availableActiveExecutionRunPresent) {
    return { kind: 'defer' }
  }
  return { kind: 'proceed' }
}

// ---------------------------------------------------------------------------
// 释放恢复（Paperclip decideReleaseRecovery 裁剪版）
// ---------------------------------------------------------------------------

export type ReleaseRecoveryFacts = {
  /** 持有锁的 run 记录是否已不存在（数据丢失/被清理）。 */
  runMissing: boolean
  /** run 是否已终态（completed/failed/timeout）但锁未释放。 */
  runSettled: boolean
  /** run 仍 running 但锁已超时（超过回收阈值）。 */
  lockTimedOut: boolean
}

export type ReleaseRecoveryDecision =
  | { kind: 'keep' }             // 一切正常，不动
  | { kind: 'force-release' }    // 强制释放锁（run 消失/终态/超时）
  | { kind: 'timeout-run' }      // run 超时：先记 timeout 终态再强制释放

export function decideReleaseRecovery(f: ReleaseRecoveryFacts): ReleaseRecoveryDecision {
  if (f.runMissing || f.runSettled) return { kind: 'force-release' }
  if (f.lockTimedOut) return { kind: 'timeout-run' }
  return { kind: 'keep' }
}

// ---------------------------------------------------------------------------
// 名称归一化（Paperclip normalizeAgentKey 同义）
// ---------------------------------------------------------------------------

/** Agent 名称规范键：比较「是否同一 Agent 的连续唤醒」用，避免大小写/空白抖动。 */
export function normalizeAgentKey(name: string): string {
  return String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

// ---------------------------------------------------------------------------
// 目标血缘物化
// ---------------------------------------------------------------------------

/**
 * 血缘物化：goalChain（根→父→本目标）+ projectId 拼为 issue.goalAncestry，
 * 读取血缘不需递归查库（目标树很浅，写时物化、读时直读）。
 */
export function materializeGoalAncestry(goalChain: string[], projectId?: string): string[] {
  return [...goalChain, ...(projectId ? [projectId] : [])]
}

/** 血缘摘要（注入 Agent 上下文用）：[目标链…] → 「根 › 父 › 目标 › 项目」。 */
export function lineageSummary(ancestry: string[], titles: Record<string, string>): string {
  return ancestry.map((id) => titles[id] ?? id).join(' › ') || '（未挂目标/项目）'
}

// ---------------------------------------------------------------------------
// Agent 上下文装配（goal-aware execution 的落地形态）
// ---------------------------------------------------------------------------

export interface ContextPackInput {
  goalTitle?: string
  goalMetric?: string
  projectNames: string[]
  issueTitle: string
  blockerTitles: string[]
  dataClass?: string
  budgetNote?: string
  permissionNote?: string
}

/** 拼装「为什么而干」的上下文包：目标/项目/任务/前置 + 治理范围注记。 */
export function buildIssueContextPack(input: ContextPackInput): string {
  const lines: string[] = ['【本任务服务于】']
  lines.push(input.goalTitle
    ? `目标：${input.goalTitle}${input.goalMetric ? `（指标：${input.goalMetric}）` : ''}`
    : '目标：（未挂目标）')
  const projectNames = input.projectNames ?? []
  if (projectNames.length > 0) lines.push(`项目：${projectNames.join('、')}`)
  lines.push(`你的任务：${input.issueTitle}`)
  const blockerTitles = input.blockerTitles ?? []
  lines.push(blockerTitles.length > 0 ? `前置：等待「${blockerTitles.join('」「')}」完成` : '前置：无阻塞依赖')
  lines.push('', '【可用范围】')
  if (input.permissionNote) lines.push(input.permissionNote)
  if (input.dataClass) lines.push(`可访问数据密级上限：${input.dataClass}（更高密级需申请）`)
  if (input.budgetNote) lines.push(input.budgetNote)
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Agent 健康度（R9：心跳数据入 Agent 健康度）
// ---------------------------------------------------------------------------

export type AgentHealthLevel = 'healthy' | 'stale' | 'silent' | 'frozen' | 'offline'

export interface AgentHealthFacts {
  agentStatus: string
  frozen: boolean
  /** 最近一次心跳时点（ms epoch；无=null）。 */
  lastHeartbeatAt: number | null
  /** 最近一次纳管指标提报时点（ms epoch；无=null）。 */
  lastMetricsReportAt: number | null
  nowMs: number
  /** 心跳周期（分钟；0/缺省=未配置心跳，按 24h 宽松口径）。 */
  heartbeatIntervalMinutes?: number
}

/**
 * 健康分档：offline（非运行态）→ frozen（冻结）→ healthy（心跳新鲜）
 * → stale（心跳迟滞）→ silent（长期无心跳）。新鲜窗口取心跳周期的 3 倍
 * （容忍两轮漏报），迟滞窗口 9 倍；未配置心跳的 Agent 按 24h/72h 宽松两档（提报义务口径）。
 */
export function computeAgentHealth(f: AgentHealthFacts): AgentHealthLevel {
  if (f.agentStatus !== 'online' && f.agentStatus !== 'trial') return 'offline'
  if (f.frozen) return 'frozen'
  const configured = (f.heartbeatIntervalMinutes ?? 0) > 0
  const baseMs = configured ? (f.heartbeatIntervalMinutes as number) * 60_000 : 24 * 3_600_000
  const last = f.lastHeartbeatAt ?? f.lastMetricsReportAt
  if (last === null) return 'silent'
  if (f.nowMs - last <= baseMs * 3) return 'healthy'
  if (f.nowMs - last <= baseMs * 9) return 'stale'
  return 'silent'
}

// ---------------------------------------------------------------------------
// 任务状态机（exec:issues）
// ---------------------------------------------------------------------------

export type IssueStatus = 'todo' | 'in_progress' | 'review' | 'done' | 'cancelled'

/** 显式流转表：done/cancelled 为终态；review 可打回 in_progress。 */
export const ISSUE_TRANSITIONS: Record<IssueStatus, IssueStatus[]> = {
  todo: ['in_progress', 'cancelled'],
  in_progress: ['review', 'cancelled'],
  review: ['done', 'in_progress', 'cancelled'],
  done: [],
  cancelled: [],
}

export function issueCanTransition(from: IssueStatus, to: IssueStatus): boolean {
  return ISSUE_TRANSITIONS[from]?.includes(to) ?? false
}

/** 前置依赖是否已解除：blocker 全部终态（done 视为解除，cancelled 也解除等待——不再无限挂起）。 */
export function blockersResolved(blockerStatuses: IssueStatus[]): boolean {
  return blockerStatuses.every((status) => status === 'done' || status === 'cancelled')
}

// ---------------------------------------------------------------------------
// 例行调度：最小 5 段 cron（分钟粒度）
// ---------------------------------------------------------------------------

/** 单字段匹配：`*`、`a`、`a-b`、`a/b`（步进）、逗号列表。 */
export function cronFieldMatches(field: string, value: number, min: number, max: number): boolean {
  for (const part of field.split(',')) {
    const [range, stepRaw] = part.split('/')
    const step = stepRaw === undefined ? 1 : Number(stepRaw)
    if (!Number.isInteger(step) || step < 1) continue
    let from = min
    let to = max
    if (range !== undefined && range !== '*' && range !== '') {
      const dash = range.indexOf('-')
      if (dash >= 0) {
        from = Number(range.slice(0, dash))
        to = Number(range.slice(dash + 1))
      } else {
        from = Number(range)
        to = stepRaw === undefined ? from : max
      }
    }
    if (!Number.isInteger(from) || !Number.isInteger(to)) continue
    if (from < min || to > max || from > to) continue
    if (value >= from && value <= to && (value - from) % step === 0) return true
  }
  return false
}

/** 5 段 cron（分 时 日 月 周）在给定时刻是否命中。周 0/7 均为周日。 */
export function cronMatches(expr: string, at: Date): boolean {
  const fields = expr.trim().split(/\s+/)
  if (fields.length !== 5) return false
  const minute = at.getUTCMinutes()
  const hour = at.getUTCHours()
  const dom = at.getUTCDate()
  const month = at.getUTCMonth() + 1
  const dowRaw = at.getUTCDay()
  const dow = dowRaw === 0 ? 7 : dowRaw
  const [fMinute, fHour, fDom, fMonth, fDow] = fields
  if (!cronFieldMatches(fMinute ?? '', minute, 0, 59)) return false
  if (!cronFieldMatches(fHour ?? '', hour, 0, 23)) return false
  if (!cronFieldMatches(fMonth ?? '', month, 1, 12)) return false
  // 日与周的 POSIX 语义：两者都收窄（非 *）时命中其一即可
  const domRestricted = fDom !== undefined && fDom !== '*' && fDom !== ''
  const dowRestricted = fDow !== undefined && fDow !== '*' && fDow !== ''
  const domHit = cronFieldMatches(fDom ?? '', dom, 1, 31)
  // 周日兼容 0 与 7 两种写法（value 侧已归一到 7，字段写 0 时按 0 再试一次）
  const dowHit = cronFieldMatches(fDow ?? '', dow, 0, 7) || (dowRaw === 0 && cronFieldMatches(fDow ?? '', 0, 0, 0))
  if (domRestricted && dowRestricted) return domHit || dowHit
  return domHit && dowHit
}

/** cron 合法性校验（登记时用，给用户即时反馈）。 */
export function cronIsValid(expr: string): boolean {
  const fields = expr.trim().split(/\s+/)
  if (fields.length !== 5) return false
  const ranges: Array<[number, number]> = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]]
  return fields.every((field, index) => {
    const [min, max] = ranges[index]!
    // 逐 part 试匹配一个必然落在范围内的值不充分——校验词法结构即可
    return field.split(',').every((part) => {
      const [range, stepRaw] = part.split('/')
      if (stepRaw !== undefined && (!/^\d+$/.test(stepRaw) || Number(stepRaw) < 1)) return false
      if (range === '*' || range === '') return true
      if (!/^\d+(-\d+)?$/.test(range)) return false
      const [a, b] = range.split('-')
      const from = Number(a)
      const to = b === undefined ? from : Number(b)
      return from >= min && to <= max && from <= to
    })
  })
}

// ---------------------------------------------------------------------------
// 唤醒幂等键
// ---------------------------------------------------------------------------

export function wakeIdempotencyKey(trigger: string, parts: Array<string | number | undefined>): string {
  return [trigger, ...parts.map((p) => String(p ?? ''))].join(':')
}
