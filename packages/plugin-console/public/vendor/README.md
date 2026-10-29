# 控制台主题可视化依赖

- `cytoscape-3.33.1.min.js`：Cytoscape.js 3.33.1 发布包的 UMD 版；许可证见 `cytoscape-LICENSE.txt`。
- `d3-7.9.0.min.js`：从 D3 7.9.0 依赖树中，仅打包 `select`、`scaleLinear`、`scalePoint`、`max`、`area` 和 `line`，不包含 D3 的网络请求模块；许可证见 `d3-LICENSE.txt` 和 `d3-submodules-LICENSES.txt`。

D3 精简包由 esbuild 0.25.12 生成，入口为：

```js
export { select } from 'd3-selection'
export { scaleLinear, scalePoint } from 'd3-scale'
export { max } from 'd3-array'
export { area, line } from 'd3-shape'
```

构建参数：`--bundle --minify --format=iife --global-name=d3`。具体依赖版本与许可列于 `d3-submodules-LICENSES.txt`。依赖随控制台本地静态资源发布，仅在对应主题按需加载，无 CDN 网络依赖。
