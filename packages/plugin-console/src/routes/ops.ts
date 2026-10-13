/**
 * Ops 域路由：多租户最小集/计量管道/全员工作台与效果回传/总线死信重投/成本摘要与反馈聚合/模型渠道治理（渠道组/遥测/预算）（R4 巨石拆分，REFACTOR-2026-10-13，2026-10-13）：
 * 自 plugin-console/index.ts 拆出，处理器逐字搬运（行为与迁出前一致）。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ConsoleRouteDeps } from './deps.ts'
import { nonbillableUsage } from '../../../plugin-usage/src/index.ts'

export function registerOpsRoutes(ctx: Context, deps: ConsoleRouteDeps): void {
  const { http, guarded, body, changeLog, caller } = deps
  // -- 租户（多租户最小集，v1.2 第 2 步） ------------------------------------
  guarded('GET', '/api/iam/tenants', 'iam.org.read', () => ({
    tenants: ctx.iam.tenants().all(),
  }))

  guarded('POST', '/api/iam/tenants', 'iam.org.write', (exchange) => {
    const input = body<{ name: string; plan?: 'trial' | 'standard' | 'enterprise' }>(exchange)
    const tenant = ctx.iam.createTenant(input)
    changeLog(exchange, 'iam.tenant.create', 'tenant', tenant.id, tenant.name)
    return tenant
  })

  // -- 计量（usage 管道，v1.2 第 2 步） --------------------------------------
  guarded('GET', '/api/usage/events', 'usage.read', (exchange) => {
    return ctx.usage.query({
      ...(exchange.query.get('tenant_id') ? { tenant_id: exchange.query.get('tenant_id')! } : {}),
      ...(exchange.query.get('principal') ? { principal: exchange.query.get('principal')! } : {}),
      ...(exchange.query.get('resource') ? { resource: exchange.query.get('resource')! } : {}),
      ...(exchange.query.get('from') ? { from: exchange.query.get('from')! } : {}),
      ...(exchange.query.get('to') ? { to: exchange.query.get('to')! } : {}),
      ...(exchange.query.get('limit') ? { limit: Number(exchange.query.get('limit')) } : {}),
    })
  })

  guarded('GET', '/api/usage/totals', 'usage.read', (exchange) => {
    return ctx.usage.totals({
      ...(exchange.query.get('tenant_id') ? { tenant_id: exchange.query.get('tenant_id')! } : {}),
      ...(exchange.query.get('principal') ? { principal: exchange.query.get('principal')! } : {}),
      // REL-08：resource 过滤此前被路由静默丢弃（服务层 totals() 已支持）——?resource=<不存在键> 返回全库数字
      ...(exchange.query.get('resource') ? { resource: exchange.query.get('resource')! } : {}),
      ...(exchange.query.get('from') ? { from: exchange.query.get('from')! } : {}),
    })
  })

  guarded('POST', '/api/usage/record', 'usage.write', (exchange) => {
    const input = body<{ org: string; subject: string; principal: string; resource: string; meters: Array<{ key: string; value: number; unit: string }>; tenant_id?: string; trace_id?: string; idempotency_key?: string }>(exchange)
    const event = ctx.usage.record(input)
    changeLog(exchange, 'usage.record', 'usage_event', event.event_id, event.resource, `${event.meters.map((meter) => `${meter.key}=${meter.value}`).join(',')} charge=${event.pricing.charge_cents}分`)
    return event
  })

  // -- 全员工作台 / 效果回传（WP-04/A3 + WP-07/D1） ---------------------------------

  /** 资产引用 → 展示名（agent/app/nas 走资源注册表，mcp/skill 走各自注册表；id 或 slug 命中均可）。 */
  const usageAssetName = (resource: string): string => {
    const colon = resource.indexOf(':')
    const type = resource.slice(0, colon)
    const id = resource.slice(colon + 1)
    const matches = (item: { id?: string; slug?: string; name?: string }): boolean => item.id === id || item.slug === id
    try {
      if (type === 'agent' || type === 'app' || type === 'nas') return ctx.resourceCore.list(type).find(matches)?.name ?? id
      if (type === 'mcp') return ctx.mcpRegistry.services().all().find(matches)?.name ?? id
      if (type === 'skill') return ctx.skillHub.skills().all().find(matches)?.name ?? id
    } catch { /* 注册表缺失时回落裸标识 */ }
    return id
  }

  /**
   * 最近调用（WP-04/A3 全员工作台）：当前登录人自身的计量事件 ≤5，只读自见（不做跨人透视）。
   * 管理口径仍走 /api/usage/events（usage.read）。
   */
  guarded('GET', '/api/usage/recent', 'console.login', (exchange) => {
    const info = caller(exchange)
    if (!info.userId) return { items: [] }
    const limit = Math.min(Number(exchange.query.get('limit') ?? 5) || 5, 20)
    const subject = `user:${info.userId}`
    const items = ctx.usage.query({ limit: 200 }).items
      .filter((event) => event.subject === subject)
      .slice(0, limit)
      .map((event) => ({
        event_id: event.event_id,
        occurred_at: event.occurred_at,
        resource: event.resource,
        name: usageAssetName(event.resource),
        meters: event.meters,
        charge_cents: event.pricing.charge_cents,
        nonbillable: event.pricing.rate?.nonbillable === true,
      }))
    return { items }
  })

  /**
   * 反馈回传（WP-07/D1）：👍/👎 薄端点 —— 落零价快照 usage 事件（D2：charge=0 + nonbillable，
   * 不污染计量口径）。主体经 X-On-Behalf-User 归因（Agent 代用户回传），缺省取登录人；
   * 幂等键=主体+资源+消息+评分，同键重放不重复计数。
   */
  guarded('POST', '/api/usage/feedback', 'console.login', (exchange) => {
    const info = caller(exchange)
    const input = body<{ resource: string; messageId?: string; score: 'up' | 'down'; note?: string }>(exchange)
    if (!input.resource?.trim() || (input.score !== 'up' && input.score !== 'down')) {
      exchange.fail(400, 'BAD_REQUEST', 'resource 与 score（up/down）必填')
      return
    }
    const onBehalf = String(exchange.headers['x-on-behalf-user'] ?? '').trim()
    const subject = onBehalf ? `user:${onBehalf}` : (info.userId ? `user:${info.userId}` : '')
    if (!subject) {
      exchange.fail(403, 'FORBIDDEN', '机器主体回传反馈须携带 X-On-Behalf-User 归因到人')
      return
    }
    const orgId = (info.userId ? ctx.iam.users().get(info.userId)?.orgId : undefined) ?? ''
    const event = ctx.usage.record(nonbillableUsage({
      org: orgId,
      subject,
      principal: orgId ? `org:${orgId}` : 'platform',
      resource: input.resource,
      idempotency_key: `feedback:${subject}:${input.resource}:${input.messageId ?? 'anon'}:${input.score}`,
    }))
    changeLog(exchange, 'usage.feedback', 'usage_event', event.event_id, input.resource,
      `${input.score}${input.note ? `：${input.note}` : ''}（非计费零价快照，X-On-Behalf-User${onBehalf ? `=${onBehalf}` : '未用'}）`)
    return { event_id: event.event_id, charge_cents: event.pricing.charge_cents, nonbillable: event.pricing.rate?.nonbillable === true }
  })

  guarded('GET', '/api/usage/price-book', 'usage.admin', () => ({
    entries: ctx.usage.priceBook().all(),
  }))

  guarded('PUT', '/api/usage/price-book', 'usage.admin', (exchange) => {
    const input = body<{ pattern: string; meter_key: string; list_cents_per_unit: number; cost_cents_per_unit: number; units_per_step: number; tax_rate?: number; currency?: string; rate_version?: string }>(exchange)
    const entry = ctx.usage.upsertPrice({ tax_rate: 0.06, currency: 'CNY', rate_version: 'v2026.08', ...input })
    changeLog(exchange, 'usage.price.upsert', 'price_entry', entry.id, entry.pattern)
    return entry
  })

  guarded('POST', '/api/usage/reconcile', 'usage.admin', (exchange) => {
    const since = exchange.query.get('from') ?? undefined
    const reconciliation = ctx.usage.reconcile(since)
    const drift = ctx.usage.capabilityDrift(since)
    changeLog(exchange, 'usage.reconcile', 'usage', 'reconcile', '', `mismatch=${reconciliation.mismatch} drift=${drift.drift.length}`)
    return { reconciliation, drift }
  })

  guarded('GET', '/api/usage/dead-letters', 'usage.admin', () => ({
    items: ctx.usage.deadLetters().all(),
  }))

  guarded('POST', '/api/usage/replay', 'usage.admin', (exchange) => {
    const { from } = body<{ from: string }>(exchange)
    return ctx.usage.replay(from)
  })

  guarded('POST', '/api/usage/dead-letters/retry', 'usage.admin', (exchange) => {
    const result = ctx.usage.retryDeadLetters()
    changeLog(exchange, 'usage.deadletter.retry', 'usage', 'dead-letters', '', `重投 ${result.retried} 条，剩余 ${result.remaining} 条`)
    return result
  })

  // -- 总线死信（QA C-03）：对齐 usage 死信面——运维不再翻 jsonl -------------------
  guarded('GET', '/api/bus/dead-letters', 'usage.admin', () => ({
    deadLetters: ctx.platformBus.deadLetters(),
  }))

  guarded('POST', '/api/bus/dead-letters/retry', 'usage.admin', (exchange) => {
    const result = ctx.platformBus.retryDeadLetters()
    changeLog(exchange, 'bus.deadletter.retry', 'bus', 'dead-letters', '', `尝试 ${result.attempted} 条，重投 ${result.redelivered} 条，保留 ${result.retained} 条`)
    return result
  })

  // 保留策略手动巡检（缺省按 USAGE_RETENTION_DAYS 配置的窗口；body.days 允许管理员临时以更短窗口清理，
  // 0=本次跳过）。日常清理由 usage 服务内建定时巡检承担，此端点是运维的手动对账口。
  guarded('POST', '/api/usage/retention/purge', 'usage.admin', (exchange) => {
    const input = body<{ days?: number }>(exchange)
    const days = typeof input.days === 'number' && Number.isFinite(input.days) && input.days >= 0 ? Math.floor(input.days) : undefined
    const result = ctx.usage.purgeExpired(days)
    changeLog(exchange, 'usage.retention.purge', 'usage', 'retention', '', `days=${days ?? 'default'} 事件=${result.purgedEvents} 水位=${result.purgedWatermarks} 死信=${result.purgedDeadLetters}`)
    return { ...result, retentionDays: ctx.usage.retentionDays }
  })

  guarded('PUT', '/api/usage/capability-grants', 'usage.admin', (exchange) => {
    const input = body<{ principal: string; capabilities: string[]; source?: string }>(exchange)
    return ctx.usage.grantCapabilities(input.principal, input.capabilities, input.source ?? 'console')
  })

  // -- 成本摘要与反馈聚合（IAW 交接 4-1/4-2，面板度量驾驶舱数据源） ----------------
  // 权限分层：panel.read 可查，但非 usage.read 主体强制收敛到自身组织（scope=self-org）。
  // 窗口边界为 UTC 日界（与 usage byDay/costReport 口径一致）。
  const usageWindowBounds = (window: string): { from: string; to: string } => {
    const now = new Date()
    const to = now.toISOString()
    if (window === 'month') return { from: `${now.toISOString().slice(0, 7)}-01T00:00:00.000Z`, to }
    return { from: `${now.toISOString().slice(0, 10)}T00:00:00.000Z`, to }
  }

  guarded('GET', '/api/usage/summary', 'panel.read', (exchange) => {
    const info = caller(exchange)
    const canCrossOrg = info.permissions.includes('*') || info.permissions.includes('usage.read')
    const window = exchange.query.get('window') === 'month' ? 'month' : 'today'
    const { from, to } = usageWindowBounds(window)
    let org = exchange.query.get('org') ?? undefined
    let subject = exchange.query.get('subject') ?? undefined
    if (!canCrossOrg) {
      const user = info.userId ? ctx.iam.users().get(info.userId) : undefined
      org = user?.orgId ?? '__no_org__' // 组织解析失败 → 空聚合（fail-closed，不透穿全平台成本）
      subject = undefined
    }
    const summary = ctx.usage.summary({ from, to, ...(org ? { org } : {}), ...(subject ? { subject } : {}) })
    // 预算进度（1-4 联动）：modelgw 预算在位时随摘要返回，缺席=无预算配置
    let budget: unknown = null
    try {
      budget = (ctx.modelGateway as unknown as { budgetStatusFor?: (org: string) => unknown } | undefined)?.budgetStatusFor?.(org ?? '') ?? null
    } catch { /* 预算面缺席不阻塞摘要 */ }
    return { window, scope: canCrossOrg ? 'platform' : 'self-org', ...(org ? { org } : {}), ...(subject ? { subject } : {}), budget, ...summary }
  })

  guarded('GET', '/api/usage/feedback-stats', 'panel.read', (exchange) => {
    const info = caller(exchange)
    const canCrossOrg = info.permissions.includes('*') || info.permissions.includes('usage.read')
    const daysParam = Number(exchange.query.get('days') ?? 30)
    const days = exchange.query.get('days') === 'all' ? 0 : Math.min(Math.max(Number.isFinite(daysParam) ? daysParam : 30, 1), 365)
    const from = days > 0 ? new Date(Date.now() - days * 86_400_000).toISOString() : undefined
    let org = exchange.query.get('org') ?? undefined
    if (!canCrossOrg) {
      const user = info.userId ? ctx.iam.users().get(info.userId) : undefined
      org = user?.orgId ?? '__no_org__'
    }
    const stats = ctx.usage.feedbackStats({ ...(from ? { from } : {}), ...(org ? { org } : {}) })
    return { windowDays: days, scope: canCrossOrg ? 'platform' : 'self-org', ...(org ? { org } : {}), ...stats }
  })

  // -- 模型渠道治理（IAW 交接 1-2/1-3/1-4：渠道组/遥测/预算，modelgw 域面） --------
  guarded('GET', '/api/modelgw/channel-groups', 'panel.read', () => ({
    groups: ctx.modelGateway.channelGroups().all().map((group) => ({
      ...group,
      chain: [group.primary, group.backup1, group.backup2].filter(Boolean),
      stepTimeoutMs: group.stepTimeoutMs ?? 8000,
    })),
  }))

  guarded('PUT', '/api/modelgw/channel-groups', 'panel.config.write', (exchange) => {
    const input = body<{ slug: string; name: string; primary: string; backup1?: string; backup2?: string; manual?: boolean; stepTimeoutMs?: number; enabled?: boolean }>(exchange)
    if (!input.slug?.trim() || !input.primary?.trim() || !input.name?.trim()) {
      exchange.fail(400, 'BAD_REQUEST', 'slug/name/primary 必填')
      return
    }
    if (input.stepTimeoutMs !== undefined && (input.stepTimeoutMs < 500 || input.stepTimeoutMs > 60_000)) {
      exchange.fail(400, 'BAD_REQUEST', 'stepTimeoutMs 应在 500-60000ms 之间（PRD §4.1 口径 8000）')
      return
    }
    const group = ctx.modelGateway.upsertChannelGroup({
      slug: input.slug.trim(), name: input.name.trim(), primary: input.primary.trim(),
      ...(input.backup1 ? { backup1: input.backup1.trim() } : {}),
      ...(input.backup2 ? { backup2: input.backup2.trim() } : {}),
      ...(input.manual !== undefined ? { manual: input.manual } : {}),
      ...(input.stepTimeoutMs !== undefined ? { stepTimeoutMs: input.stepTimeoutMs } : {}),
      enabled: input.enabled ?? true,
    })
    changeLog(exchange, 'modelgw.channel_group.upsert', 'modelgw_channel_group', group.id, group.name)
    return group
  })

  /**
   * 降级链调用入口（IAW 交接 1-2）：按渠道组 主→备1→备2 逐级尝试，每步 stepTimeoutMs 超时；
   * 每次降级发 modelgw.degraded（面板 SSE 提示条消费）。全链失败且组配 manual=true →
   * 200 + ok:false + escalated:true（转人工），不造假回复。
   */
  guarded('POST', '/api/modelgw/channel-groups/:slug/invoke', 'panel.write', async (exchange) => {
    const input = body<{ messages?: Array<{ role: string; content: string }>; prompt?: string; dataClass?: string; maxTokens?: number }>(exchange)
    const messages = input.messages ?? (input.prompt ? [{ role: 'user', content: input.prompt }] : [])
    if (messages.length === 0) {
      exchange.fail(400, 'BAD_REQUEST', 'messages（或 prompt）必填')
      return
    }
    const info = caller(exchange)
    const orgId = (info.userId ? ctx.iam.users().get(info.userId)?.orgId : undefined)
      ?? ctx.iam.orgs().find((org) => org.parentId === null).at(0)?.id ?? ''
    const dataClass = input.dataClass === 'public' || input.dataClass === 'internal' || input.dataClass === 'secret' ? input.dataClass : undefined
    const result = await ctx.modelGateway.invokeWithFallback({
      group: exchange.params['slug']!,
      orgId,
      subject: info.userId ? `user:${info.userId}` : `machine:${info.principalId}`,
      messages,
      ...(dataClass ? { dataClass } : {}),
      ...(input.maxTokens !== undefined ? { maxTokens: input.maxTokens } : {}),
    })
    return result
  })

  guarded('GET', '/api/modelgw/:slug/telemetry', 'panel.read', (exchange) => {
    const slug = exchange.params['slug']!
    if (!ctx.modelGateway.models().findOne((item) => item.slug === slug)) {
      exchange.fail(404, 'NOT_FOUND', `模型不存在：${slug}`)
      return
    }
    const windowDays = Math.min(Math.max(Number(exchange.query.get('window')?.replace(/d$/, '') ?? 7) || 7, 1), 30)
    return ctx.modelGateway.telemetryFor(slug, windowDays)
  })

  guarded('GET', '/api/modelgw/budgets', 'panel.read', (exchange) => ({
    budgets: ctx.modelGateway.budgets().all()
      .filter((budget) => (exchange.query.get('org') ? (budget.orgId ?? '') === exchange.query.get('org') : true)),
  }))

  guarded('PUT', '/api/modelgw/budgets', 'panel.config.write', (exchange) => {
    const input = body<{ orgId?: string; modelSlug?: string; dailyLimitCents?: number; monthlyLimitCents?: number; warnRatio?: number; action?: 'warn' | 'block'; enabled?: boolean }>(exchange)
    for (const [key, value] of [['dailyLimitCents', input.dailyLimitCents], ['monthlyLimitCents', input.monthlyLimitCents]] as const) {
      if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
        exchange.fail(400, 'BAD_REQUEST', `${key} 应为非负数（分）`)
        return
      }
    }
    const budget = ctx.modelGateway.upsertBudget({
      ...(input.orgId ? { orgId: input.orgId } : {}),
      ...(input.modelSlug ? { modelSlug: input.modelSlug } : {}),
      ...(input.dailyLimitCents !== undefined ? { dailyLimitCents: input.dailyLimitCents } : {}),
      ...(input.monthlyLimitCents !== undefined ? { monthlyLimitCents: input.monthlyLimitCents } : {}),
      warnRatio: input.warnRatio ?? 0.8,
      action: input.action ?? 'warn',
      enabled: input.enabled ?? true,
    })
    changeLog(exchange, 'modelgw.budget.upsert', 'modelgw_budget', budget.id, budget.orgId ?? '（平台级）')
    return budget
  })

}
