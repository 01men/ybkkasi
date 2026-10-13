/**
 * REST 鉴权门共享模块（R5 鉴权样板收敛，REFACTOR-2026-10-13，2026-10-13）。
 *
 * 此前 CallerInfo + requirePermission + guarded + body + changeLog 在
 * plugin-console / plugin-panel-core / plugin-flow-core / plugin-dingtalk-bridge
 * 四处近似重复（逐字同构的 guarded/body，字段窄化不一的 CallerInfo）——
 * 单点修复、单点审计收敛于此。principal 的构造仍在 console 鉴权中间件
 * （唯一权威写入点，见 plugin-console/src/index.ts），本模块只消费。
 *
 * 依赖方向：platform-core 不反向依赖业务插件——audit 经最小结构类型注入
 * （调用方 ctx 结构化满足即可）；flow-core 等未注入 audit 的插件不得调用
 * changeLog（构造时缺 audit 则 changeLog 快速失败，防静默丢审计）。
 */
import type { HttpExchange, HttpHandler, RouteAuthDecl } from './http.ts'

/** 调用方身份（console 鉴权中间件写入 exchange.principal 的完整结构） */
export interface CallerInfo {
  kind: 'human' | 'machine'
  principalId: string
  userId?: string
  /** machine 专属：凭证关联资源（refType=agent 时 modelgw 等调用以 agent:<refId> 为计量主体）。 */
  refType?: string
  refId?: string
  name: string
  permissions: string[]
  actChain: Array<{ name: string; type: string }>
}

/** 最小结构宿主：业务插件的 ctx 均结构化满足（不引入对具体服务的类型依赖） */
export interface RestGateHost {
  httpServer: { register(method: string, pattern: string, handler: HttpHandler, auth?: RouteAuthDecl): unknown }
  platformBus: { emit(event: string, payload: unknown): unknown }
  audit?: { record(entry: Record<string, unknown>): unknown }
}

export interface RestGate {
  /** 取调用方身份（principal 由 console 鉴权中间件先行写入） */
  caller(exchange: HttpExchange): CallerInfo
  /** 权限判定：缺权限 403 + audit.authz.denied 留痕（RBAC 探针的判定面） */
  requirePermission(exchange: HttpExchange, point: string): boolean
  /** 注册权限保护路由（H5：声明经 register 自动汇入路由×权限矩阵） */
  guarded(method: string, path: string, permission: string, handler: (exchange: HttpExchange) => unknown | Promise<unknown>): void
  /** 请求体解析（宽松转换） */
  body<T extends Record<string, any>>(exchange: HttpExchange): T
  /** 变更审计留痕（要求宿主注入 audit，缺审计时快速失败） */
  changeLog(exchange: HttpExchange, action: string, resourceType: string, resourceId: string, resourceName: string, detail?: string): void
  /** 审计主体 id（人类取 userId，机器取 principalId） */
  actorOf(exchange: HttpExchange): string
}

export function createRestGate(ctx: RestGateHost): RestGate {
  const caller = (exchange: HttpExchange): CallerInfo => exchange.principal as CallerInfo

  const requirePermission = (exchange: HttpExchange, point: string): boolean => {
    const info = caller(exchange)
    if (info.permissions.includes('*') || info.permissions.includes(point)) return true
    ctx.platformBus.emit('audit.authz.denied', {
      actorId: info.userId ?? info.principalId,
      actorName: info.name,
      point,
      path: exchange.path,
    })
    exchange.fail(403, 'FORBIDDEN', `缺少权限点 ${point}，请联系管理员调整角色`, { permission: point })
    return false
  }

  const guarded = (method: string, path: string, permission: string, handler: (exchange: HttpExchange) => unknown | Promise<unknown>): void => {
    ctx.httpServer.register(method, path, async (exchange) => {
      if (!requirePermission(exchange, permission)) return
      try {
        const result = await handler(exchange)
        if (!exchange.res.writableEnded) exchange.ok(result)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        exchange.fail(400, 'BAD_REQUEST', message)
      }
    }, { access: 'guarded', permission })
  }

  const body = <T extends Record<string, any>>(exchange: HttpExchange): T => (exchange.body ?? {}) as T

  const changeLog = (exchange: HttpExchange, action: string, resourceType: string, resourceId: string, resourceName: string, detail = ''): void => {
    if (!ctx.audit) throw new Error('changeLog 需要宿主注入 audit 服务（本插件未注入，禁止静默丢弃审计）')
    const info = caller(exchange)
    ctx.audit.record({
      type: 'change',
      actorType: info.kind === 'human' ? 'human' : 'machine',
      actorId: info.userId ?? info.principalId,
      actorName: info.name,
      action,
      resourceType,
      resourceId,
      resourceName,
      result: 'ok',
      detail,
      ...(info.actChain.length > 0 ? { actChain: info.actChain } : {}),
    })
  }

  const actorOf = (exchange: HttpExchange): string => {
    const info = caller(exchange)
    return info.userId ?? info.principalId
  }

  return { caller, requirePermission, guarded, body, changeLog, actorOf }
}
