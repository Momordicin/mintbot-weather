// mintbot-weather/src/http.ts — 经 ctx.fetch 取 JSON，以及统一的失败记录
// 用法：requestJson 取正文并解析；failStep 记录失败步骤后抛出 CallFailure
// 对应文件：src/place.ts、src/forecast.ts、main.ts

import type { ToolContext, Trace } from './types.ts'

export class CallFailure extends Error {}

export function failStep(
  ctx: ToolContext,
  trace: Trace,
  step: string,
  service: string,
  reason: string
): never {
  ctx.log.error(`天气查询失败：步骤=${step}，服务=${service}，原因=${reason}，地名=${trace.query}，时段=${trace.period}`)
  throw new CallFailure(reason)
}

export async function requestJson(
  ctx: ToolContext,
  trace: Trace,
  step: string,
  service: string,
  url: string,
  headers?: Record<string, string>
): Promise<{ body: string; json: unknown }> {
  if (ctx.signal.aborted) failStep(ctx, trace, step, service, '调用已中止，未发起请求')
  const res = await ctx.fetch(url, headers ? { headers } : undefined)
  if (!res.ok) {
    let reason: string
    if (res.kind === 'http') reason = `HTTP 状态码 ${res.status ?? '未知'}：${res.message}`
    else if (res.kind === 'timeout') reason = `超时：${res.message}`
    else if (res.kind === 'connect') reason = `连接错误 ${res.code ?? '无 code'}：${res.message}`
    else reason = `已中止：${res.message}`
    failStep(ctx, trace, step, service, reason)
  }
  let json: unknown
  try {
    json = JSON.parse(res.body)
  } catch {
    failStep(ctx, trace, step, service, '内容不对：不是 JSON')
  }
  return { body: res.body, json }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
