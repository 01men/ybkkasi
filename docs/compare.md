# 与同类框架的关系（公开信息，未实测）

> 本文只列**公开资料**（各项目官方仓库/文档，2026-11-18 访问），**未做同环境实测**，不做排名、不构成「谁更强」的结论。
> 目的是帮读者判断：ybkkasi 处在哪一层、和什么工具互补、什么场景不该选它。发现事实错误欢迎提 issue 更正。

## 一句话区分

- **应用/工作流平台**（Dify、n8n、Flowise、Langflow）解决「怎么把 AI 应用/流程搭出来」；
- **模型/MCP 网关**（AI Gateway、ThinkWatch、LiteLLM）解决「调用怎么安全地过、怎么限额计费」；
- **ybkkasi** 解决「**这些 AI 能力归谁、谁能调、用了多少、谁签字、结果怎么验**」——企业 AI 资产与数字员工的控制面。

三者可以叠加：用 Dify 造应用、用网关接模型、用 ybkkasi 做组织级确权、授权、审批、计量与审计。

## 分层对照

| 层 | 代表项目（公开资料） | 它们主要回答 | ybkkasi 的位置 |
|---|---|---|---|
| 应用/工作流 | [Dify](https://github.com/langgenius/dify)、[n8n](https://github.com/n8n-io/n8n)、[Flowise](https://github.com/FlowiseAI/Flowise)、[Langflow](https://github.com/langflow-ai/langflow) | 应用怎么搭、流程怎么编排 | 不竞争，作为其上游治理层；资产登记后仍可在这些工具里调用 |
| RAG / 知识库 | [RAGFlow](https://github.com/infiniflow/ragflow)、[FastGPT](https://github.com/labring/FastGPT) | 知识怎么进、怎么答 | 知识库作为**资产**被登记、授权、计量 |
| 模型/MCP 网关 | [AI Gateway](https://github.com/krillinai/AIGateway)、[ThinkWatch](https://github.com/ThinkWatchProject/ThinkWatch)、[LiteLLM](https://github.com/BerriAI/litellm) | 调用身份、路由、限流、成本、审计 | **重叠最多**；ybkkasi 差异在资产确权/生命周期/组织归属与数字员工任务闭环；网关能力可直接对接，不必替换 |
| 编程 Agent 交付 | [LoopForge](https://github.com/Tencent/LoopForge) | 研发交付 SOP（Agent/脚本/人闸/PR） | 研发域的参考与互补；ybkkasi 提供组织级资产与审批底座 |
| 可观测/评估 | [Langfuse](https://github.com/langfuse/langfuse) | trace、评估、成本观测 | 观测数据可作为被治理对象接入 |
| 开发者门户 | [Backstage](https://github.com/backstage/backstage) | 软件目录、服务归属 | ybkkasi 面向 **AI 资产**（MCP/Skill/Agent/模型渠道）而非通用软件目录 |
| 身份与权限 | [Keycloak](https://github.com/keycloak/keycloak)、[authentik](https://github.com/goauthentik/authentik) | 通用 IAM/SSO | 企业部署可桥接外部 IdP；平台内做 AI 域授权 |

## ybkkasi 的差异点（可在本仓库代码核对）

1. **资产确权与生命周期**：MCP 服务、Skill、Agent、应用、模型渠道、NAS 均有归属组织、权限矩阵与发布/审批/下线生命周期。
2. **受控调用**：工具与 MCP 列表按调用方权限过滤，on-behalf-of 令牌链，L4 高风险操作强制审批。
3. **幂等计量与内部成本参考**：每次调用可计量，未定价显式标注而非记零。
4. **全程审计**：认证/授权/调用/变更四类审计可回溯。
5. **平台自身即插件树**：治理能力内生于各域，不靠外层补丁；可与 [dsh](https://github.com/deepseek-ai/deepseek-harness) 插件体系同构运行。
6. **数字员工是协作主体**：任务、审批、验收与资产在同一控制面，而不是孤立的 agent 框架。

## 什么场景不适合选 ybkkasi

- 只想快速搭一个 AI 应用/聊天机器人 → 用 Dify/Flowise 更快；
- 只需要模型路由与限流 → 用 LiteLLM/网关更轻；
- 只做研发代码交付 → 用 LoopForge 这类研发工作台更直接；
- 需要多进程/高可用集群的成熟形态 → 请先读本仓库 README「运行边界」，当前存储形态面向单进程。

## 如何更正

本文只依据公开资料，可能滞后。若你发现事实错误或希望补充对比维度，请提 issue；我们会在下个版本更新并注明日期。
