# 元冰可 · 企业 AI 资源管理平台

> **v1.5.0 · MIT · self-hosted.** One control plane for every MCP server, skill, agent and AI app.

[![MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![selftest](https://img.shields.io/badge/selftest-1621%20green-success)](https://github.com/01men/ybkkasi/actions/workflows/quality-gate.yml)
[![Node](https://img.shields.io/badge/Node-%E2%89%A522.6-339933)]()
[![i18n](https://img.shields.io/badge/i18n-zh--en--ja-blue)]()
[![Demo](https://img.shields.io/badge/demo-demo.ybkkasi.com-FF6B35)](https://demo.ybkkasi.com)

**把散落在企业里的 MCP 服务 / Skill / Agent / AI 应用 / 模型渠道 / SaaS 连接器 / NAS 存储，
统一成一套可管、可算、可审的资产。**

一套身份 · 一套权限 · 一套计量 · 一套审计。**29 个插件包，按需启用。**

> **YBK Enterprise AI Asset Governance** — One control plane for every MCP server, skill,
> agent, and AI app. One identity, one permission model, one metering pipeline, one audit trail.
> Self-hosted, MIT licensed.

**[▶ 免登录在线体验](https://demo.ybkkasi.com)** · **[⬇ 60 秒本地启动](#60-秒跑起来)** · **[📖 文档](docs/ARCHITECTURE.md)**

---

## 你可能正在经历这些

- MCP 服务散在各处，**没人说得清谁在用**
- Agent 拿着一把**万能 token 横冲直撞**
- 模型账单月底出来，**没人说得清哪个部门花的**
- 出了数据问题，**翻遍日志查不到审计记录**

元冰可把这些统一成「资产」，**从注册那一刻起就进入治理轨道**。

---

## 这和 AI Gateway 有什么不同

网关把 MCP 当作「一种要路由的流量」；
元冰可把 MCP / Skill / Agent 当作「**要被管生命周期的资产**」——
有状态机、有审批流、有逐工具最小权限声明、能按部门 / Agent / Skill 三个维度出成本报表。

| 层 | 代表方案 | 元冰可的位置 |
|---|---|---|
| AI/LLM Gateway | LiteLLM · Portkey · Higress · Bifrost | 不竞争，管流量路由 |
| LLMOps 可观测 | Langfuse · LangSmith · Braintrust | 不竞争，互补（我们缺 trace 深度） |
| Agent 构建平台 | Dify · Coze · FastGPT | 不构建，只治理已建成的 |
| **企业 AI 资产治理** | **这是一个刚被验证需求的新品类** | **✅ 这一层** |

---

## 60 秒跑起来

**Docker 一键体验**(推荐——打开即免登只读演示控制台):

```bash
docker compose up -d              # → http://localhost:7300(≤60 秒可访问,见演示数据)
```

`docker compose up` 自带 `DEMO_SEED=1 + DEMO_MODE=1`:首启注入完整演示数据,
访客**不注册不登录**直接浏览真实控制台(权限集为 26 个 `.read` 点白名单,
写操作 403/405,页面顶部有「演示模式 · 只读」横幅)。仅在演示实例开启 `DEMO_MODE`
——它会开放实例全部只读数据面,勿接真实业务数据。

**生产部署**(不带任何 `DEMO_*` 变量,行为与源码部署完全一致):

```bash
docker run -d --name ybkkasi -p 7300:7300 \
  -e ADMIN_PASSWORD='你的强口令' \
  -v ybkkasi-data:/app/data \
  ybkkasi:1.5.0
```

源码部署(要求 Node ≥ 22.6,原生 TypeScript 运行,无构建步骤;`node:sqlite` 为 Node 内置):

```bash
npm install && npm start          # → http://127.0.0.1:7300
```

> Node 22.6–22.17 的类型剥离尚未默认开启(22.18 / 23.6 起才默认):`npm start` / `npm run selftest`
> 等脚本已内置处理(自测会带 flag 自动重启);若绕开脚本直接 `node src/main.ts`,请自行附加
> `--experimental-strip-types`(或写入 `NODE_OPTIONS`)。CI 在 Node 22.14 与 24 双版本轨验证。

生产基线默认:内置角色 + 根组织 + `admin` 账号(**无任何演示业务数据**)。
`admin` 口令取 `ADMIN_PASSWORD` 环境变量;未设置则随机生成并写入 `data/admin-initial-password.txt`。

想先看效果再读文档:

```bash
DEMO_SEED=1 npm start             # 注入演示数据(组织树/账号/MCP/Skill/Agent/应用/28 天历史)
# 演示账号 admin / ops / hr / dev / audit,口令均为 Ybk@2026
# 追加 DEMO_MODE=1 即开启免登只读演示态(同 Docker 体验形态)
```

企业单节点部署建议开启 SQLite 集合后端(数据完整性 / 内存有界,详见「诚实边界」):

```bash
PLATFORM_STORAGE=sqlite npm start # 业务集合切换 SQLite 后端(WAL + 事务,首启自动回填既有 JSON 数据)
```

```bash
npm run selftest                  # 1621 项端到端断言(隔离实例,全绿;含 SQLite 后端契约节)
npm run lint:manifests            # 插件清单五面 YAML 校验
```

要求 **Node ≥ 22.6**(原生 TypeScript 运行,无构建步骤;`node:sqlite` 为 Node 内置,零新增依赖)。
已实测版本线:v24.21.0 与 v22.14.0(CI 双版本轨)。

---

## 它管什么

大多数团队现在的状态是:MCP 服务散在各处没人知道谁在用、Agent 拿着万能 token 横冲直撞、
模型账单月底出来没人说得清哪个部门花的、出了问题查不到审计记录。

元冰可把这些**统一成"资产"**,每类资产共享同一套底座:

| 域            | 插件                                                                                                         | 能力                                                                 |
| ------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **身份**       | `plugin-iam` · `plugin-authn`                                                                              | 组织树 / 角色 / 用户组 / 三方连接器 · 双轨身份 + OIDC Provider + on-behalf-of 链     |
| **资产本体**     | `plugin-resource-core`                                                                                     | 属性 schema + 生命周期状态机 + 依赖图,所有资产类型的共同底座                              |
| **MCP**      | `plugin-mcp`                                                                                               | 部署 / 灰度 / 回滚 / 健康熔断 / 权限组 / 调用网关 / 监控(真实 HTTP JSON-RPC 传输层);服务级数据面 `POST /mcp/services/:slug`(委托令牌 aud 绑定 + 按身份过滤 tools/list)与 Secret Broker 凭证保管、治理属性(ownerEntity/密级/暴露模式),应用经能力绑定挂载 MCP 服务并联动上线门禁 |
| **Skill**    | `plugin-skillhub`                                                                                          | 提交 → 静态扫描 → 两级审批 → 版本化上架                                           |
| **Agent**    | `plugin-agent`                                                                                             | Agent 本体管理(资源底座 + 机器凭证)                                            |
| **AI 应用**    | `plugin-app`                                                                                               | 编排拓扑 + 应用指标 + 成本穿透                                                 |
| **模型渠道**     | `plugin-modelgw`                                                                                           | OpenAI 兼容真实转发 · 分级路由 · 渠道组降级链 · 预算熔断                               |
| **SaaS 连接器** | `plugin-connector`                                                                                         | open-connector sidecar 数据面:Provider 目录 / OAuth 代理 / 凭证保险库 / 双层授权镜像 |
| **NAS 存储**   | `plugin-nas`                                                                                               | MCP 文件网关通道 / 组织位置 RBAC / 签名下载链接 / Skill 包直传                        |
| **计量**       | `plugin-usage`                                                                                             | 唯一计量入口 · schema v1 幂等 / 死信重放 / 价格簿 / 部门·Agent·Skill 三维聚合           |
| **审计**       | `plugin-audit`                                                                                             | 四类审计日志 + 告警规则 + 成本归集 + 审批中心                                        |
| **流程**       | `plugin-flow-core` · `plugin-exec-hub`                                                                     | 事务流编排 / SLA 与甘特 · 目标树、执行锁 CAS、心跳唤醒、例行调度                            |
| **数字员工**     | `plugin-workforce`                                                                                         | 员工档案 → 任用 → permit 授权 → 受控调用 → 交付验收                                |
| **市场**       | `plugin-market`                                                                                            | 第三方与自营插件市场(契约五面 / Ed25519 验签 / L0 运行时)                             |
| **接入层**      | `plugin-console` · `plugin-panel-core` · `plugin-dsh-bridge` · `plugin-rq-card` · `plugin-dingtalk-bridge` | REST 网关 + 控制台 SPA + 部门工作台面板 + 宿主桥 + 会话执行卡 + 钉钉桥接                   |

**这层的独特性**:市面上的 AI Gateway(LiteLLM / Higress / Portkey)把 MCP 当作**一种要路由的流量**;
元冰可把 MCP / Skill / Agent 当作**要被管生命周期的资产**——有状态机、有审批流、有逐工具最小权限声明、
能按部门 / Agent / Skill 三个维度出 token 报表。这两个是不同的层,不是一个替代关系。

---

## 架构:一切皆插件

运行中的平台就是一棵 [cordis](https://github.com/cordiverse/cordis) 插件树
(与 DeepSeek Harness 同一插件框架)。每个业务域 = 一个插件包,独立声明依赖 / 权限点 / 事件,可独立启停。
稳定入口见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

```
基础层   platform-core      存储 · 事件总线 · HTTP · ToolRuntime-lite · YAML · 签名 · 场景图谱
底座     resource-core      资源本体:schema + 生命周期状态机 + 依赖图
业务域   iam · authn · usage · audit · market · connector · mcp · nas · skillhub
         agent · app · modelgw · connect · update · portal · flow-core · exec-hub · workforce
接入层   console · panel-core · dsh-bridge · rq-card · dingtalk-bridge
```

**插件协作铁律**:状态变更必发事件;跨插件联动只走事件总线或扩展点(`ctx.platformBus`),
禁止直连对方数据。例如 `iam.user.frozen → authn 吊销全部令牌`、`mcp.unhealthy → 熔断 + 审计`。

### 一份插件代码,两种宿主

- **独立宿主**(默认,承诺 SLA 的形态)——`npm start`(即 `node --experimental-strip-types src/main.ts`)启动完整平台:控制台 + API + 工具。
- **完整 dsh 运行时**(experimental)——同一批插件挂进 `dsh web`,此时平台注册的运维工具
  **直接对模型可见可调用**:在会话里问「列出所有 MCP 服务和健康状态」,模型会调
  `mcp_service_list`,而不是静态作答。这是"Agent 自运维"形态。

```bash
# 安装形态(推荐发布用)——copy 安装,根 dependencies 会把 @dsh-ops/plugin-rq-card 一并装入 profile
dsh plugin --profile web add github:01men/ybkkasi
# 本地目录同理请用 file: 前缀(copy 语义,依赖自动就位):
#   dsh plugin --profile web add file:/path/to/ybkkasi

# 源码检出模式(本地开发)——需要把 cordis 指向 dsh 源码树的 vendor/cordis,
# 保证插件与宿主加载同一个 cordis 实例(两份实例会导致 ctx.plugin() 静默失效)
dsh web --patch <本项目绝对路径>/cordis.yml
```

> ⚠️ 若用 **link: 安装**(`dsh plugin --profile web add /path/to/checkout`,不带 `file:` 前缀),
> pnpm 的 link 语义**不会**安装被链接包的依赖——`@dsh-ops/plugin-rq-card`(client-modules 按
> 裸包名从 profile 根解析)需要额外补一条链接,否则该条目启动时报 `ERR_MODULE_NOT_FOUND`:
>
> ```bash
> dsh plugin --profile web add /path/to/ybkkasi/packages/plugin-rq-card
> ```
>
> 另:浏览器半 bundle(`packages/plugin-rq-card/lib/client.js`)已随仓库入库,无需现场构建;
> 若源码改动过 rq-card 前端,重跑 `node packages/plugin-rq-card/build.mjs`。

> ⚠️ 宿主形态依赖 dsh `>=0.1.0-rc.7 <0.2.0`。dsh 目前仍是 developer preview,
> 官方明示会有破坏性变更。**独立宿主形态不依赖 dsh 版本稳定性**,是最稳的部署方式。
> 详见 [`docs/host-features-ops-notes.md`](docs/host-features-ops-notes.md)。

---

## 接口面

**CLI**(`dshctl.mjs`,16 组命令,机器可读优先):

```
org / user / role / group      组织与账号
token / credential             令牌与机器凭证
plugin / skill / mcp           资产:市场 / Skill / MCP 服务
connector / nas                SaaS 连接器 / NAS 存储
usage / connect / update       计量 / 远程 dsh 接入 / 平台自更新
sync / conflict / help         三方同步 / 组织冲突 / 帮助
```

**REST**——463 条去重路由(代码注册口径,运行时实测;完整接口清单可经 `GET /api/openapi.json` 机器可读获取,登录令牌访问),全部经统一鉴权中间件 + RBAC;
未匹配路由的匿名请求统一返回 401(而非 404),不提供路由探测侧信道。

**MCP**——平台即 MCP Server,任意 MCP 客户端可直接接入;86 个注册工具
**均已声明最小权限 permission**。

**协议契约**——对外协议键保持 ASCII 不改写,中文释义见
[`docs/协议键中文对照总表.md`](docs/协议键中文对照总表.md);
能力契约见 `docs/contract-{c1,c2,c3,j1,j2,j3,j4}-*.md`。

---

## 诚实边界

这个项目的价值有一半在于它**明确说清了自己不做什么**:

- **免登演示态**(`DEMO_MODE=1`):**不新增鉴权面、不发令牌、不开写权限**——仅在既有
  console 鉴权中间件的「无 Bearer 头」分支注入固定只读主体(26 个 `.read` 点白名单,
  无 `*`);写方法入口直接 405,带 Bearer 的真实登录路径行为完全不变。代价说清楚:
  它开放实例**全部只读数据视图**给任何能访问端口的人,仅限演示种子数据实例,默认关闭。
- **存储**:业务集合**双形态**——默认 JSON 集合(原子落盘);`PLATFORM_STORAGE=sqlite` 切换
  SQLite 后端(WAL + `synchronous=FULL` + 事务,首启自动回填既有 JSON 数据,`uniqueOn`
  落为引擎级 UNIQUE INDEX,JSON 文件保留为回滚源)。计量与事务数据始终为 SQLite
  (`data/txnstore.db`)。**两种形态都是单进程、无水平扩展**——多节点 HA 需要 Postgres
  后端,规划见 [`docs/adr-0001-storage-migration.md`](docs/adr-0001-storage-migration.md)。
- **MCP 执行层**:支持真实 HTTP 传输(`exec: real`);`exec: demo` 是**显式标注**的降级演示层
  (确定性模拟、不计入计量与 SLO)。
- **模型网关**:仅转发 OpenAI 兼容 `chat/completions`;未配置 endpoint 时**直接报错,
  绝不生成假 completion 充数**。
- **NAS 文件操作**:全部经 MCP 文件网关,不直连 DSM 私有 API;
  `fs_upload/fs_download` 在网关进程侧读写本地路径,平台与网关需同机部署或配共享挂载。
- **OIDC 私钥**存 data 目录,生产建议迁 KMS。
- **i18n**:运行时支持 zh-CN(默认)/ en-US / ja-JP 实时切换,未命中优雅降级中文;
  协议层 ASCII 键在任何语言版本中不改写。架构已支持 i18n,出海市场按需推进。
- **计费**:平台不转售、不分账。对外只呈现**用量与内部成本穿透**(价格簿为零价快照,
  `charge` 恒 0),原钱包/分账子系统已下线封存。

---

## 与市面方案的关系

| 层                | 代表方案                                  | 元冰可的位置                                  |
| ---------------- | ------------------------------------- | --------------------------------------- |
| AI / LLM Gateway | LiteLLM · Portkey · Higress · Bifrost | 不竞争。网关解决**流量路由与成本可见**,这里解决**资产治理与责任归属** |
| LLMOps 可观测       | Langfuse · LangSmith · Braintrust     | 不竞争,但**互补**——这里有计量与审计,缺 trace/eval 深度   |
| Agent 构建平台       | Dify · Coze · FastGPT                 | 不同赛道。这里不构建 Agent,只**治理**已建成的            |
| **AI 资产治理**      | 无成熟方案（早期玩家:Monospace / Busabase / AgentValet）| ✅ **这一层** |
| 企业 MaaS 私有化      | 阿里百炼 · 百度 · 蚂蚁 Agentar                | 轻量,可完全私有化,不绑云合同                         |

这是一个**刚被验证需求的新品类**——网关上在做流量、可观测在做 trace、构建平台在做 Agent,
但「企业里已经建成的那些 AI 资产归谁管」这一层还没有成熟答案。

大多数团队现在的状态是:MCP 服务散在各处没人知道谁在用、Agent 拿着万能 token 横冲直撞、
模型账单月底出来没人说得清哪个部门花的、出了问题查不到审计记录。
元冰可把这些**统一成"资产"**,每类资产共享同一套底座。

---

## 开发

```bash
npm run selftest              # 1621 项端到端断言(含 P95 尾延迟闸门 + 故障注入 + SQLite 后端契约)
npm run lint:manifests        # 插件清单校验
npm run lint:boot-order       # 插件装配顺序
npm run lint:cjk              # 中文残留门禁
npm run manifests             # 重新生成清单

node scripts/storage-bench.mjs         # 存储后端基准(JSON vs SQLite,10k 写入 P99)
node scripts/demo-route-audit.mjs      # 演示只读面审计(GET/HEAD 路由权限点 vs 演示白名单差集)
node tests/full-chain-drill.mjs        # 全链路演练
node tests/workforce-loop-drill.mjs    # 数字员工闭环演练
```

CI(`.github/workflows/quality-gate.yml`)在每次 push / PR 于 Node 22.14 与 24 双版本轨跑契约 lint + 全量自测 + P95 闸门。

仓库只保留对外文档(README / 架构说明 / 部署与接入指南 / 契约 7 份);
QA 报告、交接单、重构基线等内部过程物料在 [`docs/internal/`](docs/internal/)。

## License

MIT

---

> 最近更新：2026-10-22 · 信息架构收敛与部门面板登记制（v1.4.0）——侧边栏重排为「总览 / 资源 / 协作与执行 / 治理 / 企业」，「协作与执行」独立承载执行中枢 / A2A / UHP；资产登记页下线，登记动作回归各资源页；「部门面板」由硬编码外链改为「宿主连接 × 部门」登记清单（`#/panels`，未登记不产生入口，删宿主即清理登记，面板侧新增 `?dept=` 深链且校验与服务端 `DEPT_RE` 同口径）；钉钉扫码登录新增授权页可用性预检（`900103/900108` 就地给指引并回落账号密码，2 分钟缓存不加重 IdP）；上线门禁移除 `systemPromptVersion`，收敛为 `dataClass` + 身份纳管（试运行另需 `trialGroups`）；三语补登记面板文案，新增 `dept.test.mjs` 与面板登记 7 例单测。此前：2026-10-21 · A2A/UHP 复测整改（外部集成闭环 P1-01：归属优先于组织收敛，第三方凭证派活后可直接 get/list/cancel/订阅；治理第 2 项 permit 覆盖真实生效并经契约方法 `inspectAgent` 判定；UHP `/v1` 发现面裸体 + 注入变体统一拒绝留痕 + 直调 SSE 闭合；A2A 页接入任务 SSE 并降级轮询；新增 `lint:i18n` 三语门禁与 A2A 页面冒烟）。此前：2026-10-17 · 市场引爆 W1 批次——免登演示模式（DEMO_MODE=1：无 Bearer 注入 26 个 `.read` 白名单主体 + 写方法 405 + 前端演示会话/只读横幅/写按钮权限门控收口，`console.read` 只读基线点经 `console.login` 蕴含规则真实用户零感知）+ Docker 一键体验（`docker compose up` ≤60 秒起演示实例）+ 演示只读面路由审计脚本。此前：2026-10-16 · v1.3.0 整改攻坚批次——启动探针上线（双实例守卫 + 插件树体检，拒绝带病启动）、cordis 精确锁版 4.0.4 + CI 双轨、存储 SQLite 收尾（默认 JSON_KEEP 名单 / 回填哈希对账 / iam 一人一号演练）、dsh 耦合面窄端口化 + 契约测试。完整版本史见 [CHANGELOG.md](CHANGELOG.md)。
