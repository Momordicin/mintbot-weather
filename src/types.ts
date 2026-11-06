// mintbot-weather/src/types.ts — 插件与 MintBot 之间的接口类型，以及地点、预报的数据形状
// 用法：其他文件 import type 引用；MintBot 阶段 2 按同样的形状实现 ToolContext
// 对应文件：main.ts、src/http.ts、src/place.ts、src/forecast.ts

export type FetchResult =
  | { ok: true; status: number; body: string }
  | { ok: false; kind: 'http' | 'timeout' | 'connect' | 'aborted'; status?: number; code?: string; message: string }

export interface ToolContext {
  config: Record<string, unknown>
  dataDir: string
  signal: AbortSignal
  fetch(url: string, init?: { headers?: Record<string, string> }): Promise<FetchResult>
  log: { info(message: string): void; error(message: string): void }
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: object
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string>
}

export type Period = 'now' | 'today' | 'tomorrow'

export interface Trace {
  query: string
  period: Period
}

export interface PlaceQuery {
  city: string
  region: string
  countryCode: string
  district: string
}

export interface GeoResult {
  name: string
  latitude: number
  longitude: number
  country_code?: string
  country?: string
  admin1?: string
  admin2?: string
  [key: string]: unknown
}

export interface Place {
  city: GeoResult
  district: GeoResult | null
}

export interface ForecastData {
  current: {
    time: string
    temperature_2m: number
    relative_humidity_2m: number
    apparent_temperature: number
    precipitation: number
    weather_code: number
    wind_speed_10m: number
    wind_gusts_10m: number
    uv_index: number
  }
  hourly: {
    time: string[]
    temperature_2m: (number | null)[]
    relative_humidity_2m: (number | null)[]
    precipitation: (number | null)[]
    precipitation_probability: (number | null)[]
    weather_code: (number | null)[]
    wind_speed_10m: (number | null)[]
    wind_gusts_10m: (number | null)[]
    uv_index: (number | null)[]
  }
  daily: {
    time: string[]
    sunrise: string[]
    sunset: string[]
  }
}

export interface AirQualityData {
  current: { time: string; us_aqi: number | null }
  hourly: { time: string[]; us_aqi: (number | null)[] }
}

export interface AlertProperties {
  event?: string | null
  severity?: string | null
  headline?: string | null
  instruction?: string | null
  onset?: string | null
  ends?: string | null
  expires?: string | null
}

export interface RawBodies {
  forecast: string
  air_quality: string
  alerts: string | null
}

export interface WeatherBundle {
  forecast: ForecastData
  airQuality: AirQualityData
  alerts: AlertProperties[] | null
  raw: RawBodies
}

export interface CachedQuery {
  queried_at: number
  period: Period
  raw: RawBodies
}

export interface CacheFile {
  key: string
  place: { queried_at: number; result: Place }
  queries: CachedQuery[]
}
