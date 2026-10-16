/**
 * 浏览器半：slot 注册 + 降级探测（WP-06 交付物 1/3，spike §4.3 伪代码落地）。
 *
 * 【注入面】两条 slot：
 *   ① 四态执行卡：为元冰可工具名（RQ_TOOL_NAMES）逐一注册 `tool.call.toolview`
 *      键位条目——加法式，未列名的工具回落 dsh 的 GenericToolCard；
 *   ② 👍/👎 反馈条：`conversation.chat.assistant-actions` list 条目
 *      （id 'rq-feedback'，与 dsh 自带 'feedback' 并存，order 20 排其后）。
 *
 * 【W5 耦合面收窄】本文件对宿主的全部依赖经 createClientHostPort 收窄为
 * HostClientPort 窄端口（platform-core/src/host-bridge.ts 声明契约）；dsh
 * 三包类型只进 host-port.ts 单点——dsh 升级 API 漂移时改 adapter + 重跑
 * 契约测试（tests/host-bridge.contract.mjs），插件体不动。
 *
 * 【降级预案（spike §5 的 1-4 条，本 apply 逐条落实）】
 *   1. 声明依赖全部走 ctx.slots.inject：目标槽未声明时回调永不执行、注入保持
 *      惰性——上游改名/删槽 = 卡片静默消失，不崩宿主（机制天然兜底）；
 *   2. 显式探测：apply 内 specDynamic(name) 存在性检查 + 回调执行时
 *      校验 spec.kind；任一不满足 → 置降级标志（DEGRADED 数组）；
 *   3. boot 面探测：window.__DSH_BOOT__ / bundle 404 属于「机制整体不存在」，
 *      该场景下本 bundle 根本不会执行，无需代码面处理（见 spike §5 第 3 条）；
 *   4. apply 全体 try/catch：任何抛错吞掉并置降级标志；slot 边界另有
 *      reportEntryError 让位机制（单卡崩溃只让出单元格）——双保险；
 *   5.（兜底在宿主工具侧）工具结果文本始终携带 markdown 摘要 + /rq 链接，
 *      见 src/index.ts 的 summarizeForToolResult 契约；
 *   6. 降级标志在场时经 shell.overlay 挂「卡片插件未生效」角标（槽在才挂）。
 * @module @dsh-ops/plugin-rq-card/client
 */

import { createElement } from 'react'
import type { ClientContext, SessionId } from './host-port.ts'
import { createClientHostPort } from './host-port.ts'
import type { HostClientPort } from '../../../platform-core/src/host-bridge.ts'
import { deriveExecutionState } from './state.ts'
import { RqFeedbackController } from './controller.ts'
import { ExecutionCard } from './ExecutionCard.tsx'
import { RqFeedback } from './RqFeedback.tsx'
import type { RqFeedbackInjected, RqToolviewInjected } from './slots.ts'
import { en, ja, zh } from './locales.ts'
import { ensureStyles } from './styles.ts'
import {
  DEGRADED_BADGE_ID, FEEDBACK_ENTRY_ID, SLOT_ASSISTANT_ACTIONS, SLOT_OVERLAY,
  SLOT_TOOLVIEW, TOOLVIEW_ENTRY_PREFIX,
} from '../wire.ts'

export type { ExecutionState, ExecutionStateInput, BlockedReason } from './state.ts'
export type { RqFeedbackView, RqToolviewInjected, RqFeedbackInjected } from './slots.ts'
export { deriveExecutionState } from './state.ts'

/** 词典命名空间（locales.ts 的 LocaleNamespaceMap 座位名）。 */
const NS = 'rq-card'

/** 插件 id（与 package.json name、boot 图行 id 一致）。 */
const PLUGIN_ID = '@dsh-ops/plugin-rq-card'

/**
 * 元冰可工具名名录（各插件包 tools.ts 的登记清单，截至 WP-06）。
 * 四态执行卡为这些工具注册键位；新增工具不自动获得卡片（回落 GenericToolCard），
 * 在此追加一行即可覆盖。核心主角是 mcp_invoke（资产调运四态主战场）。
 */
const RQ_TOOL_NAMES: readonly string[] = [
  // 资产调运（四态主战场）
  'mcp_invoke', 'mcp_service_list', 'mcp_health_check', 'mcp_metrics', 'mcp_deploy', 'mcp_offline',
  // NAS（文件/知识目录）
  'nas_list', 'nas_get', 'nas_health_check', 'nas_fs_list', 'nas_fs_search', 'nas_fs_upload', 'nas_fs_mkdir', 'nas_fs_delete',
  // 技能
  'skill_search', 'skill_submit', 'skill_approve', 'skill_publish', 'skill_install', 'skill_deprecate',
  // 应用
  'app_list', 'app_metrics', 'app_cost_breakdown', 'app_topology', 'app_metrics_report',
  // Agent
  'agent_list', 'agent_get', 'agent_bind_user', 'agent_metrics', 'agent_metrics_report', 'agent_offline',
  // 身份与访问
  'iam_user_list', 'iam_user_create', 'iam_user_freeze', 'iam_user_reset_password', 'iam_org_tree',
  'iam_org_create', 'iam_org_update', 'iam_role_list', 'iam_sync_run', 'iam_conflict_list',
  'authn_token_issue', 'authn_token_list', 'authn_token_revoke', 'authn_credential_create',
  'authn_credential_rotate', 'authn_credential_scopes',
  // 连接器 / 模型 / 计费 / 审计 / 市场 / 审批
  'connector_catalog_search', 'connector_connection_list', 'connector_execute', 'connector_run_list', 'connector_perm_group_list',
  'model_list', 'billing_wallet_balance', 'audit_logs', 'audit_alerts_list', 'audit_alerts_read_all',
  'audit_cost_report', 'market_plugin_list', 'approval_decide',
]

/** 降级原因台账（spike §5 第 2/4 条的「降级标志」）。 */
const DEGRADED: string[] = []

/** 记一条降级原因（console 留痕，便于运维发现；绝不抛出）。 */
function markDegraded(what: string, error?: unknown): void {
  DEGRADED.push(what)
  console.warn(`[rq-card] degraded (${what}):`, error ?? 'target slot unavailable')
}

/** 安全执行一段注入动作；抛错吞掉并记降级（spike §5 第 4 条）。 */
function safely(what: string, action: () => void): void {
  try {
    action()
  } catch (error) {
    markDegraded(what, error)
  }
}

/** specDynamic 探测（缺席/抛错/非对象已由 adapter 折叠为 undefined）。 */
function probeSpec(host: HostClientPort, slot: string): { kind?: string } | undefined {
  return host.slots.specDynamic?.(slot)
}

/** 必需服务：slot 注册表 + 词典。 */
export const inject = ['slots', 'locale']

/**
 * 客户端插件体入口（dsh client loader 契约：inject + apply(ctx)）。
 * @param ctx - 客户端根 context。
 */
export function apply(ctx: ClientContext): void {
  applyViaPort(createClientHostPort(ctx))
}

/**
 * 插件体（只依赖窄端口；契约测试经本入口 + mock 端口直跑）。
 * @param host - 宿主桥窄端口（ctx.slots / ctx.locale / ctx.effect 的最小收窄面）。
 */
export function applyViaPort(host: HostClientPort): void {
  // 样式表先落（幂等；无 document 环境自动跳过）。
  safely('styles', () => { ensureStyles() })

  // 词典注册。
  safely('locale', () => {
    host.effect(() => host.locale.register(NS, { zh, en, ja }), 'rq-card: dictionaries')
  })

  // ── ① 四态执行卡：显式探测 + 键位注册（spike §5 第 2 条）──
  const toolviewSpec = probeSpec(host, SLOT_TOOLVIEW)
  if (toolviewSpec?.kind !== 'keyed') {
    markDegraded(`${SLOT_TOOLVIEW} spec missing or not keyed`, toolviewSpec)
  } else {
    for (const tool of RQ_TOOL_NAMES) {
      safely(`toolview:${tool}`, () => {
        host.slots.inject(SLOT_TOOLVIEW, () => host.slots.register({
          name: SLOT_TOOLVIEW,
          key: tool,
          id: `${TOOLVIEW_ENTRY_PREFIX}${tool}`,
          locale: NS,
          inject: (): RqToolviewInjected => ({
            // C2 表映射的唯一入口；healthSnapshot 为宿主半后续接线点。
            deriveState: deriveExecutionState,
          }),
        }, ExecutionCard))
      })
    }
  }

  // ── ② 👍/👎 反馈条：list 条目，与 dsh 自带 'feedback' 并存 ──
  const actionsSpec = probeSpec(host, SLOT_ASSISTANT_ACTIONS)
  if (actionsSpec?.kind !== 'list') {
    markDegraded(`${SLOT_ASSISTANT_ACTIONS} spec missing or not list`, actionsSpec)
  } else {
    safely('assistant-actions', () => {
      host.slots.inject(SLOT_ASSISTANT_ACTIONS, () => {
        const controllers = new Map<SessionId, RqFeedbackController>()
        const controllerFor = (sessionId: SessionId): RqFeedbackController => {
          let controller = controllers.get(sessionId)
          if (controller === undefined) {
            controller = new RqFeedbackController()
            controllers.set(sessionId, controller)
          }
          return controller
        }
        const dispose = host.slots.register({
          name: SLOT_ASSISTANT_ACTIONS,
          id: FEEDBACK_ENTRY_ID,
          order: 20,
          locale: NS,
          inject: (sessionId): RqFeedbackInjected => {
            const controller = controllerFor(sessionId as SessionId)
            return {
              hooks: { rqfb: controller },
              rate: (messageId, score, note) => controller.rate(messageId, score, note),
            }
          },
        }, RqFeedback)
        return () => {
          dispose()
          controllers.clear()
        }
      })
    })
  }

  // ── ③ 降级角标：仅当确有降级原因且 shell.overlay 仍在（spike §5 第 6 条）──
  if (DEGRADED.length > 0) {
    const overlaySpec = probeSpec(host, SLOT_OVERLAY)
    if (overlaySpec?.kind === 'list') {
      safely('overlay-badge', () => {
        host.slots.inject(SLOT_OVERLAY, () => host.slots.register({
          name: SLOT_OVERLAY,
          id: DEGRADED_BADGE_ID,
          order: 90,
          locale: NS,
        }, function RqCardDegradedBadge(props?: unknown) {
          // 词典经 locale: NS 座位注入（props.t）；slot 契约未注入 t 时降级中文原文——宁可少译，不抛错。
          const maybeT = (props as { t?: unknown } | undefined)?.t
          const translate = typeof maybeT === 'function'
            ? (maybeT as (key: string) => string)
            : ((key: string) => (zh as Record<string, string>)[key] ?? key)
          // 无其他 props 依赖：任何 slot 契约变化都只会让角标空白，不会抛错。
          // 本文件是 .ts（非 tsx），故用 createElement 而非 JSX 字面量。
          return createElement('span', { className: 'rq-badge' }, translate('badge.degraded'))
        }))
      })
    }
    console.warn(`[rq-card] degraded mode with ${DEGRADED.length} reason(s); markdown fallback remains available`)
  }

  // 【冒烟自证（spike 风险 R8 的首个联调里程碑）】boot 后可在控制台确认：
  //   window.__DSH_BOOT__ 含 { id: '@dsh-ops/plugin-rq-card', ... } 图行，
  //   且本日志出现——两件事齐了，说明「空插件上链」成立。
  console.info('[rq-card] client plugin applied:', PLUGIN_ID)
}
