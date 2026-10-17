# 元冰可 AIOS —— 平台镜像（W1 市场引爆批次，2026-10-17）。
#
# 零构建基线照进容器：仓库原生 TS 直接运行（Node ≥22 的类型剥离为默认行为），
# node:sqlite 是 Node 内置模块——镜像里不需要装任何数据库，npm ci 之外零额外依赖。
# 运行时只读四样东西：src/、packages/（含控制台 SPA 与词典）、docs/（/docs 白名单伺服）、
# 根 package.json（版本信息）；其余目录（archive/tests/cli/integrations/数据目录等）
# 由 .dockerignore 排除，不进镜像。
FROM node:22-alpine

WORKDIR /app

# 清单与源码一并拷贝（npm workspaces 全树安装，锁文件锁定版本）；
# devDependencies 必须安装——@deepseek-ai/cordis（插件树内核）与 openid-client（OIDC）
# 声明在 devDependencies 但是运行时硬依赖，--omit=dev 会让实例起不来。
#
# 注意：NODE_ENV=production 必须在 npm ci **之后** 设置。
# npm 会依据 NODE_ENV 把 ci 的默认安装范围收缩为 --omit=dev，若在 npm ci 之前
# 设 ENV，@deepseek-ai/cordis 与 openid-client 会被静默跳过，容器启动即以
# ERR_MODULE_NOT_FOUND 崩掉（npm 7+ 起 NODE_ENV=production 即触发该行为）。
# 故此处在 ci 命令上显式 --include=dev 兜底，与 ENV 的先后顺序解耦。
COPY package.json package-lock.json cordis.yml cordis.patch.yml ./
COPY src ./src
COPY packages ./packages
COPY docs ./docs
RUN npm ci --include=dev --no-audit --no-fund

# 依赖装齐后再切生产模式（npm ci 已完成，不再影响安装范围）。
ENV NODE_ENV=production

# 平台全部持久化状态（业务集合 + SQLite 计量/事务库 + OIDC 私钥）都在数据目录：
# 挂 volume 持久化，容器层不存状态，升级镜像 = 换容器不换数据。
RUN mkdir -p /app/data
VOLUME ["/app/data"]

# 生产部署挂 ADMIN_PASSWORD + 自建 volume，且**不要**带 DEMO_* 变量（见 README「生产部署」）；
# DEMO_MODE=1 会把实例的全部只读视图开放给免登访客，仅限演示种子数据实例。
EXPOSE 7300
CMD ["node", "src/main.ts", "--port", "7300", "--data", "/app/data"]
