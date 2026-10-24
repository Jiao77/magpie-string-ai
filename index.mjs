// magpie-string-ai: String AI (string.ink) 专用 Magpie 供应商插件
// 基于 Sub2API 架构深度定制：支持聚合四大分组 API Key（Claude、OpenAI、国产模型、其他模型），
// 单账号统一管理，按模型智能分发路由，并在用量中心呈现单一整洁卡片与钱包额度。

import {
  ID,
  NAME,
  loadCachedModelKeys,
  extractAllKeys,
  resolveBaseURL,
  aggregateUsage,
  discoverAllModels,
  findKeyForModel,
  memModelKeys,
} from "./lib/helpers.mjs"

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
