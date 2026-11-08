// mintbot-weather/main.ts — 插件入口，导出 get_weather 工具
// 用法：MintBot 加载后读取 tools，按名称调用 execute(args, ctx)
// 对应文件：metadata.json、_conf_schema.json、src/*.ts

import { buildReport } from './src/format.ts'
import { fetchWeather } from './src/forecast.ts'
import { CallFailure } from './src/http.ts'
import { placeName, resolvePlace, saveQuery } from './src/place.ts'
import { defaultCityNotFound, defaultCityUntranslated, errors, locationNotFound } from './src/standard.ts'
import type { Period, PlaceQuery, ToolContext, ToolDefinition, Trace } from './src/types.ts'

const PERIODS: Period[] = ['now', 'today', 'tomorrow']

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readQuery(args: Record<string, unknown>, configured: string): PlaceQuery {
  if (text(args.city)) {
    return {
      city: text(args.city),
      region: text(args.region),
      countryCode: text(args.country_code),
      district: text(args.district)
    }
  }
  const [city, ...rest] = configured.split(',')
  return { city: city.trim(), region: rest.join(',').trim(), countryCode: '', district: '' }
}

async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const period = args.period
  if (typeof period !== 'string' || !PERIODS.includes(period as Period)) {
    return 'period 必须是 now、today 或 tomorrow 之一。'
  }
  const fromModel = text(args.city) !== ''
  const configured = text(ctx.config.default_city)
  const q = readQuery(args, configured)
  if (!q.city) return errors.no_location
  const name = fromModel ? placeName(q) : configured
  const searchable = fromModel || !/[^\x00-\x7f]/.test(configured)

  const query = [q.city, q.region, q.countryCode, q.district].filter((p) => p !== '').join(', ')
  const trace: Trace = { query, period: period as Period }
  try {
    const resolved = await resolvePlace(ctx, trace, name, searchable ? q : null, fromModel ? text(args.default_city_name) : '')
    if (!resolved) {
      if (!searchable) return defaultCityUntranslated(configured)
      return fromModel ? locationNotFound(query) : defaultCityNotFound(configured)
    }
    const used = resolved.place.district ?? resolved.place.city
    const bundle = await fetchWeather(ctx, trace, used.latitude, used.longitude, resolved.place.city.country_code)
    const report = buildReport(resolved.place, q.district !== '', trace.period, bundle)
    await saveQuery(ctx, resolved, trace.period, bundle.raw)
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
      '查询某个地点现在、今天或明天的天气、空气质量和出行建议，美国地区附带官方预警。用户说了地点时把地点用英文填进参数；用户没说地点或要查询当前所在地的天气时不填地点。',
    parameters: {
      type: 'object',
      properties: {
        city: { type: 'string', description: '用户说的城市，用英文城市名，例如 San Jose；用户没说地点或要查询当前所在地的天气时不填' },
        region: { type: 'string', description: '这个城市所在的省或州，英文，例如 California；用户没说地点或要查询当前所在地的天气时不填' },
        country_code: { type: 'string', description: '这个城市所在国家的两位代码，例如 US、CN；用户没说地点或要查询当前所在地的天气时不填' },
        district: { type: 'string', description: '区县，英文，例如 Bao\'an；用户没说到区县时不填' },
        default_city_name: {
          type: 'string',
          description: '插件要求你翻译默认城市时，原样填插件给出的中文名，同时用英文填 city 等参数；其他时候不填'
        },
        period: { type: 'string', enum: PERIODS, description: 'now 现在，today 今天剩余时间，tomorrow 明天' }
      },
      required: ['period']
    },
    execute
  }
]
