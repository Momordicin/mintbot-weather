// mintbot-weather/src/advice.ts — 官方分级表、热指数与风寒公式、WMO 天气代码
// 用法：aqiAdvice、uvAdvice、heatAdvice、windAdvice、windChillF 返回对应一档的文字或数值
// 对应文件：docs/research/15-weather-indicator-guidance.md（MintBot 仓库）、src/format.ts

export function cToF(c: number): number {
  return c * 1.8 + 32
}

export function fToC(f: number): number {
  return (f - 32) / 1.8
}

export function kmhToMph(kmh: number): number {
  return kmh / 1.609344
}

const AQI_TIERS: { max: number; category: string; text: string | null }[] = [
  { max: 50, category: 'Good', text: "It's a great day to be active outside." },
  { max: 100, category: 'Moderate', text: "It's a good day to be active outside." },
  { max: 150, category: 'Unhealthy for Sensitive Groups', text: null },
  {
    max: 200,
    category: 'Unhealthy',
    text: 'Reduce long or intense activities. Take more breaks during outdoor activities.'
  },
  {
    max: 300,
    category: 'Very Unhealthy',
    text: 'Avoid long or intense activities. Consider rescheduling or moving activities indoors.'
  },
  { max: Infinity, category: 'Hazardous', text: 'Avoid all physical activity outdoors.' }
]

export function aqiCategory(aqi: number): string {
  const rounded = Math.round(aqi)
  return (AQI_TIERS.find((t) => rounded <= t.max) ?? AQI_TIERS[AQI_TIERS.length - 1]).category
}

export function aqiAdvice(aqi: number): string {
  const rounded = Math.round(aqi)
  const tier = AQI_TIERS.find((t) => rounded <= t.max) ?? AQI_TIERS[AQI_TIERS.length - 1]
  return tier.text ? `${tier.category}：${tier.text}` : tier.category
}

export function uvAdvice(uv: number): string {
  const rounded = Math.round(uv)
  if (rounded <= 2) {
    return 'Low：No protection needed. You can safely stay outside using minimal sun protection.'
  }
  if (rounded <= 7) {
    return 'Moderate to High：Protection needed. Seek shade during late morning through mid-afternoon.'
  }
  return 'Very High to Extreme：Extra protection needed. Be careful outside, especially during late morning through mid-afternoon. If your shadow is shorter than you, seek shade.'
}

export function heatIndexF(tF: number, rh: number): number {
  const simple = 0.5 * (tF + 61.0 + (tF - 68.0) * 1.2 + rh * 0.094)
  if ((simple + tF) / 2 < 80) return (simple + tF) / 2
  let hi =
    -42.379 +
    2.04901523 * tF +
    10.14333127 * rh -
    0.22475541 * tF * rh -
    0.00683783 * tF * tF -
    0.05481717 * rh * rh +
    0.00122874 * tF * tF * rh +
    0.00085282 * tF * rh * rh -
    0.00000199 * tF * tF * rh * rh
  if (rh < 13 && tF >= 80 && tF <= 112) hi -= ((13 - rh) / 4) * Math.sqrt((17 - Math.abs(tF - 95)) / 17)
  if (rh > 85 && tF >= 80 && tF <= 87) hi += ((rh - 85) / 10) * ((87 - tF) / 5)
  return hi
}

export function heatAdvice(hiF: number): string | null {
  if (hiF < 80) return null
  if (hiF < 90) return 'Caution：Fatigue possible with prolonged exposure and/or physical activity'
  if (hiF < 103) {
    return 'Extreme Caution：Heat stroke, heat cramps, or heat exhaustion possible with prolonged exposure and/or physical activity'
  }
  if (hiF < 125) {
    return 'Danger：Heat cramps or heat exhaustion likely, and heat stroke possible with prolonged exposure and/or physical activity'
  }
  return 'Extreme Danger：Heat stroke highly likely'
}

export function windChillF(tF: number, mph: number): number | null {
  if (tF > 50 || mph <= 3) return null
  const v = Math.pow(mph, 0.16)
  return 35.74 + 0.6215 * tF - 35.75 * v + 0.4275 * tF * v
}

const BEAUFORT: { max: number; name: string; text: string }[] = [
  { max: 1, name: 'Calm', text: 'Calm; smoke rises vertically.' },
  { max: 3, name: 'Light Air', text: 'Direction of wind shown by smoke drift, but not by wind vanes.' },
  { max: 7, name: 'Light Breeze', text: 'Wind felt on face; leaves rustle; ordinary vanes moved by wind.' },
  { max: 12, name: 'Gentle Breeze', text: 'Leaves and small twigs in constant motion; wind extends light flag.' },
  { max: 18, name: 'Moderate Breeze', text: 'Raises dust and loose paper; small branches are moved.' },
  {
    max: 24,
    name: 'Fresh Breeze',
    text: 'Small trees in leaf begin to sway; crested wavelets form on inland waters.'
  },
  {
    max: 31,
    name: 'Strong Breeze',
    text: 'Large branches in motion; whistling heard in telegraph wires; umbrellas used with difficulty.'
  },
  {
    max: 38,
    name: 'Near Gale',
    text: 'Whole trees in motion; inconvenience felt when walking against the wind.'
  },
  { max: 46, name: 'Gale', text: 'Breaks twigs off trees; generally impedes progress.' },
  {
    max: 54,
    name: 'Severe Gale',
    text: 'Slight structural damage occurs (chimney-pots and slates removed)'
  },
  {
    max: 63,
    name: 'Storm',
    text: 'Seldom experienced inland; trees uprooted; considerable structural damage occurs.'
  },
  { max: 72, name: 'Violent Storm', text: 'Very rarely experienced; accompanied by wide-spread damage.' },
  { max: Infinity, name: 'Hurricane', text: 'see Saffir-Simpson Hurricane Scale' }
]

export function windAdvice(mph: number): string {
  const rounded = Math.round(mph)
  const level = BEAUFORT.findIndex((b) => rounded <= b.max)
  const tier = BEAUFORT[level]
  return `${level} 级 ${tier.name}：${tier.text}`
}

const WMO: Record<number, string> = {
  0: '晴',
  1: '大部晴',
  2: '局部多云',
  3: '阴',
  45: '雾',
  48: '雾凇',
  51: '小毛毛雨',
  53: '中毛毛雨',
  55: '大毛毛雨',
  56: '轻微冻毛毛雨',
  57: '浓冻毛毛雨',
  61: '小雨',
  63: '中雨',
  65: '大雨',
  66: '轻微冻雨',
  67: '强冻雨',
  71: '小雪',
  73: '中雪',
  75: '大雪',
  77: '米雪',
  80: '小阵雨',
  81: '中阵雨',
  82: '强阵雨',
  85: '小阵雪',
  86: '大阵雪',
  95: '雷暴',
  96: '雷暴伴小冰雹',
  97: '强雷暴',
  99: '雷暴伴大冰雹'
}

export function weatherText(code: number): string {
  return WMO[code] ?? `天气代码 ${code}`
}

export function isPrecipCode(code: number): boolean {
  return (code >= 51 && code <= 67) || (code >= 71 && code <= 77) || (code >= 80 && code <= 86) || (code >= 95 && code <= 99)
}
