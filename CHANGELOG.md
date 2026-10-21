# 更新日志

本文件记录对外可感知的版本节点。过程性批次明细（QA 报告、交接单、批次计划）见
`docs/internal/`（不构成对外契约）；早期完整发布说明见 `docs/internal/release-notes-*.md`。

## [1.3.1] · 2026-10-21 · A2A/UHP 复测整改（QA P1×1 + P2×6，含 1 项「声称已修」实为空操作的回退修复）

**外部集成闭环（P1-01，对外部第三方 Agent 开放的前置阻断项）**

- `refType=external` 机器凭证此前可成功派活，但 `tasks/get` 恒 `-32003`、`tasks/list` 恒空、
  `tasks/cancel` 无法取消、事件流 403——外部集成在「派活之后」全部断裂。根因：`getTask`/
  `listTasks` 的组织判定先于归属判定，而 external 凭证没有组织归属，归属短路永远不可达。
- 修复：**归属优先于组织收敛**——任务发起方本人恒定可见自己的任务；组织隔离（Q-4）只约束
  非发起方的治理读。内部 `refType=agent` 行为不变，跨组织隔离用例零回归。

**治理第 2 项 permit 覆盖真实生效（P2-01，上一批声称已修实为空操作）**

- 静态根因：`plugin-a2a` 的 `inject` 缺 `workforceIdentity` → cordis Service 代理读未注入键
  抛错 → 被 `governanceCheck` 的 `catch` 吞掉「按 legacy 放行」，受管员工离岗后仍可接单。
- 修复：补 `inject` 声明；把「探测 `resolver.store` 内部结构」改为契约方法
  **`workforceIdentity.inspectAgent()`**（三段判定：未纳管 / 已纳管但 permit 失效 / permit
  生效），脆弱耦合一并消除。受管但失效 → `PERMIT_NOT_EFFECTIVE`（fail-closed），
  恢复任用后可再次放行（不是死锁）。

**UHP 协议面口径统一**

- **P2-02**：`GET /v1/uhp` 改规范裸体（与 Agent Card well-known 同口径），外部 UHP 客户端
  无需再剥平台 `{ok,data}` 信封；CLI 的宽松解析保留为旧实例升级窗口兼容。
- **P2-04**：任务绑定注入变体矩阵（`metadata.ybk_a2a_task_id` / 顶层 `task_id` / 顶层
  `taskId`）统一 `400 TASK_BINDING_FORBIDDEN` + 专项审计 `uhp.invoke.task_binding_denied`
  （此前顶层变体静默丢弃，注入尝试不可观测）。
- **P2-03**：外部直调 `stream=true` 的 SSE 此前只下发 `response.created` 后悬挂（订阅器监听
  的 `a2a.task.progress` 只对平台派发记录发出）。新增记录级事件 **`uhp.response.progress`**
  （所有来源统一发出、不驱动 A2A 状态机，故不扩大任务绑定闸门攻击面），SSE 改订阅该事件并
  补「订阅后二次查终态」堵住竞态。

**前端完整性**

- **P2-05**：a2a 页三语补齐（en-US / ja-JP 各 7 条：运行时/取消/删除/`{n} ms`/步数预算/
  UHP 执行记录/`{n} 小时`），并顺带补齐 approvals/skills/iam-helpers 既有缺口；新增门禁
  `npm run lint:i18n`（**文件级 ≥95%** + 模板占位符一致性，防「整体达标但新页面残缺」）。
- **P2-06**：任务抽屉接入任务 SSE（`/v1/a2a/tasks/:id/events`，快照/进度/终态帧），经
  `realtime.js` 统一封装（SSE 优先、失败/无令牌降级 2s 轮询）；`realtime.js` 新增
  `eventNames` 具名事件支持（EventSource 的 `onmessage` 只收无命名事件）。
- 修复 a2a 目录页在无 `Option` 全局的环境（jsdom/SSR/门禁）下抛错；`page-smoke` 补 A2A
  五 tab 用例（此前新增页面零门禁覆盖，31 → 36 用例）。

**回归护栏（selftest 1552/1552）**

- 新增：external 凭证「派活→get→list→cancel→SSE」五段闭环；受管态（绑定无任用）→
  `PERMIT_NOT_EFFECTIVE` + 恢复任用后放行；注入变体矩阵三条路径；UHP 直调 SSE 闭合；
  `/v1/uhp` 裸体断言。
- 文档同步：《协议键中文对照总表》§3.4 permit 行改为实况口径、§六补「规范裸体例外」、
  事件清点口径按实际 93 条重算；`plugin-a2a` / `plugin-uhp` 的 `plugin.yaml` 补依赖声明
  （a2a→workforce、uhp→agent），`manifest/events.yaml` 登记 `uhp.response.progress`。
- 测试基建：selftest 的 6 个子实例（基线口令/workforce/灰度/演示/sqlite kill -9/CORS 精确来源）
  由固定端口改为内核分配空闲端口（`SELFTEST_PIN_PORTS=1` 可钉死复现），根治 QA 两次踩中的
  「并行实例占用固定端口 → 假失败」；`page-smoke` 的 P04 断言由 `.card`（依赖热力图数据）
  改为 `.res-card`（技能卡真实类名），消除数据依赖导致的随机红绿。
- CI：`quality-gate` 增 `lint:i18n` 与 `realtime.test.mjs` 两步。

> 复测缺陷对账：`docs/a2a-uhp-retest-fix-20261021.md`（逐项「缺陷→根因→修复→护栏」）。

## [1.3.0] · 2026-10-20 · A2A/UHP 验收缺陷整改批次（QA P0×1 + P1×9 + P2×24）

**安全整改（上线前阻断项）**

- **P0 任务劫持封堵（四层防御）**：外部 `uhp.invoke` 凭证此前可借 `metadata.ybk_a2a_task_id`
  劫持任意 A2A 任务（绕过人在环审批、伪造交付物、审计栽赃）。修复：协议面拒绝外部任务绑定
  （`400 TASK_BINDING_FORBIDDEN` + 专项审计）、服务层 `dispatchedByPlatform` fail-closed、
  进度回传仅认平台派发记录（外部直调永不驱动 A2A 状态机）、A2A 侧 responseId 配对校验 +
  审计主体改记真实调用方。selftest 新增「A2A/UHP 安全护栏」分节复刻攻击路径回归。
- **越权取消封堵**：`tasks/cancel` 改严格所有权判定（此前只读治理权限点可取消他人任务），
  JSON-RPC 保留码 `-32003` 分流归属拒绝。
- **UHP 执行记录归属**：读/取消仅属主可用（非属主按 404 回应，不泄露 id 存在性）。
- **组织隔离**：A2A 目录/任务/履约/巡检与 UHP harness/执行记录全面接入 R11 组织子树口径
  （此前下级组织持治理读权限即可读全平台任务明文）。
- **正文脱敏**：`a2a.directory.read` 收敛为元数据视图，任务正文/交付物内容/协商要约需发起方
  本人、验收员或平台管理员（`contentRedacted` 标记）。
- **验收职责分离**：任务发起人不可验收自己发起的任务（403）。

**契约与身份链**

- OBO 身份链打通：Agent 凭证默认 scope 补 `agent.a2a.invoke`（+存量迁移）；令牌 act 链的
  真实发起人写入任务与审计；`ybk_on_behalf_user` 外部自述不再采信（须校验可代表关系）。
- UHP 寻址修复：发现面公布的 `harness/<id>` 可直接调用（此前必然 404，selftest 曾把实现细节
  当契约）。
- 协议同构：`message/stream` 与 `message/send` 统一返回 JSON-RPC Task，流式由专用 SSE 端点
  承载（卡片已声明地址）。
- Agent Card 升级为规范裸体（不再包 `{ok,data}` 信封）并补齐自描述：事件地址、所需权限点、
  协议版本与方法面、计量双主体口径。
- `mode` 台账保真（矩阵拒绝不再误记 single_turn）、幂等键两层统一（含 attempt）、调用方
  `contextId` 透传（同链多 Task 归集可用）、permit 覆盖真实判定（`PERMIT_NOT_EFFECTIVE`）、
  会话续接继承 session_id 并回填上一轮回答、协作链 Top 确定性排序、UHP 审计带 responseId、
  `/v1` 与 SSE 拒绝路径审计留痕、SSE 错误码规范分流（401/403/404）。
- 治理拒绝原因码 6 条补录《协议键中文对照总表》§3.4（含 `code:` 形态清点命令）。

**产品数字与前端/CLI 补齐**

- 加载屏权限点数纠正为后端真实值 **92**（84→85→94 三次漂移的根因是无门禁——新增 selftest
  「产品数字与装配一致性」分节把三数与后端绑定）；`/api/platform/info` 插件清单改取实际
  装配树（此前写死 18 项）。
- 控制台 A2A 页新增「审批规则」「UHP 执行」两个 tab 与协作链成本卡（后端 27 端点的前端
  覆盖率 22% → 治理动作全入口）；新增「发起协作」「取消任务」入口；长任务抽屉 2s 轮询；
  无权限验收文案不再误导；a2a.js 面向用户文案 en-US/ja-JP 各补 ~190 条（22% → 全覆盖）。
- dshctl CLI：新增 `a2a`（12 动作）/`uhp`（5 动作）子命令；修复存量 6 缺陷（agent topology、
  mcp get 括号错位、group list、全局选项前置、approval decide `--confirmed`、mcp invoke
  denied 退出码）与 `--help`；`credential rotate --output json` 纯净输出。

> 修复对账清单：`docs/contract-c3-agent-a2a-v2-fix-batch-20261020.md`（逐项「缺陷→根因→修复
> →回归护栏」，供验收复测）。

## [1.3.0] · 2026-10-20 · 企业数字员工内网协作面（A2A/UHP，contract-c3 升版 v2）

**A2A 协作平面（新插件 plugin-a2a）**

- **Agent Card**：在线员工自动投影生成签名卡（技能 = 已上架 Skill + subjects 命中的 MCP
  权限组，声明不大于授权、不接受自由填写）；JWS（EdDSA/Ed25519）签名复用平台验签基建，
  私钥落盘 0600、目录卡附公钥，先验签后采信；`/.well-known/agent-card.json`（平台目录）与
  `/.well-known/agents/:slug/agent-card.json`（单员工）免鉴权发现。
- **跨运行时目录**：`GET /api/a2a/directory` 按技能/密级/运行时/自治级别检索在线员工——
  补齐 contract-c3 v1 诚实缺席的 discovery（内网形态）。
- **Task 生命周期**：JSON-RPC 主端点 `POST /api/agents/:slug/a2a`（message/send·stream、
  tasks/get·list·cancel，复用 v1 权限点 `agent.a2a.invoke`），八态机
  （submitted/working/input_required/auth_required/completed/failed/canceled/rejected）；
  任务 SSE 事件流（`/v1/a2a/tasks/:taskId/events?token=`，fail-closed）。v1 点名直调端点
  原样保留，行为不变。
- **治理检查五项**：权限点 / 在线·非冻结·permit 覆盖 / 密级天花板（越级拒绝）/ 预算配额
  （modelgw 熔断口径预检）/ 敏感审批规则（命中 → `auth_required` 挂审批中心工单，通过后
  幂等恢复执行、驳回 → rejected）。
- **A0-A3 协商引擎**：纯函数矩阵（仅约束数字员工互调；人类调用方按目标级别直判）；
  A3×A3 要约-还价（上限 3 轮，超限 rejected），协商全程审计。
- **验收与履约**：人工交付验收（仅 completed、必填理由——不轻信自报）；履约视图
  （接收/完成率/中断/验收通过率/耗时 P95/tokens）；声明-授权一致性巡检（例行 + 手动，
  捕获幽灵 Skill/权限组/harness 引用与模型离线漂移并告警）。

**UHP 执行驱动（新插件 plugin-uhp）**

- `GET /v1/uhp` 能力发现（免鉴权；版本锁定 2026-08-11，conformance=core 诚实声明，
  文件输入输出未做不宣称）。
- `POST /v1/uhp/responses` 任务面（Responses 兼容子集 + ybk metadata 扩展）：自校验
  Bearer + `uhp.invoke`；幂等键请求头（同键重放返回原 response）；`previous_response_id`
  会话续接；取消联动；`stream=true` SSE。请求级 `tools` 注入一律接受不生效并记
  `ignored_fields`（越权原语封堵）。
- configured harness 注册表（`/api/uhp/harnesses`，uhp.read/uhp.admin）：模型渠道、密级
  天花板、步数/时间预算、工具白名单投影；Agent `attrs.uhpHarnessRef` 显式引用，缺省按
  attrs 临时投影。内置 dsh harness = 单步真实模型执行（modelgw 分级路由 + 预算熔断），
  不虚构工具执行循环（诚实边界）。

**底座与治理**

- plugin-agent：schema 增「协作属性」字段组（a2aDataClassCeiling / uhpHarnessRef /
  uhpSessionPolicy，additive，存量缺省兼容——contract-c3 v2 红线 2 登记）。
- plugin-usage：usage_events 增 `context_id` 列（D3 同款幂等迁移）；协作链聚合
  `GET /api/usage/collaborations`——同一 A2A contextId 多 Task 计量按链归集「一次协作总成本」。
- 治理闭环：每次协作一条审计链（治理决策 + invoke 双分支 + 审批工单 + 验收结论）；
  `agent.a2a.invoked` 事件 additive 升级；新增权限点 6 个（a2a.directory.read / a2a.task.accept
  / a2a.admin / uhp.read / uhp.admin / uhp.invoke），全部进 RBAC 越权探针矩阵。
- 控制台：新增「A2A 协作」页（协作目录 / 任务追踪 / 履约视图三区块，三语导航）；
  演示只读白名单有意增补 `a2a.directory.read`、`uhp.read`（写/验收/执行类不进白名单）。
- 契约与文档：`docs/contract-c3-agent-a2a-v2-release-notes.md`（升版发布说明）与
  `docs/a2a-uhp-implementation.md`（施工对账）；协议键中文对照总表增记 4 事件 + 6 权限点
  + 3 环境变量。
- 质量：selftest 新增「A2A/UHP 协作面」分节约 30 项断言（卡片验签/治理拒绝/审批恢复/协商
  accept·counter·超限/取消不计量/幂等重放/巡检漂移/验收/履约/SSE fail-closed），全量
  1523/1523 通过；boot-order / manifests / demo-route-audit 三门禁绿。

## [1.3.0] · 2026-10-16 · 启动健壮性与交付卫生批次（EXEC-CHECKLIST 整改收口）

**启动健壮性（W2 · P0）**

- 新增启动探针 `platform-core/boot-probe.ts`：`assertSingleRoot` 双实例守卫 + `probeTree`
  插件树体检 + `formatTreeHealth` 可读报告。`boot-all` 两道接线——首个插件装配前查双实例、
  全部装配后体检必需服务（opsStorage/platformBus/httpServer/iam/authn/usage/audit），
  不健康即**拒绝启动**（打印卡死插件与等待的 inject 键，取代旧日「沉默 PENDING 零报错」）。
- FAILED fiber 引入「良性败者」豁免：声明 provide 已被其他 ACTIVE fiber 接管的 husk
  （panel-core/flow-core 既有双注册习语产物）只入诊断清单不拦启动；真故障照拦。
- 演练与断言：`scripts/boot-drill.mjs` 五场景（正常/双实例不可达/文案可读/污染清理/真故障）；
  selftest 新增「启动健壮性探针」节 6 条断言。

**版本锁定与 CI 双轨（W3）**

- `@deepseek-ai/cordis` 去 caret 精确锁定 **4.0.4**（`npm ci` 任意机器解析一致）。
- CI 双轨 `quality-gate.yml`：`gate`（lint 三门禁 + selftest + 契约测试，必须绿，全程不碰
  dsh）与 `dsh-compat`（仅手动触发、`continue-on-error`、matrix rc.7/rc.9，实验轨允许红）。
- 新增 `scripts/check-dsh-compat.mjs`：`dsh.compatibility.dshReleases` 从此有唯一机器验证
  来源——版本确认/实体来源确认/cordis 单实例覆盖/装配 probeTree + 无重复注册/回写记录
  五断言；环境不可达时输出「兼容性未验证」并以退出码 2 结束，绝不谎报兼容。
  rc.7 本机实测五项全过。

**存储收尾（W4 · ADR-0001 第二期落地）**

- sqlite 后端默认豁免名单 `DEFAULT_JSON_KEEP`（9 项）：低频配置型集合（resource:dependencies /
  update:state / oidc-keys / market:* / platform:bootstrap / agent·app·iam migrations /
  iam:groupSnapshots）默认保留 JSON，与 ADR 第三批结论对齐；`PLATFORM_STORAGE_JSON_KEEP`
  显式设置时完全覆盖默认。
- JSON→SQL 回填加**事务内对账**：逐集合条数 + 逐条规范化 SHA-256 哈希，不一致整体回滚、
  启动响亮失败（消息含集合名与差异数）。
- sqlite 后端 iam「一人一号」端到端攻击演练 7 断言：二次绑定引擎拒绝、跨 corpId 放行、
  同 tick 竞态恰一条成功、绕层直插被拒、refresh 轮转、吊销经 onChange 可靠广播、吊销后
  refresh 被拒。
- ADR 口径双侧回写：压测正式改「串行 10k 写 P99<50ms」（node:sqlite 同步 API 单写者，
  不做多进程压测的论证在册）；`PLATFORM_STORAGE_MIGRATED` 条款废止（后端级开关 +
  JSON_KEEP 名单即回滚机制）。

**dsh 耦合面收窄（W5）**

- 窄端口 `platform-core/host-bridge.ts`：plugin-dsh-bridge（ctx.webServer 七调用点）与
  plugin-rq-card client（ctx.slots/locale）全部 dsh API 调用收进 adapter，dsh 特有类型
  不进端口签名，升级改动面锁死在 adapter 内；mock 契约测试 42 条
  （`npm run test:contracts`），dsh 升级只需重跑该组。inject 键与外部行为零变化。

**交付卫生**

- 夹带改动专项（QA 2026-10-16 §3）：plugin-mcp `mcpToolRisks` 服务与 `mcp.risk.admin`
  权限确认为误删，按方案 A 恢复；根修 `scripts/gen-manifests.mjs`——risk-registry 增强面
  与 console `/locales/:locale` 声明补进生成器数据源并支持权限注释，**再跑生成器与仓库
  逐字节一致**（此前重跑会反复冲掉手工增强面，即夹带漂移的源头）。
- selftest 版本期望动态化（读根 package.json，bump 不再联动测试；修复 1.2.0 批次
  1448/1450 的 2 项红）。
- 品牌卫生清零：llms.txt 与 docs/i18n 共 88 处 RongQi → YuanBingKe；部署文档 4 处旧品牌
  「衡 ·」→ 元冰可；根目录品牌指南迁移 `docs/internal/`。
- CONTRIBUTING 标注已验证 Node 版本（v24.21.0 实测）；中英部署文档补齐双形态
  experimental 声明。
- 门禁：selftest **1467/1467 全绿**（1450 基线 + W2 六条 + 存储收尾十一条）；
  lint 三门禁 0 错误；契约测试 42/42；boot-drill 五场景全绿；check-dsh-compat rc.7 全过。

## [1.2.0] · 2026-10-16 · 产品化收口批次

**存储（ADR-0001 第一期）**

- 业务集合存储双后端化：默认 JSON（零变化、向后兼容），`PLATFORM_STORAGE=sqlite` 切换
  SQLite 后端——写入即事务（WAL + `synchronous=FULL`）、`uniqueOn` 落引擎级唯一索引、
  常驻内存不随记录数增长；首启自动回填既有 JSON 数据（文件保留为回滚源），
  回退工具 `scripts/storage-export.mjs`、基准工具 `scripts/storage-bench.mjs`（10k 写入 P99 < 1ms）。
  27 个业务插件零改动。selftest 新增 SQLite 后端契约节（双后端对拍/引擎级唯一/回填幂等/
  平台级 kill -9 零丢失），总计 1450 项断言（当批门禁遗留 2 项版本期望红，
  已于 1.3.0 动态化修复回绿）。

**分发与叙事**

- GitHub topics 增补 `dsh-plugin` 等六项（dsh 生态官方发现机制）；仓库描述改为一句价值陈述。
- README 整体重写（684 → 200 行）：价值前置第一屏（给已经跑 dsh 的团队的企业管控台）、
  「与市面方案的关系」竞品边界表、「诚实边界」节前置并更新存储双形态口径。
- 文档收敛：docs/ 根只留对外文档（README / 架构 / 部署与接入指南 / 契约 7 份 / i18n）；
  QA 报告、交接单、重构基线、发布说明等 67 个过程物料外移 `docs/internal/`。
- 新增 `docs/ARCHITECTURE.md`（架构稳定入口）、`CONTRIBUTING.md`、本 `CHANGELOG.md`、
  `docs/adr-0001-storage-migration.md`（含落地记录）。

## [1.1.0] · 2026-10-15/16 · 全球化与数字员工二期

- 运行时表现层内置 zh-CN（默认）/ en-US / ja-JP 三语实时切换（协议层 ASCII 键不改写）；
  语言切换不生效双缺陷收口。
- 数字员工二期 W 批次：MCP 工具可信风险登记流程、REST/Panel 接入面等价收敛、
  usage 代报白名单、workforce.admin 运维面、灰度交付包。
- 执行中枢 plugin-exec-hub 整体交付：目标树、30s 心跳循环、执行锁 CAS、例行调度、
  Agent 组织化、预算联动冻结 + L4 解冻。
- 审查反馈整改批次：组织隔离 fail-closed、MCP 工具权限最小化（存量工具逐一补声明）、
  模型渠道降级链预算守卫。

## [1.0.0] · 2026-09-09 → 2026-10-14 · 基线到生态

- M0 基线：IAM / 统一认证（Authn + OIDC Provider）/ MCP 部署服务 / Skill 市场 / Agent 本体 /
  AI 应用 / 用量计量 / 模型网关 / 审计告警九域；合规收敛（废止计费转售，零价快照口径）。
- M1-1 契约冻结 v1 齐套（J1-J4）；IAW 流程编排批次（flow-core）；M2 优化批次。
- 生态化演进（v1.2 设计）：连接器纳管、NAS 存储、插件市场（契约五面 + Ed25519 验签）、
  数字员工（workforce）、执行中枢、钉钉桥接、dsh 宿主双形态。
- 全局重构 REFACTOR-2026-10-13 七项收敛 + 品牌重塑元冰可 + 全站移动端适配
  + Kimi CIO 仪表盘设计适配（暖纸 + 深青蓝设计系统）。

[1.2.0]: https://github.com/01men/ybkkasi
[1.1.0]: https://github.com/01men/ybkkasi
[1.0.0]: https://github.com/01men/ybkkasi
