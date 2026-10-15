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
import { existsSync, readdirSync, createReadStream, readFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import type { HttpExchange, Collection, RecordBase, CallerInfo } from '../../platform-core/src/index.ts'
import { createRestGate } from '../../platform-core/src/index.ts'
import { createPluginContext, newId, platformVersionInfo, PlatformEvents } from '../../platform-core/src/index.ts'
import { PermissionCatalog, type UserManageActor } from '../../plugin-iam/src/index.ts'
import { ProviderAuthError } from '../../plugin-iam/src/providers.ts'
import { normalizeLocale, readCatalogDir, DEFAULT_LOCALE, t } from '../../platform-i18n/src/index.ts'
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
import { registerAuditRoutes } from './routes/audit.ts'
import { registerOpsRoutes } from './routes/ops.ts'
import { registerUsageRoutes } from './routes/usage.ts'
import { registerFleetRoutes } from './routes/fleet.ts'
import { registerBridgeRoutes } from './routes/bridge.ts'

export const name = 'console'
export const inject = [
  'httpServer', 'opsStorage', 'platformBus', 'tools',
  'iam', 'authn', 'oidc', 'entryTickets', 'audit', 'usage', 'market', 'modelGateway',
  'mcpRegistry', 'nasRegistry', 'nasAuthz', 'nasShareLinks', 'skillHub', 'resourceCore', 'agentRegistry', 'appRegistry', 'update',
  'connectorHub',
  // 数字员工窄端口登记器（platform-core 首位装配即提供；实现由 plugin-workforce 后补登记，port() 缺席=legacy）
  'workforcePolicy',
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

/** 动态路径的公开前缀（OIDC 授权页查询：仅回显客户端名/scope，不泄露 redirect_uri）。
 *  执行中枢 webhook 触发器：路径即凭证（未登记/停用路径一律 404，fail-closed，见 plugin-exec-hub）。 */
const PUBLIC_PATH_PREFIXES = ['/api/authn/oidc/auth-requests/', '/api/exec/webhook/']

/** /docs 公开白名单（默认拒绝，导出供 selftest 比对——清单变动即红）：
 *  仅收录面向外部读者的接入指引与对外口径设计文档（「本文档随服务发布，可直接访问」系列）。
 *  目录内其余文档（部署 runbook、qa-report/handoff/dev-plan/contract/重构基线等内部协作面）
 *  一律 404，改走仓库私有分发；扩编须经评审改此清单，宁紧勿松。 */
export const PUBLIC_DOCS = new Set([
  'app-onboarding.md',
  'agent-onboarding.md',
  'app-sso-integration.md',
  'app-org-sync.md',
  'app-rbac-guide.md',
  'ecosystem-design-v1.2.md',
])

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
      exchange.fail(401, 'UNAUTHORIZED', t('缺少 Bearer 令牌，请先登录'))
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
    const resourceOf = (exchange: HttpExchange): { id: string; name: string; ownerId: string } => {
      const record = ctx.resourceCore.get(refType, exchange.params['id']!) as { id: string; name: string; ownerId: string } | undefined
      if (!record) throw new Error(refType === 'app' ? t('应用不存在：{id}', { id: exchange.params['id'] }) : t('Agent 不存在：{id}', { id: exchange.params['id'] }))
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
  registerAuditRoutes(ctx, { http, guarded, body, changeLog, caller })
  registerOpsRoutes(ctx, { http, guarded, body, changeLog, caller })
  registerUsageRoutes(ctx, { http, guarded, body, changeLog, caller })

  // -- Fleet 六类资产统一台账（设计适配规格 5.2，2026-10-14） --------------------
  registerFleetRoutes(ctx, { http, guarded, body, changeLog, caller })
  registerBridgeRoutes(ctx, { http, guarded, body, changeLog, caller })

  // -- 第三方插件市场（v1.2）：已迁移 routes/market.ts（OPT-P1-01 首段） ------
  registerMarketRoutes(ctx, { http, guarded, body, changeLog, caller })

  // -- FinOps CFO 视图（M2）：routes/finops.ts（新模式：新路由不再进 apply()） ------
  registerFinOpsRoutes(ctx, { guarded })

  // -- 平台级路由（M2 筑基）：routes/platform.ts（首启 bootstrap 状态） ------
  registerPlatformRoutes(ctx, { http })

  // -- 静态 SPA -----------------------------------------------------------
  const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
  if (existsSync(publicDir)) {
    http.serveStatic('/', publicDir, '/index.html')
  }

  // -- UI 全球化（2026-10-16）：/locales/:locale 词典合并端点 -----------------
  // 三层词典一次取齐（前端 i18n.js 单请求加载）：服务端文案（platform-i18n/locales，
  // 覆盖 API 错误消息/通知/审批文案——SPA 展示服务端错误时同样走前端词典翻译）
  // + 控制台 SPA 词典（public/locales/<locale>/*.json）+ 面板 SPA 词典
  // （plugin-panel-core/public/locales/<locale>/*.json）。多文件按文件名序浅合并，
  // 多团队并行维护互不覆盖；企业定制走 I18N_EXTRA_DIR（platform-i18n 内核已并）。
  // 非 /api 路径：鉴权中间件天然放行（词典为静态文案，不含任何业务数据）。
  const packagesRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
  http.register('GET', '/locales/:locale', (exchange) => {
    const locale = normalizeLocale(exchange.params['locale']) ?? DEFAULT_LOCALE
    const merged: Record<string, string> = {
      ...readCatalogDir(join(packagesRoot, 'platform-i18n', 'locales', locale)),
      ...readCatalogDir(join(packagesRoot, 'plugin-console', 'public', 'locales', locale)),
      ...readCatalogDir(join(packagesRoot, 'plugin-panel-core', 'public', 'locales', locale)),
    }
    exchange.res.setHeader('cache-control', 'no-cache')
    exchange.ok({ locale, count: Object.keys(merged).length, catalog: merged })
  })

  // -- /docs 文档发布（默认拒绝白名单，见 PUBLIC_DOCS）：仅白名单内文档随服务可直接访问 ----
  // 源码检出与 dsh plugin add 两种形态下本文件均位于 <root>/packages/plugin-console/src/，
  // docs 目录恒为 <root>/docs。本路由面为纯匿名静态服务（鉴权中间件只覆盖 /api/*），
  // 不存在按登录身份放行的上下文——白名单外一律 404（不用 403，避免存在性探测），
  // 内部文档改走仓库私有分发。白名单收在代码常量而非 docs/ 旁 manifest：manifest 本身就在
  // 伺服目录内，可读即反向泄露内部文档清单；常量则随代码评审走查、diff 可审计。
  const docsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs')
  if (existsSync(docsDir)) {
    // 拦截全部 /docs/* 子路径（先于路由与静态分发）：仅放行白名单内的单文件名。
    // 白名单键即文件名字面量（不含路径分隔符），故 %2F/.. 等任何越界或畸形编码形态
    // 都落不进集合，天然无穿越面（强度不低于原按段解码+拒绝越界段的目录伺服实现）。
    http.use((exchange) => {
      if (!exchange.path.startsWith('/docs/')) return
      let name = ''
      try {
        name = decodeURIComponent(exchange.path.slice('/docs/'.length))
      } catch { /* 畸形编码按白名单外处理 */ }
      if (!PUBLIC_DOCS.has(name)) {
        exchange.fail(404, 'NOT_FOUND', t('文档不存在'))
        return true
      }
      exchange.file(join(docsDir, name))
      return true
    })
    http.register('GET', '/docs', (exchange) => {
      const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] ?? ch)
      const files = readdirSync(docsDir).filter((name) => PUBLIC_DOCS.has(name)).sort()
      const items = files.map((name) => {
        const hint = name === 'app-onboarding.md' ? t('（AI 应用接入总览）')
          : name === 'agent-onboarding.md' ? t('（Agent 接入指引）')
          : name === 'app-sso-integration.md' ? t('（应用统一身份接入指南）')
          : name === 'app-org-sync.md' ? t('（应用组织架构同步指南）')
          : name === 'app-rbac-guide.md' ? t('（应用内权限（RBAC）构造指南）')
          : name === 'ecosystem-design-v1.2.md' ? t('（平台生态设计 v1.2）') : ''
        return `<li><a href="/docs/${encodeURIComponent(name)}">${escapeHtml(name)}</a>${hint}</li>`
      }).join('')
      exchange.res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      exchange.res.end(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${t('元冰可 · 平台文档')}</title><style>body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:640px;margin:48px auto;padding:0 16px;color:#1f2328}h1{font-size:20px}li{margin:8px 0;font-size:14px}a{color:#2563eb}</style></head><body><h1>${t('元冰可 · 平台文档')}</h1><p>${t('以下对外文档随本服务发布，可直接打开阅读：')}</p><ul>${items}</ul></body></html>`)
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

/** 事件流人话摘要（测试 UI-03）：优先取业务字段拼「标签：值」句，绝不回退裸 JSON——原始 payload 走 detail 字段收进「详情」。
 *  标签/枚举值常量为中文数据（t() 的键），展示边界在拼接处按请求语言即时翻译。 */
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
    bits.push(t('{label}：{value}', { label: t(label), value: EVENT_VALUE_LABELS[text] !== undefined ? t(EVENT_VALUE_LABELS[text]) : text.slice(0, 80) }))
    if (bits.length >= 3) break
  }
  return bits.join(t('；'))
}

/** 原始 payload 压缩串（仅用于「详情」折叠展示，防止误读也保留排查线索）。 */
function summarizeDetail(payload: unknown): string | undefined {
  if (payload === null || payload === undefined || typeof payload !== 'object') return undefined
  const json = JSON.stringify(payload)
  if (!json || json === '{}') return undefined
  return json.slice(0, 400)
}

