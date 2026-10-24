// magpie-string-ai: String AI (string.ink) 专用 Magpie 供应商插件
// 基于 Sub2API 架构深度定制：支持聚合四大分组 API Key（Claude、OpenAI、国产模型、其他模型），
// 单账号统一管理，按模型智能分发路由，并在用量中心呈现单一整洁卡片与钱包额度。

import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

const ID = "string-ai"
const NAME = "String AI"
const DEFAULT_BASE_URL = "https://www.string.ink/v1"
const CHAT = "@ai-sdk/openai-compatible"
const MESSAGES = "@ai-sdk/anthropic"
const RESPONSES = "@ai-sdk/openai"
const TIMEOUT = 15_000

const HOUR = 3600
const DAY = 24 * HOUR
const SPANS = { "5h": ["5 小时", 5 * HOUR], "1d": ["24 小时", DAY], "7d": ["7 天", 7 * DAY] }
const LEVELS = ["low", "medium", "high"]

function cleanBaseURL(url) {
  const s = String(url || DEFAULT_BASE_URL).trim().replace(/\/+$/, "")
  return s.endsWith("/v1") ? s : `${s}/v1`
}

function rootURL(baseURL) {
  return baseURL.replace(/\/v1$/, "")
}

function cacheFile() {
  const home = homedir()
  const dir = process.env.XDG_CACHE_HOME || (process.platform === "darwin" ? join(home, "Library", "Caches") : join(home, ".cache"))
  return join(dir, "magpie-string-ai", "model-keys.json")
}

let memModelKeys = {}

async function loadCachedModelKeys() {
  try {
    const text = await readFile(cacheFile(), "utf8")
    memModelKeys = JSON.parse(text) || {}
  } catch {}
  return memModelKeys
}

async function saveCachedModelKeys(mapping) {
  const file = cacheFile()
  try {
    await mkdir(dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify(mapping))
    await rename(tmp, file)
    memModelKeys = mapping
  } catch {}
}

export function extractAllKeys(auth, options = {}) {
  const list = []
  const seen = new Set()

  function add(k, category, label) {
    if (typeof k !== "string") return
    for (const part of k.split(/[\r\n,;\s]+/)) {
      const trimmed = part.trim()
      if (trimmed && trimmed.startsWith("sk-") && !seen.has(trimmed)) {
        seen.add(trimmed)
        list.push({ key: trimmed, category, label })
      }
    }
  }

  // 1. 从 options 提取
  if (options && typeof options === "object") {
    add(options.claudeKey, "claude", "Claude 分组")
    add(options.openaiKey, "openai", "OpenAI / ChatGPT 分组")
    add(options.domesticKey, "domestic", "国产模型 分组")
    add(options.otherKey, "other", "其他模型 分组")
    add(options.key, "primary", "主分组 / 默认")
    if (Array.isArray(options.keys)) {
      for (const k of options.keys) add(k, "extra", "自定义分组")
    }
  }

  // 2. 从 auth metadata 提取
  add(auth?.metadata?.claudeKey, "claude", "Claude 分组")
  add(auth?.metadata?.openaiKey, "openai", "OpenAI / ChatGPT 分组")
  add(auth?.metadata?.domesticKey, "domestic", "国产模型 分组")
  add(auth?.metadata?.otherKey, "other", "其他模型 分组")
  add(auth?.metadata?.extraKeys, "extra", "自定义分组")

  // 3. 从 auth.key 提取
  add(auth?.key, "primary", "主分组 / 默认")

  return list
}

export function resolveBaseURL(auth, options = {}) {
  return cleanBaseURL(options?.baseURL || auth?.metadata?.baseURL)
}

async function fetchJSON(baseURL, path, key) {
  const root = rootURL(baseURL)
  const fullPath = path.startsWith("/v1") ? `${root}${path}` : `${baseURL}${path}`
  const res = await fetch(fullPath, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT),
  })
  const text = await res.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {}
  if (!res.ok) {
    const why = body?.error?.message ?? body?.message ?? body?.code ?? (text.trim().slice(0, 200) || res.statusText)
    const err = new Error(`${res.status} ${why}`)
    if (res.status === 401) err.signIn = "expired"
    throw err
  }
  if (body === undefined) throw new Error(`${path}: 非合法 JSON 响应`)
  return body
}

function npmOf(id) {
  const s = id.toLowerCase()
  if (/^claude-/.test(s) || s.startsWith("anthropic/")) return MESSAGES
  if (/^(gpt-|o\d|codex-|chatgpt-)/.test(s)) return RESPONSES
  return CHAT
}

const variantsOf = (levels) => Object.fromEntries(levels.map((l) => [l, {}]))

function runtimeModel(m, baseURL, told, was, known) {
  const npm = npmOf(m.id)
  const kept = was?.variants && typeof was.variants === "object" && Object.keys(was.variants).length ? was.variants : undefined
  const reasoning = told?.length ? true : known ? known.reasoning : !!kept || npm !== CHAT || /think|reason/i.test(m.id)
  const levels = told?.length ? told : known?.levels?.length ? known.levels : undefined
  return {
    id: m.id,
    providerID: ID,
    name: m.name,
    api: { id: m.id, url: baseURL, npm },
    status: "active",
    headers: {},
    options: {},
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: known ? { ...known.limit } : { context: 0, output: 0 },
    capabilities: {
      temperature: true,
      reasoning,
      attachment: npm !== CHAT,
      toolcall: true,
      input: { text: true, image: npm !== CHAT, audio: false, video: false, pdf: false },
      output: { text: true, image: false, audio: false, video: false, pdf: false },
      interleaved: typeof known?.interleaved === "object" ? { ...known.interleaved } : (known?.interleaved ?? false),
    },
    release_date: "",
    variants: !reasoning ? {} : levels ? variantsOf(levels) : known ? variantsOf(LEVELS) : (kept ?? variantsOf(LEVELS)),
  }
}

const MODELS_DEV = "https://models.dev/api.json"
let askingKnown

async function knownModels() {
  if (askingKnown) return askingKnown
  askingKnown = (async () => {
    try {
      const res = await fetch(MODELS_DEV, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(5000) })
      if (!res.ok) return new Map()
      const body = await res.json()
      const out = new Map()
      for (const [pid, p] of Object.entries(body ?? {})) {
        for (const [id, m] of Object.entries(p?.models ?? {})) {
          if (out.has(id) || typeof m?.canonical_model_id !== "string") continue
          if (m.canonical_model_id.split("/")[0] === pid) {
            const levels = []
            for (const o of Array.isArray(m.reasoning_options) ? m.reasoning_options : []) {
              if (o?.type === "effort" && Array.isArray(o.values)) {
                for (const v of o.values) if (v && !levels.includes(v)) levels.push(v)
              }
            }
            out.set(id, {
              reasoning: m.reasoning === true,
              levels,
              interleaved: m.interleaved === true ? true : typeof m.interleaved?.field === "string" ? { field: m.interleaved.field } : false,
              limit: { context: m.limit?.context || 0, output: m.limit?.output || 0 },
            })
          }
        }
      }
      return out
    } catch {
      return new Map()
    } finally {
      askingKnown = undefined
    }
  })()
  return askingKnown
}

async function fetchEfforts(baseURL, key) {
  try {
    const root = rootURL(baseURL)
    const res = await fetch(`${root}/backend-api/codex/models`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT),
    })
    if (!res.ok) return {}
    const body = await res.json()
    const out = {}
    for (const m of Array.isArray(body?.models) ? body.models : []) {
      if (typeof m?.slug !== "string" || !Array.isArray(m.supported_reasoning_levels)) continue
      const levels = []
      for (const l of m.supported_reasoning_levels) {
        const e = typeof l === "string" ? l : l?.effort
        if (typeof e === "string" && e.trim() && !levels.includes(e.trim())) levels.push(e.trim())
      }
      if (levels.some((l) => l !== "none")) out[m.slug] = levels
    }
    return out
  } catch {
    return {}
  }
}

async function discoverAllModels(baseURL, keys, was = {}) {
  const official = await knownModels()
  const out = {}
  const mapping = { ...memModelKeys }

  await Promise.all(
    keys.map(async (item) => {
      const key = item.key
      try {
        const [res, told] = await Promise.all([fetchJSON(baseURL, "/v1/models", key), fetchEfforts(baseURL, key)])
        for (const m of res?.data ?? []) {
          if (!m?.id) continue
          mapping[m.id] = key
          if (!out[m.id]) {
            const displayName = typeof m.display_name === "string" && m.display_name ? m.display_name : m.id
            out[m.id] = runtimeModel({ id: m.id, name: displayName }, baseURL, told[m.id], was?.[m.id], official.get(m.id))
          }
        }
      } catch (err) {
        console.error(`magpie-string-ai: [${item.label}] 拉取模型失败: ${err.message}`)
      }
    }),
  )

  await saveCachedModelKeys(mapping)
  return out
}

export function findKeyForModel(modelId, keys) {
  if (memModelKeys[modelId]) return memModelKeys[modelId]
  const lower = modelId.toLowerCase()
  if (/^claude-/i.test(lower) || lower.startsWith("anthropic/")) {
    const k = keys.find((x) => x.category === "claude")
    if (k) return k.key
  }
  if (/^(gpt-|o\d|codex-|chatgpt-)/i.test(lower) || lower.startsWith("openai/")) {
    const k = keys.find((x) => x.category === "openai")
    if (k) return k.key
  }
  if (/deepseek|qwen|glm|kimi|moonshot|minimax|doubao|baichuan|yi-/i.test(lower)) {
    const k = keys.find((x) => x.category === "domestic")
    if (k) return k.key
  }
  if (/gemini|grok|llama|mistral|composer/i.test(lower)) {
    const k = keys.find((x) => x.category === "other")
    if (k) return k.key
  }
  return keys[0]?.key || ""
}

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : undefined)
const money = (v) => "$" + (Math.round(v * 100) / 100).toFixed(2)
const pct = (used, limit) => (limit > 0 ? (100 * used) / limit : used > 0 ? 100 : 0)
const after = (iso, secs) => {
  const t = iso ? Date.parse(iso) : NaN
  return Number.isFinite(t) ? new Date(t + secs * 1000).toISOString() : undefined
}

function win(name, used, limit, extra = {}) {
  return { name, used: pct(used, limit), display: money(used) + " / " + money(limit), ...extra }
}

export async function aggregateUsage(baseURL, keys) {
  let balance
  const windows = []
  const seenKeys = new Set()

  await Promise.all(
    keys.map(async (item) => {
      const key = item.key
      if (seenKeys.has(key)) return
      seenKeys.add(key)
      try {
        const u = await fetchJSON(baseURL, "/v1/usage", key)
        if (num(u?.balance) !== undefined && balance === undefined) {
          balance = u.balance
        }
        if (u?.mode === "quota_limited") {
          const q = u.quota
          if (q && num(q.limit) > 0) windows.push(win(`${item.label} 总额度`, num(q.used) ?? 0, q.limit))
          for (const r of Array.isArray(u.rate_limits) ? u.rate_limits : []) {
            const limit = num(r?.limit)
            if (!(limit > 0)) continue
            const [spanName, spanSec] = SPANS[r.window] ?? [String(r.window ?? "窗口"), undefined]
            windows.push(
              win(`${item.label} ${spanName}`, num(r.used) ?? 0, limit, {
                ...(r.reset_at ? { resetsAt: r.reset_at } : {}),
                ...(spanSec ? { span: spanSec } : {}),
              }),
            )
          }
        } else if (u?.subscription && typeof u.subscription === "object") {
          const s = u.subscription
          const told = (v) => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? v : undefined)
          const rows = [
            ["24 小时", s.daily_usage_usd, s.daily_limit_usd, DAY, told(s.daily_reset_at)],
            ["7 天", s.weekly_usage_usd, s.weekly_limit_usd, 7 * DAY, told(s.weekly_reset_at) ?? after(s.weekly_window_start, 7 * DAY)],
            ["30 天", s.monthly_usage_usd, s.monthly_limit_usd, 30 * DAY, told(s.monthly_reset_at)],
          ]
          for (const [name, used, limit, span, resetsAt] of rows) {
            if (!(num(limit) > 0)) continue
            windows.push(win(`${item.label} ${name}`, num(used) ?? 0, limit, { span, ...(resetsAt ? { resetsAt } : {}) }))
          }
        }
      } catch {}
    }),
  )

  return {
    plan: "钱包余额",
    balance: balance !== undefined ? money(balance) : undefined,
    windows,
  }
}

export default async function StringAIPlugin({ client } = {}, options = {}) {
  await loadCachedModelKeys()

  return {
    auth: {
      provider: ID,
      async loader(getAuth) {
        const auth = await getAuth()
        if (auth?.type !== "api" || !auth.key) return {}
        const keys = extractAllKeys(auth, options)
        if (!keys.length) return {}
        const baseURL = resolveBaseURL(auth, options)
        if (typeof client?.auth?.set === "function" && auth.accountId !== NAME) {
          try {
            await client.auth.set({ path: { id: ID }, body: { ...auth, accountId: NAME } })
          } catch {}
        }
        return { baseURL, apiKey: keys[0].key }
      },
      methods: [
        {
          type: "api",
          label: "String AI API Key (主密钥或默认 Key)",
          placeholder: "sk-… (输入任一有效 Key 激活账号)",
          prompts: [
            { type: "text", key: "claudeKey", message: "Claude 分组 API Key (选填，留空使用主 Key)", placeholder: "sk-… 留空则跳过" },
            { type: "text", key: "openaiKey", message: "OpenAI / ChatGPT 分组 API Key (选填，留空使用主 Key)", placeholder: "sk-… 留空则跳过" },
            { type: "text", key: "domesticKey", message: "国产模型 分组 API Key (选填，留空使用主 Key)", placeholder: "sk-… 留空则跳过" },
            { type: "text", key: "otherKey", message: "其他模型 (Gemini/Grok) 分组 API Key (选填，留空使用主 Key)", placeholder: "sk-… 留空则跳过" },
            { type: "text", key: "baseURL", message: "String AI 接入地址 (选填，默认 https://www.string.ink/v1)", placeholder: "https://www.string.ink/v1" },
            { type: "text", key: "name", message: "账号备注名称 (可选)", placeholder: "String AI" },
          ],
        },
      ],
      async usage(getAuth) {
        const auth = await getAuth()
        const keys = extractAllKeys(auth, options)
        if (!keys.length) return { error: "未配置 String AI API Key" }
        const baseURL = resolveBaseURL(auth, options)
        const res = await aggregateUsage(baseURL, keys)
        return { user: NAME, ...res }
      },
    },
    provider: {
      id: ID,
      async models(provider, { auth } = {}) {
        const keys = extractAllKeys(auth, options)
        if (!keys.length) return provider?.models ?? {}
        const baseURL = resolveBaseURL(auth, options)
        try {
          return await discoverAllModels(baseURL, keys, provider?.models)
        } catch (e) {
          if (e?.signIn) throw e
          return provider?.models ?? {}
        }
      },
    },
    "chat.headers": async (params, out) => {
      const modelId = params?.model?.id
      if (!modelId) return
      const keys = extractAllKeys(params?.auth, options)
      const targetKey = memModelKeys[modelId] || findKeyForModel(modelId, keys.length ? keys : [{ key: params?.provider?.options?.apiKey, category: "primary" }].filter(Boolean))
      if (targetKey) {
        out.headers["authorization"] = `Bearer ${targetKey}`
        out.headers["x-api-key"] = targetKey
      }
    },
    config(cfg) {
      cfg.provider ??= {}
      cfg.provider[ID] = { ...(cfg.provider[ID] ?? {}), name: NAME }
    },
  }
}
