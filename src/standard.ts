// mintbot-weather/src/standard.ts — 读取 metadata.json 里的 standard.errors
// 用法：import { errors } 取三条失败文案，locationNotFound(query) 填入地名
// 对应文件：metadata.json、main.ts

import { readFileSync } from 'node:fs'

interface Metadata {
  standard: { errors: { no_location: string; location_not_found: string; network: string } }
}

const metadata: Metadata = JSON.parse(readFileSync(new URL('../metadata.json', import.meta.url), 'utf8'))

export const errors = metadata.standard.errors

export function locationNotFound(query: string): string {
  return errors.location_not_found.replace('{query}', query)
}
