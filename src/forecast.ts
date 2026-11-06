// mintbot-weather/src/forecast.ts — 同时请求预报、空气质量、预警（US）并检查内容
// 用法：fetchWeather(ctx, trace, lat, lon, countryCode) 返回解析后的数据和三个原样正文
// 对应文件：src/http.ts、src/types.ts、main.ts

import { failStep, isRecord, requestJson } from './http.ts'
import type { AirQualityData, AlertProperties, ForecastData, ToolContext, Trace, WeatherBundle } from './types.ts'

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
const FORECAST_SERVICE = 'api.open-meteo.com'
const AIR_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality'
const AIR_SERVICE = 'air-quality-api.open-meteo.com'
const ALERTS_URL = 'https://api.weather.gov/alerts/active'
const ALERTS_SERVICE = 'api.weather.gov'

const FORECAST_CURRENT = [
  'temperature_2m',
  'relative_humidity_2m',
  'apparent_temperature',
  'precipitation',
  'weather_code',
  'wind_speed_10m',
  'wind_gusts_10m',
  'uv_index'
]
const FORECAST_HOURLY = [
  'temperature_2m',
  'relative_humidity_2m',
  'precipitation',
  'precipitation_probability',
  'weather_code',
  'wind_speed_10m',
  'wind_gusts_10m',
  'uv_index'
]
const FORECAST_DAILY = ['sunrise', 'sunset']

function hasNumbers(obj: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((k) => typeof obj[k] === 'number')
}

function hasArrays(obj: Record<string, unknown>, keys: string[], length: number): boolean {
  return keys.every((k) => Array.isArray(obj[k]) && (obj[k] as unknown[]).length === length)
}

function parseForecast(json: unknown): ForecastData | null {
  if (!isRecord(json) || !isRecord(json.current) || !isRecord(json.hourly) || !isRecord(json.daily)) return null
  const { current, hourly, daily } = json
  if (typeof current.time !== 'string' || !hasNumbers(current, FORECAST_CURRENT)) return null
  if (!Array.isArray(hourly.time)) return null
  if (!hasArrays(hourly, FORECAST_HOURLY, hourly.time.length)) return null
  if (!Array.isArray(daily.time) || daily.time.length < 2) return null
  if (!hasArrays(daily, ['sunrise', 'sunset'], daily.time.length)) return null
  return json as unknown as ForecastData
}

function parseAirQuality(json: unknown): AirQualityData | null {
  if (!isRecord(json) || !isRecord(json.current) || !isRecord(json.hourly)) return null
  const { current, hourly } = json
  if (typeof current.time !== 'string' || (current.us_aqi !== null && typeof current.us_aqi !== 'number')) return null
  if (!Array.isArray(hourly.time) || !hasArrays(hourly, ['us_aqi'], hourly.time.length)) return null
  return json as unknown as AirQualityData
}

function parseAlerts(json: unknown): AlertProperties[] | null {
  if (!isRecord(json) || !Array.isArray(json.features)) return null
  const out: AlertProperties[] = []
  for (const f of json.features) {
    if (!isRecord(f) || !isRecord(f.properties)) return null
    out.push(f.properties as AlertProperties)
  }
  return out
}

export async function fetchWeather(
  ctx: ToolContext,
  trace: Trace,
  lat: number,
  lon: number,
  countryCode: string | undefined
): Promise<WeatherBundle> {
  const forecastParams = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    timezone: 'auto',
    forecast_days: '2',
    current: FORECAST_CURRENT.join(','),
    hourly: FORECAST_HOURLY.join(','),
    daily: FORECAST_DAILY.join(',')
  })
  const airParams = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    timezone: 'auto',
    forecast_days: '2',
    current: 'us_aqi',
    hourly: 'us_aqi'
  })
  const wantAlerts = countryCode?.toUpperCase() === 'US'

  const [forecastRes, airRes, alertsRes] = await Promise.all([
    requestJson(ctx, trace, '预报', FORECAST_SERVICE, `${FORECAST_URL}?${forecastParams}`),
    requestJson(ctx, trace, '空气质量', AIR_SERVICE, `${AIR_URL}?${airParams}`),
    wantAlerts
      ? requestJson(ctx, trace, '预警', ALERTS_SERVICE, `${ALERTS_URL}?point=${lat},${lon}`, {
          'User-Agent': '(MintBot, local desktop app)',
          Accept: 'application/geo+json'
        })
      : Promise.resolve(null)
  ])

  const forecast = parseForecast(forecastRes.json)
  if (!forecast) return failStep(ctx, trace, '预报', FORECAST_SERVICE, '内容不对：缺少必要字段')
  const airQuality = parseAirQuality(airRes.json)
  if (!airQuality) return failStep(ctx, trace, '空气质量', AIR_SERVICE, '内容不对：缺少必要字段')
  let alerts: AlertProperties[] | null = null
  if (alertsRes) {
    alerts = parseAlerts(alertsRes.json)
    if (!alerts) return failStep(ctx, trace, '预警', ALERTS_SERVICE, '内容不对：缺少 features')
  }
  return {
    forecast,
    airQuality,
    alerts,
    raw: { forecast: forecastRes.body, air_quality: airRes.body, alerts: alertsRes ? alertsRes.body : null }
  }
}
