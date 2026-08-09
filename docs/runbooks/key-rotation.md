# 密钥轮换 Runbook（P2-15）

> 目标：安全地更换 JWT 签名密钥（`JWT_SECRET`），**不强制所有在线用户重新登录**。
> 双密钥过渡期机制：新密钥签发新 token，旧密钥仅用于校验存量 token。

## 背景

登录签发与请求校验都依赖 `JWT_SECRET`。直接改它会立刻使所有未过期 token 失效 → 全站用户被踢下线（PDA 现场尤其中断作业）。

代码已支持双密钥（v0.4.67+）：
- `JWT_SECRET`：新密钥（**签发**新 token + 校验）
- `JWT_SECRET_PREVIOUS`：旧密钥（可选，**仅校验**存量 token，不签发）
- 校验逻辑：先用新密钥 `jwt.verify`，失败且配置了旧密钥则用旧密钥兜底；只有两者都失败才判无效

## 常规轮换步骤（不停服）

1. **生成新密钥**（≥32 位随机串）：
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```

2. **部署过渡配置**：在 `backend/.env`（或生产环境变量）中：
   - 把当前 `JWT_SECRET` 的值移到 `JWT_SECRET_PREVIOUS`
   - 把新密钥写入 `JWT_SECRET`
   - 重启后端（过渡期内旧 token 仍有效，用户无感知）

3. **验证过渡期**：
   ```bash
   curl -H "Authorization: Bearer <旧token>" https://<域名>/api/health   # 应仍有效（200）
   curl -H "Authorization: Bearer <新token>" https://<域名>/api/health   # 应有效（200）
   ```

4. **等待旧 token 自然过期**（默认 7 天，`JWT_EXPIRES_IN` 可调），或等所有活跃用户重登后：
   移除 `JWT_SECRET_PREVIOUS`，重启后端，轮换完成。

## 紧急轮换（密钥疑似泄露，立刻生效）

泄露场景不需要过渡期——**立即踢掉所有旧 token**：
- 直接替换 `JWT_SECRET` 为新值（**不设** `JWT_SECRET_PREVIOUS`），重启后端
- 所有用户需重新登录（这是泄露场景的正确代价，防止攻击者用旧 token 继续访问）

## 注意事项

- `JWT_SECRET` 长度必须 ≥32（env.js 强校验，不足拒绝启动）。
- 密钥**绝不写入代码/文档/提交**；只存在于 `.env`（已 gitignore）与部署环境变量。
- `token_version` 仍是改密码/禁用用户时立即使旧 token 失效的独立机制，与密钥轮换正交。
- 生产服务器：`deploy/production*.json` 或系统环境变量中改（不要改仓库内文件）。
