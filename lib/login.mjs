import { createHash, randomBytes, randomUUID } from "node:crypto"
import { accountRequest, readAccount, sessionAuth, SITE } from "./account.mjs"

export const CLIENT_ID = "stringai-launcher"
export const REDIRECT_URI = "http://127.0.0.1:18465/auth/callback"

export async function browserLogin() {
  const verifier = randomBytes(32).toString("base64url")
  const deviceId = randomUUID()
  // 使用 String AI 官方 Launcher 的公开 PKCE 授权流程，不申请托管密钥。
  const pending = await accountRequest("/launcher/auth/start", { body: {
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    device_id: deviceId,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    app_version: "1.3.0",
  } })
  const authorize = new URL(pending.auth_url)
  const expires = Date.parse(pending.expires_at)
  const destination = new URL(authorize.searchParams.get("redirect"), SITE)
  if (authorize.origin !== SITE || authorize.pathname !== "/login" || authorize.username || authorize.password ||
      destination.origin !== SITE || destination.pathname !== "/launcher/auth/authorize" ||
      typeof pending.state !== "string" || !pending.state || destination.searchParams.get("state") !== pending.state ||
      !Number.isFinite(expires) || expires <= Date.now()) {
    throw new Error("String AI 返回的授权链接或有效期不正确")
  }
  return {
    url: authorize.href,
    instructions: "在 String AI 官网完成登录和验证。跳转到 127.0.0.1 后，复制地址栏里的完整地址并粘贴到这里；即使页面显示无法访问也可以。本机和远程 Docker 都无需配置回调端口。",
    method: "code",
    async callback(value) {
      if (Date.now() >= expires) throw new Error("String AI 授权已过期，请重新登录")
      let callback
      try {
        callback = new URL(value.trim())
      } catch {
        throw new Error("请粘贴浏览器地址栏里的完整回调地址")
      }
      const target = new URL(REDIRECT_URI)
      if (callback.origin !== target.origin || callback.pathname !== target.pathname || callback.username || callback.password) {
        throw new Error("String AI 回调地址不正确，请复制本次登录跳转后的完整地址")
      }
      if (callback.searchParams.get("state") !== pending.state) {
        throw new Error("String AI 回调不属于本次登录，请重新登录")
      }
      if (callback.searchParams.has("error")) throw new Error("String AI 未完成授权，请重新登录")
      const code = callback.searchParams.get("code")
      if (!code) throw new Error("String AI 回调地址缺少授权码")
      const session = await accountRequest("/launcher/auth/exchange", { body: {
        client_id: CLIENT_ID,
        device_id: deviceId,
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier,
        code,
        state: pending.state,
      } })
      const tokens = sessionAuth(session)
      const { user, keys } = await readAccount(tokens.access)
      return { type: "success", ...tokens, accountId: user.email,
        metadata: { email: user.email, userId: user.id, keyCount: keys.length } }
    },
  }
}
