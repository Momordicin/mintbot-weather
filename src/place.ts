// mintbot-weather/src/place.ts — 地名查询（Open-Meteo geocoding）、地点文件与名字索引
// 用法：resolvePlace 按名字查索引再查地名；saveQuery 把一次查询的原始数据追加进地点文件
// 对应文件：src/http.ts、main.ts

import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { failStep, isRecord, requestJson } from './http.ts'
import type { GeoResult, LegacyPlaceFile, Period, Place, PlaceFile, PlaceQuery, RawBodies, ToolContext, Trace } from './types.ts'

const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search'
const GEOCODING_SERVICE = 'geocoding-api.open-meteo.com'
const DISTRICT_MAX_KM = 30
const INDEX_FILE = 'index.json'
const PLACE_FILE_NAME = /^\d+(-\d+)?\.json$/

export function placeName(q: PlaceQuery): string {
  return `${q.city}|${q.region}|${q.countryCode}|${q.district}`.toLowerCase()
}

function placesDir(dataDir: string): string {
  return join(dataDir, 'places')
}

function fileNameFor(place: Place): string {
  return `${place.city.id}${place.district ? `-${place.district.id}` : ''}.json`
}

function isGeoResult(value: unknown): value is GeoResult {
  return (
    isRecord(value) &&
    typeof value.id === 'number' &&
    typeof value.name === 'string' &&
    typeof value.latitude === 'number' &&
    typeof value.longitude === 'number'
  )
}

function hasPlaceData(value: Record<string, unknown>): boolean {
  const place = value.place
  if (!Array.isArray(value.queries) || !isRecord(place) || typeof place.queried_at !== 'number' || !isRecord(place.result)) {
    return false
  }
  const result = place.result
  return isGeoResult(result.city) && (result.district === null || isGeoResult(result.district))
}

function isPlaceFile(value: unknown): value is PlaceFile {
  return (
    isRecord(value) &&
    Array.isArray(value.names) &&
    value.names.every((n) => typeof n === 'string') &&
    hasPlaceData(value)
  )
}

function isLegacyPlaceFile(value: unknown): value is LegacyPlaceFile {
  return isRecord(value) && typeof value.key === 'string' && !Array.isArray(value.names) && hasPlaceData(value)
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return null
  }
}

async function readPlaceFile(dataDir: string, file: string): Promise<PlaceFile | null> {
  const parsed = await readJson(join(placesDir(dataDir), file))
  return isPlaceFile(parsed) ? parsed : null
}

async function writePlaceFile(dataDir: string, file: string, data: PlaceFile): Promise<void> {
  await mkdir(placesDir(dataDir), { recursive: true })
  await writeFile(join(placesDir(dataDir), file), JSON.stringify(data, null, 2) + '\n', 'utf8')
}

async function writeIndex(dataDir: string, index: Map<string, string>): Promise<void> {
  await mkdir(placesDir(dataDir), { recursive: true })
  await writeFile(join(placesDir(dataDir), INDEX_FILE), JSON.stringify(Object.fromEntries(index), null, 2) + '\n', 'utf8')
}

function addName(data: PlaceFile, name: string): boolean {
  if (data.names.includes(name)) return false
  data.names.push(name)
  return true
}

async function migrateLegacy(
  ctx: ToolContext,
  dir: string,
  current: Map<string, PlaceFile>,
  legacy: Map<string, { file: string; data: LegacyPlaceFile }[]>
): Promise<void> {
  for (const [target, olds] of legacy) {
    try {
      const base = current.get(target)
      const names = base ? [...base.names] : []
      const queries = base ? [...base.queries] : []
      let place = base?.place
      for (const { data } of [...olds].sort((a, b) => a.data.place.queried_at - b.data.place.queried_at)) {
        if (!names.includes(data.key)) names.push(data.key)
        queries.push(...data.queries)
        if (!place || data.place.queried_at > place.queried_at) place = data.place
      }
      if (!place) continue
      queries.sort((a, b) => a.queried_at - b.queried_at)
      const merged: PlaceFile = { names, place, queries }
      await writePlaceFile(ctx.dataDir, target, merged)
      current.set(target, merged)
      for (const { file } of olds) if (file !== target) await unlink(join(dir, file))
    } catch (err) {
      ctx.log.error(`天气插件迁移旧地点文件失败：${target}，${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

async function rebuildIndex(ctx: ToolContext): Promise<Map<string, string>> {
  const dir = placesDir(ctx.dataDir)
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return new Map()
  }
  const current = new Map<string, PlaceFile>()
  const legacy = new Map<string, { file: string; data: LegacyPlaceFile }[]>()
  for (const file of entries) {
    if (!file.endsWith('.json') || file === INDEX_FILE) continue
    const parsed = await readJson(join(dir, file))
    if (isPlaceFile(parsed)) {
      if (PLACE_FILE_NAME.test(file)) current.set(file, parsed)
    } else if (isLegacyPlaceFile(parsed)) {
      const target = fileNameFor(parsed.place.result)
      legacy.set(target, [...(legacy.get(target) ?? []), { file, data: parsed }])
    }
  }
  await migrateLegacy(ctx, dir, current, legacy)
  const index = new Map<string, string>()
  for (const [file, data] of current) for (const name of data.names) index.set(name, file)
  try {
    await writeIndex(ctx.dataDir, index)
  } catch (err) {
    ctx.log.error(`天气插件写名字索引失败：${err instanceof Error ? err.message : String(err)}`)
  }
  return index
}

async function loadIndex(ctx: ToolContext): Promise<Map<string, string>> {
  const parsed = await readJson(join(placesDir(ctx.dataDir), INDEX_FILE))
  if (isRecord(parsed) && Object.values(parsed).every((v) => typeof v === 'string')) {
    return new Map(Object.entries(parsed) as [string, string][])
  }
  return rebuildIndex(ctx)
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
    return failStep(ctx, trace, '地名', GEOCODING_SERVICE, '内容不对：results 缺少编号、名称或坐标')
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

async function searchPlace(ctx: ToolContext, trace: Trace, q: PlaceQuery): Promise<Place | null> {
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
  return { city, district }
}

export interface ResolvedPlace {
  place: Place
  file: string
  data: PlaceFile
}

export async function resolvePlace(
  ctx: ToolContext,
  trace: Trace,
  name: string,
  q: PlaceQuery | null,
  extraName: string
): Promise<ResolvedPlace | null> {
  const index = await loadIndex(ctx)
  const known = index.get(name)
  let file = ''
  let data: PlaceFile | null = null
  let dirty = false
  if (known && PLACE_FILE_NAME.test(known)) {
    data = await readPlaceFile(ctx.dataDir, known)
    if (data) file = known
  }
  if (!data) {
    if (!q) return null
    const place = await searchPlace(ctx, trace, q)
    if (!place) return null
    file = fileNameFor(place)
    data = await readPlaceFile(ctx.dataDir, file)
    if (!data) {
      data = { names: [], place: { queried_at: Date.now(), result: place }, queries: [] }
      dirty = true
    }
  }
  if (addName(data, name)) dirty = true
  if (extraName && addName(data, extraName)) dirty = true
  if (dirty) {
    try {
      await writePlaceFile(ctx.dataDir, file, data)
      for (const n of data.names) index.set(n, file)
      await writeIndex(ctx.dataDir, index)
    } catch (err) {
      ctx.log.error(`天气插件写地点文件失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return { place: data.place.result, file, data }
}

export async function saveQuery(ctx: ToolContext, resolved: ResolvedPlace, period: Period, raw: RawBodies): Promise<void> {
  resolved.data.queries.push({ queried_at: Date.now(), period, raw })
  try {
    await writePlaceFile(ctx.dataDir, resolved.file, resolved.data)
  } catch (err) {
    ctx.log.error(`天气插件写地点文件失败：${err instanceof Error ? err.message : String(err)}`)
  }
}
