/**
 * Usage 域路由：用量透明月度报表（J4 契约）+ 模型网关（统一模型接入/渠道调用/密钥托管/用量透明计量）（R4 巨石拆分，REFACTOR-2026-10-13，2026-10-13）：
 * 自 plugin-console/index.ts 拆出，处理器逐字搬运（行为与迁出前一致）。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ConsoleRouteDeps } from './deps.ts'

export function registerUsageRoutes(ctx: Context, deps: ConsoleRouteDeps): void {
  const { http, guarded, body, changeLog, caller } = deps
  // -- 用量透明月度报表（M0-3；J4 契约：docs/contract-j4-usage-report.md） ----------------
  // 部门/Agent/Skill 三维 tokens 聚合 + 零价快照口径；format=csv 自助导出（Excel 友好 BOM）。
  guarded('GET', '/api/usage/report/monthly', 'usage.read', (exchange) => {
    const monthParam = exchange.query.get('month') ?? undefined
    const report = ctx.usage.monthlyReport(monthParam)
    if ((exchange.query.get('format') ?? '') !== 'csv') return report
    const esc = (value: string | number) => {
      const text = String(value)
      return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
    }
    const header = '维度,维度值,事件数,tokens,charge_cents(零价快照恒0),cost_cents(内部成本参考),nonbillable事件数'
    const lines = [header]
    const pushRows = (name: string, rows: Array<{ dimension: string; events: number; tokens: number; charge_cents: number; cost_cents: number; nonbillable_events: number }>) => {
      for (const row of rows) lines.push([name, esc(row.dimension), row.events, row.tokens, row.charge_cents, row.cost_cents, row.nonbillable_events].join(','))
    }
    pushRows('total', [report.totals])
    pushRows('org', report.byOrg)
    pushRows('agent', report.byAgent)
    pushRows('skill', report.bySkill)
    pushRows('model', report.byModel)
    // 直接写原始响应（guarded 包装器对返回值做 JSON 序列化，流式文件下载须绕开）
    exchange.res.writeHead(200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="usage-report-${report.month}.csv"`,
    })
    exchange.res.end('\ufeff' + lines.join('\r\n') + '\r\n')
    return undefined
  })

  // -- 模型网关（M0-3：统一模型接入 + 用量透明计量） ---------------------------
  guarded('GET', '/api/modelgw/models', 'modelgw.read', () => ({
    models: ctx.modelGateway.models().all().map((item) => ({ ...item, apiKey: item.apiKey.startsWith('env:') ? item.apiKey : '***' })),
  }))

  guarded('POST', '/api/modelgw/models', 'modelgw.admin', (exchange) => {
    const input = body<{ slug: string; displayName?: string; provider?: string; endpoint: string; apiKey?: string; costCentsPerKTokens?: number; status?: 'online' | 'offline'; dataClassLimit?: 'public' | 'internal' | 'secret' }>(exchange)
    const model = ctx.modelGateway.upsertModel({
      slug: input.slug,
      displayName: input.displayName ?? input.slug,
      provider: input.provider ?? 'external',
      endpoint: input.endpoint,
      apiKey: input.apiKey ?? 'env:MODEL_API_KEY',
      costCentsPerKTokens: input.costCentsPerKTokens ?? 0,
      status: input.status ?? 'online',
      ...(input.dataClassLimit !== undefined ? { dataClassLimit: input.dataClassLimit } : {}),
    })
    changeLog(exchange, 'modelgw.model.upsert', 'model', model.id, model.slug, `分级上限=${model.dataClassLimit ?? 'internal'}`)
    return model
  })

  /** 删除模型：从模型目录移除登记；计量与审计数据保留。 */
  guarded('DELETE', '/api/modelgw/models/:id', 'modelgw.admin', (exchange) => {
    const id = exchange.params['id']!
    const model = ctx.modelGateway.models().get(id)
    if (!model) throw new Error(`模型不存在：${id}`)
    ctx.modelGateway.models().remove(id)
    changeLog(exchange, 'modelgw.delete', 'model', id, model.slug)
    return { deleted: true }
  })

  guarded('POST', '/api/modelgw/invoke', 'modelgw.invoke', async (exchange) => {
    const info = caller(exchange)
    const input = body<{ model: string; messages: Array<{ role: string; content: string }>; orgId?: string; maxTokens?: number; temperature?: number; dataClass?: 'public' | 'internal' | 'secret' }>(exchange)
    // 默认用量归口组织：调用者所属组织（人）或凭证组织（机器）
    const orgId = input.orgId
      ?? (info.kind === 'human' && info.userId ? ctx.iam.users().get(info.userId)?.orgId : undefined)
    if (!orgId) throw new Error('未指定用量归口组织（orgId），且调用者无可归属组织')
    // 计量主体：human=user:<id>；machine 凭证关联 Agent 时=agent:<refId>（usage.recorded 回灌 Agent 台账的依据），其余机器=app:<principalId>
    const subject = info.kind === 'human'
      ? `user:${info.userId ?? info.principalId}`
      : (info.refType === 'agent' && info.refId ? `agent:${info.refId}` : `app:${info.principalId}`)
    return await ctx.modelGateway.invoke({
      model: input.model,
      messages: input.messages,
      orgId,
      subject,
      ...(input.maxTokens !== undefined ? { maxTokens: input.maxTokens } : {}),
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      ...(input.dataClass !== undefined ? { dataClass: input.dataClass } : {}),
    })
  })

  guarded('GET', '/api/approvals', 'approval.read', () => ({
    approvals: ctx.audit.approvals().all().sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  }))

  guarded('POST', '/api/approvals/:id/decide', 'approval.decide', async (exchange) => {
    const { decision, opinion, confirmed, finalReview } = body<{ decision: 'approve' | 'reject'; opinion?: string; confirmed?: boolean; finalReview?: boolean }>(exchange)
    const info = caller(exchange)
    const record = await ctx.audit.decideApproval(exchange.params['id']!, decision, info.userId ?? info.principalId, info.name, opinion, { confirmed, finalReview })
    return record
  })

  /** 删除审批单：仅「已驳回」单可删（Skill/Agent/应用等各资产驳回单统一走此口清理）；审计数据保留。 */
  guarded('DELETE', '/api/approvals/:id', 'approval.decide', (exchange) => {
    const id = exchange.params['id']!
    const record = ctx.audit.approvals().get(id)
    if (!record) throw new Error(`审批单不存在：${id}`)
    ctx.audit.deleteApproval(id)
    changeLog(exchange, 'approval.delete', 'approval', id, record.title, `清理驳回审批单（kind=${record.kind}）`)
    return { deleted: true }
  })

  /** 审批 SLA 看板（WP-10）：≤2 工作日达成率可查（L2 审批周期指标口径）。 */
  guarded('GET', '/api/approvals/sla', 'approval.read', (exchange) => {
    const windowDays = Number(exchange.query.get('windowDays') ?? 30) || 30
    return ctx.audit.slaReport(Math.min(Math.max(windowDays, 1), 365))
  })

}
