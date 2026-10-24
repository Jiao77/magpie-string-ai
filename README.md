# magpie-string-ai

[String AI (string.ink)](https://www.string.ink/) 专用 [Magpie](https://usemagpie.ai/) 供应商插件。

针对基于 **Sub2API** 架构的 String AI 深度优化：支持单一账号下绑定四大分组 Key，按模型自动路由分发，并在 Magpie 用量看板中统一聚合为**单张整洁卡片**，呈现钱包余额与各分组额度。

---

## 🌟 核心特性

- **单卡片呈现（Single Card View）**：在 Magpie 用量监控中心中仅展示一张精简的“String AI”卡片，彻底避免多分组多账号导致的卡片重复刷屏。
- **多分组 Key 统一聚合**：单个 String AI 账号内可同时配置：
  - `claudeKey`：Anthropic / Claude 专属分组
  - `openaiKey`：OpenAI / ChatGPT (GPT-4o, o1, o3, Codex) 专属分组
  - `domesticKey`：国产模型（DeepSeek, 通义千问, GLM, Kimi 等）专属分组
  - `otherKey`：其他模型（Google Gemini, xAI Grok, Llama 等）专属分组
  - `key`：默认主分组 / 全模型 Key（任意模型未单独配置特定分组时自动优雅回退）
- **按模型智能分发**：调用 Claude 时自动使用 Claude Key；调用 GPT/o1/o3 时自动使用 OpenAI Key；调用 DeepSeek 时自动使用国模 Key，零手动切换成本。
- **用量与限流窗口聚合**：自动查询 String AI 后台的钱包余额，并汇总各分组的 5小时、24小时、7天速率限制窗口与到期时间。
- **网络接入灵活**：默认使用标准地址 `https://www.string.ink/v1`，同时支持配置官方内地加速节点 `https://ai.qpcmqam.cn/v1`。

---

## 📦 安装方式

### 方式一：在 Magpie 配置文件中引入（推荐）

编辑 `~/.config/magpie/plugins.json`，在 `plugins` 数组中添加：

```json
{
  "plugins": [
    {
      "spec": "github:Jiao77/magpie-string-ai",
      "options": {
        "baseURL": "https://www.string.ink/v1",
        "key": "sk-your-main-or-default-key",
        "claudeKey": "sk-your-claude-group-key",
        "openaiKey": "sk-your-openai-group-key",
        "domesticKey": "sk-your-domestic-group-key",
        "otherKey": "sk-your-other-group-key"
      }
    }
  ]
}
```

配置后重启或重载 Magpie 即可生效。

### 方式二：在终端使用 Magpie CLI 安装

```bash
magpie plugin add github:Jiao77/magpie-string-ai
```

---

## ⚙️ 账号登录与配置

在 Magpie 图标或控制台中添加 `String AI` 供应商：
1. **主 API Key**：填写你的任意有效 String AI 密钥（可作为全分组或默认兜底 Key）。
2. **分组选项（选填）**：
   - **Claude Key**：String AI 控制台中所属 `Claude` 分组的 API Key。
   - **OpenAI Key**：所属 `OpenAI/ChatGPT` 分组的 API Key。
   - **国产模型 Key**：所属 `国产模型` 分组的 API Key。
   - **其他模型 Key**：所属 `其他模型` 分组的 API Key。
   - **Base URL**：留空默认为 `https://www.string.ink/v1`；如遇国内直连延迟可填 `https://ai.qpcmqam.cn/v1`。

---

## 🧪 验证与测试

```bash
# 执行本地自测套件
npm test
```

---

## 📄 开源许可

[MIT License](LICENSE) © 2026 Jiao77
