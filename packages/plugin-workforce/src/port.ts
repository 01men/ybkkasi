/**
 * 工作策略端口实现（platform-core workforce-port.ts 的 ResourceExecutionPolicyPort）。
 *
 * 消费方：资源网关与 exec-hub 经 ctx.workforcePolicy.port() 拿到本实现（窄端口，
 * 无反向依赖）。判定只依据已验证 caller，与请求是否携带 work 上下文无关（D.5 防绕行）；
 * 本端口只做工作级授权，资源网关原有授权链一项不少（两层授权取交集，§9.5）。
 * 任何异常向上抛出——gateManagedWork 会 fail-closed（POLICY_INTERNAL_ERROR）。
 */
import type { Context } from '@deepseek-ai/cordis'
import {
  appointmentInEffect,
} from './domain.ts'
import {
  WorkforceError,
  type IdentityResolution,
  type ManifestToolHandle,
  type WorkforceAdmission,
  type WorkforceCapabilities,
  type WorkforceIdentityResolver,
  type WorkforceStore,
} from './contract.ts'
import type {
  ManagedEmployeeRef,
  ResourceActionFacts,
  WorkActionQuery,
  WorkCallerRef,
  WorkDataClass,
  WorkPolicyDecision,
} from '../../platform-core/src/workforce-port.ts'
import type { ResourceExecutionPolicyPort } from '../../platform-core/src/workforce-port.ts'

export function createWorkforcePolicyPort(ctx: Context): ResourceExecutionPolicyPort {
  // -- 依赖（结构化探测；端口在 workforce 装配完成后注册，依赖均已就绪） ----------------

  const store = (): WorkforceStore => {
    const target = (ctx as unknown as { workforceStore?: WorkforceStore }).workforceStore
    if (!target || typeof target.txn !== 'function') {
      throw new WorkforceError('WORKFORCE_NOT_READY', 'workforceStore 未就绪', 503)
    }
    return target
  }

  const identity = (): WorkforceIdentityResolver => {
    const target = (ctx as unknown as { workforceIdentity?: WorkforceIdentityResolver }).workforceIdentity
    if (!target || typeof target.resolveByCaller !== 'function') {
      throw new WorkforceError('WORKFORCE_NOT_READY', 'workforceIdentity 未就绪', 503)
    }
    return target
  }

  const admission = (): WorkforceAdmission => {
    const target = (ctx as unknown as { workforceAdmission?: WorkforceAdmission }).workforceAdmission
    if (!target || typeof target.verifyPermit !== 'function') {
      throw new WorkforceError('WORKFORCE_NOT_READY', 'workforceAdmission 未就绪', 503)
    }
    return target
  }

  const capabilities = (): WorkforceCapabilities => {
    const target = (ctx as unknown as { workforceCapabilities?: WorkforceCapabilities }).workforceCapabilities
    if (!target || typeof target.toolsFor !== 'function') {
      throw new WorkforceError('WORKFORCE_NOT_READY', 'workforceCapabilities 未就绪', 503)
    }
    return target
  }

  /** 可信 caller → 受管员工引用；非员工返回 null（旧路径继续走原有授权链）。 */
  async function resolveManagedEmployee(caller: WorkCallerRef): Promise<ManagedEmployeeRef | null> {
    const resolution = await identity().resolveByCaller(caller)
    if (!resolution) return null
    return {
      employeeId: resolution.employee.id,
      agentId: resolution.binding.agentId,
      appointmentId: resolution.appointment.id,
      appointmentVersion: resolution.appointment.version,
      workOrgId: resolution.appointment.orgId,
      dataClass: resolution.appointment.dataClass,
    }
  }

  async function describeManagedAgent(agentId: string): Promise<ManagedEmployeeRef | null> {
    return identity().describeAgent(agentId)
  }

  /** 任用失效细分（等待 vs 停止语义，§13.3）。 */
  function assertAppointment(resolution: IdentityResolution): void {
    if (appointmentInEffect(resolution.appointment)) return
    const expired = resolution.appointment.effectiveUntil !== ''
      && resolution.appointment.effectiveUntil <= new Date().toISOString()
    throw new WorkforceError(
      expired ? 'APPOINTMENT_EXPIRED' : 'APPOINTMENT_NOT_EFFECTIVE',
      expired ? '任用已过期' : '任用未生效（资源授权准备未完成）',
    )
  }

  /**
   * 工具命中判定（facts 由资源服务自行解析，不接受客户端/模型自报风险，D.5）：
   * mcp/connector/nas/skill 按 registryId+action 精确匹配；
   * model 按 kind=model 且（registryId 相等或 constraints.allowedModels 含 facts.registryId）。
   */
  function matchTool(tools: ManifestToolHandle[], facts: ResourceActionFacts): ManifestToolHandle | undefined {
    if (facts.kind === 'model') {
      return tools.find((tool) => tool.kind === 'model' && (
        tool.registryId === facts.registryId
        || (Array.isArray(tool.constraints?.['allowedModels'])
          && (tool.constraints['allowedModels'] as unknown[]).includes(facts.registryId))))
    }
    return tools.find((tool) =>
      tool.kind === facts.kind
      && tool.registryId === facts.registryId
      && tool.action === facts.action)
  }

  async function authorizeWorkAction(caller: WorkCallerRef, query: WorkActionQuery): Promise<WorkPolicyDecision> {
    // 1. 受管身份（非员工不应进入本分支——gateManagedWork 已按 resolveManagedEmployee 分流）
    const resolution = await identity().resolveByCaller(caller)
    if (!resolution) {
      return { allow: false, code: 'EMPLOYEE_NOT_ACTIVE', message: '非受管数字员工或绑定缺失' }
    }
    if (resolution.employee.status !== 'active') {
      return { allow: false, code: 'EMPLOYEE_NOT_ACTIVE', message: '数字员工不在岗（停职或已离岗）' }
    }
    // 2. 任用生效（版本即策略版本）
    try {
      assertAppointment(resolution)
    } catch (error) {
      const e = error as WorkforceError
      return { allow: false, code: e.code, message: e.message }
    }
    // 3. permit：受控入口凭据（V28：即使猜到工具名，无 permit 也拒绝）
    const ref = query.ref ?? {}
    if (!ref.permitId) {
      return { allow: false, code: 'TOOL_NOT_GRANTED', message: '数字员工必须携带工作授权 permit 经受控入口调用' }
    }
    let permit
    try {
      permit = await admission().verifyPermit(caller, ref.permitId, { requireRun: true })
    } catch (error) {
      if (error instanceof WorkforceError) {
        return { allow: false, code: error.code, message: error.message }
      }
      throw error
    }
    // permit 绑定的 run 与引用 run 一致（引用仅作索引，事实以服务端回查为准，§10.4）
    if (ref.runId && ref.runId !== permit.runId) {
      return { allow: false, code: 'RUN_NOT_OWNED', message: '工作引用的 run 与 permit 绑定不一致' }
    }
    // 4. 工具在能力清单（服务端清单唯一事实，§9.2）
    const tool = matchTool(capabilities().toolsFor(permit.manifestId), query.facts)
    if (!tool) {
      return { allow: false, code: 'TOOL_NOT_GRANTED', message: '工具未列入本任用能力清单' }
    }
    // 5. 风险交集：facts 为写/admin 而清单只授 read → 拒绝（附录 D.5：不信任自报风险）
    if ((query.facts.risk === 'write' || query.facts.risk === 'admin') && tool.risk === 'read') {
      return { allow: false, code: 'ARGUMENT_SCOPE_DENIED', message: '该动作为写/管理风险，超出本句柄的只读授权' }
    }
    // 6. 步骤冲突防御（纵深防御：主校验在 invocation-service 的唯一约束）
    if (query.argsHash && ref.stepKey) {
      const prior = store().invocations.findWhere({ runId: permit.runId, stepKey: ref.stepKey })[0]
      if (prior && prior.argsHash !== query.argsHash) {
        return { allow: false, code: 'STEP_ARGUMENT_CONFLICT', message: '同一业务步骤键已绑定不同参数，冲突拒绝' }
      }
    }
    // 7. 组装核验后可信执行上下文（§8.3：身份/组织/版本服务端解析）
    return {
      allow: true,
      work: {
        employeeId: resolution.employee.id,
        agentId: resolution.binding.agentId,
        principalId: permit.principalId,
        appointmentId: permit.appointmentId,
        appointmentVersion: permit.appointmentVersion,
        workOrgId: resolution.appointment.orgId,
        dataClass: resolution.appointment.dataClass as WorkDataClass,
        issueId: permit.issueId,
        runId: permit.runId,
        leaseVersion: permit.leaseVersion,
        permitId: permit.id,
        capabilityManifestId: permit.manifestId,
        policyVersion: permit.appointmentVersion,
        // 原始业务发起人：仅 human 链保留（与员工身份并存不互覆，§5.3）
        ...(caller.kind === 'human' && caller.userId ? { requesterUserId: caller.userId } : {}),
        ...(ref.traceId ? { traceId: ref.traceId } : {}),
      },
    }
  }

  return {
    resolveManagedEmployee,
    describeManagedAgent,
    authorizeWorkAction,
  }
}
