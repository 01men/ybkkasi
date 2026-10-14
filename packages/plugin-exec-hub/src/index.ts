/**
 * @dsh-ops/plugin-exec-hub —— 执行中枢（ybkk-MATRIX 目标四「干活中枢」，R8/R9/R10 落地）。
 *
 * 机制移植自 Paperclip 执行编排（wake-queue），按平台形态裁剪：
 *   - 任务执行锁（E2）：issue 行上三字段（executionRunId / executionAgentKey / executionLockedAt）
 *     的 CAS 语义——「检查-置位」在同一同步段完成，Node 单线程 run-to-completion 保证原子性，
 *     决策（domain 纯函数）与 CAS 护栏分层（Paperclip 原设计）。释放是 run 级批量操作。
 *   - Agent 心跳唤醒（E3/R9）：exec:wakes 队列（幂等键去重）+ 30s 心跳循环：
 *     预算前置 → 权限校验 → 审批门禁（P0）→ 取锁/合并/延迟三态裁决 → 上下文装配 → 派发 run。
 *     状态枚举与 Paperclip 对齐（deferred_issue_execution 具名延迟态）。
 *   - 目标血缘（E4/R8）：exec:goals（支持父目标树）→ exec:projects → exec:issues，
 *     goalAncestry 写时物化，唤醒时上下文装配注入「为什么而干」。
 *   - 例行调度（E7）：interval / 5 段 cron / webhook 三源；webhook 端点公开但路径即凭证
 *     （未登记路径一律 404，不泄露存在性）。
 *   - 治理五联动（E6）：预算硬停（超限不唤醒 + 联动冻结 + L4 解冻审批）、权限校验
 *     （Agent 机器主体须持 exec.write）、审计留痕（唤醒/取锁/释放/回收全链 type=invoke/change）、
 *     数据密级注记（上下文包装载 dataClass 上限）、审批门禁（P0 任务执行前须 exec.issue.run 审批）。
 *
 * 治理红线：唤醒派发永不虚构执行——run 只登记「已派发 + 上下文包」，执行由 Agent 经
 * exec_claim / exec_complete 工具或外部运行时回执；无回执的 run 由僵尸锁回收闭环。
 */
import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import type { HttpExchange } from '../../platform-core/src/index.ts'
import { createRestGate, defineTool, PlatformEvents, newId, type Collection, type RecordBase } from '../../platform-core/src/index.ts'
import type { AuditLogRecord } from '../../plugin-audit/src/index.ts'
import {
  buildIssueContextPack, blockersResolved, computeAgentHealth, cronIsValid, cronMatches,
  decideReleaseRecovery, decideWakeAdmission, issueCanTransition, materializeGoalAncestry,
  normalizeAgentKey, wakeIdempotencyKey,
  type AgentHealthLevel, type IssueStatus,
} from './domain.ts'
import { seedExecHub } from './seed.ts'

// ---------------------------------------------------------------------------
// 记录模型（exec:* 集合）
// ---------------------------------------------------------------------------

export type GoalStatus = 'active' | 'achieved' | 'dropped' | 'archived'

/** 目标（R8）：支持父目标树；metric 三件套使「可量化」成为建模约束而非口头承诺。 */
export interface GoalRecord extends RecordBase {
  orgId: string
  title: string
  description?: string
  metric?: string
  metricBaseline?: number
  metricTarget?: number
  metricUnit?: string
  ownerUserId?: string
  parentGoalId?: string
  periodStart?: string
  periodEnd?: string
  status: GoalStatus
}

export type ProjectStatus = 'active' | 'done' | 'archived'

/** 项目（E4）：目标与任务之间的中间层，挂代码仓与文档。 */
export interface ProjectRecord extends RecordBase {
  orgId: string
  goalId?: string
  name: string
  description?: string
  repos: string[]
  ownerUserId?: string
  status: ProjectStatus
}

export type IssuePriority = 'P0' | 'P1' | 'P2' | 'P3'

/**
 * 任务（E2/E4）：执行锁三字段与 Paperclip 对齐（executionAgentKey=归一化名称键，
 * executionLockedAt=僵尸锁回收依据）；goalAncestry 写时物化；checkoutRunId 预留双锁位。
 */
export interface IssueRecord extends RecordBase {
  orgId: string
  projectId?: string
  parentId?: string
  blockerIds: string[]
  title: string
  detail?: string
  assigneeAgentId?: string
  assigneeUserId?: string
  status: IssueStatus
  priority: IssuePriority
  dueAt?: string
  executionRunId?: string
  executionAgentKey?: string
  executionLockedAt?: string
  /** 预留：检出锁（双锁语义，Paperclip checkout_run_id），首版不启用。 */
  checkoutRunId?: string
  goalAncestry: string[]
  createdBy: string
}

export type WakeTrigger = 'assign' | 'comment' | 'dependency' | 'routine' | 'api' | 'webhook'
export type WakeStatus = 'pending' | 'deferred_issue_execution' | 'run' | 'failed' | 'cancelled' | 'done'

/** 唤醒请求（E3）：幂等键防重复投递（无它则重复唤醒白烧预算）。 */
export interface WakeRecord extends RecordBase {
  orgId: string
  issueId?: string
  agentId?: string
  trigger: WakeTrigger
  triggerDetail?: string
  payload?: Record<string, unknown>
  status: WakeStatus
  idempotencyKey?: string
  budgetCheckPassed?: boolean
  lineageSnapshot?: string[]
  runId?: string
  lastError?: string
  createdAt: string
}

export type RunStatus = 'running' | 'completed' | 'failed' | 'timeout'

/** 执行 run：一次派发的登记（含上下文包），完成/超时/失败由 Agent 回执或僵尸回收闭环。 */
export interface RunRecord extends RecordBase {
  orgId: string
  agentId?: string
  issueIds: string[]
  trigger: WakeTrigger
  status: RunStatus
  contextPack?: string
  summary?: string
  startedAt: string
  finishedAt?: string
}

export type RoutineKind = 'interval' | 'cron' | 'webhook'

/** 例行规则（E7）：三源——间隔分钟 / 5 段 cron / webhook 路径。 */
export interface RoutineRecord extends RecordBase {
  orgId: string
  agentId: string
  name: string
  kind: RoutineKind
  intervalMinutes?: number
  cron?: string
  webhookPath?: string
  payload?: Record<string, unknown>
  enabled: boolean
  lastFiredAt?: string
  createdBy: string
}

export type HeartbeatOutcome = 'woken' | 'skipped_no_todo' | 'skipped_budget' | 'skipped_permission' | 'skipped_frozen' | 'skipped_inactive' | 'deferred'

/** 心跳留痕（R9）：Agent 健康度数据源，滚动保留 7 天。 */
export interface HeartbeatRecord extends RecordBase {
  agentId: string
  orgId: string
  at: string
  outcome: HeartbeatOutcome
  detail?: string
  issueCount?: number
}

export interface TickResult {
  processed: number
  woken: number
  deferred: number
  skipped: number
  failed: number
  reclaimed: number
  routineFired: number
  heartbeatDue: number
}

// ---------------------------------------------------------------------------
// 配置（env 可覆盖；selftest 用 TTL 压缩换确定性）
// ---------------------------------------------------------------------------

const TICK_MS = Number(process.env.EXEC_HUB_TICK_MS ?? 30_000)
const FIRST_TICK_MS = Number(process.env.EXEC_HUB_FIRST_TICK_MS ?? Math.min(TICK_MS, 15_000))
const BATCH_SIZE = Number(process.env.EXEC_HUB_BATCH ?? 50)
/** 僵尸锁阈值：Paperclip 建议约 2× 心跳周期，缺省 5 分钟。 */
const LOCK_TIMEOUT_MS = Number(process.env.EXEC_LOCK_TIMEOUT_MS ?? 300_000)
const HEARTBEAT_RETENTION_MS = 7 * 86_400_000
const METRICS_OVERDUE_MS = 24 * 3_600_000

// ---------------------------------------------------------------------------
// 服务
// ---------------------------------------------------------------------------

export class ExecutionHubService extends Service {
  static readonly provide = 'execHub'

  /** 纳管提报催办的日去重（进程内；重启重发一次可接受，告警不追求恰好一次）。 */
  private metricsReminderDayKeys = new Set<string>()
  private tickBusy = false

  constructor(ctx: Context) {
    super(ctx, 'execHub')

    // 审批通过（exec.issue.run）→ 重新入队被门禁挂起的唤醒
    ctx.platformBus.on(PlatformEvents.ApprovalDecided, (payload) => {
      try {
        const p = payload as { approvalId?: string }
        if (!p.approvalId) return
        const approval = this.ctx.opsStorage.collection<{ kind?: string; status?: string; payload?: Record<string, unknown>; orgId?: string }>('audit:approvals').get(p.approvalId)
        if (!approval || approval.kind !== 'exec.issue.run' || approval.status !== 'executed') return
        const issueId = String(approval.payload?.['issueId'] ?? '')
        if (!issueId) return
        this.enqueueWake({
          orgId: approval.orgId ?? '', issueId, trigger: 'api',
          triggerDetail: 'P0 审批通过放行', idempotencyKey: wakeIdempotencyKey('p0-release', [issueId, approval.id]),
        })
      } catch { /* 审批联动失败不阻塞事件链 */ }
    })

    if (process.env.EXEC_HUB_OFF === 'off') return
    // 心跳循环（lint-timers：unref + effect 清理双保险）
    const tickTimer = setInterval(() => { void this.safeTick() }, TICK_MS)
    tickTimer.unref?.()
    const firstTick = setTimeout(() => { void this.safeTick() }, FIRST_TICK_MS)
    firstTick.unref?.()
    // 纳管提报催办巡检：每小时一轮（R9：metrics-report 超 24h 自动催办）
    const metricsTimer = setInterval(() => { void this.remindOverdueMetrics() }, 3_600_000)
    metricsTimer.unref?.()
    ctx.effect(() => {
      clearInterval(tickTimer)
      clearTimeout(firstTick)
      clearInterval(metricsTimer)
    })
  }

  private async safeTick(): Promise<void> {
    if (this.tickBusy) return
    this.tickBusy = true
    try {
      await this.tick()
    } catch (error) {
      this.ctx.logger('exec-hub').warn(`tick 异常：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      this.tickBusy = false
    }
  }

  // -- 集合 -----------------------------------------------------------------

  goals(): Collection<GoalRecord> {
    return this.ctx.opsStorage.collection<GoalRecord>('exec:goals')
  }

  projects(): Collection<ProjectRecord> {
    return this.ctx.opsStorage.collection<ProjectRecord>('exec:projects')
  }

  issues(): Collection<IssueRecord> {
    return this.ctx.opsStorage.collection<IssueRecord>('exec:issues')
  }

  wakes(): Collection<WakeRecord> {
    return this.ctx.opsStorage.collection<WakeRecord>('exec:wakes')
  }

  runs(): Collection<RunRecord> {
    return this.ctx.opsStorage.collection<RunRecord>('exec:runs')
  }

  routines(): Collection<RoutineRecord> {
    return this.ctx.opsStorage.collection<RoutineRecord>('exec:routines')
  }

  heartbeats(): Collection<HeartbeatRecord> {
    return this.ctx.opsStorage.collection<HeartbeatRecord>('exec:heartbeats')
  }

  // -- 目标（R8） -------------------------------------------------------------

  /** 目标链（根→…→本目标）；无父即 [self]；成环/断链防御性截断。 */
  goalChain(goalId?: string): string[] {
    if (!goalId) return []
    const chain: string[] = []
    const seen = new Set<string>()
    let current = this.goals().get(goalId)
    while (current && !seen.has(current.id) && chain.length < 50) {
      seen.add(current.id)
      chain.unshift(current.id)
      current = current.parentGoalId ? this.goals().get(current.parentGoalId) : undefined
    }
    return chain
  }

  createGoal(input: Omit<GoalRecord, 'id' | 'createdAt' | 'updatedAt' | 'status'> & { status?: GoalStatus }): GoalRecord {
    if (!input.title?.trim()) throw new Error('目标标题必填')
    if (input.parentGoalId) {
      const parent = this.goals().get(input.parentGoalId)
      if (!parent) throw new Error(`父目标不存在：${input.parentGoalId}`)
      if (input.parentGoalId === input.id) throw new Error('父目标不得指向自己')
      if (this.goalChain(input.parentGoalId).includes(input.id ?? '')) throw new Error('目标父链成环')
    }
    const record = this.goals().insert({
      id: newId('goal'),
      orgId: input.orgId ?? '',
      title: input.title.trim(),
      ...(input.description ? { description: input.description } : {}),
      ...(input.metric ? { metric: input.metric } : {}),
      ...(input.metricBaseline !== undefined ? { metricBaseline: input.metricBaseline } : {}),
      ...(input.metricTarget !== undefined ? { metricTarget: input.metricTarget } : {}),
      ...(input.metricUnit ? { metricUnit: input.metricUnit } : {}),
      ...(input.ownerUserId ? { ownerUserId: input.ownerUserId } : {}),
      ...(input.parentGoalId ? { parentGoalId: input.parentGoalId } : {}),
      ...(input.periodStart ? { periodStart: input.periodStart } : {}),
      ...(input.periodEnd ? { periodEnd: input.periodEnd } : {}),
      status: input.status ?? 'active',
    })
    this.ctx.platformBus.emit(PlatformEvents.ExecGoalChanged, { goalId: record.id, action: 'created' })
    return record
  }

  updateGoal(id: string, patch: Partial<GoalRecord>): GoalRecord {
    const goal = this.goals().get(id)
    if (!goal) throw new Error(`目标不存在：${id}`)
    if (patch.parentGoalId) {
      if (patch.parentGoalId === id) throw new Error('父目标不得指向自己')
      if (!this.goals().get(patch.parentGoalId)) throw new Error(`父目标不存在：${patch.parentGoalId}`)
      if (this.goalChain(patch.parentGoalId).includes(id)) throw new Error('目标父链成环')
    }
    const updated = this.goals().update(id, {
      ...(patch.title !== undefined ? { title: patch.title.trim() || goal.title } : {}),
      ...(patch.parentGoalId !== undefined ? { parentGoalId: patch.parentGoalId || undefined } : {}),
      ...patch,
    })
    this.ctx.platformBus.emit(PlatformEvents.ExecGoalChanged, { goalId: id, action: 'updated' })
    return updated
  }

  deleteGoal(id: string): { deleted: true } {
    const goal = this.goals().get(id)
    if (!goal) throw new Error(`目标不存在：${id}`)
    if (this.goals().all().some((item) => item.parentGoalId === id)) throw new Error('目标下仍有子目标，先迁移或删除子目标')
    if (this.projects().all().some((item) => item.goalId === id)) throw new Error('目标下仍有项目，先迁移或删除项目')
    this.goals().remove(id)
    this.ctx.platformBus.emit(PlatformEvents.ExecGoalChanged, { goalId: id, action: 'deleted' })
    return { deleted: true }
  }

  // -- 项目（E4） ---------------------------------------------------------------

  createProject(input: Omit<ProjectRecord, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'repos'> & { repos?: string[]; status?: ProjectStatus }): ProjectRecord {
    if (!input.name?.trim()) throw new Error('项目名称必填')
    if (input.goalId && !this.goals().get(input.goalId)) throw new Error(`关联目标不存在：${input.goalId}`)
    const record = this.projects().insert({
      id: newId('proj'),
      orgId: input.orgId ?? '',
      ...(input.goalId ? { goalId: input.goalId } : {}),
      name: input.name.trim(),
      ...(input.description ? { description: input.description } : {}),
      repos: input.repos ?? [],
      ...(input.ownerUserId ? { ownerUserId: input.ownerUserId } : {}),
      status: input.status ?? 'active',
    })
    this.ctx.platformBus.emit(PlatformEvents.ExecGoalChanged, { projectId: record.id, action: 'project-created' })
    return record
  }

  updateProject(id: string, patch: Partial<ProjectRecord>): ProjectRecord {
    const project = this.projects().get(id)
    if (!project) throw new Error(`项目不存在：${id}`)
    if (patch.goalId && !this.goals().get(patch.goalId)) throw new Error(`关联目标不存在：${patch.goalId}`)
    const updated = this.projects().update(id, patch)
    // 项目改挂目标 → 重物化其下任务血缘
    if (patch.goalId !== undefined) {
      for (const issue of this.issues().all().filter((item) => item.projectId === id)) {
        this.rematerialize(issue.id)
      }
    }
    this.ctx.platformBus.emit(PlatformEvents.ExecGoalChanged, { projectId: id, action: 'project-updated' })
    return updated
  }

  deleteProject(id: string): { deleted: true } {
    const project = this.projects().get(id)
    if (!project) throw new Error(`项目不存在：${id}`)
    if (this.issues().all().some((item) => item.projectId === id)) throw new Error('项目下仍有任务，先迁移或删除任务')
    this.projects().remove(id)
    this.ctx.platformBus.emit(PlatformEvents.ExecGoalChanged, { projectId: id, action: 'project-deleted' })
    return { deleted: true }
  }

  // -- 任务（E2/E4） -------------------------------------------------------------

  /** 血缘重物化：goalAncestry = goalChain(project.goalId) + [projectId]。 */
  private rematerialize(issueId: string): void {
    const issue = this.issues().get(issueId)
    if (!issue) return
    const project = issue.projectId ? this.projects().get(issue.projectId) : undefined
    const chain = this.goalChain(project?.goalId)
    const ancestry = materializeGoalAncestry(chain, issue.projectId)
    if (JSON.stringify(ancestry) !== JSON.stringify(issue.goalAncestry)) {
      this.issues().update(issueId, { goalAncestry: ancestry })
    }
  }

  createIssue(input: {
    orgId?: string; projectId?: string; parentId?: string; blockerIds?: string[]
    title: string; detail?: string; assigneeAgentId?: string; assigneeUserId?: string
    priority?: IssuePriority; dueAt?: string; createdBy: string
  }): IssueRecord {
    if (!input.title?.trim()) throw new Error('任务标题必填')
    if (input.projectId && !this.projects().get(input.projectId)) throw new Error(`项目不存在：${input.projectId}`)
    if (input.parentId && !this.issues().get(input.parentId)) throw new Error(`父任务不存在：${input.parentId}`)
    for (const blockerId of input.blockerIds ?? []) {
      if (!this.issues().get(blockerId)) throw new Error(`前置任务不存在：${blockerId}`)
    }
    if (input.assigneeAgentId && !this.agentOf(input.assigneeAgentId)) throw new Error(`负责人 Agent 不存在：${input.assigneeAgentId}`)
    const project = input.projectId ? this.projects().get(input.projectId) : undefined
    const orgId = input.orgId ?? project?.orgId ?? this.agentOf(input.assigneeAgentId ?? '')?.orgId ?? ''
    const record = this.issues().insert({
      id: newId('iss'),
      orgId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.parentId ? { parentId: input.parentId } : {}),
      blockerIds: input.blockerIds ?? [],
      title: input.title.trim(),
      ...(input.detail ? { detail: input.detail } : {}),
      ...(input.assigneeAgentId ? { assigneeAgentId: input.assigneeAgentId } : {}),
      ...(input.assigneeUserId ? { assigneeUserId: input.assigneeUserId } : {}),
      status: 'todo',
      priority: input.priority ?? 'P2',
      ...(input.dueAt ? { dueAt: input.dueAt } : {}),
      goalAncestry: materializeGoalAncestry(this.goalChain(project?.goalId), input.projectId),
      createdBy: input.createdBy,
    })
    this.ctx.platformBus.emit(PlatformEvents.ExecIssueChanged, { issueId: record.id, action: 'created', status: record.status })
    // 派发触发器：assigneeAgentId 由空变为非空（E7 触发源接线表）
    if (record.assigneeAgentId) {
      this.enqueueWake({
        orgId, issueId: record.id, agentId: record.assigneeAgentId, trigger: 'assign',
        idempotencyKey: wakeIdempotencyKey('assign', [record.id, record.assigneeAgentId, record.createdAt.slice(0, 13)]),
      })
    }
    return record
  }

  updateIssue(id: string, patch: Partial<IssueRecord>, actor: string): IssueRecord {
    const issue = this.issues().get(id)
    if (!issue) throw new Error(`任务不存在：${id}`)
    if (patch.projectId && !this.projects().get(patch.projectId)) throw new Error(`项目不存在：${patch.projectId}`)
    if (patch.assigneeAgentId && !this.agentOf(patch.assigneeAgentId)) throw new Error(`负责人 Agent 不存在：${patch.assigneeAgentId}`)
    for (const blockerId of patch.blockerIds ?? []) {
      if (!this.issues().get(blockerId)) throw new Error(`前置任务不存在：${blockerId}`)
      if (blockerId === id) throw new Error('前置任务不得指向自己')
    }
    const updated = this.issues().update(id, { ...patch })
    this.rematerialize(id)
    // 换 Agent / 新挂 Agent → 派发唤醒（幂等键带时间桶，重复 PATCH 不重复唤醒）
    const newAssignee = updated.assigneeAgentId
    if (newAssignee && newAssignee !== issue.assigneeAgentId) {
      this.enqueueWake({
        orgId: updated.orgId, issueId: id, agentId: newAssignee, trigger: 'assign',
        triggerDetail: `改派（${actor}）`,
        idempotencyKey: wakeIdempotencyKey('assign', [id, newAssignee, new Date().toISOString().slice(0, 13)]),
      })
    }
    this.ctx.platformBus.emit(PlatformEvents.ExecIssueChanged, { issueId: id, action: 'updated', status: updated.status })
    return this.issues().get(id) ?? updated
  }

  transitionIssue(id: string, to: IssueStatus, actor: string): IssueRecord {
    const issue = this.issues().get(id)
    if (!issue) throw new Error(`任务不存在：${id}`)
    if (!issueCanTransition(issue.status, to)) {
      throw new Error(`任务状态 ${issue.status} 不允许流转到 ${to}`)
    }
    if (to === 'done' && issue.executionRunId) {
      // 收尾语义：终态前先收 run（释放锁 + run 完结），不留悬挂锁
      this.completeRun(issue.executionRunId, { status: 'completed', summary: `任务完成收尾（${actor}）` })
    }
    if (to === 'cancelled' && issue.executionRunId) {
      this.completeRun(issue.executionRunId, { status: 'failed', summary: `任务取消收尾（${actor}）` })
    }
    const updated = this.issues().update(id, { status: to })
    this.ctx.platformBus.emit(PlatformEvents.ExecIssueChanged, { issueId: id, action: 'transition', status: to })
    // 依赖解除触发器：blocker 终态后，下游全解除者入队 dependency 唤醒（E7 触发源接线表）
    if (to === 'done' || to === 'cancelled') this.wakeUnblockedDependents(id)
    return updated
  }

  /** 扫描以 issueId 为前置的任务：其 blockers 全部终态 → 入队 dependency 唤醒。 */
  private wakeUnblockedDependents(issueId: string): void {
    for (const dependent of this.issues().all().filter((item) => item.blockerIds.includes(issueId))) {
      const statuses = dependent.blockerIds.map((bid) => this.issues().get(bid)?.status ?? 'todo')
      if (!blockersResolved(statuses as IssueStatus[])) continue
      if (!dependent.assigneeAgentId) continue
      this.enqueueWake({
        orgId: dependent.orgId, issueId: dependent.id, agentId: dependent.assigneeAgentId,
        trigger: 'dependency', triggerDetail: `前置 ${issueId} 已解除`,
        idempotencyKey: wakeIdempotencyKey('dep', [dependent.id, issueId]),
      })
    }
  }

  deleteIssue(id: string): { deleted: true } {
    const issue = this.issues().get(id)
    if (!issue) throw new Error(`任务不存在：${id}`)
    if (issue.executionRunId) throw new Error('任务执行中（持有执行锁），先完成或取消')
    if (this.issues().all().some((item) => item.parentId === id)) throw new Error('任务下仍有子任务')
    this.issues().remove(id)
    this.ctx.platformBus.emit(PlatformEvents.ExecIssueChanged, { issueId: id, action: 'deleted' })
    return { deleted: true }
  }

  // -- 执行锁（E2：CAS 语义，检查-置位在同一同步段＝Node 原子） -------------------

  acquireLock(issueId: string, runId: string, agentKey: string): { ok: true } | { ok: false; reason: 'no_issue' | 'locked_by_other'; holder?: string } {
    const issue = this.issues().get(issueId)
    if (!issue) return { ok: false, reason: 'no_issue' }
    if (issue.executionRunId) return { ok: false, reason: 'locked_by_other', holder: issue.executionRunId }
    this.issues().update(issueId, {
      executionRunId: runId,
      executionAgentKey: agentKey,
      executionLockedAt: new Date().toISOString(),
    })
    return { ok: true }
  }

  /** run 级批量释放（Paperclip 语义：按 executionRunId 释放全部持有 issue，防部分释放泄漏）。 */
  releaseLocks(runId: string): number {
    let released = 0
    for (const issue of this.issues().all().filter((item) => item.executionRunId === runId)) {
      this.issues().update(issue.id, { executionRunId: undefined, executionAgentKey: undefined, executionLockedAt: undefined })
      released += 1
      this.ctx.platformBus.emit(PlatformEvents.ExecIssueChanged, { issueId: issue.id, action: 'lock-released' })
    }
    return released
  }

  /**
   * 僵尸锁回收（Paperclip active-run-watchdog 思路）：锁龄超阈值时按
   * decideReleaseRecovery 裁决——run 消失/终态直接强释，run 仍 running 记 timeout 再强释。
   */
  reclaimZombieLocks(nowMs = Date.now()): number {
    let reclaimed = 0
    for (const issue of this.issues().all().filter((item) => item.executionRunId && item.executionLockedAt)) {
      const lockAge = nowMs - new Date(issue.executionLockedAt!).getTime()
      if (lockAge < LOCK_TIMEOUT_MS) continue
      const run = this.runs().get(issue.executionRunId!)
      const decision = decideReleaseRecovery({
        runMissing: !run,
        runSettled: Boolean(run && run.status !== 'running'),
        lockTimedOut: true,
      })
      if (decision.kind === 'keep') continue
      if (decision.kind === 'timeout-run' && run) {
        this.runs().update(run.id, { status: 'timeout', finishedAt: new Date().toISOString(), summary: `执行锁超时（${Math.round(lockAge / 1000)}s）自动回收` })
      }
      const holderRun = issue.executionRunId!
      this.issues().update(issue.id, { executionRunId: undefined, executionAgentKey: undefined, executionLockedAt: undefined })
      reclaimed += 1
      this.auditSafe({
        type: 'change', actorType: 'machine', actorId: 'exec-hub', actorName: '执行中枢',
        action: 'exec.lock.reclaimed', resourceType: 'issue', resourceId: issue.id, resourceName: issue.title,
        result: 'ok', detail: `run=${holderRun} 锁龄 ${Math.round(lockAge / 1000)}s（${decision.kind}）`,
      })
      this.ctx.platformBus.emit(PlatformEvents.ExecLockReclaimed, { issueId: issue.id, runId: holderRun, reason: decision.kind })
    }
    return reclaimed
  }

  // -- run ------------------------------------------------------------------

  private createRun(input: { orgId: string; agentId?: string; issueIds: string[]; trigger: WakeTrigger; contextPack?: string }): RunRecord {
    return this.runs().insert({
      id: newId('run'),
      orgId: input.orgId,
      ...(input.agentId ? { agentId: input.agentId } : {}),
      issueIds: input.issueIds,
      trigger: input.trigger,
      status: 'running',
      ...(input.contextPack ? { contextPack: input.contextPack } : {}),
      startedAt: new Date().toISOString(),
    })
  }

  /** run 收尾：终态 + run 级释放锁 + in_progress 任务交回审阅（review）。 */
  completeRun(runId: string, options: { status?: RunStatus; summary?: string } = {}): RunRecord {
    const run = this.runs().get(runId)
    if (!run) throw new Error(`run 不存在：${runId}`)
    if (run.status !== 'running') return run
    const updated = this.runs().update(runId, {
      status: options.status ?? 'completed',
      finishedAt: new Date().toISOString(),
      ...(options.summary ? { summary: options.summary } : {}),
    })
    this.releaseLocks(runId)
    for (const issueId of run.issueIds) {
      const issue = this.issues().get(issueId)
      if (issue && issue.status === 'in_progress') this.issues().update(issueId, { status: 'review' })
    }
    this.auditSafe({
      type: 'invoke', actorType: 'machine', actorId: 'exec-hub', actorName: '执行中枢',
      action: 'exec.run.completed', resourceType: 'run', resourceId: runId,
      resourceName: run.agentId ?? '', result: 'ok',
      detail: `issues=${run.issueIds.length} status=${updated.status}${options.summary ? `（${options.summary}）` : ''}`,
    })
    this.ctx.platformBus.emit(PlatformEvents.ExecRunCompleted, {
      runId, agentId: run.agentId, issueIds: run.issueIds, status: updated.status,
    })
    return updated
  }

  // -- 唤醒队列（E3） -------------------------------------------------------------

  enqueueWake(input: {
    orgId: string; issueId?: string; agentId?: string; trigger: WakeTrigger
    triggerDetail?: string; payload?: Record<string, unknown>; idempotencyKey?: string
  }): WakeRecord {
    // 幂等键去重：pending / deferred_issue_execution 期间的重复投递直接返回既有单
    if (input.idempotencyKey) {
      const existing = this.wakes().findOne((item) =>
        item.idempotencyKey === input.idempotencyKey
        && (item.status === 'pending' || item.status === 'deferred_issue_execution'))
      if (existing) return existing
    }
    const issue = input.issueId ? this.issues().get(input.issueId) : undefined
    const record = this.wakes().insert({
      id: newId('wake'),
      orgId: input.orgId || issue?.orgId || '',
      ...(input.issueId ? { issueId: input.issueId } : {}),
      ...(input.agentId ? { agentId: input.agentId } : {}),
      trigger: input.trigger,
      ...(input.triggerDetail ? { triggerDetail: input.triggerDetail } : {}),
      ...(input.payload ? { payload: input.payload } : {}),
      status: 'pending',
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
      ...(issue?.goalAncestry ? { lineageSnapshot: issue.goalAncestry } : {}),
      createdAt: new Date().toISOString(),
    })
    this.ctx.platformBus.emit(PlatformEvents.ExecWakeEnqueued, {
      wakeId: record.id, trigger: record.trigger, issueId: record.issueId, agentId: record.agentId,
    })
    return record
  }

  // -- 心跳循环（E3/R9） ----------------------------------------------------------

  async tick(): Promise<TickResult> {
    const result: TickResult = { processed: 0, woken: 0, deferred: 0, skipped: 0, failed: 0, reclaimed: 0, routineFired: 0, heartbeatDue: 0 }
    // 1. 僵尸锁回收
    result.reclaimed = this.reclaimZombieLocks()
    // 2. 例行规则到期 → 入队 routine 唤醒
    result.routineFired = this.fireDueRoutines()
    // 3. 心跳到期（配置了 heartbeatIntervalMinutes 的运行态 Agent）→ 入队 routine 唤醒
    result.heartbeatDue = this.enqueueDueHeartbeats()
    // 4. 处理 pending + deferred 唤醒（先进先出，批量上限）
    const batch = this.wakes().all()
      .filter((item) => item.status === 'pending' || item.status === 'deferred_issue_execution')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, BATCH_SIZE)
    for (const wake of batch) {
      result.processed += 1
      const outcome = this.processWake(wake.id)
      if (outcome === 'woken') result.woken += 1
      else if (outcome === 'deferred') result.deferred += 1
      else if (outcome === 'failed') result.failed += 1
      else result.skipped += 1
    }
    // 5. 心跳留痕滚动保留 7 天
    const cutoff = new Date(Date.now() - HEARTBEAT_RETENTION_MS).toISOString()
    for (const stale of this.heartbeats().all().filter((item) => item.at < cutoff)) this.heartbeats().remove(stale.id)
    return result
  }

  /** 例行规则到期判定（interval 到点 / cron 分钟命中且距上次 ≥60s / webhook 由端点即时入队）。 */
  private fireDueRoutines(nowMs = Date.now()): number {
    let fired = 0
    const now = new Date()
    for (const routine of this.routines().all().filter((item) => item.enabled)) {
      if (!routine.agentId || !this.agentOf(routine.agentId)) continue
      let due = false
      if (routine.kind === 'interval' && (routine.intervalMinutes ?? 0) > 0) {
        const last = routine.lastFiredAt ? new Date(routine.lastFiredAt).getTime() : 0
        due = nowMs - last >= routine.intervalMinutes! * 60_000
      } else if (routine.kind === 'cron' && routine.cron && cronIsValid(routine.cron)) {
        const last = routine.lastFiredAt ? new Date(routine.lastFiredAt).getTime() : 0
        due = cronMatches(routine.cron, now) && nowMs - last >= 60_000
      }
      if (!due) continue
      this.routines().update(routine.id, { lastFiredAt: new Date().toISOString() })
      this.enqueueWake({
        orgId: routine.orgId, agentId: routine.agentId, trigger: 'routine',
        triggerDetail: `${routine.name}（${routine.kind}）`,
        ...(routine.payload ? { payload: routine.payload } : {}),
        idempotencyKey: wakeIdempotencyKey('routine', [routine.id, Math.floor(nowMs / 60_000)]),
      })
      fired += 1
    }
    return fired
  }

  /** 心跳到期（R9）：运行态 + 配置间隔 + 距上次唤醒 ≥ 间隔 → 入队心跳唤醒。 */
  private enqueueDueHeartbeats(nowMs = Date.now()): number {
    let due = 0
    for (const agent of this.listRunnableAgents()) {
      const interval = Number(agent.attrs['heartbeatIntervalMinutes'] ?? 0)
      if (!(interval > 0)) continue
      const lastHeartbeat = this.heartbeats().all()
        .filter((item) => item.agentId === agent.id)
        .sort((a, b) => b.at.localeCompare(a.at))[0]
      const lastMs = lastHeartbeat ? new Date(lastHeartbeat.at).getTime() : 0
      if (nowMs - lastMs < interval * 60_000) continue
      this.enqueueWake({
        orgId: agent.orgId ?? '', agentId: agent.id, trigger: 'routine',
        triggerDetail: `heartbeat:${interval}m`,
        idempotencyKey: wakeIdempotencyKey('hb', [agent.id, Math.floor(nowMs / (interval * 60_000))]),
      })
      due += 1
    }
    return due
  }

  private listRunnableAgents() {
    return this.ctx.resourceCore.list('agent').filter((agent) => agent.status === 'online' || agent.status === 'trial')
  }

  private agentOf(agentId: string) {
    return agentId ? this.ctx.resourceCore.collection('agent').get(agentId) : undefined
  }

  /**
   * 单条唤醒处理（治理五联动顺序：预算前置 → 冻结检查 → 权限校验 → 审批门禁 → 取锁/合并/延迟）。
   * 返回处理结果分类（供 tick 计数）；全程同步段内完成 CAS，无 await 穿插。
   */
  private processWake(wakeId: string): 'woken' | 'deferred' | 'failed' | 'skipped' {
    const wake = this.wakes().get(wakeId)
    if (!wake) return 'skipped'
    const issue = wake.issueId ? this.issues().get(wake.issueId) : undefined
    if (wake.issueId && !issue) {
      this.wakes().update(wakeId, { status: 'cancelled', lastError: '任务已删除' })
      return 'skipped'
    }
    if (issue && (issue.status === 'done' || issue.status === 'cancelled')) {
      this.wakes().update(wakeId, { status: 'cancelled', lastError: `任务已${issue.status === 'done' ? '完成' : '取消'}` })
      return 'skipped'
    }
    const agentId = wake.agentId ?? issue?.assigneeAgentId ?? ''
    const agent = this.agentOf(agentId)
    if (!agent) {
      this.wakes().update(wakeId, { status: 'failed', lastError: '负责人 Agent 不存在或未指定' })
      return 'failed'
    }
    if (agent.status !== 'online' && agent.status !== 'trial') {
      this.recordHeartbeat(agent, 'skipped_inactive', `状态 ${agent.status}`)
      this.wakes().update(wakeId, { status: 'failed', lastError: `Agent 非运行态（${agent.status}）` })
      return 'failed'
    }

    // 联动①：冻结检查（R10：预算超限冻结后不再唤醒，直至解冻审批执行）
    if (this.ctx.agentRegistry && typeof this.ctx.agentRegistry.isFrozen === 'function' && this.ctx.agentRegistry.isFrozen(agentId)) {
      this.recordHeartbeat(agent, 'skipped_frozen', wake.trigger)
      this.wakes().update(wakeId, { status: 'failed', lastError: 'Agent 已冻结（预算超限联动），待解冻审批' })
      this.auditSafe({
        type: 'invoke', actorType: 'machine', actorId: 'exec-hub', actorName: '执行中枢',
        action: 'exec.wakeup.frozen_skipped', resourceType: 'agent', resourceId: agentId,
        resourceName: agent.name, result: 'denied', detail: `wake=${wakeId} trigger=${wake.trigger}`,
      })
      return 'failed'
    }

    // 联动②：预算前置（E6——平台独有增值：超限直接不唤醒，而非事后记账报警）
    const budgetGate = this.checkAgentBudget(agentId, agent.orgId)
    if (budgetGate.blocked) {
      this.wakes().update(wakeId, { status: 'failed', budgetCheckPassed: false, lastError: `预算熔断：${budgetGate.reason}` })
      this.recordHeartbeat(agent, 'skipped_budget', budgetGate.reason)
      this.auditSafe({
        type: 'invoke', actorType: 'machine', actorId: 'exec-hub', actorName: '执行中枢',
        action: 'exec.wakeup.budget_denied', resourceType: 'agent', resourceId: agentId,
        resourceName: agent.name, result: 'denied', detail: `wake=${wakeId} ${budgetGate.reason}`,
      })
      // 超额联动冻结（R10）：预算标记 freezeAgent 时冻结 Agent 并生成 L4 解冻审批（复用审批基建，天然带二次确认）
      if (budgetGate.freezeAgent && this.ctx.agentRegistry && typeof this.ctx.agentRegistry.freezeAgent === 'function' && !this.ctx.agentRegistry.isFrozen(agentId)) {
        try {
          this.ctx.agentRegistry.freezeAgent(agentId, `执行中枢预算前置熔断：${budgetGate.reason}`, 'exec-hub')
        } catch (error) {
          this.ctx.logger('exec-hub').warn(`联动冻结失败：${error instanceof Error ? error.message : String(error)}`)
        }
      }
      return 'failed'
    }
    this.wakes().update(wakeId, { budgetCheckPassed: true })

    // 联动③：权限校验（Agent 机器主体须持 exec.write——身份纳管即权限收敛）
    const scopes = this.agentScopes(agentId)
    if (scopes === null || !(scopes.includes('exec.write') || scopes.includes('*'))) {
      this.wakes().update(wakeId, { status: 'failed', lastError: 'Agent 机器主体无 exec.write 权限（身份未纳管或权限收敛）' })
      this.recordHeartbeat(agent, 'skipped_permission', 'exec.write 缺失')
      this.auditSafe({
        type: 'authz', actorType: 'machine', actorId: `agent:${agentId}`, actorName: agent.name,
        action: 'exec.wakeup', resourceType: 'issue', resourceId: issue?.id ?? agentId,
        resourceName: issue?.title ?? agent.name, result: 'denied',
        detail: `机器主体缺少 exec.write（wake=${wakeId}）`,
      })
      this.ctx.platformBus.emit('audit.authz.denied', {
        actorId: agentId, actorName: agent.name, point: 'exec.write', path: `exec:wake:${wakeId}`,
      })
      return 'failed'
    }

    // Agent 级心跳唤醒（无 issue）：拉取待办 → 有则派发（上下文=待办清单），无则跳过
    if (!issue) {
      const todos = this.collectTodos(agent)
      if (todos.total === 0) {
        this.recordHeartbeat(agent, 'skipped_no_todo')
        this.wakes().update(wakeId, { status: 'done' })
        return 'skipped'
      }
      const pack = this.buildAgentTodoPack(agent, todos)
      const run = this.createRun({ orgId: agent.orgId ?? '', agentId, issueIds: [], trigger: wake.trigger, contextPack: pack })
      this.wakes().update(wakeId, { status: 'run', runId: run.id })
      this.recordHeartbeat(agent, 'woken', `${todos.total} 项待办`, todos.total)
      this.auditSafe({
        type: 'invoke', actorType: 'machine', actorId: 'exec-hub', actorName: '执行中枢',
        action: 'exec.wakeup.dispatched', resourceType: 'agent', resourceId: agentId,
        resourceName: agent.name, result: 'ok', detail: `run=${run.id} trigger=${wake.trigger} 待办=${todos.total}`,
      })
      return 'woken'
    }

    // 联动④：审批门禁（P0=高危任务：执行前须 exec.issue.run 审批 executed）
    if (issue.priority === 'P0' && !this.p0ApprovalPassed(issue.id)) {
      const deferred = this.wakes().update(wakeId, { status: 'deferred_issue_execution', lastError: 'P0 任务待审批放行' })
      this.recordHeartbeat(agent, 'deferred', `P0 审批 ${issue.id}`)
      return deferred ? 'deferred' : 'failed'
    }

    // 三态裁决（决策=domain 纯函数；CAS=下方护栏）
    const decision = decideWakeAdmission({
      isSameExecutionAgent: issue.executionAgentKey === normalizeAgentKey(agent.name),
      shouldDeferFollowupWake: false,
      shouldQueueFollowupForRunningWake: false,
      availableActiveExecutionRunPresent: Boolean(issue.executionRunId),
    })
    if (decision.kind === 'defer') {
      this.wakes().update(wakeId, { status: 'deferred_issue_execution', lastError: `执行锁由 ${issue.executionRunId} 持有` })
      return 'deferred'
    }
    const agentKey = normalizeAgentKey(agent.name)
    let runId: string
    if (decision.kind === 'coalesce') {
      runId = issue.executionRunId!
    } else {
      const run = this.createRun({
        orgId: issue.orgId, agentId, issueIds: [issue.id], trigger: wake.trigger,
        contextPack: this.buildIssueContext(issue, agent),
      })
      runId = run.id
    }
    // CAS 护栏：并发下仅一方成功（决策层不依赖它，它只防重复取锁）
    const acquired = this.acquireLock(issue.id, runId, agentKey)
    if (!acquired.ok) {
      this.wakes().update(wakeId, { status: 'deferred_issue_execution', lastError: `取锁竞争失败（${acquired.holder} 持有）` })
      return 'deferred'
    }
    if (decision.kind === 'coalesce') {
      const run = this.runs().get(runId)
      if (run && !run.issueIds.includes(issue.id)) this.runs().update(runId, { issueIds: [...run.issueIds, issue.id] })
    }
    if (issue.status === 'todo') this.issues().update(issue.id, { status: 'in_progress' })
    this.wakes().update(wakeId, { status: 'run', runId })
    this.ctx.platformBus.emit(PlatformEvents.ExecIssueChanged, { issueId: issue.id, action: 'dispatched', status: 'in_progress', runId })
    this.auditSafe({
      type: 'invoke', actorType: 'machine', actorId: 'exec-hub', actorName: '执行中枢',
      action: 'exec.wakeup.dispatched', resourceType: 'issue', resourceId: issue.id,
      resourceName: issue.title, result: 'ok',
      detail: `run=${runId} trigger=${wake.trigger} 决策=${decision.kind} agent=${agent.name}`,
    })
    return 'woken'
  }

  /** Agent 机器主体有效 scopes（principal 缺席/禁用 = null，fail-closed）。 */
  private agentScopes(agentId: string): string[] | null {
    try {
      const principal = this.ctx.authn.principals().findOne((item) =>
        item.type === 'machine' && item.refType === 'agent' && item.refId === agentId && item.status !== 'disabled')
      if (!principal) return null
      return this.ctx.authn.resolveMachineScopes(principal)
    } catch {
      return null
    }
  }

  /**
   * 预算前置检查（E6 联动②）：读 modelgw Agent 主体预算（B 组契约方法
   * budgetStatusForSubject）。方法缺席（旧版 modelgw）放行——invoke 时点的
   * enforceBudget 仍是硬闸；方法存在但抛错则 fail-closed 拒绝派发。
   */
  private checkAgentBudget(agentId: string, orgId?: string): { blocked: boolean; reason?: string; freezeAgent?: boolean } {
    const modelGateway = this.ctx.modelGateway as unknown as {
      budgetStatusForSubject?: (subject: string, orgId?: string) => Array<{
        budget: { action?: string; freezeAgent?: boolean; subject?: string }
        daily: { breached?: boolean } | null
        monthly: { breached?: boolean } | null
      }>
    }
    if (typeof modelGateway?.budgetStatusForSubject !== 'function') return { blocked: false }
    let statuses: ReturnType<NonNullable<typeof modelGateway.budgetStatusForSubject>>
    try {
      statuses = modelGateway.budgetStatusForSubject(`agent:${agentId}`, orgId)
    } catch (error) {
      return { blocked: true, reason: `预算检查失败（fail-closed）：${error instanceof Error ? error.message : String(error)}` }
    }
    for (const item of statuses ?? []) {
      const breached = item.daily?.breached || item.monthly?.breached
      if (breached && item.budget.action === 'block') {
        return {
          blocked: true, freezeAgent: item.budget.freezeAgent === true,
          reason: `Agent 主体预算（${item.budget.subject ?? ''}）已超限，action=block`,
        }
      }
    }
    return { blocked: false }
  }

  /** P0 审批门禁：无 executed 的 exec.issue.run 审批单时自动挂单（幂等：已有 pending/executed 即不再开）。 */
  private p0ApprovalPassed(issueId: string): boolean {
    const approvals = this.ctx.opsStorage.collection<{ kind?: string; status?: string; payload?: Record<string, unknown>; orgId?: string }>('audit:approvals')
    const related = approvals.all().filter((item) =>
      item.kind === 'exec.issue.run' && String(item.payload?.['issueId'] ?? '') === issueId)
    if (related.some((item) => item.status === 'executed')) return true
    if (related.some((item) => item.status === 'pending')) return false
    const issue = this.issues().get(issueId)
    try {
      this.ctx.audit.createApproval({
        kind: 'exec.issue.run',
        title: `P0 任务执行审批：「${issue?.title ?? issueId}」`,
        riskLevel: 'high',
        payload: { issueId, title: issue?.title ?? '' },
        ...(issue?.orgId ? { orgId: issue.orgId } : {}),
      })
    } catch { /* 审批面缺席时门禁保持拦截（fail-closed），下轮 tick 重试挂单 */ }
    return false
  }

  private recordHeartbeat(agent: { id: string; name: string; orgId?: string }, outcome: HeartbeatOutcome, detail?: string, issueCount?: number): void {
    try {
      this.heartbeats().insert({
        id: newId('hb'), agentId: agent.id, orgId: agent.orgId ?? '',
        at: new Date().toISOString(), outcome, ...(detail ? { detail } : {}),
        ...(issueCount !== undefined ? { issueCount } : {}),
      })
      this.ctx.platformBus.emit(PlatformEvents.ExecHeartbeatRecorded, { agentId: agent.id, outcome })
    } catch { /* 留痕失败不阻断调度 */ }
  }

  // -- 待办拉取与上下文装配（R9 + E4） --------------------------------------------

  /** Agent 待办三源：exec 任务（todo）+ 部门面板任务（todo/doing）+ 事务流 Agent 步骤（pending/running）。 */
  collectTodos(agent: { id: string; name: string }): { total: number; issues: number; panelTasks: number; flowSteps: number } {
    const issues = this.issues().all().filter((item) => item.assigneeAgentId === agent.id && item.status === 'todo').length
    let panelTasks = 0
    try {
      panelTasks = this.ctx.opsStorage.collection<{ assigneeType?: string; assigneeName?: string; lane?: string }>('panel:tasks')
        .all().filter((item) => item.assigneeType === 'agent' && item.assigneeName === agent.name
          && (item.lane === 'todo' || item.lane === 'doing')).length
    } catch { /* 面板集合缺席（独立形态）按 0 计 */ }
    let flowSteps = 0
    try {
      for (const flow of this.ctx.flow.flows().all().filter((item) => item.status === 'running')) {
        flowSteps += flow.steps.filter((step) => step.actorType === 'agent' && step.assignee === agent.name
          && (step.status === 'pending' || step.status === 'running')).length
      }
    } catch { /* 事务流服务缺席按 0 计 */ }
    return { total: issues + panelTasks + flowSteps, issues, panelTasks, flowSteps }
  }

  private buildIssueContext(issue: IssueRecord, agent: { attrs?: Record<string, unknown> }): string {
    const ancestry = issue.goalAncestry ?? []
    const titles: Record<string, string> = {}
    for (const id of ancestry) {
      const goal = this.goals().get(id)
      if (goal) {
        titles[id] = goal.metric
          ? `${goal.title}（指标：${goal.metricBaseline ?? '—'} → ${goal.metricTarget ?? '—'} ${goal.metricUnit ?? ''}）`.trim()
          : goal.title
        continue
      }
      const project = this.projects().get(id)
      if (project) titles[id] = project.name
    }
    const project = issue.projectId ? this.projects().get(issue.projectId) : undefined
    const blockers = (issue.blockerIds ?? [])
      .map((bid) => this.issues().get(bid)?.title ?? bid)
    return buildIssueContextPack({
      goalTitle: ancestry.length > 0 ? titles[ancestry[ancestry.length - (project ? 2 : 1)] ?? ''] ?? undefined : undefined,
      goalMetric: undefined,
      projectNames: project ? [project.name] : [],
      issueTitle: issue.title,
      blockerTitles: blockers,
      dataClass: typeof agent.attrs?.['dataClass'] === 'string' ? String(agent.attrs['dataClass']) : undefined,
      permissionNote: '你被授予执行权（exec.write）；执行前请通过 exec_claim 取锁，完成后 exec_complete 交回',
    })
  }

  private buildAgentTodoPack(agent: { id: string; name: string; attrs?: Record<string, unknown> }, todos: { total: number; issues: number; panelTasks: number; flowSteps: number }): string {
    const lines = [
      '【例行唤醒】',
      `你有 ${todos.total} 项待办：执行任务 ${todos.issues}、面板任务 ${todos.panelTasks}、事务流步骤 ${todos.flowSteps}。`,
      '请依次认领（exec_claim）并完成后交回（exec_complete）。',
      '',
      '【可用范围】',
      typeof agent.attrs?.['dataClass'] === 'string' ? `可访问数据密级上限：${String(agent.attrs['dataClass'])}` : '',
    ]
    return lines.filter((line) => line !== '').join('\n')
  }

  /** 任务血缘视图（E5：exec_lineage 工具与详情抽屉共用）。 */
  issueLineage(issueId: string): {
    issue?: IssueRecord
    goal?: GoalRecord
    project?: ProjectRecord
    ancestry: Array<{ id: string; kind: 'goal' | 'project'; title: string }>
    blockers: Array<{ id: string; title: string; status?: IssueStatus }>
  } {
    const issue = this.issues().get(issueId)
    if (!issue) throw new Error(`任务不存在：${issueId}`)
    const project = issue.projectId ? this.projects().get(issue.projectId) : undefined
    const goal = project?.goalId ? this.goals().get(project.goalId) : undefined
    const ancestry = (issue.goalAncestry ?? []).map((id) => {
      const g = this.goals().get(id)
      if (g) return { id, kind: 'goal' as const, title: g.title }
      const p = this.projects().get(id)
      return { id, kind: 'project' as const, title: p?.name ?? id }
    })
    const blockers = (issue.blockerIds ?? []).map((bid) => {
      const blocker = this.issues().get(bid)
      return { id: bid, title: blocker?.title ?? bid, status: blocker?.status }
    })
    return { issue, goal, project, ancestry, blockers }
  }

  // -- 健康度与总览（R9） -----------------------------------------------------------

  agentsHealth(): Array<{
    agentId: string; name: string; status: string; orgRole?: string; rank?: string
    frozen: boolean; lastHeartbeatAt?: string; lastMetricsReportAt?: string
    health: AgentHealthLevel
  }> {
    const nowMs = Date.now()
    return this.ctx.resourceCore.list('agent').map((agent) => {
      const lastHeartbeat = this.heartbeats().all()
        .filter((item) => item.agentId === agent.id)
        .sort((a, b) => b.at.localeCompare(a.at))[0]
      let lastMetrics: { updatedAt: string } | undefined
      try {
        lastMetrics = this.ctx.agentRegistry.usage().all()
          .filter((item) => item.agentId === agent.id)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
      } catch { /* usage 集合缺席按无提报计 */ }
      const frozen = (() => {
        try {
          return Boolean(this.ctx.agentRegistry.isFrozen?.(agent.id))
        } catch {
          return false
        }
      })()
      return {
        agentId: agent.id,
        name: agent.name,
        status: agent.status,
        orgRole: typeof agent.attrs?.['orgRole'] === 'string' ? String(agent.attrs['orgRole']) : undefined,
        rank: typeof agent.attrs?.['rank'] === 'string' ? String(agent.attrs['rank']) : undefined,
        frozen,
        lastHeartbeatAt: lastHeartbeat?.at,
        lastMetricsReportAt: lastMetrics?.updatedAt,
        health: computeAgentHealth({
          agentStatus: agent.status,
          frozen,
          lastHeartbeatAt: lastHeartbeat ? new Date(lastHeartbeat.at).getTime() : null,
          lastMetricsReportAt: lastMetrics ? new Date(lastMetrics.updatedAt).getTime() : null,
          nowMs,
          heartbeatIntervalMinutes: Number(agent.attrs?.['heartbeatIntervalMinutes'] ?? 0) || undefined,
        }),
      }
    })
  }

  overview(): Record<string, unknown> {
    const issues = this.issues().all()
    const issuesByStatus: Record<string, number> = {}
    for (const issue of issues) issuesByStatus[issue.status] = (issuesByStatus[issue.status] ?? 0) + 1
    const nowIso = new Date(Date.now() - LOCK_TIMEOUT_MS).toISOString()
    return {
      goals: this.goals().all().length,
      projects: this.projects().all().length,
      issuesByStatus,
      pendingWakes: this.wakes().all().filter((item) => item.status === 'pending').length,
      deferredWakes: this.wakes().all().filter((item) => item.status === 'deferred_issue_execution').length,
      activeRuns: this.runs().all().filter((item) => item.status === 'running').length,
      lockedIssues: issues.filter((item) => item.executionRunId).length,
      zombieLocks: issues.filter((item) => item.executionRunId && item.executionLockedAt && item.executionLockedAt < nowIso).length,
      agentsHealth: this.agentsHealth(),
    }
  }

  /** 纳管提报催办（R9）：运行态 Agent 超 24h 未提报 → 告警催办（按日去重）。 */
  private async remindOverdueMetrics(): Promise<void> {
    const dayKey = new Date().toISOString().slice(0, 10)
    for (const agent of this.listRunnableAgents()) {
      const key = `${agent.id}:${dayKey}`
      if (this.metricsReminderDayKeys.has(key)) continue
      let last: { updatedAt: string } | undefined
      try {
        last = this.ctx.agentRegistry.usage().all()
          .filter((item) => item.agentId === agent.id)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
      } catch { continue }
      const lastMs = last ? new Date(last.updatedAt).getTime() : 0
      if (lastMs !== 0 && Date.now() - lastMs < METRICS_OVERDUE_MS) continue
      this.metricsReminderDayKeys.add(key)
      this.ctx.audit?.fire?.({
        severity: 'warning',
        title: `Agent「${agent.name}」纳管指标超 24h 未提报`,
        message: '执行中枢催办：请调用 POST /api/agents/:id/metrics-report 提报 dau/sessions，超期未报将影响健康度评估与预算窗口。',
        resourceType: 'agent',
        resourceId: agent.id,
      })
    }
  }

  /** 审计留痕（audit 缺席静默降级——dsh-bridge softRead 同款防御）。 */
  private auditSafe(entry: Omit<AuditLogRecord, 'id' | 'createdAt' | 'updatedAt'>): void {
    try {
      this.ctx.audit?.record(entry)
    } catch { /* 审计面独立降级 */ }
  }
}

// ---------------------------------------------------------------------------
// REST + 工具 + 装配（/api/exec/*：guarded 自注册，鉴权依赖 console 中间件先行）
// ---------------------------------------------------------------------------

export function apply(ctx: Context) {
  const hub = new ExecutionHubService(ctx)
  const http = ctx.httpServer
  const { caller, guarded, body, actorOf } = createRestGate(ctx)

  const changeLog = (exchange: HttpExchange, action: string, resourceName: string, detail = ''): void => {
    const info = caller(exchange)
    try {
      ctx.audit?.record({
        type: 'change', actorType: info.kind === 'human' ? 'human' : 'machine',
        actorId: info.userId ?? info.principalId, actorName: info.name,
        action, resourceType: 'exec', resourceId: exchange.params['id'] ?? '', resourceName, result: 'ok', detail,
      })
    } catch { /* 审计面独立降级 */ }
  }

  // -- 总览 / 健康（R9） ------------------------------------------------------
  guarded('GET', '/api/exec/overview', 'exec.read', () => hub.overview())

  // -- 目标（R8） ---------------------------------------------------------------
  guarded('GET', '/api/exec/goals', 'exec.read', () => ({ goals: hub.goals().all() }))

  guarded('POST', '/api/exec/goals', 'exec.write', (exchange) => {
    const input = body<{ orgId?: string; title: string; description?: string; metric?: string; metricBaseline?: number; metricTarget?: number; metricUnit?: string; ownerUserId?: string; parentGoalId?: string; periodStart?: string; periodEnd?: string }>(exchange)
    const created = hub.createGoal({ ...input })
    changeLog(exchange, 'exec.goal.create', created.title)
    return created
  })

  guarded('PATCH', '/api/exec/goals/:id', 'exec.write', (exchange) => {
    const input = body<{ title?: string; description?: string; metric?: string; metricBaseline?: number; metricTarget?: number; metricUnit?: string; ownerUserId?: string; parentGoalId?: string; periodStart?: string; periodEnd?: string; status?: GoalStatus }>(exchange)
    const updated = hub.updateGoal(exchange.params['id']!, input)
    changeLog(exchange, 'exec.goal.update', updated.title)
    return updated
  })

  guarded('DELETE', '/api/exec/goals/:id', 'exec.write', (exchange) => {
    const result = hub.deleteGoal(exchange.params['id']!)
    changeLog(exchange, 'exec.goal.delete', exchange.params['id'] ?? '')
    return result
  })

  // -- 项目（E4） -----------------------------------------------------------------
  guarded('GET', '/api/exec/projects', 'exec.read', (exchange) => {
    const issues = hub.issues().all()
    return {
      projects: hub.projects().all().map((project) => {
        const projectIssues = issues.filter((item) => item.projectId === project.id)
        return {
          ...project,
          issueProgress: { done: projectIssues.filter((item) => item.status === 'done').length, total: projectIssues.length },
        }
      }),
    }
  })

  guarded('POST', '/api/exec/projects', 'exec.write', (exchange) => {
    const input = body<{ orgId?: string; goalId?: string; name: string; description?: string; repos?: string[]; ownerUserId?: string }>(exchange)
    const created = hub.createProject(input)
    changeLog(exchange, 'exec.project.create', created.name)
    return created
  })

  guarded('PATCH', '/api/exec/projects/:id', 'exec.write', (exchange) => {
    const input = body<{ goalId?: string; name?: string; description?: string; repos?: string[]; ownerUserId?: string; status?: ProjectStatus }>(exchange)
    const updated = hub.updateProject(exchange.params['id']!, input)
    changeLog(exchange, 'exec.project.update', updated.name)
    return updated
  })

  guarded('DELETE', '/api/exec/projects/:id', 'exec.write', (exchange) => {
    const result = hub.deleteProject(exchange.params['id']!)
    changeLog(exchange, 'exec.project.delete', exchange.params['id'] ?? '')
    return result
  })

  // -- 任务（E2/E4） ----------------------------------------------------------------
  guarded('GET', '/api/exec/issues', 'exec.read', (exchange) => {
    const status = exchange.query.get('status') ?? ''
    const agentId = exchange.query.get('agentId') ?? ''
    const projectId = exchange.query.get('projectId') ?? ''
    const agents = ctx.resourceCore.list('agent')
    const projects = hub.projects().all()
    return {
      issues: hub.issues().all()
        .filter((item) => (!status || item.status === status)
          && (!agentId || item.assigneeAgentId === agentId)
          && (!projectId || item.projectId === projectId))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((item) => ({
          ...item,
          assigneeAgentName: agents.find((agent) => agent.id === item.assigneeAgentId)?.name,
          projectName: projects.find((project) => project.id === item.projectId)?.name,
        })),
    }
  })

  guarded('POST', '/api/exec/issues', 'exec.write', (exchange) => {
    const input = body<{ orgId?: string; projectId?: string; parentId?: string; blockerIds?: string[]; title: string; detail?: string; assigneeAgentId?: string; assigneeUserId?: string; priority?: IssuePriority; dueAt?: string }>(exchange)
    const created = hub.createIssue({ ...input, createdBy: actorOf(exchange) })
    changeLog(exchange, 'exec.issue.create', created.title, `priority=${created.priority}${created.assigneeAgentId ? ' 已派发唤醒' : ''}`)
    return created
  })

  guarded('PATCH', '/api/exec/issues/:id', 'exec.write', (exchange) => {
    const input = body<{ title?: string; detail?: string; assigneeAgentId?: string; assigneeUserId?: string; projectId?: string; blockerIds?: string[]; priority?: IssuePriority; dueAt?: string }>(exchange)
    const updated = hub.updateIssue(exchange.params['id']!, input, actorOf(exchange))
    changeLog(exchange, 'exec.issue.update', updated.title)
    return updated
  })

  guarded('POST', '/api/exec/issues/:id/transition', 'exec.write', (exchange) => {
    const input = body<{ to: IssueStatus }>(exchange)
    const updated = hub.transitionIssue(exchange.params['id']!, input.to, actorOf(exchange))
    changeLog(exchange, 'exec.issue.transition', updated.title, `→ ${updated.status}`)
    return updated
  })

  guarded('DELETE', '/api/exec/issues/:id', 'exec.write', (exchange) => {
    const result = hub.deleteIssue(exchange.params['id']!)
    changeLog(exchange, 'exec.issue.delete', exchange.params['id'] ?? '')
    return result
  })

  guarded('POST', '/api/exec/issues/:id/wake', 'exec.write', (exchange) => {
    const input = body<{ reason?: string }>(exchange)
    const issue = hub.issues().get(exchange.params['id']!)
    if (!issue) { exchange.fail(404, 'NOT_FOUND', `任务不存在：${exchange.params['id']}`); return }
    if (!issue.assigneeAgentId) { exchange.fail(400, 'BAD_REQUEST', '任务未指定负责人 Agent'); return }
    const wake = hub.enqueueWake({
      orgId: issue.orgId, issueId: issue.id, agentId: issue.assigneeAgentId, trigger: 'api',
      triggerDetail: input.reason ?? `手动唤醒（${actorOf(exchange)}）`,
      idempotencyKey: wakeIdempotencyKey('api', [issue.id, Date.now()]),
    })
    changeLog(exchange, 'exec.issue.wake', issue.title, wake.triggerDetail ?? '')
    return wake
  })

  guarded('GET', '/api/exec/lineage/:issueId', 'exec.read', (exchange) => hub.issueLineage(exchange.params['issueId']!))

  // -- 唤醒 / run ------------------------------------------------------------------
  guarded('GET', '/api/exec/wakes', 'exec.read', (exchange) => {
    const status = exchange.query.get('status') ?? ''
    const agents = ctx.resourceCore.list('agent')
    return {
      wakes: hub.wakes().all()
        .filter((item) => !status || item.status === status)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 200)
        .map((item) => ({
          ...item,
          agentName: agents.find((agent) => agent.id === item.agentId)?.name,
        })),
    }
  })

  guarded('GET', '/api/exec/runs', 'exec.read', (exchange) => {
    const status = exchange.query.get('status') ?? ''
    return { runs: hub.runs().all().filter((item) => !status || item.status === status).sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 200) }
  })

  guarded('POST', '/api/exec/wakeup', 'exec.write', (exchange) => {
    const input = body<{ agentId?: string; issueId?: string; reason?: string }>(exchange)
    const wake = hub.enqueueWake({
      orgId: '', ...(input.agentId ? { agentId: input.agentId } : {}),
      ...(input.issueId ? { issueId: input.issueId } : {}),
      trigger: 'api', triggerDetail: input.reason ?? `API 触发（${actorOf(exchange)}）`,
      idempotencyKey: wakeIdempotencyKey('api', [input.issueId ?? input.agentId ?? '', Date.now()]),
    })
    changeLog(exchange, 'exec.wakeup', input.issueId ?? input.agentId ?? '', wake.triggerDetail ?? '')
    return wake
  })

  // -- 例行规则（E7） -----------------------------------------------------------------
  guarded('GET', '/api/exec/routines', 'exec.read', () => {
    const agents = ctx.resourceCore.list('agent')
    return {
      routines: hub.routines().all().map((item) => ({
        ...item,
        agentName: agents.find((agent) => agent.id === item.agentId)?.name,
      })),
    }
  })

  guarded('POST', '/api/exec/routines', 'exec.write', (exchange) => {
    const input = body<{ orgId?: string; agentId: string; name: string; kind: RoutineKind; intervalMinutes?: number; cron?: string; webhookPath?: string; payload?: Record<string, unknown>; enabled?: boolean }>(exchange)
    if (!input.name?.trim()) { exchange.fail(400, 'BAD_REQUEST', '例行规则名称必填'); return }
    if (!input.agentId || !ctx.resourceCore.collection('agent').get(input.agentId)) { exchange.fail(400, 'BAD_REQUEST', '负责人 Agent 不存在'); return }
    if (input.kind === 'interval' && !(Number(input.intervalMinutes) > 0)) { exchange.fail(400, 'BAD_REQUEST', 'interval 类型须提供正整数间隔分钟'); return }
    if (input.kind === 'cron') {
      if (!input.cron || !cronIsValid(input.cron)) { exchange.fail(400, 'BAD_REQUEST', 'cron 表达式非法（5 段：分 时 日 月 周，分钟粒度）'); return }
    }
    if (input.kind === 'webhook') {
      const path = (input.webhookPath ?? '').trim()
      if (!/^[a-z0-9-]{6,64}$/.test(path)) { exchange.fail(400, 'BAD_REQUEST', 'webhook 路径非法（小写字母/数字/-，6-64 位，路径即凭证请保持不可猜测）'); return }
      if (hub.routines().all().some((item) => item.webhookPath === path)) { exchange.fail(409, 'CONFLICT', 'webhook 路径已被占用'); return }
    }
    const created = hub.routines().insert({
      id: newId('rtn'),
      orgId: input.orgId ?? ctx.resourceCore.collection('agent').get(input.agentId)?.orgId ?? '',
      agentId: input.agentId,
      name: input.name.trim(),
      kind: input.kind,
      ...(input.kind === 'interval' ? { intervalMinutes: Number(input.intervalMinutes) } : {}),
      ...(input.kind === 'cron' ? { cron: input.cron!.trim() } : {}),
      ...(input.kind === 'webhook' ? { webhookPath: (input.webhookPath ?? '').trim() } : {}),
      ...(input.payload ? { payload: input.payload } : {}),
      enabled: input.enabled ?? true,
      createdBy: actorOf(exchange),
    })
    changeLog(exchange, 'exec.routine.create', created.name, `${created.kind}`)
    ctx.platformBus.emit(PlatformEvents.ExecRoutineChanged, { routineId: created.id, action: 'created' })
    return created
  })

  guarded('PATCH', '/api/exec/routines/:id', 'exec.write', (exchange) => {
    const input = body<{ name?: string; intervalMinutes?: number; cron?: string; payload?: Record<string, unknown>; enabled?: boolean }>(exchange)
    if (input.cron !== undefined && input.cron !== '' && !cronIsValid(input.cron)) { exchange.fail(400, 'BAD_REQUEST', 'cron 表达式非法'); return }
    const updated = hub.routines().update(exchange.params['id']!, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.intervalMinutes !== undefined ? { intervalMinutes: Number(input.intervalMinutes) } : {}),
      ...(input.cron !== undefined && input.cron !== '' ? { cron: input.cron } : {}),
      ...(input.payload !== undefined ? { payload: input.payload } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    })
    changeLog(exchange, 'exec.routine.update', updated.name)
    ctx.platformBus.emit(PlatformEvents.ExecRoutineChanged, { routineId: updated.id, action: 'updated' })
    return updated
  })

  guarded('DELETE', '/api/exec/routines/:id', 'exec.write', (exchange) => {
    hub.routines().remove(exchange.params['id']!)
    changeLog(exchange, 'exec.routine.delete', exchange.params['id'] ?? '')
    ctx.platformBus.emit(PlatformEvents.ExecRoutineChanged, { routineId: exchange.params['id'] ?? '', action: 'deleted' })
    return { deleted: true }
  })

  // -- 运维（手动 tick：测试与运维通道） ----------------------------------------------
  guarded('POST', '/api/exec/tick', 'exec.admin', async (exchange) => {
    const result = await hub.tick()
    changeLog(exchange, 'exec.tick', 'manual', `processed=${result.processed} woken=${result.woken} reclaimed=${result.reclaimed}`)
    return result
  })

  // -- Webhook 触发器（E7：路径即凭证——未登记/停用一律 404，不泄露存在性） ---------------
  http.register('POST', '/api/exec/webhook/:path', (exchange) => {
    const path = exchange.params['path'] ?? ''
    const routine = hub.routines().findOne((item) => item.kind === 'webhook' && item.webhookPath === path && item.enabled)
    if (!routine) {
      exchange.fail(404, 'NOT_FOUND', 'Not Found')
      return
    }
    const wake = hub.enqueueWake({
      orgId: routine.orgId, agentId: routine.agentId, trigger: 'webhook',
      triggerDetail: `webhook:${path}`,
      idempotencyKey: wakeIdempotencyKey('webhook', [routine.id, Date.now()]),
    })
    exchange.ok({ wakeId: wake.id, routine: routine.name })
  }, { access: 'public', selfValidated: true })

  // -- Agent 工具（E5：Agent 会话内直接调用，无需知晓执行中枢存在） --------------------
  const tools = ctx.tools
  if (tools) {
    tools.register(defineTool({
      name: 'exec_wakeup_status',
      description: '查看执行中枢唤醒队列状态（待唤醒/延迟中/活跃 run 数）。',
      permission: 'exec.read',
      parameters: {},
      output: { type: 'object', additionalProperties: true },
      async execute() {
        const overview = hub.overview() as { pendingWakes: number; deferredWakes: number; activeRuns: number; lockedIssues: number }
        return { pending: overview.pendingWakes, deferred: overview.deferredWakes, activeRuns: overview.activeRuns, lockedIssues: overview.lockedIssues }
      },
    }))

    tools.register(defineTool({
      name: 'exec_claim',
      description: '认领任务并取执行锁（CAS：他人持有则告知 locked_by_other；认领即建 run 并置任务进行中）。',
      permission: 'exec.write',
      parameters: { issueId: { type: 'string', required: true, description: '任务 ID' } },
      output: { type: 'object', additionalProperties: true },
      async execute(args, exec) {
        const issue = hub.issues().get(String(args.issueId ?? ''))
        if (!issue) throw new Error(`任务不存在：${String(args.issueId)}`)
        // 机器主体只能认领指派给自己的任务（人类 exec.write 持有者不受此限）
        if (exec.principal?.kind === 'machine' && exec.principal.refType === 'agent' && issue.assigneeAgentId !== exec.principal.refId) {
          throw new Error('该任务未指派给你（no_permission）')
        }
        if (issue.executionRunId) return { ok: false, reason: 'locked_by_other', holder: issue.executionRunId }
        const agent = issue.assigneeAgentId ? ctx.resourceCore.collection('agent').get(issue.assigneeAgentId) : undefined
        const runId = newId('run')
        const acquired = hub.acquireLock(issue.id, runId, normalizeAgentKey(agent?.name ?? 'unknown'))
        if (!acquired.ok) return { ok: false, reason: acquired.reason, holder: acquired.holder }
        hub.runs().insert({
          id: runId, orgId: issue.orgId,
          ...(issue.assigneeAgentId ? { agentId: issue.assigneeAgentId } : {}),
          issueIds: [issue.id], trigger: 'api', status: 'running',
          contextPack: agent ? hub.issueLineage(issue.id).ancestry.map((item) => item.title).join(' › ') : undefined,
          startedAt: new Date().toISOString(),
        })
        if (issue.status === 'todo') hub.issues().update(issue.id, { status: 'in_progress' })
        ctx.platformBus.emit(PlatformEvents.ExecIssueChanged, { issueId: issue.id, action: 'claimed', status: 'in_progress', runId })
        return { ok: true, runId }
      },
    }))

    tools.register(defineTool({
      name: 'exec_complete',
      description: '交回产出并完结 run（run 级释放执行锁；进行中任务转待审 review）。',
      permission: 'exec.write',
      parameters: {
        runId: { type: 'string', description: 'run ID（exec_claim 返回）' },
        issueId: { type: 'string', description: '任务 ID（无 runId 时按其持有 run 收尾）' },
        summary: { type: 'string', description: '产出摘要' },
        status: { type: 'string', enum: ['completed', 'failed'], description: '缺省 completed' },
      },
      output: { type: 'object', additionalProperties: true },
      async execute(args) {
        let runId = String(args.runId ?? '')
        if (!runId) {
          const issueId = String(args.issueId ?? '')
          const issue = hub.issues().get(issueId)
          if (!issue?.executionRunId) throw new Error('缺少 runId，或该任务未持有执行锁')
          runId = issue.executionRunId
        }
        const run = hub.completeRun(runId, {
          ...(args.status === 'failed' ? { status: 'failed' } : { status: 'completed' }),
          ...(args.summary ? { summary: String(args.summary) } : {}),
        })
        return { ok: true, runId, status: run.status, releasedLock: true }
      },
    }))

    tools.register(defineTool({
      name: 'exec_lineage',
      description: '查看任务的目标血缘（目标 → 项目 → 任务 → 前置依赖），回答「为什么而干」。',
      permission: 'exec.read',
      parameters: { issueId: { type: 'string', required: true, description: '任务 ID' } },
      output: { type: 'object', additionalProperties: true },
      async execute(args) {
        const lineage = hub.issueLineage(String(args.issueId ?? ''))
        return {
          goal: lineage.goal ? { id: lineage.goal.id, title: lineage.goal.title, metric: lineage.goal.metric } : undefined,
          project: lineage.project ? { id: lineage.project.id, name: lineage.project.name } : undefined,
          ancestry: lineage.ancestry,
          blockers: lineage.blockers,
        }
      },
    }))
  }

  // -- 演示种子（G3：DEMO_SEED 下制造业三部门示例；空库幂等） --------------------------
  seedExecHub(ctx, hub)
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    execHub: ExecutionHubService
  }
}

export const name = 'exec-hub'
export const inject = [
  'httpServer', 'opsStorage', 'platformBus', 'iam', 'authn', 'audit', 'tools',
  'modelGateway', 'resourceCore', 'agentRegistry', 'flow',
]
