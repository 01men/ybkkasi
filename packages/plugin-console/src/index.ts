/**
 * @dsh-ops/plugin-console —— 管理控制台接入插件。
 *
 * 职责：
 *   - REST API 网关：统一 Bearer 鉴权（authn）、权限点校验（RBAC）、审计埋点
 *   - 静态托管管理控制台 SPA（public/，飞书级交互）
 *   - 工具桥：POST /api/tools/execute 让 CLI/外部系统以同一套工具契约调用平台
 *   - 首次启动种子数据（演示环境）
 */
import { join, dirname, extname } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { existsSync, readdirSync, createReadStream } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import type { HttpExchange, Collection, RecordBase, CallerInfo } from '../../platform-core/src/index.ts'
import { createRestGate } from '../../platform-core/src/index.ts'
import { createPluginContext, newId, platformVersionInfo, PlatformEvents } from '../../platform-core/src/index.ts'
import { nonbillableUsage } from '../../plugin-usage/src/index.ts'
import { PermissionCatalog, type UserManageActor } from '../../plugin-iam/src/index.ts'
import { ProviderAuthError } from '../../plugin-iam/src/providers.ts'
import { AppRegistryService } from '../../plugin-app/src/index.ts'
import { seedAll } from './seed.ts'
import { registerMarketRoutes } from './routes/market.ts'
import { registerFinOpsRoutes } from './routes/finops.ts'
import { registerPlatformRoutes } from './routes/platform.ts'
import { registerAuthRoutes } from './routes/auth.ts'
import { registerDashboardRoutes } from './routes/dashboard.ts'
import { registerIamRoutes } from './routes/iam.ts'
import { registerAuthnRoutes } from './routes/authn.ts'
import { registerMcpRoutes } from './routes/mcp.ts'
import { registerSkillRoutes } from './routes/skills.ts'
import { registerNasRoutes } from './routes/nas.ts'
import { registerAgentRoutes } from './routes/agents.ts'
import { registerEntryTicketRoutes } from './routes/entry-tickets.ts'
import { registerAppRoutes } from './routes/apps.ts'

export const name = 'console'
export const inject = [
  'httpServer', 'opsStorage', 'platformBus', 'tools',
  'iam', 'authn', 'oidc', 'entryTickets', 'audit', 'usage', 'market', 'modelGateway',
  'mcpRegistry', 'nasRegistry', 'nasAuthz', 'nasShareLinks', 'skillHub', 'resourceCore', 'agentRegistry', 'appRegistry', 'update',
  'connectorHub',
]

// 公开路径白名单（免鉴权）：导出供 selftest「rbac endpoint matrix」比对——清单变动即红
export const PUBLIC_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/sso',
  '/api/auth/sso/authorize',
  '/api/auth/sso/callback',
  '/api/auth/sso/bind',
  '/api/auth/sso/register',
  '/api/auth/refresh',
  '/api/auth/client-credentials',
  '/api/auth/providers',
  '/api/health',
  '/api/market/developers/register',
  '/api/market/developers/login',
  // 接入码本身即凭证（一次性 + TTL + 按 IP 失败锁定），enroll 端点公开
  '/api/connect/enroll',
  // 平台授权直达：一次性短时票据回平台换取身份（票据本身即临时凭证）
  '/api/authn/entry-tickets/redeem',
  // 应用访客埋点 beacon（浏览器侧 PV/UV 上报）：1x1 GIF/JSON 免鉴权；响应恒定不泄露应用存在性
  '/api/apps/beacon',
  // 票据免登控制台：redeem 通过后直接建立控制台会话（门户/钉钉「打开即工作台」，零二次登录）
  '/api/auth/entry-ticket-session',
  // 部门面板 SSE（review-dsh-agent-panel-v2 F13）：EventSource 无法携带 Bearer 头，
  // 端点公开但内部强制 ?token= 自校验（authn.verify，失败 fail-closed 401），降级轮询端点仍走 guarded
  '/api/panel/stream',
  // 面板自持登录面（交接 F 清单 N 节，2026-09-11）：panel 命名空间登录/刷新转发同一 authn 后端，
  // 全量形态曾被本中间件拦截为 401——宿主已登录用户在面板本页登录被迫「先登出」。
  // 白名单不放行任何数据（鉴权由 authn login/refresh 自身承担，口令错误仍 401）；
  // main 侧 panel 自持登录面路由尚未合入——先行登记（无路由时请求照常 404），合入后即闭环。
  '/api/panel/auth/login',
  '/api/panel/auth/refresh',
  // 首启 bootstrap 提示（M2）：登录页「初始口令待接管」横幅数据源；只回一个布尔（见 routes/platform.ts 泄露评估）
  '/api/platform/bootstrap',
])

/** 动态路径的公开前缀（OIDC 授权页查询：仅回显客户端名/scope，不泄露 redirect_uri）。 */
const PUBLIC_PATH_PREFIXES = ['/api/authn/oidc/auth-requests/']

/** 从请求头推导对外基址（钉钉等真实 IdP 的 redirect_uri 需绝对 URL；反代场景优先 x-forwarded-*）。 */
function requestOrigin(exchange: HttpExchange): string | undefined {
  const header = (name: string): string | undefined => {
    const value = exchange.headers[name]
    if (value === undefined) return undefined
    return String(Array.isArray(value) ? value[0] : value)
  }
  const host = header('x-forwarded-host') ?? header('host')
  if (!host) return undefined
  const proto = header('x-forwarded-proto') ?? 'http'
  return `${proto}://${host}`
}

/** 服务记录对外回显时脱敏认证类请求头（存储保留原文，仅展示层掩码）。 */
function maskServiceHeaders<T extends { headers?: Record<string, string> }>(service: T): T {
  if (!service.headers) return service
  const masked: Record<string, string> = {}
  for (const [key, value] of Object.entries(service.headers)) {
    masked[key] = /authorization|token|secret|key/i.test(key)
      ? (value.length > 8 ? `${value.slice(0, 6)}…` : '****')
      : value
  }
  return { ...service, headers: masked }
}

/** NAS 资产回显时脱敏网关访问令牌（存储保留原文，仅展示层掩码）。 */
export function apply(ctx: Context) {
  const http = ctx.httpServer

  // -- 鉴权中间件 ---------------------------------------------------------
  http.use((exchange) => {
    // 取流自校验通道：?ticket=（一次性/10 分钟票据）与 ?sig=（签名分享链接，exp/sub/jti/sig 四参）——
    // 两者都是「URL 即凭证」，免 Bearer 头；真实性在 GET /fs/file 处理器内逐关验证（fail-closed）
    const nasFileStream = /^\/api\/nas\/[^/]+\/fs\/file$/.test(exchange.path)
    const ticketDownload = nasFileStream && Boolean(exchange.query.get('ticket'))
    const signedLinkDownload = nasFileStream && Boolean(exchange.query.get('sig'))
    if (!exchange.path.startsWith('/api/') || PUBLIC_PATHS.has(exchange.path) || PUBLIC_PATH_PREFIXES.some((prefix) => exchange.path.startsWith(prefix)) || ticketDownload || signedLinkDownload) return
    const header = String(exchange.headers['authorization'] ?? '')
    if (!header.startsWith('Bearer ')) {
      exchange.fail(401, 'UNAUTHORIZED', '缺少 Bearer 令牌，请先登录')
      return true
    }
    try {
      const verified = ctx.authn.verify(header.slice(7))
      exchange.principal = {
        kind: verified.principal.type,
        principalId: verified.principal.id,
        ...(verified.principal.type === 'human' && verified.principal.refId ? { userId: verified.principal.refId } : {}),
        ...(verified.principal.type === 'machine' ? { refType: verified.principal.refType, refId: verified.principal.refId } : {}),
        name: verified.principal.name,
        permissions: verified.scopes,
        actChain: verified.actChain,
      } satisfies CallerInfo
      return
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      exchange.fail(401, 'TOKEN_INVALID', message)
      return true
    }
  })

  // R5 收敛：caller/requirePermission/guarded/body/changeLog 统一引 platform-core 共享实现（单点修复、单点审计）
  const { caller, requirePermission, guarded, body, changeLog } = createRestGate(ctx)

  /**
   * SSO 管理守卫工厂（app/agent 两侧路由共用，授权口径统一在 AppRegistryService.ssoManageDecision）：
   * human = 资源 owner 或持 authn.oidc.write；机器身份绑定本资源（凭证 refType/refId 或登记 owner）
   * 时可自助签发/管理，但本次生效的回调集必须全为环回（localhost / 127.0.0.0/8 / ::1 / 0.0.0.0，
   * APP_SSO_MACHINE_LOOPBACK=0 可整体关闭该例外）；disable 纯降险恒放行。
   * 返回 false 表示已回 403（并发 audit.authz.denied 事件）。
   */
  const ssoManageGuard = (refType: 'app' | 'agent') => {
    const kindName = refType === 'app' ? '应用' : 'Agent'
    const resourceOf = (exchange: HttpExchange): { id: string; name: string; ownerId: string } => {
      const record = ctx.resourceCore.get(refType, exchange.params['id']!) as { id: string; name: string; ownerId: string } | undefined
      if (!record) throw new Error(`${kindName}不存在：${exchange.params['id']}`)
      return { id: record.id, name: record.name, ownerId: record.ownerId }
    }
    const existingClientOf = (id: string): { redirectUris?: string[]; postLogoutUris?: string[] } | undefined =>
      refType === 'app' ? ctx.oidc.clientsForApp(id)[0] : ctx.oidc.clientsForAgent(id)[0]
    return (exchange: HttpExchange, op: 'create' | 'update' | 'rotate' | 'enable' | 'disable', input?: { redirectUris?: string[]; postLogoutUris?: string[] }): boolean => {
      const resource = resourceOf(exchange)
      const info = caller(exchange)
      const existing = existingClientOf(resource.id)
      const decision = AppRegistryService.ssoManageDecision(resource, info, {
        redirectUris: input?.redirectUris ?? existing?.redirectUris ?? [],
        postLogoutUris: input?.postLogoutUris ?? existing?.postLogoutUris ?? [],
      }, op)
      if (decision.allowed) return true
      ctx.platformBus.emit('audit.authz.denied', {
        actorId: info.userId ?? info.principalId,
        actorName: info.name,
        point: `${refType}.sso(owner:${resource.id})`,
        path: exchange.path,
      })
      exchange.fail(403, 'FORBIDDEN', decision.reason)
      return false
    }
  }
  const agentSsoGuard = ssoManageGuard('agent')
  const appSsoGuard = ssoManageGuard('app')

  // -- 拓扑节点名称补全（skill 等非 resource-core 类型） ----------------------
  const enrichTopology = (node: any): any => ({
    ...node,
    name: node.type === 'skill'
      ? ctx.skillHub.skills().get(node.id)?.name ?? node.name
      : node.type === 'mcp_service'
        ? ctx.mcpRegistry.services().get(node.id)?.name ?? node.name
        : node.name,
    status: node.type === 'skill'
      ? ctx.skillHub.skills().get(node.id)?.status ?? node.status
      : node.status,
    children: node.children.map(enrichTopology),
  })


  registerAuthRoutes(ctx, { http, guarded, body, changeLog, caller, requestOrigin })
  registerDashboardRoutes(ctx, { http, guarded, body, changeLog, caller })

  registerIamRoutes(ctx, { http, guarded, body, changeLog, caller })

  registerAuthnRoutes(ctx, { http, guarded, body, changeLog, caller })

  registerMcpRoutes(ctx, { http, guarded, body, changeLog, caller, maskServiceHeaders })

  registerSkillRoutes(ctx, { http, guarded, body, changeLog, caller })
  registerNasRoutes(ctx, { http, guarded, body, changeLog, caller, requirePermission, requestOrigin })
  registerAgentRoutes(ctx, { http, guarded, body, changeLog, caller, requestOrigin, enrichTopology })
  registerEntryTicketRoutes(ctx, { http, guarded, body, changeLog, caller, agentSsoGuard })
  registerAppRoutes(ctx, { http, guarded, body, changeLog, caller, requestOrigin, enrichTopology, appSsoGuard })

  // -- Audit / 审批 / 告警 --------------------------------------------------
  guarded('GET', '/api/audit/logs', 'audit.read', (exchange) => {
    return ctx.audit.query({
      type: (exchange.query.get('type') ?? undefined) as never,
      actorId: exchange.query.get('actorId') ?? undefined,
      resourceType: exchange.query.get('resourceType') ?? undefined,
      resourceId: exchange.query.get('resourceId') ?? undefined,
      result: exchange.query.get('result') ?? undefined,
      q: exchange.query.get('q') ?? undefined,
      since: exchange.query.get('since') ?? undefined,
      limit: Number(exchange.query.get('limit') ?? 100),
    })
  })

  guarded('GET', '/api/audit/summary', 'audit.read', () => ctx.audit.summary())

  guarded('GET', '/api/audit/alert-rules', 'audit.read', () => ({ rules: ctx.audit.alertRules().all() }))

  guarded('POST', '/api/audit/alert-rules', 'audit.rule.write', (exchange) => {
    const input = body<{ name: string; metric: string; threshold: number; windowMinutes?: number; severity?: 'critical' | 'warning' | 'info'; channels?: string[]; enabled?: boolean; description?: string }>(exchange)
    const rule = ctx.audit.createAlertRule({
      name: input.name,
      metric: input.metric,
      operator: 'gt',
      threshold: input.threshold,
      windowMinutes: input.windowMinutes ?? 10,
      severity: input.severity ?? 'warning',
      channels: input.channels ?? ['dingtalk'],
      enabled: input.enabled ?? true,
      ...(input.description !== undefined ? { description: input.description } : {}),
    })
    changeLog(exchange, 'audit.rule.create', 'alert_rule', rule.id, rule.name)
    return rule
  })

  guarded('PATCH', '/api/audit/alert-rules/:id', 'audit.rule.write', (exchange) => {
    const input = body<{ enabled?: boolean; threshold?: number; severity?: string; channels?: string[] }>(exchange)
    const rule = ctx.audit.alertRules().update(exchange.params['id']!, input as never)
    changeLog(exchange, 'audit.rule.update', 'alert_rule', rule.id, rule.name)
    return rule
  })

  guarded('GET', '/api/audit/alerts', 'audit.read', (exchange) => ({
    alerts: ctx.audit.alerts().find((item) => (exchange.query.get('unread') === '1' ? !item.read : true))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  }))

  guarded('POST', '/api/audit/alerts/:id/read', 'audit.read', (exchange) => {
    ctx.audit.markAlertRead(exchange.params['id']!)
    return { read: true }
  })

  guarded('POST', '/api/audit/alerts/read-all', 'audit.read', (exchange) => {
    const read = ctx.audit.markAllAlertsRead()
    changeLog(exchange, 'audit.alert.readAll', 'alert', 'all', '', `一键全部已读（${read} 条）`)
    return { read, unread: 0 }
  })

  guarded('GET', '/api/audit/cost', 'audit.read', (exchange) => {
    // QA B-04：days 参数此前被静默丢弃（「近 14 天」实为全量聚合）——未显式给 from 时按 days 折算窗口起点
    const from = exchange.query.get('from') ?? undefined
    const to = exchange.query.get('to') ?? undefined
    const daysParam = Number(exchange.query.get('days') ?? 0)
    const days = Number.isInteger(daysParam) && daysParam > 0 ? Math.min(daysParam, 365) : 0
    const effectiveFrom = from ?? (days > 0
      ? new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10)
      : undefined)
    return {
      groupBy: exchange.query.get('groupBy') ?? 'app',
      ...(days > 0 && !from ? { days } : {}),
      rows: ctx.audit.costReport((exchange.query.get('groupBy') ?? 'app') as 'app' | 'agent' | 'org' | 'date', effectiveFrom, to),
    }
  })

  // -- 证据锚点与场景时间线（IAW 交接 5-1/5-2） ---------------------------------
  // 面板消费面：结论级证据登记/反查 + 场景维度审计时间线（panel.read/write；治理面全量审计仍走 audit.read）。
  guarded('POST', '/api/audit/evidence', 'panel.write', (exchange) => {
    const input = body<{ anchors: Array<{ kind: string; id: string; name?: string; timeWindow?: { from: string; to: string }; hitRows?: number; qualityScore?: number }>; sceneCode?: string; messageId?: string; sessionId?: string; subject?: string; note?: string }>(exchange)
    const record = ctx.audit.recordEvidence({
      anchors: input.anchors ?? [],
      ...(input.sceneCode ? { sceneCode: input.sceneCode } : {}),
      ...(input.messageId ? { messageId: input.messageId } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.subject ? { subject: input.subject } : {}),
      ...(input.note ? { note: input.note } : {}),
    })
    changeLog(exchange, 'audit.evidence.record', 'evidence', record.id, input.anchors?.map((anchor) => anchor.id).join(',') ?? '', `${input.anchors?.length ?? 0} 个锚点${input.messageId ? `，绑定消息 ${input.messageId}` : ''}`)
    return record
  })

  guarded('GET', '/api/audit/evidence/:id', 'panel.read', (exchange) => {
    const record = ctx.audit.getEvidence(exchange.params['id']!)
    if (!record) {
      exchange.fail(404, 'NOT_FOUND', `证据登记不存在：${exchange.params['id']}`)
      return
    }
    return record
  })

  guarded('GET', '/api/audit/timeline', 'panel.read', (exchange) => {
    return ctx.audit.timeline({
      ...(exchange.query.get('sceneCode') ? { sceneCode: exchange.query.get('sceneCode')! } : {}),
      ...(exchange.query.get('since') ? { since: exchange.query.get('since')! } : {}),
      ...(exchange.query.get('limit') ? { limit: Number(exchange.query.get('limit')) } : {}),
    })
  })

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

  // -- 第三方插件市场（v1.2）：已迁移 routes/market.ts（OPT-P1-01 首段） ------
  registerMarketRoutes(ctx, { http, guarded, body, changeLog, caller })

  // -- FinOps CFO 视图（M2）：routes/finops.ts（新模式：新路由不再进 apply()） ------
  registerFinOpsRoutes(ctx, { guarded })

  // -- 平台级路由（M2 筑基）：routes/platform.ts（首启 bootstrap 状态） ------
  registerPlatformRoutes(ctx, { http })

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

  // -- 平台信息与工具桥 -----------------------------------------------------
  /** 路由×权限矩阵（WP-04/A1 + 交接清单 H5）：RBAC 断言网的服务端事实源。
   *  guarded=register 声明自动汇入的权限点保护端点；public=免鉴权白名单（selfValidated=处理器自带凭证
   *  校验，断言网对其实施匿名探针必须被拒）；authenticated=仅中间件 Bearer、无独立权限点；
   *  /api/* 缺声明在 register 期即抛错，undeclaredApi 恒空——自注册端点不再可能逃出断言网。 */
  guarded('GET', '/api/platform/route-matrix', 'audit.read', () => {
    const apiDeclared = http.declaredRoutes.filter((route) => route.path === '/api' || route.path.startsWith('/api/'))
    const publicEntries = apiDeclared.flatMap((route) => route.auth.access === 'public'
      ? [{ method: route.method, path: route.path, selfValidated: route.auth.selfValidated === true }]
      : [])
    const authenticated = apiDeclared.flatMap((route) => route.auth.access === 'authenticated' ? [{ method: route.method, path: route.path }] : [])
    return {
      guarded: http.routeMatrix.map((route) => ({ ...route })),
      public: publicEntries.map((route) => route.path),
      publicEntries,
      authenticated,
      counts: {
        declaredApi: apiDeclared.length,
        guarded: http.routeMatrix.length,
        public: publicEntries.length,
        authenticated: authenticated.length,
        undeclaredApi: apiDeclared.filter((route) => route.auth.access === 'outside-api').length,
      },
      note: 'guarded=权限点保护端点；public=免鉴权（selfValidated=自带凭证校验）；authenticated=仅 Bearer；变动须经评审',
    }
  })

  guarded('GET', '/api/platform/info', 'console.login', () => {
    const versionInfo = platformVersionInfo()
    const plugins = [
      'platform-core', 'resource-core', 'iam', 'authn', 'usage', 'audit', 'market', 'modelgw', 'mcp', 'nas', 'skillhub', 'agent', 'app', 'connect', 'update', 'console', 'panel-core', 'dingtalk-bridge',
    ]
    return {
      name: '榕器|企业AI资源管理平台',
      version: versionInfo.version,
      installMode: versionInfo.installMode,
      runtime: 'standalone-cordis（dsh 插件兼容）',
      plugins,
      collections: ctx.opsStorage.names(),
      tools: ctx.tools.schemas(),
      resourceTypes: ctx.resourceCore.typesSpecs().map((spec) => ({ type: spec.type, label: spec.label, plugin: spec.plugin })),
      events: ctx.platformBus.recent(10),
    }
  })


  /**
   * 工具身份注入：服务端以令牌解析的调用者身份为准，禁止调用方自填身份参数。
   * connector_execute / mcp_invoke 的调用方身份已改为经 exec.principal 传递（schema 无 caller* 参数），
   * 不再走 args 注入；其余工具的 approver/requester/actor 仍由此处覆盖。
   */
  const injectToolIdentity = (name: string, inputArgs: Record<string, unknown>, info: CallerInfo): Record<string, unknown> => {
    const args = { ...inputArgs }
    const principalId = info.userId ?? info.principalId
    if (name === 'approval_decide' || name === 'skill_approve') {
      args.approverId = principalId
      args.approverName = info.name
    } else if (name === 'agent_offline' || name === 'mcp_offline' || name === 'iam_sync_run') {
      args.requesterId = principalId
      args.requesterName = info.name
      args.actor = info.name
    } else if (name === 'agent_bind_user' || name === 'skill_install' || name === 'skill_publish') {
      args.actor = info.name
    }
    // nas_fs_* 工具身份已改为经 exec.principal 传递（P0-2：身份不进工具参数，schema 无 actor* 参数）
    return args
  }

  guarded('GET', '/api/tools/schemas', 'console.login', () => ({
    tools: ctx.tools.schemas().map((tool) => ({ name: tool.name, description: tool.description, permission: tool.permission, parameters: tool.parameters })),
  }))

  guarded('POST', '/api/tools/execute', 'console.login', async (exchange) => {
    const input = body<{ name: string; args?: Record<string, unknown> }>(exchange)
    if (!input.name) throw new Error('工具名必填')
    const info = caller(exchange)
    // 工具级权限校验：以工具声明的最小权限点为准，缺省仅要求登录
    const definition = ctx.tools.schemas().find((tool) => tool.name === input.name)
    const required = definition?.permission
    if (required && !info.permissions.includes('*') && !info.permissions.includes(required)) {
      ctx.platformBus.emit('audit.authz.denied', {
        actorId: info.userId ?? info.principalId,
        actorName: info.name,
        point: required,
        path: exchange.path,
      })
      exchange.fail(403, 'FORBIDDEN', `缺少权限点 ${required}，请联系管理员调整角色`, { permission: required })
      return
    }
    const args = injectToolIdentity(input.name, input.args ?? {}, info)
    const result = await ctx.tools.execute({ name: input.name, arguments: args, principal: info })
    return result
  })

  // -- MCP Server 端点：平台即 MCP 服务（与 REST/CLI/dsh 插件同一套工具与权限体系） ------
  //
  // Streamable HTTP（JSON-RPC 2.0 over POST /mcp）：initialize（回 mcp-session-id，无状态
  // 服务端会话仅为客户端兼容）/ notifications/*（202）/ tools/list / tools/call / ping。
  // 每请求 Bearer 鉴权（人/机器令牌皆可），工具级权限点 + 身份注入与 REST 工具桥完全一致。
  // 不提供 GET SSE 长流（纯 JSON 响应形态合规）；外部 MCP 客户端接入示例：
  //   {"mcpServers":{"dsh-ops-platform":{"url":"http://<平台>:7300/mcp","headers":{"Authorization":"Bearer <平台令牌>"}}}}
  const mcpCallerFromToken = (exchange: HttpExchange): CallerInfo | undefined => {
    const header = String(exchange.headers['authorization'] ?? '')
    if (!header.startsWith('Bearer ')) {
      exchange.res.writeHead(401, {
        'content-type': 'application/json',
        'www-authenticate': 'Bearer realm="dsh-ops-mcp"',
      })
      exchange.res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32001, message: '缺少 Bearer 令牌：/mcp 与 REST 共用同一套平台令牌' } }))
      return undefined
    }
    try {
      const verified = ctx.authn.verify(header.slice(7))
      return {
        kind: verified.principal.type,
        principalId: verified.principal.id,
        ...(verified.principal.type === 'human' && verified.principal.refId ? { userId: verified.principal.refId } : {}),
        name: verified.principal.name,
        permissions: verified.scopes,
        actChain: verified.actChain,
      } satisfies CallerInfo
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      exchange.res.writeHead(401, { 'content-type': 'application/json' })
      exchange.res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32001, message: `令牌无效：${message}` } }))
      return undefined
    }
  }

  const mcpReply = (exchange: HttpExchange, payload: Record<string, unknown>, extraHeaders: Record<string, string> = {}): void => {
    exchange.res.writeHead(200, { 'content-type': 'application/json', ...extraHeaders })
    exchange.res.end(JSON.stringify(payload))
  }

  http.register('POST', '/mcp', async (exchange) => {
    const info = mcpCallerFromToken(exchange)
    if (!info) return
    const message = exchange.body
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      exchange.res.writeHead(400, { 'content-type': 'application/json' })
      exchange.res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: '请求体必须是单个 JSON-RPC 2.0 消息（暂不支持批量）' } }))
      return
    }
    const id = (message as Record<string, unknown>).id
    // 通知类消息（无 id）：确认即止
    if (id === undefined || id === null) {
      exchange.res.writeHead(202)
      exchange.res.end()
      return
    }
    const method = String((message as Record<string, unknown>).method ?? '')
    const params = ((message as Record<string, unknown>).params ?? {}) as Record<string, unknown>
    const reply = (result: unknown, extraHeaders?: Record<string, string>) => mcpReply(exchange, { jsonrpc: '2.0', id, result }, extraHeaders)
    const replyError = (code: number, text: string) => mcpReply(exchange, { jsonrpc: '2.0', id, error: { code, message: text } })
    switch (method) {
      case 'initialize':
        return reply(
          {
            protocolVersion: '2025-03-26',
            capabilities: { tools: {} },
            serverInfo: { name: 'dsh-ops-platform', title: '榕器|企业AI资源管理平台 · MCP 网关', version: platformVersionInfo().version },
            instructions: '榕器|企业AI资源管理平台（IAM/MCP/Skill/Agent/应用/NAS/用量计量/审计）。工具权限与控制台账号一致：先用 nas_list / mcp_service_list / skill_search 等盘点资产，再按需调用写类工具。',
          },
          { 'mcp-session-id': `dshmcp-${Date.now().toString(36)}` },
        )
      case 'ping':
        return reply({})
      case 'tools/list':
        return reply({
          tools: ctx.tools.schemas().map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.parameters,
            ...(tool.permission !== undefined ? { annotations: { 'x-permission': tool.permission } } : {}),
          })),
        })
      case 'tools/call': {
        const name = String(params.name ?? '')
        const args = (params.arguments && typeof params.arguments === 'object' ? params.arguments : {}) as Record<string, unknown>
        const definition = ctx.tools.schemas().find((tool) => tool.name === name)
        if (!definition) {
          return reply({ content: [{ type: 'text', text: `未知工具：${name}` }], isError: true })
        }
        if (definition.permission && !info.permissions.includes('*') && !info.permissions.includes(definition.permission)) {
          ctx.platformBus.emit('audit.authz.denied', {
            actorId: info.userId ?? info.principalId,
            actorName: info.name,
            point: definition.permission,
            path: '/mcp',
          })
          return reply({ content: [{ type: 'text', text: `缺少权限点 ${definition.permission}（调用方 ${info.name}），调用被拒绝` }], isError: true })
        }
        const result = await ctx.tools.execute({ name, arguments: injectToolIdentity(name, args, info), principal: info })
        return reply({
          content: result.content.length > 0 ? result.content : [{ type: 'text', text: JSON.stringify(result.value ?? null) }],
          isError: result.isError,
        })
      }
      default:
        return replyError(-32601, `方法不存在：${method}`)
    }
  })

  // Streamable HTTP：本端点为无会话纯 JSON 形态，GET（SSE 长流）不支持，DELETE（会话终止）恒成功
  http.register('GET', '/mcp', (exchange) => {
    exchange.res.writeHead(405, { 'content-type': 'application/json', allow: 'POST' })
    exchange.res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message: '本 MCP 端点为无会话纯 JSON 形态，不支持 GET SSE 长流' } }))
  })
  http.register('DELETE', '/mcp', (exchange) => {
    exchange.ok({})
  })

  // -- 静态 SPA -----------------------------------------------------------
  const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
  if (existsSync(publicDir)) {
    http.serveStatic('/', publicDir, '/index.html')
  }

  // -- /docs 静态发布：仓库/安装包内 docs 目录（应用接入指南等文档随服务可直接访问） ----
  // 源码检出与 dsh plugin add 两种形态下本文件均位于 <root>/packages/plugin-console/src/，
  // docs 目录恒为 <root>/docs。公开无鉴权（与控制台 SPA 同级；内容均为已公开的仓库文档）。
  const docsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs')
  if (existsSync(docsDir)) {
    http.serveStatic('/docs', docsDir)
    http.register('GET', '/docs', (exchange) => {
      const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] ?? ch)
      const files = readdirSync(docsDir).filter((name) => name.endsWith('.md')).sort()
      const items = files.map((name) => {
      const hint = name === 'app-sso-integration.md' ? '（应用统一身份接入指南）'
        : name === 'app-org-sync.md' ? '（应用组织架构同步指南）'
        : name === 'app-rbac-guide.md' ? '（应用内权限（RBAC）构造指南）' : ''
        return `<li><a href="/docs/${encodeURIComponent(name)}">${escapeHtml(name)}</a>${hint}</li>`
      }).join('')
      exchange.res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      exchange.res.end(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>榕器 · 平台文档</title><style>body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:640px;margin:48px auto;padding:0 16px;color:#1f2328}h1{font-size:20px}li{margin:8px 0;font-size:14px}a{color:#2563eb}</style></head><body><h1>榕器 · 平台文档</h1><p>以下文档随本服务发布，可直接打开阅读：</p><ul>${items}</ul></body></html>`)
    })
  }

  // -- 种子数据 -----------------------------------------------------------
  void seedAll(ctx)
}




/** 事件摘要用字段标签（按信息量排序，命中即拼入人话摘要；未列出的内部字段不外显）。 */
const EVENT_FIELD_LABELS: Array<[string, string]> = [
  ['title', '标题'], ['name', '名称'], ['displayName', '姓名'], ['reason', '原因'], ['message', '信息'],
  ['error', '错误'], ['actorName', '操作人'], ['username', '用户名'], ['userId', '账号'], ['version', '版本'],
  ['service', '服务'], ['actionId', '动作'], ['provider', '平台'], ['alias', '连接'], ['baseUrl', '网关地址'],
  ['status', '状态'], ['result', '结果'], ['kind', '类型'],
]
/** 摘要中常见英文枚举值的中文转译（测试 UI-03：事件流不留裸英文码）。 */
const EVENT_VALUE_LABELS: Record<string, string> = {
  created: '创建', updated: '更新', deleted: '删除', approved: '通过', rejected: '驳回',
  healthy: '健康', unavailable: '不可用', ok: '成功', failed: '失败', catalog: '目录',
}

/** 事件流人话摘要（测试 UI-03）：优先取业务字段拼「标签：值」句，绝不回退裸 JSON——原始 payload 走 detail 字段收进「详情」。 */
function summarize(payload: unknown): string {
  if (payload === null || payload === undefined) return ''
  if (typeof payload !== 'object') return String(payload).slice(0, 120)
  const record = payload as Record<string, unknown>
  const bits: string[] = []
  for (const [key, label] of EVENT_FIELD_LABELS) {
    const value = record[key]
    if (value === undefined || value === null || value === '') continue
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') continue
    const text = String(value)
    bits.push(`${label}：${EVENT_VALUE_LABELS[text] ?? text.slice(0, 80)}`)
    if (bits.length >= 3) break
  }
  return bits.join('；')
}

/** 原始 payload 压缩串（仅用于「详情」折叠展示，防止误读也保留排查线索）。 */
function summarizeDetail(payload: unknown): string | undefined {
  if (payload === null || payload === undefined || typeof payload !== 'object') return undefined
  const json = JSON.stringify(payload)
  if (!json || json === '{}') return undefined
  return json.slice(0, 400)
}

