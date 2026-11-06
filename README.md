# mintbot-weather

MintBot 天气插件。工具 `get_weather` 查询某个地点现在、今天或明天的天气、空气质量和出行建议，美国地区附带 NWS 官方预警。

- 数据来源：Open-Meteo（地名、预报、空气质量）、NWS `api.weather.gov`（美国预警）。
- 源码是 TypeScript，由 Node 22 直接运行，不编译；运行时没有依赖，网络请求都走 MintBot 提供的 `ctx.fetch`。
- 插件说明在 `metadata.json`，用户配置项在 `_conf_schema.json`，入口是 `main.ts`。
- 地点缓存写在插件数据目录的 `places/` 下，每个地点一个文件。

## 开发

```text
pnpm install
pnpm exec tsc -p .
```
