import assert from "node:assert/strict"
import StringAIPlugin, { extractAllKeys, findKeyForModel, resolveBaseURL } from "../index.mjs"

console.log("=== 开始测试 magpie-string-ai ===")

// 1. 测试 BaseURL 解析
{
  assert.equal(resolveBaseURL({}, {}), "https://www.string.ink/v1")
  assert.equal(resolveBaseURL({}, { baseURL: "https://ai.qpcmqam.cn" }), "https://ai.qpcmqam.cn/v1")
  assert.equal(resolveBaseURL({ metadata: { baseURL: "https://www.string.ink/v1/" } }, {}), "https://www.string.ink/v1")
  console.log("✔ BaseURL 解析测试通过")
}

// 2. 测试多分组 Key 提取
{
  const options = {
    claudeKey: "sk-claude-111",
    openaiKey: "sk-openai-222",
    domesticKey: "sk-domestic-333",
    otherKey: "sk-other-444",
  }
  const keys = extractAllKeys({}, options)
  assert.equal(keys.length, 4)
  assert.equal(keys.find((k) => k.category === "claude")?.key, "sk-claude-111")
  assert.equal(keys.find((k) => k.category === "openai")?.key, "sk-openai-222")
  assert.equal(keys.find((k) => k.category === "domestic")?.key, "sk-domestic-333")
  assert.equal(keys.find((k) => k.category === "other")?.key, "sk-other-444")

  // 测试从 auth metadata 提取
  const auth = {
    key: "sk-primary-999",
    metadata: {
      claudeKey: "sk-claude-meta",
      domesticKey: "sk-domestic-meta",
    },
  }
  const authKeys = extractAllKeys(auth, {})
  assert.equal(authKeys.length, 3)
  assert.equal(authKeys.find((k) => k.category === "primary")?.key, "sk-primary-999")
  assert.equal(authKeys.find((k) => k.category === "claude")?.key, "sk-claude-meta")
  assert.equal(authKeys.find((k) => k.category === "domestic")?.key, "sk-domestic-meta")
  console.log("✔ Key 提取逻辑测试通过")
}

// 3. 测试模型分类与自动路由分发
{
  const keys = [
    { key: "sk-claude-key", category: "claude" },
    { key: "sk-openai-key", category: "openai" },
    { key: "sk-domestic-key", category: "domestic" },
    { key: "sk-other-key", category: "other" },
  ]

  assert.equal(findKeyForModel("claude-3-7-sonnet-20250219", keys), "sk-claude-key")
  assert.equal(findKeyForModel("claude-3-5-sonnet-latest", keys), "sk-claude-key")
  assert.equal(findKeyForModel("gpt-4o", keys), "sk-openai-key")
  assert.equal(findKeyForModel("o1-preview", keys), "sk-openai-key")
  assert.equal(findKeyForModel("o3-mini", keys), "sk-openai-key")
  assert.equal(findKeyForModel("deepseek-chat", keys), "sk-domestic-key")
  assert.equal(findKeyForModel("deepseek-reasoner", keys), "sk-domestic-key")
  assert.equal(findKeyForModel("qwen-max", keys), "sk-domestic-key")
  assert.equal(findKeyForModel("glm-4-plus", keys), "sk-domestic-key")
  assert.equal(findKeyForModel("gemini-2.5-pro", keys), "sk-other-key")
  assert.equal(findKeyForModel("grok-2", keys), "sk-other-key")

  // 当只提供主 Key 时，所有模型优雅回退到主 Key
  const singleKey = [{ key: "sk-all-in-one", category: "primary" }]
  assert.equal(findKeyForModel("claude-3-7-sonnet", singleKey), "sk-all-in-one")
  assert.equal(findKeyForModel("gpt-4o", singleKey), "sk-all-in-one")
  assert.equal(findKeyForModel("deepseek-chat", singleKey), "sk-all-in-one")
  console.log("✔ 模型自动路由分发测试通过")
}

// 4. 测试 Plugin 契约导出
{
  const plugin = await StringAIPlugin()
  assert.equal(typeof plugin.auth?.loader, "function")
  assert.equal(typeof plugin.auth?.usage, "function")
  assert.equal(Array.isArray(plugin.auth?.methods), true)
  assert.equal(typeof plugin.provider?.models, "function")
  assert.equal(typeof plugin["chat.headers"], "function")
  assert.equal(typeof plugin.config, "function")

  // 测试 chat.headers 注入
  const out = { headers: {} }
  await plugin["chat.headers"](
    {
      model: { id: "claude-3-7-sonnet" },
      auth: { metadata: { claudeKey: "sk-claude-direct" } },
    },
    out,
  )
  assert.equal(out.headers["authorization"], "Bearer sk-claude-direct")
  assert.equal(out.headers["x-api-key"], "sk-claude-direct")
  console.log("✔ Magpie Plugin 契约测试通过")
}

console.log("🎉 全部测试顺利通过！")
