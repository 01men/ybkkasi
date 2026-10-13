/**
 * MCP 服务与连接器纳管域路由（R4 巨石拆分，REFACTOR-2026-10-13，2026-10-13）：
 * 自 plugin-console/index.ts 拆出——MCP 服务 CRUD/导入/工具同步/终审/灰度部署/回滚/
 * 下线审批/删除/探活/指标/调用台账/权限组/invoke（含 resolveMcpCaller 身份反查，随迁），
 * 以及 open-connector 融合的连接器纳管（网关配置/目录/连接/执行网关/权限组/运行日志对账台账）。
 * 处理器逐字搬运（行为与迁出前一致）；maskServiceHeaders 属中间件层回显脱敏，定义留
 * index.ts、经依赖注入。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { CallerInfo, HttpExchange } from '../../../platform-core/src/index.ts'
import type { ConsoleRouteDeps } from './deps.ts'

export interface McpRouteDeps extends ConsoleRouteDeps {
  /** 服务记录对外回显脱敏（存储保留原文；定义留 index.ts 中间件层） */
  maskServiceHeaders: <T extends { headers?: Record<string, string> }>(service: T) => T
}

export function registerMcpRoutes(ctx: Context, deps: McpRouteDeps): void {
  const { guarded, body, changeLog, caller, maskServiceHeaders } = deps

  /**
   * MCP 网关调用方身份解析：权限组 subjects 以 agent/app 资源 ID 授权，
   * 机器令牌需经 principal 的 refType/refId 反查归属资源，否则 agent 主体永远命中不了。
   */
  const resolveMcpCaller = (info: CallerInfo): { type: 'user' | 'agent' | 'app'; id: string; name: string } => {
    if (info.kind === 'human') return { type: 'user', id: info.userId ?? info.principalId, name: info.name }
    const principal = ctx.authn.principals().get(info.principalId)
    if (principal?.refType === 'agent' && principal.refId) return { type: 'agent', id: principal.refId, name: info.name }
    if (principal?.refType === 'app' && principal.refId) return { type: 'app', id: principal.refId, name: info.name }
    return { type: 'app', id: info.principalId, name: info.name }
  }
  // -- MCP ----------------------------------------------------------------
  guarded('GET', '/api/mcp/services', 'mcp.service.read', () => ({
    services: ctx.mcpRegistry.services().all().map(maskServiceHeaders),
    overview: ctx.mcpRegistry.metricsOverview(),
  }))

  guarded('POST', '/api/mcp/services', 'mcp.service.write', (exchange) => {
    const input = body<{ name: string; slug?: string; description?: string; icon?: string; endpoint?: string; transport?: 'stdio' | 'sse' | 'http'; mode?: 'hosted' | 'external'; orgId?: string; headers?: Record<string, string>; tools?: Array<{ name: string; description: string; riskLevel?: 'read' | 'write' | 'admin'; inputSchema?: Record<string, unknown> }> }>(exchange)
    // orgId 缺省回落根组织（与 /api/mcp/import 同口径）：外部推送方（机器凭证）无需 iam.org.read 即可注册
    const orgId = input.orgId ?? ctx.iam.orgs().findOne((org) => org.parentId === null)?.id
    const service = ctx.mcpRegistry.createService({
      ...input,
      ...(orgId ? { orgId } : {}),
      owner: caller(exchange).name,
      ...(input.tools ? { tools: input.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        riskLevel: tool.riskLevel ?? 'read',
        // 完整透传外部工具的 inputSchema（导入链路的关键信息），仅缺省时兜底空对象
        inputSchema: tool.inputSchema && typeof tool.inputSchema === 'object' && Object.keys(tool.inputSchema).length > 0
          ? tool.inputSchema
          : { type: 'object', properties: {}, additionalProperties: true },
      })) } : {}),
    })
    changeLog(exchange, 'mcp.service.create', 'mcp_service', service.id, service.name)
    return maskServiceHeaders(service)
  })

  /** mcpServers JSON 一键导入：解析 → 注册外部服务 → 自动发现工具 →（默认）验证上线。 */
  guarded('POST', '/api/mcp/import', 'mcp.service.write', async (exchange) => {
    const input = body<{ config: string | object; autoDeploy?: boolean }>(exchange)
    const rootOrg = ctx.iam.orgs().findOne((org) => org.parentId === null)
    if (!rootOrg) throw new Error('组织数据未初始化，无法导入')
    const result = await ctx.mcpRegistry.importServices({
      config: input.config,
      orgId: rootOrg.id,
      owner: caller(exchange).name,
      ...(input.autoDeploy !== undefined ? { autoDeploy: input.autoDeploy } : {}),
    })
    for (const item of result.results) {
      if (item.ok && item.serviceId) changeLog(exchange, 'mcp.service.import', 'mcp_service', item.serviceId, item.name, `tools=${item.tools ?? 0} reachable=${item.reachable}`)
    }
    return result
  })

  /** 外部服务工具同步：以远端 tools/list 为准刷新本地工具清单。 */
  guarded('POST', '/api/mcp/services/:id/sync-tools', 'mcp.service.write', async (exchange) => {
    const service = await ctx.mcpRegistry.syncTools(exchange.params['id']!)
    changeLog(exchange, 'mcp.service.syncTools', 'mcp_service', service.id, service.name, `tools=${service.tools.length}`)
    return maskServiceHeaders(service)
  })

  guarded('PATCH', '/api/mcp/services/:id', 'mcp.service.write', (exchange) => {
    const service = ctx.mcpRegistry.updateService(exchange.params['id']!, body(exchange))
    changeLog(exchange, 'mcp.service.update', 'mcp_service', service.id, service.name)
    return maskServiceHeaders(service)
  })

  guarded('POST', '/api/mcp/services/:id/verify', 'mcp.service.deploy', async (exchange) => {
    const service = await ctx.mcpRegistry.verifyService(exchange.params['id']!)
    changeLog(exchange, 'mcp.service.verify', 'mcp_service', service.id, service.name)
    return service
  })

  /**
   * MCP 服务公司级终审标记（WP-10/L1）：终审通过后，该服务全部调用记录附带水印
   * （watermark.finalReview），标记与水印在审计/调用台账双侧可追溯。
   */
  guarded('POST', '/api/mcp/services/:id/final-review', 'mcp.service.deploy', (exchange) => {
    const id = exchange.params['id']!
    const service = ctx.mcpRegistry.services().get(id)
    if (!service) throw new Error(`MCP 服务不存在：${id}`)
    const info = caller(exchange)
    const mark = { approverId: info.userId ?? info.principalId, approverName: info.name, at: new Date().toISOString() }
    const updated = ctx.mcpRegistry.services().update(id, { finalReview: mark })
    changeLog(exchange, 'mcp.final_review', 'mcp_service', id, service.name, '公司级终审标记：后续调用将附带水印')
    return { id, finalReview: updated.finalReview }
  })

  guarded('POST', '/api/mcp/services/:id/deploy', 'mcp.service.deploy', async (exchange) => {
    const input = body<{ grayPercent?: number; version?: string; changelog?: string; dryRun?: boolean }>(exchange)
    const id = exchange.params['id']!
    const impact = ctx.resourceCore.impact('mcp_service', id)
    if (input.dryRun) return { dryRun: true, impact }
    const service = await ctx.mcpRegistry.deployService(id, { ...input, actor: caller(exchange).name })
    changeLog(exchange, 'mcp.service.deploy', 'mcp_service', service.id, service.name, `v${service.currentVersion} gray=${service.grayPercent}%`)
    return service
  })

  guarded('POST', '/api/mcp/services/:id/rollback', 'mcp.service.deploy', async (exchange) => {
    const { targetVersion } = body<{ targetVersion: string }>(exchange)
    const service = await ctx.mcpRegistry.rollbackService(exchange.params['id']!, targetVersion, caller(exchange).name)
    changeLog(exchange, 'mcp.service.rollback', 'mcp_service', service.id, service.name, targetVersion)
    return service
  })

  guarded('POST', '/api/mcp/services/:id/offline', 'mcp.service.offline', (exchange) => {
    const { reason, viaApproval } = body<{ reason?: string; viaApproval?: boolean }>(exchange)
    if (!reason?.trim()) throw new Error('下线必须填写原因（护栏要求，下架分析依赖该口径）')
    const id = exchange.params['id']!
    if (viaApproval !== false) {
      const impact = ctx.resourceCore.impact('mcp_service', id)
      const approval = ctx.mcpRegistry.requestOfflineApproval(id, { id: caller(exchange).userId ?? caller(exchange).principalId, name: caller(exchange).name }, reason ?? '', impact.map((item) => `${item.name}（${item.type}）`))
      return { approval, note: '已创建 L4 审批单' }
    }
    const service = ctx.mcpRegistry.offlineService(id, caller(exchange).name, reason ?? '')
    changeLog(exchange, 'mcp.service.offline', 'mcp_service', service.id, service.name, reason ?? '')
    return service
  })

  /** 删除 MCP 服务：仅已下线可删；被权限组引用时拒绝；调用明细与审计数据保留。 */
  guarded('DELETE', '/api/mcp/services/:id', 'mcp.service.write', (exchange) => {
    const id = exchange.params['id']!
    const service = ctx.mcpRegistry.services().get(id)
    if (!service) throw new Error(`MCP 服务不存在：${id}`)
    if (service.status !== 'offline') throw new Error(`当前状态 ${service.status} 不可删除，请先下线服务`)
    const referencingGroups = ctx.mcpRegistry.permGroups().find((group) => Object.keys(group.policies).includes(id))
    if (referencingGroups.length > 0) {
      throw new Error(`该服务仍被权限组引用（${referencingGroups.map((group) => group.name).join('、')}），请先从权限组中移除`)
    }
    ctx.mcpRegistry.purgeService(id)
    changeLog(exchange, 'mcp.service.delete', 'mcp_service', id, service.name)
    return { deleted: true }
  })

  guarded('POST', '/api/mcp/services/:id/health', 'mcp.service.deploy', async (exchange) => {
    return await ctx.mcpRegistry.healthCheck(exchange.params['id']!)
  })

  guarded('GET', '/api/mcp/services/:id/metrics', 'mcp.service.read', (exchange) => {
    return ctx.mcpRegistry.serviceMetrics(exchange.params['id']!)
  })

  guarded('GET', '/api/mcp/calls', 'mcp.service.read', (exchange) => {
    return ctx.mcpRegistry.callLog({
      serviceId: exchange.query.get('serviceId') ?? undefined,
      callerId: exchange.query.get('callerId') ?? undefined,
      status: exchange.query.get('status') ?? undefined,
      limit: Number(exchange.query.get('limit') ?? 100),
    })
  })

  guarded('GET', '/api/mcp/perm-groups', 'mcp.service.read', () => ({ groups: ctx.mcpRegistry.permGroups().all() }))

  guarded('POST', '/api/mcp/perm-groups', 'mcp.permgroup.write', (exchange) => {
    const input = body<{ name: string; description?: string; policies: Record<string, { allowedTools: '*' | string[]; constraints?: { readOnly?: boolean } }>; subjects: Array<{ type: 'user_group' | 'agent' | 'app'; id: string; name?: string }> }>(exchange)
    const group = ctx.mcpRegistry.createPermGroup({
      name: input.name,
      description: input.description,
      policies: Object.fromEntries(Object.entries(input.policies).map(([serviceId, policy]) => [
        serviceId,
        { allowedTools: policy.allowedTools, constraints: policy.constraints ?? {} },
      ])),
      subjects: input.subjects,
    })
    changeLog(exchange, 'mcp.permgroup.create', 'mcp_perm_group', group.id, group.name)
    return group
  })

  guarded('PATCH', '/api/mcp/perm-groups/:id', 'mcp.permgroup.write', (exchange) => {
    const group = ctx.mcpRegistry.updatePermGroup(exchange.params['id']!, body(exchange))
    changeLog(exchange, 'mcp.permgroup.update', 'mcp_perm_group', group.id, group.name)
    return group
  })

  guarded('DELETE', '/api/mcp/perm-groups/:id', 'mcp.permgroup.write', (exchange) => {
    ctx.mcpRegistry.deletePermGroup(exchange.params['id']!)
    changeLog(exchange, 'mcp.permgroup.delete', 'mcp_perm_group', exchange.params['id']!, '')
    return { deleted: true }
  })

  guarded('POST', '/api/mcp/invoke', 'mcp.invoke', async (exchange) => {
    const input = body<{ serviceId: string; tool: string; args?: Record<string, unknown> }>(exchange)
    const info = caller(exchange)
    return await ctx.mcpRegistry.invoke({
      ...resolveMcpCaller(info),
      ...(info.actChain.length > 0 ? { actChain: info.actChain } : {}),
      ...(info.actChain.length > 0 ? { onBehalfOf: info.actChain[0]!.name } : {}),
    }, input.serviceId, input.tool, input.args ?? {})
  })

  // -- 连接器纳管（open-connector 融合） ------------------------------------
  // 路由集中在 console（仓内铁律），业务逻辑全在 plugin-connector；OcError 的错误码/状态
  // 原样透传（oauth_client_config_required→向导指引、connection_not_allowed→403 等）。
  const runWithOcErrors = async (exchange: HttpExchange, handler: () => Promise<unknown> | unknown): Promise<unknown> => {
    try {
      return await handler()
    } catch (error) {
      const status = (error as { status?: unknown }).status
      const code = (error as { code?: unknown }).code
      const message = error instanceof Error ? error.message : String(error)
      const guidance = (error as { guidance?: unknown }).guidance
      if (typeof status === 'number' && typeof code === 'string' && typeof guidance !== 'undefined'
        || (typeof status === 'number' && typeof code === 'string' && (error as { name?: string }).name === 'OcError')) {
        exchange.fail(status, code.toUpperCase(), guidance ? `${message} ${String(guidance)}` : message)
        return undefined
      }
      throw error
    }
  }

  /**
   * 连接器域组织可见范围：超管可带 ?orgId= 查任意组织；普通用户锁定在自身归属组织；
   * 机器收敛到绑定资源的归属组织，外部机器无归属 → 无可见数据（fail-closed）。
   * 与工具路径共用 connectorHub.orgScopeFor，REST/工具一套标准（审查 P0-1）。
   */
  const restrictOrgScope = (exchange: HttpExchange): string | null | undefined => {
    const info = caller(exchange)
    const requested = exchange.query.get('orgId') ?? undefined
    if (info.permissions.includes('*')) return requested
    const scope = ctx.connectorHub.orgScopeFor(info)
    if (scope === undefined) return requested
    return scope
  }

  /** 连接引用对外回显：无凭证字段（结构保证），maskedProfile 已在服务侧脱敏。 */
  const maskReference = <T extends { maskedProfile?: Record<string, string> }>(ref: T): T => ref

  const requireBodyOrg = (orgId: string | undefined): string => {
    if (!orgId) throw new Error('orgId 必填（连接归属组织，org:<orgId>: 别名前缀由此而来）')
    return orgId
  }

  const resolveConnectorCaller = (info: CallerInfo): { type: 'user' | 'agent' | 'app'; id: string; name: string } => {
    if (info.kind === 'human') return { type: 'user', id: info.userId ?? info.principalId, name: info.name }
    const principal = ctx.authn.principals().get(info.principalId)
    if (principal?.refType === 'agent' && principal.refId) return { type: 'agent', id: principal.refId, name: info.name }
    if (principal?.refType === 'app' && principal.refId) return { type: 'app', id: principal.refId, name: info.name }
    return { type: 'app', id: info.principalId, name: info.name }
  }

  // -- 网关配置 -------------------------------------------------------------
  guarded('GET', '/api/connector/gateway', 'connector.gateway.write', (exchange) => {
    // ?assumeEnv=JSON：只读「预演探针」——评估强制 env 门禁各分支的 fail-closed 文案
    // （不改动进程真实环境；selftest T-02 依赖此确定性断言路径）。
    const assumeRaw = exchange.query.get('assumeEnv')
    if (assumeRaw) {
      try {
        const parsed = JSON.parse(assumeRaw) as Record<string, boolean>
        return ctx.connectorHub.gatewayStatus(parsed)
      } catch {
        throw new Error('assumeEnv 必须是 {"ENV_NAME": boolean} 形态的 JSON')
      }
    }
    return ctx.connectorHub.gatewayStatus()
  })

  /** org 巡检手动触发（T-21 确定性断言；定时器周期外的一致性复核入口）。 */
  guarded('POST', '/api/connector/patrol', 'connector.gateway.write', async (exchange) => {
    return await runWithOcErrors(exchange, () => ctx.connectorHub.runPatrols(exchange.query.get('catalog') === '1' ? true : undefined))
  })

  guarded('PUT', '/api/connector/gateway', 'connector.gateway.write', async (exchange) => {
    const input = body<{ baseUrl: string; adminToken?: string; autoCatalogSyncMinutes?: number }>(exchange)
    const record = await ctx.connectorHub.configureGateway(input, caller(exchange).name)
    changeLog(exchange, 'connector.gateway.configure', 'connector_gateway', record.id, record.baseUrl)
    return { ok: true, baseUrl: record.baseUrl, versionPin: record.versionPin, autoCatalogSyncMinutes: record.autoCatalogSyncMinutes }
  })

  guarded('POST', '/api/connector/gateway/health', 'connector.gateway.write', async (exchange) => {
    const result = await ctx.connectorHub.probeGateway()
    changeLog(exchange, 'connector.gateway.probe', 'connector_gateway', 'gateway', '', result.ok ? `healthy ${result.latencyMs}ms` : `${result.reason ?? ''}`)
    return result
  })

  // connector.offline：网关维护下线（默认 L4 审批；viaApproval=false 需管理员显式绕行并留痕）
  guarded('POST', '/api/connector/gateway/offline', 'connector.gateway.write', async (exchange) => {
    const input = body<{ reason?: string; viaApproval?: boolean }>(exchange)
    if (!input.reason?.trim()) throw new Error('下线必须填写原因（护栏要求，处置复盘依赖该口径）')
    const info = caller(exchange)
    if (input.viaApproval === false) {
      const record = await ctx.connectorHub.offlineGateway(input.reason)
      changeLog(exchange, 'connector.gateway.offline', 'connector_gateway', record?.id ?? 'gateway', input.reason, '直连模式（无审批）')
      return { offlined: true, mode: 'direct' }
    }
    const approval = ctx.audit.createApproval({
      kind: 'connector.offline',
      title: `连接器网关维护下线：${input.reason.slice(0, 40)}`,
      payload: { scope: 'gateway', reason: input.reason, requesterId: info.userId ?? info.principalId, requesterName: info.name },
      requesterId: info.userId ?? info.principalId,
      requesterName: info.name,
    })
    changeLog(exchange, 'connector.gateway.offline.request', 'approval_center', approval.id, input.reason, 'L4 审批单已创建')
    return { approvalRequired: true, approvalId: approval.id }
  })

  // 恢复上线：低风险运维动作（清除维护标记并立即探活），不设审批
  guarded('POST', '/api/connector/gateway/online', 'connector.gateway.write', async (exchange) => {
    const result = await ctx.connectorHub.onlineGateway()
    changeLog(exchange, 'connector.gateway.online', 'connector_gateway', 'gateway', '', result.ok ? `healthy ${result.latencyMs}ms` : (result.reason ?? ''))
    return { ...result, online: true }
  })

  // -- 目录 -----------------------------------------------------------------
  guarded('GET', '/api/connector/catalog', 'connector.catalog.read', (exchange) => {
    const q = (exchange.query.get('q') ?? '').toLowerCase()
    const service = exchange.query.get('service')
    const kind = exchange.query.get('kind')
    const limit = Math.min(Number(exchange.query.get('limit') ?? 100), 500)
    const catalog = ctx.connectorHub.catalogs().all()[0]
    if (!catalog) return { providers: [], actions: [], skippedServices: [] as Array<{ service: string; reason: string }> }
    const filterProvider = (provider: Record<string, unknown>): boolean =>
      (!service || String(provider['service']) === service)
      && (!q || JSON.stringify(provider).toLowerCase().includes(q))
    const filterAction = (action: { id: string; service: string; description?: string }): boolean =>
      (!service || action.service === service)
      && (!q || `${action.id} ${action.service} ${action.description ?? ''}`.toLowerCase().includes(q))
    return {
      ...(catalog.syncedAt ? { syncedAt: catalog.syncedAt } : {}),
      providers: kind === 'actions' ? [] : catalog.providers.filter(filterProvider).slice(0, limit),
      actions: kind === 'providers' ? [] : catalog.actions.filter(filterAction).slice(0, limit),
      skippedServices: catalog.skippedServices,
    }
  })

  guarded('GET', '/api/connector/catalog/actions/:id/guide', 'connector.catalog.read', async (exchange) => {
    const { client } = ctx.connectorHub['requireClient']()
    const text = await client.getActionGuide(exchange.params['id']!)
    return { actionId: exchange.params['id'], guide: text }
  })

  guarded('GET', '/api/connector/catalog/actions/:id', 'connector.catalog.read', (exchange) => {
    const action = ctx.connectorHub.requireAction(exchange.params['id']!)
    return { action }
  })

  guarded('POST', '/api/connector/catalog/sync', 'connector.gateway.write', async (exchange) => {
    const result = await runWithOcErrors(exchange, () => ctx.connectorHub.syncCatalog(caller(exchange).name))
    if (!result) return // 错误响应已由处理器写出（如网关 fail-closed 503）
    changeLog(exchange, 'connector.catalog.sync', 'connector_catalog', 'catalog', '', `providers/actions=${(result as { providers?: number }).providers ?? 0}/${(result as { actions?: number }).actions ?? 0}`)
    return result
  })

  // -- 连接 -----------------------------------------------------------------
  guarded('GET', '/api/connector/connections', 'connector.connection.read', (exchange) => {
    const restrictedOrg = restrictOrgScope(exchange)
    if (restrictedOrg === null) return { total: 0, connections: [] }
    const refs = ctx.connectorHub.connections().find((item) =>
      (restrictedOrg === undefined || item.ownerOrgId === restrictedOrg))
    return { total: refs.length, connections: refs.map(maskReference) }
  })

  guarded('POST', '/api/connector/connections/oauth', 'connector.connection.write', async (exchange) => {
    const input = body<{ provider: string; aliasSuffix: string; requestedScopes?: string[]; requireApproval?: boolean; approvalId?: string; actorName?: string }>(exchange)
    const info = caller(exchange)
    const result = await runWithOcErrors(exchange, () => ctx.connectorHub.createConnection({
      orgId: requireBodyOrg(input.orgId),
      actor: { id: info.userId ?? info.principalId, name: input.actorName ?? info.name },
      provider: input.provider,
      aliasSuffix: input.aliasSuffix,
      authType: 'oauth',
      ...(input.requestedScopes?.length ? { requestedScopes: input.requestedScopes } : {}),
      ...(input.requireApproval !== undefined ? { requireApproval: input.requireApproval } : {}),
      ...(input.approvalId ? { approvalId: input.approvalId } : {}),
    }))
    if ((result as { reference?: { id: string } }).reference) {
      changeLog(exchange, 'connector.connection.oauth.start', 'connector_connection', (result as { reference: { id: string } }).reference.id, input.provider, input.orgId)
    } else if ((result as { approvalRequired?: boolean }).approvalRequired) {
      changeLog(exchange, 'connector.connection.approval', 'approval_center', (result as { approvalId?: string }).approvalId ?? '', input.provider, '连接创建进入审批门禁')
    }
    return result
  })

  guarded('POST', '/api/connector/connections/api-key', 'connector.connection.write', async (exchange) => {
    // 表单值过手直达 sidecar，不落任何集合、不打日志（红线一）
    const input = body<{ provider: string; aliasSuffix: string; values: Record<string, unknown>; authType?: 'api_key' | 'custom_credential'; requireApproval?: boolean; approvalId?: string; actorName?: string }>(exchange)
    const info = caller(exchange)
    const result = await runWithOcErrors(exchange, () => ctx.connectorHub.createConnection({
      orgId: requireBodyOrg(input.orgId),
      actor: { id: info.userId ?? info.principalId, name: input.actorName ?? info.name },
      provider: input.provider,
      aliasSuffix: input.aliasSuffix,
      authType: input.authType ?? 'api_key',
      values: input.values,
      ...(input.requireApproval !== undefined ? { requireApproval: input.requireApproval } : {}),
      ...(input.approvalId ? { approvalId: input.approvalId } : {}),
    }))
    const ref = (result as { reference?: { id: string } }).reference
    if (ref) changeLog(exchange, 'connector.connection.create', 'connector_connection', ref.id, input.provider, `${input.authType ?? 'api_key'} 直达 sidecar`)
    else if ((result as { approvalRequired?: boolean }).approvalRequired) {
      changeLog(exchange, 'connector.connection.approval', 'approval_center', (result as { approvalId?: string }).approvalId ?? '', input.provider, '连接创建进入审批门禁')
    }
    return result
  })

  guarded('POST', '/api/connector/connections/no-auth', 'connector.connection.write', async (exchange) => {
    const input = body<{ provider: string; aliasSuffix: string; actorName?: string }>(exchange)
    const info = caller(exchange)
    const result = await runWithOcErrors(exchange, () => ctx.connectorHub.createConnection({
      orgId: requireBodyOrg(input.orgId),
      actor: { id: info.userId ?? info.principalId, name: input.actorName ?? info.name },
      provider: input.provider,
      aliasSuffix: input.aliasSuffix,
      authType: 'no_auth',
    }))
    const ref = (result as { reference?: { id: string } }).reference
    if (ref) changeLog(exchange, 'connector.connection.create', 'connector_connection', ref.id, input.provider, 'no_auth 虚拟连接登记')
    return result
  })

  guarded('GET', '/api/connector/connections/oauth/:requestId/status', 'connector.connection.write', async (exchange) => {
    return await runWithOcErrors(exchange, () => ctx.connectorHub.confirmConnectionStatus({ requestId: exchange.params['requestId'] }))
  })

  guarded('POST', '/api/connector/connections/refresh', 'connector.connection.read', async (exchange) => {
    const orgFilter = exchange.query.get('orgId') ?? undefined
    return await runWithOcErrors(exchange, () => ctx.connectorHub.refreshConnections(orgFilter))
  })

  guarded('POST', '/api/connector/connections/:id/offline', 'connector.connection.write', async (exchange) => {
    const input = body<{ reason?: string; viaApproval?: boolean }>(exchange)
    if (!input.reason?.trim()) throw new Error('下线必须填写原因（护栏要求）')
    const id = exchange.params['id']!
    const info = caller(exchange)
    if (input.viaApproval === false) {
      const ref = await runWithOcErrors(exchange, () => ctx.connectorHub.offlineConnection(id, { actorName: info.name, reason: input.reason! }))
      if (!ref) return
      changeLog(exchange, 'connector.connection.offline', 'connector_connection', id, ref.alias, input.reason)
      return { offlined: true, mode: 'direct', reference: maskReference(ref) }
    }
    const approval = ctx.audit.createApproval({
      kind: 'connector.offline',
      title: `下线连接：${id}`,
      payload: { scope: 'connection', connectionId: id, reason: input.reason, requesterId: info.userId ?? info.principalId, requesterName: info.name },
      requesterId: info.userId ?? info.principalId,
      requesterName: info.name,
    })
    changeLog(exchange, 'connector.connection.offline.request', 'approval_center', approval.id, id, input.reason)
    return { approvalRequired: true, approvalId: approval.id }
  })

  guarded('POST', '/api/connector/connections/:id/online', 'connector.connection.write', async (exchange) => {
    const restored = await runWithOcErrors(exchange, () => ctx.connectorHub.onlineConnection(exchange.params['id']!))
    if (!restored) return
    changeLog(exchange, 'connector.connection.online', 'connector_connection', restored.id, restored.alias, '')
    return { online: true, reference: maskReference(restored) }
  })

  guarded('DELETE', '/api/connector/connections/:id', 'connector.connection.write', async (exchange) => {
    const input = body<{ force?: boolean }>(exchange)
    const deleteOutcome = await runWithOcErrors(exchange, () => ctx.connectorHub.deleteConnection(exchange.params['id']!, {
      actor: caller(exchange).name, ...(input.force ? { force: true } : {}),
    }))
    if (!deleteOutcome) return // 错误响应已由处理器写出（如 connection_in_use 409）
    const result = deleteOutcome as Awaited<ReturnType<typeof ctx.connectorHub.deleteConnection>>
    changeLog(exchange, 'connector.connection.delete', 'connector_connection', exchange.params['id']!, '', `released=${result.releasedGroups.join(',') || 'none'}`)
    return result
  })

  // -- 执行网关 --------------------------------------------------------------
  guarded('POST', '/api/connector/execute', 'connector.invoke', async (exchange) => {
    const input = body<{ actionId: string; input?: Record<string, unknown>; connection?: string; dryRun?: boolean }>(exchange)
    const info = caller(exchange)
    const resolved = resolveConnectorCaller(info)
    return await runWithOcErrors(exchange, () => ctx.connectorHub.invokeAction({
      ...resolved,
      ...(info.actChain.length > 0 ? { actChain: info.actChain } : {}),
    }, {
      actionId: input.actionId,
      input: input.input ?? {},
      ...(input.connection ? { alias: input.connection } : {}),
      ...(input.dryRun ? { dryRun: true } : {}),
    }))
  })

  // -- 权限组 -----------------------------------------------------------------
  guarded('GET', '/api/connector/perm-groups', 'connector.connection.read', (exchange) => {
    const orgFilter = restrictOrgScope(exchange)
    if (orgFilter === null) return { total: 0, groups: [] }
    const groups = ctx.connectorHub.permGroups().find((group) => (orgFilter === undefined || group.orgId === orgFilter))
    return { total: groups.length, groups }
  })

  guarded('POST', '/api/connector/perm-groups', 'connector.permgroup.write', async (exchange) => {
    const input = body<{ name: string; description?: string; orgId: string; policies: Record<string, { allowedActions: '*' | string[]; riskCap?: 'read' | 'write' | 'admin'; connections?: string[]; constraints?: { readOnly?: boolean; denyParams?: string[] } }>; subjects: Array<{ type: 'user_group' | 'agent' | 'app'; id: string; name?: string }>; rateLimitPerMin?: number; odd?: Record<string, unknown> }>(exchange)
    const createdGroup = await runWithOcErrors(exchange, () => ctx.connectorHub.createPermGroup({
      name: input.name,
      description: input.description,
      orgId: input.orgId,
      policies: input.policies,
      subjects: input.subjects,
      rateLimitPerMin: input.rateLimitPerMin,
      ...(input.odd !== undefined ? { odd: input.odd } : {}),
      // precheckCents 入参已废止（M0-2 billing 下线，OPT-P0-02）：legacy 记录字段运行时不读，新写请求不再透传
    }))
    if (!createdGroup) return // 错误响应已由处理器写出（如 invalid_alias_prefix 400）
    const group = createdGroup as Awaited<ReturnType<typeof ctx.connectorHub.createPermGroup>>
    changeLog(exchange, 'connector.permgroup.create', 'connector_perm_group', group.id, group.name)
    return group
  })

  guarded('PATCH', '/api/connector/perm-groups/:id', 'connector.permgroup.write', async (exchange) => {
    const updated = await runWithOcErrors(exchange, () => ctx.connectorHub.updatePermGroup(exchange.params['id']!, body(exchange)))
    if (!updated) return // 错误响应已由处理器写出
    const group = updated as Awaited<ReturnType<typeof ctx.connectorHub.updatePermGroup>>
    changeLog(exchange, 'connector.permgroup.update', 'connector_perm_group', group.id, group.name)
    return group
  })

  guarded('DELETE', '/api/connector/perm-groups/:id', 'connector.permgroup.write', (exchange) => {
    const removed = ctx.connectorHub.deletePermGroup(exchange.params['id']!)
    changeLog(exchange, 'connector.permgroup.delete', 'connector_perm_group', exchange.params['id']!, '')
    return { deleted: removed }
  })

  guarded('POST', '/api/connector/perm-groups/:id/impact', 'connector.connection.read', (exchange) => {
    return ctx.connectorHub.permGroupImpact(exchange.params['id']!)
  })

  // -- 运行日志 / 对账 / 台账 ---------------------------------------------------
  guarded('GET', '/api/connector/runs', 'connector.runs.read', async (exchange) => {
    return await runWithOcErrors(exchange, () => ctx.connectorHub.listRunsView({
      ...(exchange.query.get('service') ? { service: exchange.query.get('service')! } : {}),
      ...(exchange.query.get('ok') !== null ? { ok: exchange.query.get('ok') === 'true' } : {}),
      limit: Number(exchange.query.get('limit') ?? 100),
    }))
  })

  guarded('POST', '/api/connector/reconcile', 'connector.runs.read', async (exchange) => {
    const outcome = await runWithOcErrors(exchange, () => ctx.connectorHub.reconcileRuns())
    if (!outcome) return // 错误响应已由处理器写出
    const result = outcome as Awaited<ReturnType<typeof ctx.connectorHub.reconcileRuns>>
    changeLog(exchange, 'connector.reconcile.runs', 'connector_reconcile', 'runs', '', `checked=${result.checkedRuns} bypass=${result.bypassRuns.length}`)
    return result
  })

  guarded('GET', '/api/connector/tokens', 'connector.permgroup.write', (exchange) => {
    // 台账只读：永不返回 token 值（值仅创建时返回一次且平台不落盘）
    const ledgers = ctx.connectorHub.tokens().all().map((item) => ({
      permGroupId: item.permGroupId,
      ocTokenId: item.ocTokenId,
      policySnapshotHash: item.policySnapshotHash.slice(0, 12),
      createdAt: item.createdAt,
      lastSyncedAt: item.lastSyncedAt,
    }))
    return { total: ledgers.length, tokens: ledgers }
  })
}
