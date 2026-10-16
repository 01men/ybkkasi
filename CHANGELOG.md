# 更新日志

本文件记录对外可感知的版本节点。过程性批次明细（QA 报告、交接单、批次计划）见
`docs/internal/`（不构成对外契约）；早期完整发布说明见 `docs/internal/release-notes-*.md`。

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
