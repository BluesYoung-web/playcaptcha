# PlayCaptcha Opaque Mahjong v3 后端实现规范

## 目标与边界

本规范描述语言、框架和存储无关的服务端功能。Go、Node、Java、Python、Rust 或其他语言/框架实现同等有效；协议不要求 Node runtime、Sharp 或任何特定库。仓库中的 `playgrounds/server/server.mjs` 只是非规范的 Node + Sharp + Vite middleware + 内存 `Map` 教学适配器。

v3 降低 JSON/DOM 直接求解风险：浏览器只能获得一张不带牌义的手牌 raster、12 张不带牌义的候选 raster、12 个随机 candidate ID。它不能阻止图像识别，因此生产系统仍须限速、风险分级和业务 token 绑定。

## HTTP 契约

所有 JSON 请求使用同一个应用端点。认证可由 HttpOnly session、应用登录态或网关完成。

### 创建挑战

```json
{
  "version": 3,
  "action": "create",
  "mode": "mahjong",
  "context": { "scene": "login" }
}
```

成功响应：

```json
{
  "version": 3,
  "challengeId": "random-opaque-id",
  "mode": "mahjong",
  "challenge": {
    "handImage": "/captcha/assets/random-hand-token",
    "candidates": [{ "id": "random-candidate-id", "image": "/captcha/assets/random-image-token" }]
  },
  "expiresAt": "2026-07-28T12:00:00Z"
}
```

`candidates` 必须恰好 12 项，所有 `id` 和 `image` 唯一。响应不得包含牌 ID、素材编号、手牌数组、答案、候选映射或可稳定关联牌面的文件名。

### 获取 raster

```http
GET /captcha/assets/{opaque-token}
```

服务端必须验证资源 token 存在、未过期、所属 challenge 未消费，并与创建 challenge 的会话或认证主体一致。响应应使用 `Cache-Control: private, no-store`、`X-Content-Type-Options: nosniff`。资源 URL 不得重定向到固定牌素材。

### 验证

```json
{
  "version": 3,
  "action": "verify",
  "challengeId": "random-opaque-id",
  "completion": { "selected": "random-candidate-id" },
  "context": { "scene": "login" }
}
```

服务端只接受 candidate ID，不接受麻将牌 ID。无论答案正确与否，首次合法格式的验证尝试都必须原子消费 challenge。成功响应：

```json
{
  "verified": true,
  "token": "business-bound-result-token",
  "expiresAt": "2026-07-28T12:02:00Z"
}
```

失败响应：`{ "verified": false, "message": "..." }`。错误信息不应泄露正确候选。

## 持久化模型

```text
ChallengeRecord
  id: opaque high-entropy identifier
  subject: session/account/device binding
  contextDigest: canonical application-context digest
  answerCandidateId: opaque candidate identifier
  candidateMap: candidateId -> internal MahjongTileId
  assetTokens: token -> raster bytes or protected object key
  createdAt, expiresAt
  consumedAt: nullable timestamp
  resultTokenId: nullable identifier
```

内部 `MahjongTileId` 和原始素材路径不得进入客户端可见日志、响应或 URL。分布式部署应使用共享数据库/缓存和受保护对象存储；共享状态、原子比较并交换、context digest、生产限速和业务绑定 token 都是生产实现责任。内存 `Map` 只适合单进程教学示例，不是规范持久层。

## 状态机

```text
missing -> reject
active + asset GET -> active
active + expired -> expired
active + first verify -> consumed (atomic)
consumed + any asset GET/verify -> reject
expired + any operation -> reject
```

消费操作需要比较并交换：`UPDATE ... SET consumed_at=now WHERE id=? AND consumed_at IS NULL AND expires_at>now AND subject=?`。只有影响一行的调用者可以判题。不要先读取、后删除。

## 图像生成不变量

- 手牌必须合成为一张新的 raster，而不是返回 13 个固定资源 URL。
- 候选 raster 需要重新编码；建议加入细微、可读的随机 padding、背景噪声、缩放或色彩扰动，避免按文件哈希建立固定字典。
- 每轮使用新资源 token；不同 challenge 不复用 URL。
- 图片不得包含文本元数据、文件名或响应 header 暗示牌义。
- 可访问性应提供独立的服务端挑战类型；不要用 `alt` 重新暴露牌义。

## 语言无关伪代码

```text
create(subject, context):
  require allowed(subject, context, "create")
  mahjong = generate_single_wait_hand()
  candidate_ids = 12 random opaque ids
  mapping = random bijection(candidate_ids, mahjong.candidates)
  hand_raster = compose_and_randomize(mahjong.hand)
  candidate_rasters = reencode_and_randomize(each mapped tile)
  asset_tokens = store_protected_rasters(subject, challenge_id, ttl)
  atomically store ChallengeRecord(answerCandidateId, mapping, asset_tokens, ttl)
  return only challengeId, handImage URL, [{id, image}], expiresAt

verify(subject, challenge_id, selected_id, context):
  require request schema exactly matches v3
  record = atomically_mark_consumed_if_active_and_bound(challenge_id, subject)
  if no record: reject generic unavailable
  revoke all record asset tokens
  if digest(context) != record.contextDigest: reject generic unavailable
  if selected_id != record.answerCandidateId: reject incorrect
  return mint_business_token(subject, context, short_ttl)
```

## 限速与业务绑定

至少按 subject、IP、账号和业务对象限制 create/verify；记录异常完成速度、失败率和重复创建。结果 token 必须短期、一次性，并绑定实际业务动作、主体、context digest 和 challenge ID。业务接口必须再次验证 token，不能把前端 `verify` 事件当作授权。

## Transport 集成

组件可使用 `verify-endpoint` 内置 HTTP transport，也可由宿主设置 `verificationTransport`。自定义 transport 接收 `{ request, signal }` 并返回已解析 JSON 值；它可以使用任何 HTTP 客户端、SDK、Service Worker 或原生 bridge。两种路径必须连接到同一份上述服务端语义，不能由客户端本地判定远端成功。

## 非规范参考适配器

`pnpm run playground:server` 启动的示例选择 Node、Sharp/WebP、Vite middleware、端口 `4186` 和进程内 `Map`，目的是提供可运行的协议演示。这些都是实现选择。Go 或任意其他语言可使用不同 HTTP 框架、图像库、共享数据库、缓存和对象存储，只要严格满足以上 HTTP schema、状态转换、受保护 raster 生命周期、原子消费、限速及业务 token 绑定要求。
