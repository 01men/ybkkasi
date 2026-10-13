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
import { registerAuditRoutes } from './routes/audit.ts'
import { registerOpsRoutes } from './routes/ops.ts'
import { registerUsageRoutes } from './routes/usage.ts'

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
  registerAuditRoutes(ctx, { http, guarded, body, changeLog, caller })
  registerOpsRoutes(ctx, { http, guarded, body, changeLog, caller })
  registerUsageRoutes(ctx, { http, guarded, body, changeLog, caller })

  // -- 第三方插件市场（v1.2）：已迁移 routes/market.ts（OPT-P1-01 首段） ------
  registerMarketRoutes(ctx, { http, guarded, body, changeLog, caller })

  // -- FinOps CFO 视图（M2）：routes/finops.ts（新模式：新路由不再进 apply()） ------
  registerFinOpsRoutes(ctx, { guarded })

  // -- 平台级路由（M2 筑基）：routes/platform.ts（首启 bootstrap 状态） ------
  registerPlatformRoutes(ctx, { http })

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

