// mintbot-weather/src/place.ts — 地名查询（Open-Meteo geocoding）与地点缓存文件
// 用法：resolvePlace 先读缓存再查地名；saveQuery 把一次查询的原始数据追加进缓存文件
// 对应文件：src/http.ts、main.ts

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { failStep, isRecord, requestJson } from './http.ts'
import type { CacheFile, GeoResult, Period, Place, PlaceQuery, RawBodies, ToolContext, Trace } from './types.ts'

const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search'
const GEOCODING_SERVICE = 'geocoding-api.open-meteo.com'
const DISTRICT_MAX_KM = 30

export function cacheKey(q: PlaceQuery): string {
  return `${q.city}|${q.region}|${q.countryCode}|${q.district}`.toLowerCase()
}

function cachePath(dataDir: string, key: string): string {
  const hash = createHash('sha256').update(key).digest('hex').slice(0, 16)
  return join(dataDir, 'places', `${hash}.json`)
}

function isGeoResult(value: unknown): value is GeoResult {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    typeof value.latitude === 'number' &&
    typeof value.longitude === 'number'
  )
}

function isCacheFile(value: unknown, key: string): value is CacheFile {
  if (!isRecord(value) || value.key !== key || !Array.isArray(value.queries)) return false
  const place = value.place
  if (!isRecord(place) || typeof place.queried_at !== 'number' || !isRecord(place.result)) return false
  const result = place.result
  return isGeoResult(result.city) && (result.district === null || isGeoResult(result.district))
}

async function readCache(dataDir: string, key: string): Promise<CacheFile | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(cachePath(dataDir, key), 'utf8'))
    return isCacheFile(parsed, key) ? parsed : null
  } catch {
    return null
  }
}

async function writeCache(dataDir: string, file: CacheFile): Promise<void> {
  const path = cachePath(dataDir, file.key)
  await mkdir(join(dataDir, 'places'), { recursive: true })
  await writeFile(path, JSON.stringify(file, null, 2) + '\n', 'utf8')
}

async function search(
  ctx: ToolContext,
  trace: Trace,
  name: string,
  countryCode: string
): Promise<GeoResult[]> {
  const params = new URLSearchParams({ name })
  if (countryCode) params.set('countryCode', countryCode)
  params.set('language', 'en')
  params.set('count', '10')
  const { json } = await requestJson(ctx, trace, '地名', GEOCODING_SERVICE, `${GEOCODING_URL}?${params}`)
  if (!isRecord(json)) return failStep(ctx, trace, '地名', GEOCODING_SERVICE, '内容不对：不是对象')
  if (json.results === undefined) return []
  if (!Array.isArray(json.results) || !json.results.every(isGeoResult)) {
    return failStep(ctx, trace, '地名', GEOCODING_SERVICE, '内容不对：results 缺少名称或坐标')
  }
  return json.results
}

function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = Math.PI / 180
  const dLat = (bLat - aLat) * rad
  const dLon = (bLon - aLon) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

export interface ResolvedPlace {
  place: Place
  cached: CacheFile | null
}

export async function resolvePlace(
  ctx: ToolContext,
  trace: Trace,
  q: PlaceQuery
): Promise<ResolvedPlace | null> {
  const key = cacheKey(q)
  const cached = await readCache(ctx.dataDir, key)
  if (cached) return { place: cached.place.result, cached }

  const cityResults = await search(ctx, trace, q.city, q.countryCode)
  const region = q.region.toLowerCase()
  const city =
    (region ? cityResults.find((r) => (r.admin1 ?? '').toLowerCase().startsWith(region)) : undefined) ?? cityResults[0]
  if (!city) {
    ctx.log.error(`天气查询失败：步骤=地名，服务=${GEOCODING_SERVICE}，原因=没有找到地点，地名=${trace.query}，时段=${trace.period}`)
    return null
  }

  let district: GeoResult | null = null
  if (q.district) {
    const districtResults = await search(ctx, trace, q.district, q.countryCode)
    district =
      districtResults.find(
        (r) =>
          r.admin2 === city.name ||
          distanceKm(city.latitude, city.longitude, r.latitude, r.longitude) <= DISTRICT_MAX_KM
      ) ?? null
  }
  return { place: { city, district }, cached: null }
}

export async function saveQuery(
  ctx: ToolContext,
  q: PlaceQuery,
  resolved: ResolvedPlace,
  period: Period,
  raw: RawBodies
): Promise<void> {
  const now = Date.now()
  const file: CacheFile = resolved.cached ?? {
    key: cacheKey(q),
    place: { queried_at: now, result: resolved.place },
    queries: []
  }
  file.queries.push({ queried_at: now, period, raw })
  try {
    await writeCache(ctx.dataDir, file)
  } catch (err) {
    ctx.log.error(`天气插件写缓存失败：${err instanceof Error ? err.message : String(err)}`)
  }
}
