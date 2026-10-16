# 更新日志

本文件记录对外可感知的版本节点。过程性批次明细（QA 报告、交接单、批次计划）见
`docs/internal/`（不构成对外契约）；早期完整发布说明见 `docs/internal/release-notes-*.md`。

## [1.2.0] · 2026-10-16 · 产品化收口批次

**存储（ADR-0001 第一期）**

- 业务集合存储双后端化：默认 JSON（零变化、向后兼容），`PLATFORM_STORAGE=sqlite` 切换
  SQLite 后端——写入即事务（WAL + `synchronous=FULL`）、`uniqueOn` 落引擎级唯一索引、
  常驻内存不随记录数增长；首启自动回填既有 JSON 数据（文件保留为回滚源），
  回退工具 `scripts/storage-export.mjs`、基准工具 `scripts/storage-bench.mjs`（10k 写入 P99 < 1ms）。
  27 个业务插件零改动。selftest 新增 SQLite 后端契约节（双后端对拍/引擎级唯一/回填幂等/
  平台级 kill -9 零丢失），总计 1450 项断言全绿。

**分发与叙事**

- GitHub topics 增补 `dsh-plugin` 等六项（dsh 生态官方发现机制）；仓库描述改为一句价值陈述。
- README 整体重写（684 → 180 行）：价值前置第一屏（给已经跑 dsh 的团队的企业管控台）、
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
