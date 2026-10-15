/**
 * REST 工作面（/api/workforce/*，路径与权限点以 manifest/api.yaml 为唯一事实源）。
 *
 * 统一约定：callerRef＝gate.caller(exchange)（console 鉴权中间件先行写入 principal）；
 * WorkforceError → exchange.fail(e.httpStatus, e.code, e.message)；
 * 管理类写操作走 gate.changeLog 留痕（受控调用/交付自身已是权威账本，不重复审计）。
 */
import type { Context } from '@deepseek-ai/cordis'
import { createRestGate, type RestGate } from '../../platform-core/src/rest-gate.ts'
import type { HttpExchange } from '../../platform-core/src/http.ts'
import type { WorkCallerRef, WorkDataClass } from '../../platform-core/src/workforce-port.ts'
import {
  WorkforceError,
  type EmployeeRecord,
  type EmployeeStatus,
  type ResourceGrantSpec,
  type WorkforceAdmission,
  type WorkforceAppointments,
  type WorkforceArtifacts,
  type WorkforceDelivery,
  type WorkforceEmployees,
  type WorkforceIdentityResolver,
  type WorkforceInvocations,
  type WorkforceStore,
} from './contract.ts'

interface WorkforceServices {
  store: WorkforceStore
  employees: WorkforceEmployees
  appointments: WorkforceAppointments
  identity: WorkforceIdentityResolver
  admission: WorkforceAdmission
  invocations: WorkforceInvocations
  artifacts: WorkforceArtifacts
  delivery: WorkforceDelivery
}

function services(ctx: Context): WorkforceServices {
  const source = ctx as unknown as Partial<WorkforceServices> & Record<string, unknown>
  const missing = (['workforceStore', 'workforceEmployees', 'workforceAppointments', 'workforceIdentity',
    'workforceAdmission', 'workforceInvocations', 'workforceArtifacts', 'workforceDelivery'] as const)
    .filter((key) => !source[key])
  if (missing.length > 0) {
    throw new WorkforceError('WORKFORCE_NOT_READY', `数字员工服务未就绪：${missing.join('、')}`, 503)
  }
  // 显式按接口字段名组包（ctx 不得原样强转返回：调用方按 store/employees/… 取用，
  // 而 ctx 上的服务键是 workforceStore/workforceEmployees/…——原样返回会让 svc.store
  // 变成对 ctx 的未知属性读取，被 cordis 判 without inject 抛 400）
  return {
    store: source.workforceStore,
    employees: source.workforceEmployees,
    appointments: source.workforceAppointments,
    identity: source.workforceIdentity,
    admission: source.workforceAdmission,
    invocations: source.workforceInvocations,
    artifacts: source.workforceArtifacts,
    delivery: source.workforceDelivery,
  } as WorkforceServices
}

/** gate.caller → 可信 caller（与 tools.ts 同规则；禁止从请求体读身份）。 */
function callerRefOf(gate: RestGate, exchange: HttpExchange): WorkCallerRef {
  const info = gate.caller(exchange)
  return {
    kind: info.kind,
    principalId: info.principalId,
    ...(info.userId ? { userId: info.userId } : {}),
    ...(info.refType !== undefined ? { refType: info.refType } : {}),
    ...(info.refId !== undefined ? { refId: info.refId } : {}),
    ...(info.name ? { name: info.name } : {}),
  }
}

/** 统一错误出口：领域错误按 httpStatus/code 透传，其余 400。 */
function failOf(exchange: HttpExchange, error: unknown): void {
  if (error instanceof WorkforceError) {
    exchange.fail(error.httpStatus, error.code, error.message)
    return
  }
  exchange.fail(400, 'BAD_REQUEST', error instanceof Error ? error.message : String(error))
}

function readBody(exchange: HttpExchange): Record<string, unknown> {
  const body = exchange.body
  return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}
}

function publicEmployee(record: EmployeeRecord): Record<string, unknown> {
  return {
    id: record.id, name: record.name, displayName: record.displayName, orgId: record.orgId,
    supervisorUserId: record.supervisorUserId, status: record.status, primaryAgentId: record.primaryAgentId,
    createdAt: record.createdAt, updatedAt: record.updatedAt,
  }
}

function parseGrants(value: unknown): ResourceGrantSpec[] {
  if (!Array.isArray(value)) throw new WorkforceError('ARGUMENT_SCOPE_DENIED', 'grants 必须为数组')
  return value.map((item) => {
    const grant = item as Record<string, unknown>
    const kind = grant['kind']
    if (kind !== 'mcp' && kind !== 'connector' && kind !== 'model' && kind !== 'skill' && kind !== 'nas' && kind !== 'app') {
      throw new WorkforceError('ARGUMENT_SCOPE_DENIED', `非法授权类型：${String(kind)}`)
    }
    const risk = grant['risk']
    if (risk !== 'read' && risk !== 'write' && risk !== 'admin') {
      throw new WorkforceError('ARGUMENT_SCOPE_DENIED', `非法风险级：${String(risk)}`)
    }
    const registryId = String(grant['registryId'] ?? '')
    if (!registryId) throw new WorkforceError('ARGUMENT_SCOPE_DENIED', '授权缺少 registryId')
    const actions = Array.isArray(grant['actions']) ? grant['actions'].map((action) => String(action)) : []
    if (actions.length === 0) throw new WorkforceError('ARGUMENT_SCOPE_DENIED', `授权 ${registryId} 缺少动作清单（未知风险工具不得默认开放）`)
    return {
      kind, registryId, actions, risk,
      constraints: grant['constraints'] && typeof grant['constraints'] === 'object'
        ? grant['constraints'] as Record<string, unknown>
        : undefined,
    }
  })
}

export function registerWorkforceRoutes(ctx: Context): void {
  const gate = createRestGate(ctx as unknown as Parameters<typeof createRestGate>[0])

  // -- 总览 ---------------------------------------------------------------

  gate.guarded('GET', '/api/workforce/overview', 'workforce.read', () => {
    const svc = services(ctx)
    return {
      employees: svc.store.employees.count(),
      bindings: svc.store.bindings.count(),
      appointments: svc.store.appointments.count(),
      permits: svc.store.permits.findWhere({ status: 'active' }).length,
      invocations: svc.store.invocations.count(),
      deliverables: svc.store.deliverables.count(),
      artifacts: svc.store.artifacts.count(),
    }
  })

  // -- 员工 ---------------------------------------------------------------

  gate.guarded('GET', '/api/workforce/employees', 'workforce.read', (exchange) => {
    const svc = services(ctx)
    const url = new URL(exchange.request.url, 'http://localhost')
    const orgId = url.searchParams.get('orgId') ?? undefined
    const status = url.searchParams.get('status') ?? undefined
    const records = svc.employees.list({
      ...(orgId ? { orgId } : {}),
      ...(status ? { status: status as EmployeeStatus } : {}),
    })
    return records.map(publicEmployee)
  })

  gate.guarded('POST', '/api/workforce/employees', 'workforce.write', (exchange) => {
    const svc = services(ctx)
    const body = readBody(exchange)
    const record = svc.employees.create({
      name: String(body['name'] ?? ''),
      ...(body['displayName'] !== undefined ? { displayName: String(body['displayName']) } : {}),
      orgId: String(body['orgId'] ?? ''),
      supervisorUserId: String(body['supervisorUserId'] ?? ''),
      agentId: String(body['agentId'] ?? ''),
      ...(body['principalId'] !== undefined ? { principalId: String(body['principalId']) } : {}),
      ...(body['runtime'] !== undefined ? { runtime: String(body['runtime']) } : {}),
    })
    gate.changeLog(exchange, 'workforce.employee.create', 'employee', record.id, record.name)
    return publicEmployee(record)
  })

  gate.guarded('GET', '/api/workforce/employees/:id', 'workforce.read', (exchange) => {
    const svc = services(ctx)
    return {
      ...publicEmployee(svc.employees.get(exchange.params['id'] ?? '')),
      bindings: svc.employees.bindingsFor(exchange.params['id'] ?? ''),
    }
  })

  gate.guarded('POST', '/api/workforce/employees/:id/status', 'workforce.write', async (exchange) => {
    const svc = services(ctx)
    const body = readBody(exchange)
    const status = String(body['status'] ?? '')
    if (status !== 'active' && status !== 'suspended' && status !== 'offboarded') {
      throw new WorkforceError('ARGUMENT_SCOPE_DENIED', `非法员工状态：${status}`)
    }
    const record = await svc.employees.setStatus(callerRefOf(gate, exchange), exchange.params['id'] ?? '', status, String(body['reason'] ?? ''))
    gate.changeLog(exchange, 'workforce.employee.status', 'employee', record.id, record.name, `→ ${status}（${String(body['reason'] ?? '')}）`)
    return publicEmployee(record)
  })

  gate.guarded('POST', '/api/workforce/employees/:id/bindings', 'workforce.write', (exchange) => {
    const svc = services(ctx)
    const body = readBody(exchange)
    const binding = svc.employees.bindAgent(
      callerRefOf(gate, exchange),
      exchange.params['id'] ?? '',
      String(body['agentId'] ?? ''),
      ...(body['principalId'] !== undefined ? [String(body['principalId'])] as const : []),
      ...(body['runtime'] !== undefined ? [String(body['runtime'])] as const : []),
    )
    gate.changeLog(exchange, 'workforce.employee.bind', 'binding', binding.id, `${binding.employeeId} → ${binding.agentId}`)
    return binding
  })

  // -- 任用 ---------------------------------------------------------------

  gate.guarded('GET', '/api/workforce/appointments', 'workforce.read', (exchange) => {
    const svc = services(ctx)
    const url = new URL(exchange.request.url, 'http://localhost')
    const employeeId = url.searchParams.get('employeeId') ?? undefined
    const status = url.searchParams.get('status') ?? undefined
    return svc.appointments.list({
      ...(employeeId ? { employeeId } : {}),
      ...(status ? { status: status as 'preparing' | 'effective' | 'revoking' | 'revoked' | 'failed' } : {}),
    })
  })

  gate.guarded('POST', '/api/workforce/appointments', 'workforce.write', (exchange) => {
    const svc = services(ctx)
    const body = readBody(exchange)
    const actor = gate.actorOf(exchange)
    const record = svc.appointments.create({
      employeeId: String(body['employeeId'] ?? ''),
      position: String(body['position'] ?? ''),
      orgId: String(body['orgId'] ?? ''),
      dataClass: String(body['dataClass'] ?? 'internal') as WorkDataClass,
      effectiveFrom: String(body['effectiveFrom'] ?? new Date().toISOString()),
      ...(body['effectiveUntil'] !== undefined ? { effectiveUntil: String(body['effectiveUntil']) } : {}),
      grants: parseGrants(body['grants']),
      approvedBy: String(body['approvedBy'] ?? actor),
      ...(body['approvalRef'] !== undefined ? { approvalRef: String(body['approvalRef']) } : {}),
    })
    gate.changeLog(exchange, 'workforce.appointment.create', 'appointment', record.id, `${record.employeeId} v${record.version}`)
    return record
  })

  gate.guarded('POST', '/api/workforce/appointments/:id/activate', 'workforce.write', async (exchange) => {
    const svc = services(ctx)
    const record = await svc.appointments.activate(callerRefOf(gate, exchange), exchange.params['id'] ?? '')
    gate.changeLog(exchange, 'workforce.appointment.activate', 'appointment', record.id, `→ ${record.status}`)
    return record
  })

  gate.guarded('POST', '/api/workforce/appointments/:id/revoke', 'workforce.write', async (exchange) => {
    const svc = services(ctx)
    const body = readBody(exchange)
    const record = await svc.appointments.revoke(callerRefOf(gate, exchange), exchange.params['id'] ?? '', String(body['reason'] ?? ''))
    gate.changeLog(exchange, 'workforce.appointment.revoke', 'appointment', record.id, `→ ${record.status}（${String(body['reason'] ?? '')}）`)
    return record
  })

  // -- 待办拉取（运行时按机器主体反查员工待办，不接受任意员工过滤，§13.1） ---------

  gate.guarded('GET', '/api/workforce/work-items', 'workforce.invoke', async (exchange) => {
    const svc = services(ctx)
    const caller = callerRefOf(gate, exchange)
    const resolution = await svc.identity.resolveByCaller(caller)
    if (!resolution) throw new WorkforceError('EMPLOYEE_NOT_ACTIVE', '非受管数字员工或绑定缺失')
    const agentId = resolution.binding.agentId
    const hub = (ctx as unknown as {
      execHub?: { issues?: () => { all(): Array<Record<string, unknown>> } }
    }).execHub
    if (!hub || typeof hub.issues !== 'function') {
      exchange.fail(503, 'EXEC_HUB_UNAVAILABLE', '执行中枢未就绪，无法拉取待办')
      return
    }
    const issues = hub.issues().all()
      .filter((issue) => issue['assigneeAgentId'] === agentId && (issue['status'] === 'todo' || issue['status'] === 'in_progress'))
      .map((issue) => ({
        id: issue['id'], title: issue['title'], status: issue['status'], priority: issue['priority'],
        dueAt: issue['dueAt'] ?? '', executionRunId: issue['executionRunId'] ?? '',
      }))
    return { employeeId: resolution.employee.id, agentId, items: issues }
  })

  // -- 认领与续租 -----------------------------------------------------------

  gate.guarded('POST', '/api/workforce/claims', 'workforce.invoke', async (exchange) => {
    const svc = services(ctx)
    const body = readBody(exchange)
    const outcome = await svc.admission.claimWork(callerRefOf(gate, exchange), {
      issueId: String(body['issueId'] ?? ''),
      ...(typeof body['agentKey'] === 'string' && body['agentKey'] ? { agentKey: body['agentKey'] } : {}),
      ...(typeof body['ttlMinutes'] === 'number' && body['ttlMinutes'] > 0 ? { ttlMs: Math.round(body['ttlMinutes'] * 60_000) } : {}),
    })
    if (!outcome.ok) {
      exchange.fail(outcome.code === 'WORKFORCE_NOT_READY' ? 503 : 403, outcome.code, outcome.message,
        outcome.holder ? { holder: outcome.holder } : undefined)
      return
    }
    gate.changeLog(exchange, 'workforce.claim', 'run', outcome.runId, `issue=${outcome.issueId} employee=${outcome.employeeId}`)
    return {
      ok: true,
      employeeId: outcome.employeeId,
      issueId: outcome.issueId,
      runId: outcome.runId,
      lease: outcome.lease,
      permit: outcome.permit,
      manifest: outcome.manifest,
      tools: outcome.tools.map((tool) => tool.handle),
      idempotent: outcome.idempotent,
    }
  })

  gate.guarded('POST', '/api/workforce/leases/:id/renew', 'workforce.invoke', async (exchange) => {
    const svc = services(ctx)
    const body = readBody(exchange)
    const result = await svc.admission.renewWorkLease(
      callerRefOf(gate, exchange),
      exchange.params['id'] ?? '',
      typeof body['ttlMinutes'] === 'number' && body['ttlMinutes'] > 0 ? Math.round(body['ttlMinutes'] * 60_000) : undefined,
    )
    if (!result.ok) {
      exchange.fail(result.code === 'EXEC_HUB_UNAVAILABLE' ? 503 : 403, result.code, result.message)
      return
    }
    return { ok: true, lease: result.lease }
  })

  // -- 受控调用账本 ---------------------------------------------------------

  gate.guarded('POST', '/api/workforce/invocations', 'workforce.invoke', async (exchange) => {
    const svc = services(ctx)
    const body = readBody(exchange)
    const outcome = await svc.invocations.invoke(callerRefOf(gate, exchange), {
      permitId: String(body['permitId'] ?? ''),
      toolHandle: String(body['toolHandle'] ?? ''),
      stepKey: String(body['stepKey'] ?? ''),
      arguments: body['arguments'],
      ...(typeof body['traceId'] === 'string' && body['traceId'] ? { traceId: body['traceId'] } : {}),
    })
    // 领域状态与 HTTP 状态分开保留（§9.3：不以 HTTP 200 冒充业务成功，也不以 4xx 丢失领域状态）
    return { ok: outcome.status === 'completed', ...outcome }
  })

  gate.guarded('GET', '/api/workforce/invocations/:id', 'workforce.invoke', async (exchange) => {
    const svc = services(ctx)
    return svc.invocations.get(callerRefOf(gate, exchange), exchange.params['id'] ?? '')
  })

  gate.guarded('GET', '/api/workforce/invocations', 'workforce.invoke', async (exchange) => {
    const svc = services(ctx)
    const url = new URL(exchange.request.url, 'http://localhost')
    const runId = url.searchParams.get('runId') ?? ''
    if (!runId) throw new WorkforceError('ARGUMENT_SCOPE_DENIED', '缺少 runId 查询参数')
    return svc.invocations.listByRun(callerRefOf(gate, exchange), runId)
  })

  // -- 受控 artifact ---------------------------------------------------------

  gate.guarded('POST', '/api/workforce/artifacts', 'workforce.invoke', async (exchange) => {
    const svc = services(ctx)
    const body = readBody(exchange)
    const record = await svc.artifacts.createUpload(callerRefOf(gate, exchange), {
      name: String(body['name'] ?? ''),
      contentType: String(body['contentType'] ?? 'application/octet-stream'),
      contentBase64: String(body['contentBase64'] ?? ''),
      ...(typeof body['runId'] === 'string' && body['runId'] ? { runId: body['runId'] } : {}),
    })
    return {
      id: record.id, name: record.name, sizeBytes: record.sizeBytes,
      sha256: record.sha256, runId: record.runId, createdAt: record.createdAt,
    }
  })

  gate.guarded('GET', '/api/workforce/artifacts/:id', 'workforce.invoke', async (exchange) => {
    const svc = services(ctx)
    return svc.artifacts.get(callerRefOf(gate, exchange), exchange.params['id'] ?? '')
  })

  // -- 交付 -----------------------------------------------------------------

  gate.guarded('POST', '/api/workforce/deliverables', 'workforce.invoke', async (exchange) => {
    const svc = services(ctx)
    const body = readBody(exchange)
    const record = await svc.delivery.submit(callerRefOf(gate, exchange), {
      permitId: String(body['permitId'] ?? ''),
      summary: String(body['summary'] ?? ''),
      artifactIds: Array.isArray(body['artifactIds']) ? body['artifactIds'].map((item) => String(item)) : [],
    })
    gate.changeLog(exchange, 'workforce.deliverable.submit', 'deliverable', record.id, `run=${record.runId} v${record.version}`)
    return record
  })

  gate.guarded('GET', '/api/workforce/deliverables', 'workforce.invoke', async (exchange) => {
    const svc = services(ctx)
    const url = new URL(exchange.request.url, 'http://localhost')
    const runId = url.searchParams.get('runId') ?? ''
    if (!runId) throw new WorkforceError('ARGUMENT_SCOPE_DENIED', '缺少 runId 查询参数')
    return svc.delivery.listByRun(callerRefOf(gate, exchange), runId)
  })

  // -- 验收（真人，workforce.accept） -----------------------------------------

  gate.guarded('POST', '/api/workforce/acceptances', 'workforce.accept', async (exchange) => {
    const svc = services(ctx)
    const body = readBody(exchange)
    const decision = String(body['decision'] ?? '')
    if (decision !== 'accepted' && decision !== 'rejected') {
      throw new WorkforceError('ARGUMENT_SCOPE_DENIED', `非法验收决定：${decision}`)
    }
    const record = await svc.delivery.decide(callerRefOf(gate, exchange), {
      deliverableId: String(body['deliverableId'] ?? ''),
      decision,
      reason: String(body['reason'] ?? ''),
    })
    gate.changeLog(exchange, 'workforce.acceptance.decide', 'deliverable', record.id, `${decision}（${record.decisionReason}）`)
    return record
  })
}
