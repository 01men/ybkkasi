<p align="center">
  <img src="ybk-mark-128.png" width="72" alt="元冰可标志">
</p>

<h1 align="center">元冰可 AIOS</h1>

<p align="center"><strong>让数字员工与企业 AI 能力，在统一治理下协同工作。</strong></p>
<p align="center">面向企业的 AI 运行与治理平台 · 支持自主部署 · 基于 dsh / cordis 插件体系</p>

<p align="center">
  <a href="https://github.com/01men/ybkkasi/actions/workflows/quality-gate.yml"><img src="https://github.com/01men/ybkkasi/actions/workflows/quality-gate.yml/badge.svg?branch=main" alt="主分支质量检查状态"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT 许可证"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-%E2%89%A522.6-339933" alt="Node.js 22.6 或更高版本"></a>
</p>

<p align="center">
  <strong>简体中文</strong> · <a href="docs/i18n/en/README.md">English</a> · <a href="README.agent.md">Agent</a>
</p>

<p align="center">
  <a href="https://demo.ybkkasi.com/"><strong>在线体验</strong></a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#接入-dsh">接入 dsh</a> ·
  <a href="#面向-agent-和开发者">Agent 接入</a> ·
  <a href="docs/deploy-enterprise.md">部署指南</a>
</p>

[![元冰可控制台：查看用量与成本，数据为演示数据](packages/plugin-console/public/launch/img/20-usage-cost.jpg)](https://demo.ybkkasi.com/)

## 一个面向协作与治理的 AI 平台

元冰可连接企业的目标、数字员工与 AI 能力，让任务执行、能力调用和交付验收有迹可循。数字员工是协作主体；MCP 服务、Skill、模型渠道和应用等是其可使用的能力与资源。

- **组织协作**：围绕目标、项目和任务组织数字员工的工作，支持受控调用与交付验收。
- **能力管理**：集中管理 MCP 服务、Skill、模型渠道、应用及连接器，支持资源生命周期和授权。
- **企业治理**：以组织、身份和权限约束访问，结合审批、审计和用量记录追踪操作。
- **灵活接入**：独立运行控制台与 API，也可通过 dsh 插件、MCP 和命令行接入。

## 界面

以下截图来自本仓库的演示实例，数据为演示数据：

| 数字员工 | MCP 服务 | 审批与审计 |
| --- | --- | --- |
| [![数字员工列表：健康度、所属组织与最近调用](packages/plugin-console/public/launch/img/23-agents.jpg)](https://demo.ybkkasi.com/) | [![MCP 服务：发布状态、工具清单与健康检查](packages/plugin-console/public/launch/img/24-mcps.jpg)](https://demo.ybkkasi.com/) | [![审批中心：L4 生命周期审批与审计记录](packages/plugin-console/public/launch/img/26-approvals.jpg)](https://demo.ybkkasi.com/) |

## 快速开始

在线体验无需安装：[demo.ybkkasi.com](https://demo.ybkkasi.com/)。

本地使用 Docker Compose 启动一个只读演示实例：

```bash
git clone https://github.com/01men/ybkkasi.git
cd ybkkasi
docker compose up -d
```

打开 [http://localhost:7300](http://localhost:7300)。演示模式会让访客访问实例的只读数据，请仅在隔离的演示环境使用，不要接入真实业务数据。

如需从源码启动独立实例，需要 Node.js ≥ 22.6：

```bash
npm ci
npm start
```

独立实例默认不注入演示数据。首次启动凭据、持久化、备份和企业部署配置见[部署指南](docs/deploy-enterprise.md)。

## 它是怎么搭起来的

实例本身是一棵 cordis 插件树，与 dsh 使用同一个插件框架。每个业务域是一个独立插件包，自行声明依赖、权限点和事件，可以单独启停；跨插件协作只经由事件总线和扩展点，插件之间不直接读写彼此的数据。仓库包含 25 个插件清单与 9 份领域运维 Skill。

这意味着治理能力不是加在平台外层的补丁，而是每个域自身的一部分：组织、身份、权限、计量、审计各自有归属插件，也各自对调用方负责。

## 接入 dsh

项目提供 dsh `web` profile 的插件包；仓库声明的兼容范围为 `>=0.1.0-rc.7 <0.2.0`。dsh 挂载仍属实验性接入，请先在隔离环境验证所用版本。

```bash
dsh plugin --profile web add github:01men/ybkkasi
```

挂载配置将控制台和 API 放在 dsh Web 服务的 `/rq` 前缀下。远程 dsh 也可通过一次性接入码连接已有平台，凭证与授权范围由管理员管理。接入和部署细节见[部署指南](docs/deploy-enterprise.md)。

## 面向 Agent 和开发者

| 入口 | 用途 |
| --- | --- |
| [Agent 视图](README.agent.md) | 给自动化调用方的接入事实与安全边界 |
| [llms.txt](llms.txt) | 项目概要、Agent 操作边界与文档索引 |
| [运维 Skill 索引](skills/dsh-ops-admin/SKILL.md) | 按领域查找运维手册；可直接读取或安装到 dsh 的 Skill 目录 |
| `POST /mcp` | 平台运维工具的 MCP 接口；工具列表按调用方权限过滤 |
| `GET /api/openapi.json` | 当前实例的 REST 接口描述，需要授权 |
| [命令行工具](cli/dshctl.mjs) | 平台运维 CLI，支持 `--output json` |

以上路径以独立实例为例；dsh 挂载形态使用 `/rq` 前缀。访问受保护接口时请使用获得授权的凭据。CLI 的 `--dry-run` 仅对明确支持预演的操作有效；其他写入会被拒绝。

接口与工具数量随版本和调用方权限变化，不在本文档中固定——以目标实例的 `/api/openapi.json` 与 `/mcp` 返回为准。

## 运行边界

- **数据与可用性**：当前存储形态面向单进程运行，不应让多个进程同时使用同一数据目录；部署前请规划备份和恢复。
- **权限与凭据**：按需授予最小权限，妥善保管令牌、接入码和密钥；审计和审批以实际配置及操作权限为准。
- **模型与工具**：真实调用需要配置相应服务和凭据；演示数据及演示执行结果不代表生产调用。

## 文档与社区

[架构说明](docs/ARCHITECTURE.md) · [企业部署](docs/deploy-enterprise.md) · [更新记录](CHANGELOG.md) · [贡献指南](CONTRIBUTING.md) · [i18n 治理](docs/i18n/README.md) · [English](docs/i18n/en/README.md) · [日本語](docs/i18n/ja/README.md) · [Agent](README.agent.md)

本项目采用 [MIT License](LICENSE)。