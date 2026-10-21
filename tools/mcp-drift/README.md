# mcp-drift

把「这台机器现在跑什么 MCP」导出成**可 review 的快照**，并检测与团队基线的漂移。

零依赖，只用 Node 内置模块。Node >= 18。

## 为什么存在

`dsh-mcp-manager` 把 MCP 的 roster、加载模式、工具过滤、destructive 策略管得很好，
但这些开关**只存在于本机配置文件**。

于是这个场景无人能察觉：

| 人 | 机器上的实际状态 |
|---|---|
| A | 上季度出过事故，把 `delete_*` 全禁了 |
| B | 忘了配，`destructiveHint: true` 的工具直接进了会话 |
| C | 还留着两个月前临时加、团队早已决定下线的 server |

**三个人的 MCP 权限面完全不同，而且没有任何一个人能看出这个差异。**

本工具不解决治理，只解决**让差异变得可见且可进 code review**。

## 用法

```sh
# 1. 生成基线（提交进仓库，作为团队约定）
node mcp-drift.mjs snapshot --config ~/.dsh/cordis.patch.yml -o mcp-baseline.json

# 2. 本机自检：有漂移就 exit 1
node mcp-drift.mjs check --config ~/.dsh/cordis.patch.yml --baseline mcp-baseline.json

# 3. 比对两份已保存的快照
node mcp-drift.mjs diff --baseline base.json --current cur.json
```

CI 里一步到位：

```yaml
- run: node mcp-drift.mjs check --config cordis.patch.yml --baseline mcp-baseline.json
```

基线缺失**不算漂移**，退出 0——第一次接入不该红。

## 输出分级

| 级别 | 含义 | 例子 |
|---|---|---|
| `[风险]` | 权限面被放宽，需人工确认 | 关闭了 destructive 过滤 / 新增基线外的 server / 启用了基线里关着的 server |
| `[放宽]` | 约束减少 | 工具过滤少了条目 |
| `[变更]` | 行为变化但不一定更危险 | 加载模式切换 / server 被关闭 |

退出码：有 `[风险]` 级漂移 → `1`，否则 `0`。

## 两个刻意的设计约束

**1. 导出必须是结构化重建，不是行编辑。**
`dsh-mcp-manager` 的 README 明确说全局行写操作会重写整个 Include 文件，注释和引号风格都会丢。
如果快照也用行编辑产生，diff 里全是噪音，没人会 review，工具就白做了。
所以输出是规范化 JSON：字段顺序固定、冗余字段剔除、`toolFilter` 排序、`rows` 按 `id` 排序。

**2. 解析失败必须响亮。**
治理工具最危险的失败模式是**静默降级**：用户以为配了策略，实际没生效。
因此 `config` 存在却解析不出映射时，工具**抛错退出**，而不是当成「未配置」继续跑。
同理，`toolFilter: [a, b]` 会被真正解成数组——如果解成字符串，`Array.isArray` 判断失败，
过滤器会被当成「没配」，一项权限放宽就被漏报了。

## 快照格式

```json
{
  "$schema": "https://ybkkasi.com/schemas/mcp-roster-snapshot/v1",
  "rows": [{
    "id": "mcp-github",
    "name": "@modelcontextprotocol/server-github",
    "package": "@modelcontextprotocol/server-github",
    "enabled": true,
    "loadingMode": "lazy",
    "hideDestructive": false,
    "toolFilter": ["create_issue", "list_issues"],
    "destructiveHint": false
  }],
  "summary": {
    "total": 4, "enabled": 4,
    "hideDestructiveOn": 1, "toolFiltered": 1,
    "surfaceHash": "0e5f04e32f9441cd"
  }
}
```

`surfaceHash` 是权限面的指纹。两台机器的 hash 相同 = 权限面一致，可以直接对答案，
不必逐行读 diff。

## 边界（明确说清楚，不吹全能）

- 只读 `cordis.patch.yml` 的 `insert` 段。不解析多文档、锚点、复杂嵌套块——遇到就报错，不猜。
- `surfaceHash` 只覆盖 enabled 行，不含工具级 schema。工具集合变了 hash 不变。
- 不校验 server 是否真实存在、是否可达。它比的是**配置**，不是**运行态**。
- 与 dsh-mcp-manager 的配置耦合：`loadingMode` / `hideDestructive` / `toolFilter` 三个字段名
  取自其 README 与 settings 定义。上游改名需同步。

## 相关

- 提问背景：https://github.com/zhang-guo-wen/dsh-mcp-manager/issues/2
- 企业侧 AI 资产治理：https://ybkkasi.com · https://demo.ybkkasi.com

MIT