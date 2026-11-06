// mintbot-weather/src/format.ts — 把预报、空气质量、预警按时段整理成交给角色的文字
// 用法：buildReport(place, districtRequested, period, bundle) 返回完整回复
// 对应文件：src/advice.ts、src/types.ts、main.ts

import {
  aqiAdvice,
  aqiCategory,
  cToF,
  fToC,
  heatAdvice,
  heatIndexF,
  isPrecipCode,
  kmhToMph,
  uvAdvice,
  weatherText,
  windAdvice,
  windChillF
} from './advice.ts'
import type { AlertProperties, GeoResult, Period, Place, WeatherBundle } from './types.ts'

const ALERT_PROMPT = '以下是美国国家气象局的官方预警英文原文，请用你自己的口吻转述要点，不要照念原文。'
const ALERT_SOURCE = '来源：美国国家气象局（api.weather.gov）'
const AQI_MISSING = '空气质量数据暂时不可用，请在回复中告诉用户。'
const SUN_WINDOW_MINUTES = 120

function r1(v: number): string {
  return String(Math.round(v * 10) / 10)
}

function localMinutes(s: string): number {
  return (
    Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), +s.slice(11, 13), +s.slice(14, 16)) / 60000
  )
}

function hourIndexes(times: string[], date: string, fromHour: number): number[] {
  const out: number[] = []
  times.forEach((t, i) => {
    if (t.slice(0, 10) === date && +t.slice(11, 13) >= fromHour) out.push(i)
  })
  return out
}

function nums(arr: (number | null)[], idx: number[]): number[] {
  return idx.map((i) => arr[i]).filter((v): v is number => typeof v === 'number')
}

function placeLine(g: GeoResult): string {
  const parts = [g.name, g.admin1, g.country].filter((p): p is string => typeof p === 'string' && p !== '')
  return `地点：${parts.join(', ')}（${g.latitude}, ${g.longitude}）`
}

function sunLines(bundle: WeatherBundle, period: Period): string[] {
  const { current } = bundle.forecast
  const { sunrise, sunset } = bundle.forecast.daily
  const out: string[] = []
  if (period === 'now') {
    const nowMin = localMinutes(current.time)
    const events: { label: string; time: string }[] = []
    sunrise.forEach((t) => events.push({ label: '日出', time: t }))
    sunset.forEach((t) => events.push({ label: '日落', time: t }))
    for (const e of events) {
      const diff = localMinutes(e.time) - nowMin
      if (diff > 0 && diff <= SUN_WINDOW_MINUTES) out.push(`${e.label}：${e.time.slice(11, 16)}（${Math.round(diff)} 分钟后）`)
    }
  } else if (period === 'today') {
    if (sunrise[0] > current.time) out.push(`日出：${sunrise[0].slice(11, 16)}`)
    if (sunset[0] > current.time) out.push(`日落：${sunset[0].slice(11, 16)}`)
  } else {
    out.push(`日出：${sunrise[1].slice(11, 16)}`)
    out.push(`日落：${sunset[1].slice(11, 16)}`)
  }
  return out
}

function precipLines(bundle: WeatherBundle, idx: number[]): string[] {
  const h = bundle.forecast.hourly
  const segments: number[][] = []
  let run: number[] = []
  for (const i of idx) {
    const code = h.weather_code[i]
    if (typeof code === 'number' && isPrecipCode(code)) {
      if (run.length && run[run.length - 1] !== i - 1) {
        segments.push(run)
        run = []
      }
      run.push(i)
    } else if (run.length) {
      segments.push(run)
      run = []
    }
  }
  if (run.length) segments.push(run)

  if (segments.length === 0) {
    const probs = nums(h.precipitation_probability, idx)
    return [probs.length ? `降水：无降水，当天最高降水概率 ${Math.max(...probs)}%` : '降水：无降水']
  }
  return segments.map((seg) => {
    const counts = new Map<number, number>()
    for (const i of seg) counts.set(h.weather_code[i] as number, (counts.get(h.weather_code[i] as number) ?? 0) + 1)
    let code = h.weather_code[seg[0]] as number
    let best = 0
    for (const [c, n] of counts) {
      if (n > best) {
        best = n
        code = c
      }
    }
    const probs = nums(h.precipitation_probability, seg)
    const total = nums(h.precipitation, seg).reduce((a, b) => a + b, 0)
    const probText = probs.length ? `，最高降水概率 ${Math.max(...probs)}%` : ''
    const start = `${h.time[seg[0]].slice(11, 13)}:00`
    const span =
      seg.length === 1
        ? `${start} 开始有${weatherText(code)}`
        : `${start}–${h.time[seg[seg.length - 1]].slice(11, 13)}:00 ${weatherText(code)}`
    return `降水：${span}${probText}，累计降水量 ${r1(total)} mm`
  })
}

function adviceLines(args: {
  aqi: number | null
  uv: number | null
  tempsHumid: { t: number; rh: number }[]
  windKmh: number | null
  windTemps: { t: number; kmh: number }[]
}): string[] {
  const out: string[] = []
  if (args.aqi !== null) out.push(`空气质量：AQI ${Math.round(args.aqi)}，${aqiAdvice(args.aqi)}`)
  if (args.uv !== null) out.push(`紫外线：指数 ${r1(args.uv)}，${uvAdvice(args.uv)}`)

  let maxHi: number | null = null
  for (const p of args.tempsHumid) {
    const tF = cToF(p.t)
    if (tF < 80) continue
    const hi = heatIndexF(tF, p.rh)
    if (maxHi === null || hi > maxHi) maxHi = hi
  }
  const heat = maxHi === null ? null : heatAdvice(maxHi)
  if (maxHi !== null && heat) out.push(`炎热：热指数约 ${r1(fToC(maxHi))}°C，${heat}`)

  if (args.windKmh !== null) out.push(`风：${r1(args.windKmh)} km/h，${windAdvice(kmhToMph(args.windKmh))}`)

  let minWc: number | null = null
  for (const p of args.windTemps) {
    const wc = windChillF(cToF(p.t), kmhToMph(p.kmh))
    if (wc !== null && (minWc === null || wc < minWc)) minWc = wc
  }
  if (minWc !== null) out.push(`寒冷：风寒约 ${r1(fToC(minWc))}°C`)
  return out
}

function alertLines(alerts: AlertProperties[] | null): string[] {
  if (!alerts || alerts.length === 0) return []
  const out: string[] = []
  for (const a of alerts) {
    const fields: [string, string | null | undefined][] = [
      ['Event', a.event],
      ['Severity', a.severity],
      ['Headline', a.headline],
      ['Instruction', a.instruction],
      ['Onset', a.onset],
      ['Ends', a.ends || a.expires]
    ]
    const text = fields
      .filter(([, v]) => typeof v === 'string' && v !== '')
      .map(([k, v]) => `${k}: ${(v as string).replace(/\s+/g, ' ').trim()}`)
      .join('; ')
    out.push(ALERT_PROMPT, text)
  }
  out.push(ALERT_SOURCE)
  return out
}

export function buildReport(place: Place, districtRequested: boolean, period: Period, bundle: WeatherBundle): string {
  const { current, hourly, daily } = bundle.forecast
  const used = place.district ?? place.city
  const lines: string[] = [placeLine(used)]
  if (districtRequested && !place.district) lines.push('按城市查询')

  let aqi: number | null
  let uv: number | null
  let tempsHumid: { t: number; rh: number }[]
  let windKmh: number | null
  let windTemps: { t: number; kmh: number }[]

  if (period === 'now') {
    lines.push(`时段：现在（当地时间 ${current.time.replace('T', ' ')}）`)
    lines.push(`天气：${weatherText(current.weather_code)}`)
    lines.push(
      `气温 ${r1(current.temperature_2m)}°C，体感 ${r1(current.apparent_temperature)}°C，湿度 ${r1(current.relative_humidity_2m)}%`
    )
    lines.push(`风速 ${r1(current.wind_speed_10m)} km/h，阵风 ${r1(current.wind_gusts_10m)} km/h`)
    lines.push(`紫外线指数：${r1(current.uv_index)}`)
    lines.push(`当前降水：${r1(current.precipitation)} mm`)
    aqi = bundle.airQuality.current.us_aqi
    if (aqi !== null) lines.push(`空气质量：AQI ${Math.round(aqi)}（${aqiCategory(aqi)}）`)
    lines.push(...sunLines(bundle, period))
    uv = current.uv_index
    tempsHumid = [{ t: current.temperature_2m, rh: current.relative_humidity_2m }]
    windKmh = current.wind_speed_10m
    windTemps = [{ t: current.temperature_2m, kmh: current.wind_speed_10m }]
  } else {
    const date = period === 'today' ? current.time.slice(0, 10) : daily.time[1]
    const fromHour = period === 'today' ? +current.time.slice(11, 13) : 0
    const idx = hourIndexes(hourly.time, date, fromHour)
    const airIdx = hourIndexes(bundle.airQuality.hourly.time, date, fromHour)
    const label = period === 'today' ? `今天（当地时间 ${current.time.slice(11, 13)}:00 到 23:00）` : `明天（${date}）`
    lines.push(`时段：${label}`)

    const temps = nums(hourly.temperature_2m, idx)
    if (temps.length) lines.push(`气温：最高 ${r1(Math.max(...temps))}°C，最低 ${r1(Math.min(...temps))}°C`)
    lines.push(...precipLines(bundle, idx))
    const winds = nums(hourly.wind_speed_10m, idx)
    const gusts = nums(hourly.wind_gusts_10m, idx)
    if (winds.length) {
      lines.push(
        `风：最大风速 ${r1(Math.max(...winds))} km/h${gusts.length ? `，最大阵风 ${r1(Math.max(...gusts))} km/h` : ''}`
      )
    }
    const uvs = nums(hourly.uv_index, idx)
    if (uvs.length) lines.push(`紫外线：最高指数 ${r1(Math.max(...uvs))}`)
    const aqis = nums(bundle.airQuality.hourly.us_aqi, airIdx)
    if (aqis.length) lines.push(`空气质量：最高 AQI ${Math.round(Math.max(...aqis))}（${aqiCategory(Math.max(...aqis))}）`)
    lines.push(...sunLines(bundle, period))

    aqi = aqis.length ? Math.max(...aqis) : null
    uv = uvs.length ? Math.max(...uvs) : null
    tempsHumid = idx
      .filter((i) => typeof hourly.temperature_2m[i] === 'number' && typeof hourly.relative_humidity_2m[i] === 'number')
      .map((i) => ({ t: hourly.temperature_2m[i] as number, rh: hourly.relative_humidity_2m[i] as number }))
    windKmh = winds.length ? Math.max(...winds) : null
    windTemps = idx
      .filter((i) => typeof hourly.temperature_2m[i] === 'number' && typeof hourly.wind_speed_10m[i] === 'number')
      .map((i) => ({ t: hourly.temperature_2m[i] as number, kmh: hourly.wind_speed_10m[i] as number }))
  }

  if (aqi === null) lines.push(AQI_MISSING)
  const advice = adviceLines({ aqi, uv, tempsHumid, windKmh, windTemps })
  if (advice.length) lines.push('出行建议：', ...advice.map((l) => `- ${l}`))
  lines.push(...alertLines(bundle.alerts))
  return lines.join('\n')
}
