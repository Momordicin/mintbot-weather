// mintbot-weather/main.ts — 插件入口，导出 get_weather 工具
// 用法：MintBot 加载后读取 tools，按名称调用 execute(args, ctx)
// 对应文件：metadata.json、_conf_schema.json、src/*.ts

import { buildReport } from './src/format.ts'
import { fetchWeather } from './src/forecast.ts'
import { CallFailure } from './src/http.ts'
import { resolvePlace, saveQuery } from './src/place.ts'
import { errors, locationNotFound } from './src/standard.ts'
import type { Period, PlaceQuery, ToolContext, ToolDefinition, Trace } from './src/types.ts'

const PERIODS: Period[] = ['now', 'today', 'tomorrow']

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readQuery(args: Record<string, unknown>, config: Record<string, unknown>): PlaceQuery {
  if (text(args.city)) {
    return {
      city: text(args.city),
      region: text(args.region),
      countryCode: text(args.country_code),
      district: text(args.district)
    }
  }
  return {
    city: text(config.default_city),
    region: text(config.default_region),
    countryCode: text(config.default_country_code),
    district: text(config.default_district)
  }
}

async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const period = args.period
  if (typeof period !== 'string' || !PERIODS.includes(period as Period)) {
    return 'period 必须是 now、today 或 tomorrow 之一。'
  }
  const q = readQuery(args, ctx.config)
  if (!q.city) return errors.no_location

  const query = [q.city, q.region, q.countryCode, q.district].filter((p) => p !== '').join(', ')
  const trace: Trace = { query, period: period as Period }
  try {
    const resolved = await resolvePlace(ctx, trace, q)
    if (!resolved) return locationNotFound(query)
    const used = resolved.place.district ?? resolved.place.city
    const bundle = await fetchWeather(ctx, trace, used.latitude, used.longitude, resolved.place.city.country_code)
    const report = buildReport(resolved.place, q.district !== '', trace.period, bundle)
    await saveQuery(ctx, q, resolved, trace.period, bundle.raw)
    return report
  } catch (err) {
    if (err instanceof CallFailure) return errors.network
    ctx.log.error(
      `天气查询失败：步骤=未知，原因=${err instanceof Error ? err.stack ?? err.message : String(err)}，地名=${query}，时段=${trace.period}`
    )
    return errors.network
  }
}

export const tools: ToolDefinition[] = [
  {
    name: 'get_weather',
    description:
      '查询某个地点现在、今天或明天的天气、空气质量和出行建议，美国地区附带官方预警。地名一律用英文填写，最好带上所在的省或州和国家代码。不知道用户在哪里时不要猜，不要填地点，插件会使用默认城市；没有默认城市时会提示你去问用户。',
    parameters: {
      type: 'object',
      properties: {
        city: { type: 'string', description: '英文城市名，例如 San Jose。不知道时不填' },
        region: { type: 'string', description: '城市所在的省或州，英文，例如 California' },
        country_code: { type: 'string', description: '两位国家代码，例如 US、CN' },
        district: { type: 'string', description: '区县，英文，可不填，例如 Bao\'an' },
        period: { type: 'string', enum: PERIODS, description: 'now 现在，today 今天剩余时间，tomorrow 明天' }
      },
      required: ['period']
    },
    execute
  }
]
