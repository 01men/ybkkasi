/**
 * App 域路由：AI 应用台账（机器身份读审计/凭证据点/拓扑/影响面/审计时间线/SSO 打通 owner 自助签发与机器环回自助）（R4 巨石拆分，REFACTOR-2026-10-13，2026-10-13）：
 * 自 plugin-console/index.ts 拆出，处理器逐字搬运（行为与迁出前一致）。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { HttpExchange } from '../../../platform-core/src/index.ts'
import { t } from '../../../platform-i18n/src/index.ts'
import { CapabilityOwnerConflictError, type AppCapabilityLink } from '../../../plugin-app/src/index.ts'
import type { ConsoleRouteDeps } from './deps.ts'
import { scopedOrgFilterOf } from './iam.ts'

export interface AppRouteDeps extends ConsoleRouteDeps {
  requestOrigin: (exchange: HttpExchange) => string | undefined
  enrichTopology: (node: any) => any
  appSsoGuard: (exchange: HttpExchange, op: 'create' | 'update' | 'rotate' | 'enable' | 'disable', input?: { redirectUris?: string[]; postLogoutUris?: string[] }) => boolean
}

export function registerAppRoutes(ctx: Context, deps: AppRouteDeps): void {
  const { http, guarded, body, changeLog, caller, requestOrigin, enrichTopology, appSsoGuard } = deps
  // -- App ----------------------------------------------------------------
  // R11 多公司收口：非 `*` 管理员按本组织子树过滤应用台账（与 /api/agents 同口径）
  guarded('GET', '/api/apps', 'app.read', (exchange) => {
    const orgFilter = scopedOrgFilterOf(ctx, caller, exchange)
    return {
      apps: ctx.resourceCore.list('app')
        .filter((app) => (orgFilter ? orgFilter(app.orgId) : true))
        .map((app) => ({
          ...app,
          metrics: ctx.appRegistry.metrics(app.id),
          availableTransitions: ctx.resourceCore.availableTransitions('app', app.id),
        })),
      schema: ctx.resourceCore.typeSpec('app')?.schema,
      lifecycle: ctx.resourceCore.typeSpec('app')?.lifecycle,
    }
  })

  // 开发者选择器数据源（注册表单下拉/搜索用）：挂在 app.write 下——能注册应用即可枚举
  // 在编用户的瘦字段（id/姓名/账号/部门/钉钉 unionId 绑定），不经 iam.user.read；须注册在 /api/apps/:id 之前（路由先匹配先中）
  guarded('GET', '/api/apps/developer-options', 'app.write', () => ({
    options: ctx.iam.users().find((user) => user.status === 'active')
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh-Hans-CN'))
      .map((user) => ({
        id: user.id,
        name: user.displayName,
        username: user.username,
        orgName: ctx.iam.orgs().get(user.orgId)?.name ?? '',
        // 钉钉身份绑定 unionId：供外部推送方把表格人员字段的 unionId 解析成平台账号（开发者字段落 developerId + 真实姓名）
        unionIds: (user.bindings ?? []).filter((b) => b.provider === 'dingtalk').map((b) => b.unionId),
      })),
  }))

  /** 开发者字段解析（attrs 原地修改）：developerId 须为在编平台用户，developerName 以 IAM displayName 为准；
   *  空串语义：POST 时不落字段，PATCH（allowClear）时显式清除开发者。 */
  const resolveDeveloperAttrs = (attrs: Record<string, unknown>, { allowClear = false } = {}): void => {
    const raw = attrs['developerId']
    const id = typeof raw === 'string' ? raw.trim() : ''
    if (id) {
      const user = ctx.iam.users().get(id)
      if (!user) throw new Error(t('开发者不存在：{id}（developerId 须为平台用户 ID）', { id }))
      if (user.status !== 'active') throw new Error(t('开发者「{name}」非在编状态，不能登记为应用开发者', { name: user.displayName }))
      attrs['developerId'] = user.id
      attrs['developerName'] = user.displayName
      return
    }
    if (raw === undefined) return
    if (allowClear) {
      attrs['developerId'] = ''
      attrs['developerName'] = ''
    } else {
      delete attrs['developerId']
    }
  }

  guarded('GET', '/api/apps/:id', 'app.read', (exchange) => {
    const id = exchange.params['id']!
    const app = ctx.resourceCore.get('app', id)
    if (!app) throw new Error(t('应用不存在：{id}', { id }))
    // SSO 配置块（不含 secret；供详情页「SSO 配置」tab 与门禁提示使用）
    const ssoClients = ctx.oidc.clientsForApp(id)
    const ssoClient = ssoClients[0]
    const { clientSecretHash, ...ssoSafe } = ssoClient ?? {}
    void clientSecretHash
    return {
      ...app,
      metrics: ctx.appRegistry.metrics(id),
      topology: enrichTopology(ctx.appRegistry.topology(id)),
      cost: ctx.appRegistry.costBreakdown(id),
      impact: ctx.resourceCore.impact('app', id),
      availableTransitions: ctx.resourceCore.availableTransitions('app', id),
      audit: ctx.audit.query({ resourceType: 'app', resourceId: id, limit: 30 }).items,
      sso: ssoClient
        ? {
          ...ssoSafe,
          status: ssoSafe.status ?? 'active',
          clientType: ssoSafe.clientType ?? 'confidential',
          refAppName: ctx.resourceCore.get('app', ssoSafe.refId ?? '')?.name ?? undefined,
          discovery: {
            issuer: ctx.oidc.issuer(),
            authorization_endpoint: `${ctx.oidc.issuer()}/oauth/authorize`,
            token_endpoint: `${ctx.oidc.issuer()}/oauth/token`,
            userinfo_endpoint: `${ctx.oidc.issuer()}/oauth/userinfo`,
          },
        }
        : null,
      ssoEnforceTypes: ((): string[] => {
        // 门禁形态提示（与 plugin-app 同源逻辑；动态 import 避免循环依赖）
        return String(process.env.APP_SSO_ENFORCE ?? 'web,h5').split(',').map((item) => item.trim()).filter(Boolean)
      })(),
    }
  })

  guarded('POST', '/api/apps', 'app.write', (exchange) => {
    const input = body<{ name: string; slug?: string; attrs?: Record<string, unknown>; agentIds?: string[] }>(exchange)
    const info = caller(exchange)
    const user = info.userId ? ctx.iam.users().get(info.userId) : undefined
    const attrs = { ...(input.attrs ?? {}) }
    resolveDeveloperAttrs(attrs)
    const result = ctx.appRegistry.register({
      ...input,
      attrs,
      ownerId: info.userId ?? info.principalId,
      ownerName: info.name,
      orgId: user?.orgId ?? ctx.iam.orgs().all()[0]?.id ?? 'org_unknown',
    })
    return { app: result.app, credential: result.credential ?? null }
  })

  /**
   * 应用写操作归属守卫（QA A-04）：PATCH/删除/指标上报/状态流转此前仅校验 app.write，
   * 任意 developer 可改写他人应用。平台管理员（'*'）、应用 owner、绑定本应用的机器主体
   * （refType=app 自助上报通道）之外一律 403 并落 audit.authz.denied。
   */
  const assertAppOwner = (exchange: HttpExchange, appId: string): boolean => {
    const info = caller(exchange)
    if (info.permissions.includes('*')) return true
    const app = ctx.resourceCore.get('app', appId)
    if (!app) throw new Error(t('应用不存在：{id}', { id: appId }))
    const isOwner = info.kind === 'human' && info.userId !== undefined && app.ownerId === info.userId
    const isBoundMachine = info.kind === 'machine' && info.refType === 'app' && info.refId === appId
    if (isOwner || isBoundMachine) return true
    ctx.platformBus.emit('audit.authz.denied', {
      actorId: info.userId ?? info.principalId,
      actorName: info.name,
      point: `app.write(owner:${appId})`,
      path: exchange.path,
    })
    exchange.fail(403, 'FORBIDDEN', t('仅平台管理员与应用负责人可变更「{name}」（owner 校验，QA A-04）', { name: app.name }))
    return false
  }

  guarded('PATCH', '/api/apps/:id', 'app.write', (exchange) => {
    if (!assertAppOwner(exchange, exchange.params['id']!)) return
    const input = body<{ name?: string; attrs?: Record<string, unknown> }>(exchange)
    const attrs = { ...(input.attrs ?? {}) }
    resolveDeveloperAttrs(attrs, { allowClear: true })
    const app = ctx.appRegistry.updateApp(exchange.params['id']!, { ...input, attrs })
    changeLog(exchange, 'app.update', 'app', app.id, app.name)
    return app
  })

  // 接入提示词（注册同款模板，平台侧生成）：rotate=true 轮换机器凭证 secret 并随提示词返回（旧值立即失效），
  // rotate=false 仅含 client_id（secret 丢失场景必须 rotate 才能拿到可用凭证）。控制台详情页按钮与外部推送方共用。
  guarded('POST', '/api/apps/:id/onboarding-prompt', 'app.write', (exchange) => {
    if (!assertAppOwner(exchange, exchange.params['id']!)) return
    const { rotate } = body<{ rotate?: boolean }>(exchange)
    const id = exchange.params['id']!
    const result = ctx.appRegistry.buildOnboardingPrompt(id, requestOrigin(exchange) ?? 'http://127.0.0.1:7300', { rotate: rotate === true })
    changeLog(exchange, 'app.onboarding-prompt', 'app', id, result.appName, result.rotated ? t('轮换机器凭证并生成接入提示词（旧 secret 立即失效）') : t('生成接入提示词（未轮换，不含 secret）'))
    return result
  })

  /** 删除应用：草稿（从未上线）或已归档可删；级联清除依赖边、禁用 SSO 客户端与机器凭证（记录保留）。 */
  guarded('DELETE', '/api/apps/:id', 'app.write', (exchange) => {
    if (!assertAppOwner(exchange, exchange.params['id']!)) return
    const id = exchange.params['id']!
    const app = ctx.resourceCore.get('app', id)
    if (!app) throw new Error(t('应用不存在：{id}', { id }))
    ctx.resourceCore.remove('app', id, { allowStates: ['draft', 'archived'] })
    ctx.appRegistry.purge(id)
    changeLog(exchange, 'app.delete', 'app', id, app.name)
    return { deleted: true }
  })

  // 应用指标主动上报（接入方 → 宿主推送通道；同日 DAU/UV 取最大、会话/PV 累加，可指定 date 补录）
  guarded('POST', '/api/apps/:id/metrics-report', 'app.write', (exchange) => {
    if (!assertAppOwner(exchange, exchange.params['id']!)) return
    const id = exchange.params['id']!
    const input = body<{ dau?: number; sessions?: number; avgDepth?: number; retention7?: number; pv?: number; uv?: number; date?: string }>(exchange)
    ctx.appRegistry.recordUsage(id, input)
    const app = ctx.resourceCore.get('app', id)!
    changeLog(exchange, 'app.metrics.report', 'app', id, app.name, `pv=${input.pv ?? '-'} uv=${input.uv ?? '-'} dau=${input.dau ?? '-'} sessions=${input.sessions ?? '-'} date=${input.date ?? t('当日')}`)
    return ctx.appRegistry.metrics(id)
  })

  // 组织架构同步（应用自助复用平台组织模块）：绑定本应用的机器凭证/owner 拉平台组织树+在职成员，
  // 在应用内复刻平台组织架构功能；users[].id 即 SSO userinfo 的 sub。?ifNoneMatch=<version> 命中
  // 返回 {unchanged:true} 零载荷轮询。PII 最小化（无手机号/邮箱）；更全字段走 /api/iam/roster
  // （iam.roster.read，管理员追加）。批量组织数据出口，每次拉取记 invoke 审计（同 roster 口径）。
  guarded('GET', '/api/apps/:id/org-sync', 'app.read', (exchange) => {
    if (!assertAppOwner(exchange, exchange.params['id']!)) return
    const id = exchange.params['id']!
    const ifNoneMatch = exchange.query.get('ifNoneMatch') ?? undefined
    const snapshot = ctx.appRegistry.orgSnapshot(id, { ...(ifNoneMatch ? { ifNoneMatch } : {}) })
    const info = caller(exchange)
    ctx.audit.record({
      type: 'invoke',
      actorType: info.kind === 'human' ? 'human' : 'machine',
      actorId: info.userId ?? info.principalId,
      actorName: info.name,
      action: 'app.org-sync.pull',
      resourceType: 'app',
      resourceId: id,
      resourceName: ctx.resourceCore.get('app', id)?.name ?? id,
      result: 'ok',
      detail: snapshot.unchanged
        ? `unchanged version=${snapshot.version}`
        : `orgs=${snapshot.orgs?.length ?? 0} users=${snapshot.users?.length ?? 0} version=${snapshot.version}`,
      ...(info.actChain.length > 0 ? { actChain: info.actChain } : {}),
    })
    return snapshot
  })

  guarded('POST', '/api/apps/:id/transition', 'app.write', (exchange) => {
    if (!assertAppOwner(exchange, exchange.params['id']!)) return
    const { action, note } = body<{ action: string; note?: string }>(exchange)
    const info = caller(exchange)
    const id = exchange.params['id']!
    if (action === 'online') {
      const approval = ctx.appRegistry.requestOnline(id, { id: info.userId ?? info.principalId, name: info.name })
      return { approval, note: t('发布为 L4 操作，已创建审批单') }
    }
    if (action === 'offline') {
      const approval = ctx.appRegistry.requestOffline(id, { id: info.userId ?? info.principalId, name: info.name }, note ?? '')
      return { approval, note: t('下架为 L4 操作，已创建审批单') }
    }
    if (action === 'submit_trial') return ctx.resourceCore.transition('app', id, 'submit_trial', info.name).entity
    if (action === 'retrial') return ctx.resourceCore.transition('app', id, 'retrial', info.name).entity
    if (action === 'archive') return ctx.appRegistry.archive(id, info.name)
    throw new Error(t('未知操作：{action}', { action }))
  })

  // -- 应用能力绑定（W2-T4，MCP 治理契约 §10） ------------------------------
  // 服务摘要只投影非 headers 字段——headers 一概不回显：脱敏管道 maskServiceHeaders 定义于
  // plugin-console/index.ts（中间件层），无法传入本路由域；直接零回显比掩码更保守，
  // 满足同一红线「业务集合与任何 API 响应绝不出现凭证/敏感头」。
  const capabilityServiceSummary = (serviceId: string) => {
    const service = ctx.mcpRegistry.services().get(serviceId)
    if (!service) return null
    return {
      id: service.id,
      name: service.name,
      slug: service.slug,
      status: service.status,
      dataClass: service.dataClass,
      exposureMode: service.exposureMode,
      environment: service.environment,
      health: service.health,
      toolCount: service.tools.length,
      hasCredential: Boolean(service.credentialRef),
      ownerEntity: service.ownerEntity,
    }
  }

  // 能力列表（含逐条服务摘要）；owner 守卫同 assertAppOwner 既有口径，权限点按契约 §15 用 app.write
  guarded('GET', '/api/apps/:id/capabilities', 'app.write', (exchange) => {
    if (!assertAppOwner(exchange, exchange.params['id']!)) return
    const id = exchange.params['id']!
    return {
      capabilities: ctx.appRegistry.listCapabilities(id).map((link) => ({
        ...link,
        service: capabilityServiceSummary(link.serviceId),
      })),
    }
  })

  // 绑定能力服务 {serviceId, required?}：服务必须存在；绑定同步 ownerEntity 回写
  // （platform 占位可认领；已归属其他主体 409 OWNER_CONFLICT）；重复绑定幂等返回现态
  guarded('POST', '/api/apps/:id/capabilities', 'app.write', (exchange) => {
    if (!assertAppOwner(exchange, exchange.params['id']!)) return
    const id = exchange.params['id']!
    const input = body<{ serviceId: string; required?: boolean }>(exchange)
    if (!input.serviceId?.trim()) throw new Error(t('serviceId 必填'))
    const info = caller(exchange)
    let result: { link: AppCapabilityLink; created: boolean }
    try {
      result = ctx.appRegistry.bindCapability(id, { serviceId: input.serviceId.trim(), required: input.required === true, boundBy: info.name })
    } catch (error) {
      if (error instanceof CapabilityOwnerConflictError) {
        exchange.fail(409, 'OWNER_CONFLICT', error.message)
        return
      }
      throw error
    }
    const app = ctx.resourceCore.get('app', id)
    changeLog(exchange, 'app.capability.bind', 'app', id, app?.name ?? id, result.created
      ? t('绑定能力服务 {serviceId}（required={required}；ownerEntity 回写 app 归属）', { serviceId: result.link.serviceId, required: result.link.required })
      : t('重复绑定幂等返回现态（serviceId={serviceId}）', { serviceId: result.link.serviceId }))
    return { ...result, service: capabilityServiceSummary(result.link.serviceId) }
  })

  // 解绑能力服务：删绑定记录与 capability 依赖边；服务归属若为本 app 联动还原 platform 占位
  guarded('DELETE', '/api/apps/:id/capabilities/:serviceId', 'app.write', (exchange) => {
    if (!assertAppOwner(exchange, exchange.params['id']!)) return
    const id = exchange.params['id']!
    const serviceId = exchange.params['serviceId']!
    const result = ctx.appRegistry.unbindCapability(id, serviceId)
    const app = ctx.resourceCore.get('app', id)
    changeLog(exchange, 'app.capability.unbind', 'app', id, app?.name ?? id, result.removed
      ? t('解绑能力服务 {serviceId}{owner}', { serviceId, owner: result.ownerRestored ? t('；归属联动还原 platform 占位（解绑联动）') : '' })
      : t('绑定不存在，幂等返回（serviceId={serviceId}）', { serviceId }))
    return result
  })

  // -- 应用 ↔ SSO 打通（owner 自助签发 + 机器环回自助，口径见 ssoManageGuard） ----
  const ssoApp = (exchange: HttpExchange): { id: string; name: string; ownerId: string } => {
    const app = ctx.resourceCore.get('app', exchange.params['id']!)
    if (!app) throw new Error(t('应用不存在：{id}', { id: exchange.params['id'] }))
    return { id: app.id, name: app.name, ownerId: app.ownerId }
  }

  guarded('POST', '/api/apps/:id/sso-client', 'app.write', (exchange) => {
    const input = body<{ redirectUris: string[]; clientType?: 'confidential' | 'public'; consentRequired?: boolean; postLogoutUris?: string[]; description?: string }>(exchange)
    if (!appSsoGuard(exchange, 'create', { redirectUris: input.redirectUris, postLogoutUris: input.postLogoutUris })) return
    const app = ssoApp(exchange)
    const created = ctx.appRegistry.createSsoClient(app.id, input)
    changeLog(exchange, 'app.sso.create', 'oidc_client', created.client.id, created.client.name, t('应用 {name} 签发（{clientType}）', { name: app.name, clientType: input.clientType ?? 'confidential' }))
    return {
      clientId: created.client.clientId,
      clientSecret: created.clientSecret,
      redirectUris: created.client.redirectUris,
      note: created.client.clientType === 'public' ? t('public 客户端无 secret（强制 PKCE、不发 refresh）') : t('clientSecret 仅此一次返回'),
    }
  })

  guarded('PATCH', '/api/apps/:id/sso-client', 'app.write', (exchange) => {
    const input = body<{ redirectUris?: string[]; description?: string; consentRequired?: boolean; postLogoutUris?: string[] }>(exchange)
    if (!appSsoGuard(exchange, 'update', { redirectUris: input.redirectUris, postLogoutUris: input.postLogoutUris })) return
    const app = ssoApp(exchange)
    const updated = ctx.appRegistry.updateSsoClient(app.id, input)
    changeLog(exchange, 'app.sso.update', 'oidc_client', updated.id, updated.name)
    return updated
  })

  guarded('POST', '/api/apps/:id/sso-client/rotate', 'app.write', (exchange) => {
    if (!appSsoGuard(exchange, 'rotate')) return
    const app = ssoApp(exchange)
    const rotated = ctx.appRegistry.rotateSsoSecret(app.id)
    changeLog(exchange, 'app.sso.rotate', 'oidc_client', rotated.client.id, rotated.client.name, t('旧 secret 立即失效'))
    return { clientId: rotated.client.clientId, clientSecret: rotated.clientSecret, note: t('新 clientSecret 仅此一次返回，旧值立即失效') }
  })

  for (const action of ['disable', 'enable'] as const) {
    guarded('POST', `/api/apps/:id/sso-client/${action}`, 'app.write', (exchange) => {
      if (!appSsoGuard(exchange, action)) return
      const app = ssoApp(exchange)
      const { reason } = body<{ reason?: string }>(exchange)
      const client = action === 'disable'
        ? ctx.appRegistry.disableSsoClient(app.id, reason ?? t('owner 手动禁用'))
        : ctx.appRegistry.enableSsoClient(app.id)
      changeLog(exchange, `app.sso.${action}`, 'oidc_client', client.id, client.name, reason ?? '')
      return client
    })
  }

}
