# PlayCaptcha

麻将胡牌真人验证 Web Component。组件只提供麻将玩法，保留两条验证路径：

- **本地纯前端**：浏览器生成与服务端一致的 7 张等价待胡牌和 12 张候选牌，本地判断结果。
- **服务端签发 v3**：浏览器只获得受保护的手牌 raster、12 张候选 raster 和不透明 candidate ID，服务端原子消费并判题。

## 安装

```bash
pnpm add @bluesyoung/playcaptcha
```

```ts
import '@bluesyoung/playcaptcha'
```

## 本地纯前端

不配置验证端点或 transport 时，组件直接运行本地麻将挑战：

```html
<play-captcha locale="zh-CN"></play-captcha>

<script type="module">
  import '@bluesyoung/playcaptcha'

  document.querySelector('play-captcha').addEventListener('verify', (event) => {
    console.log(event.detail) // { mode: 'mahjong', source: 'local' }
  })
</script>
```

`show-answer` 只影响本地提示；默认关闭。错误选择不会发送 `verify`，正确选择发送一个 bubbling、composed 的事件。

## 服务端签发 v3

```html
<play-captcha
  verify-endpoint="/api/captcha"
  verify-timeout="10000"
  verification-data='{"scene":"login"}'
></play-captcha>
```

宿主也可以设置 `verificationTransport`。它优先于 `verify-endpoint`，接收 `{ request, signal }`，必须遵守相同 v3 语义。

### 创建请求

```json
{
  "version": 3,
  "action": "create",
  "mode": "mahjong",
  "context": { "scene": "login" }
}
```

### 签发响应

```json
{
  "version": 3,
  "challengeId": "random-opaque-id",
  "mode": "mahjong",
  "challenge": {
    "handImage": "/captcha/assets/random-hand-token",
    "candidates": [{ "id": "random-candidate-id", "image": "/captcha/assets/random-image-token" }]
  },
  "expiresAt": "2026-08-04T12:00:00Z"
}
```

`candidates` 必须恰好 12 项，所有 `id` 和 `image` 唯一。响应不得暴露麻将牌 ID、素材编号、答案或映射。

### 验证请求

```json
{
  "version": 3,
  "action": "verify",
  "challengeId": "random-opaque-id",
  "completion": { "selected": "random-candidate-id" },
  "context": { "scene": "login" }
}
```

### 验证响应

```json
{
  "verified": true,
  "token": "business-bound-result-token",
  "expiresAt": "2026-08-04T12:02:00Z"
}
```

失败响应：

```json
{ "verified": false, "message": "Challenge unavailable" }
```

## 服务端安全与实现清单

协议与语言、框架、存储无关。Go、Node、Java、Python、Rust 或其他实现同等有效；不要求 Node runtime、Sharp 或任何特定库。

- 严格验证 v3 HTTP schema；远端 create 只接受 `mode: "mahjong"`。
- 使用高熵 challenge/candidate/asset ID；不得在 JSON、DOM、URL 或日志暴露牌义。
- 将 challenge 绑定到 HttpOnly session、账号或其他认证主体，并保存 canonical context digest。
- 手牌合成为新的 raster；候选重新编码并使用每轮唯一的受保护资源 token。
- raster 只允许未过期、未消费且主体匹配的 challenge 读取；返回 `private, no-store` 和 `nosniff`。
- 第一次格式合法的 verify 必须通过比较并交换原子消费，无论答案对错；随后撤销全部资源。
- 按主体、IP、账号和业务对象限制 create/verify，记录异常速度、失败率和重复创建。
- 成功 token 必须短期、一次性，绑定业务动作、主体、context digest 和 challenge ID；业务接口必须再次验证。
- 分布式生产部署使用共享数据库/缓存及受保护对象存储，不能依赖单进程内存。

完整规范：[`docs/compose/specs/2026-07-28-opaque-mahjong-v3-backend-design.md`](docs/compose/specs/2026-07-28-opaque-mahjong-v3-backend-design.md)。

仓库保留一个可运行的非规范教学适配器：

```bash
pnpm run playground:server
```

它选择 Node、Sharp/WebP、Vite middleware、端口 `4186` 和进程内 `Map`，只用于演示协议。生产实现仍负责共享状态、原子消费、context digest、限速和业务 token 绑定。

## 属性与 JavaScript 配置

| 属性                | Property           | 说明                                 |
| ------------------- | ------------------ | ------------------------------------ |
| `locale`            | `locale`           | `zh-CN` 或 `en`；区域值归一化        |
| `title`             | `title`            | 自定义标题；移除后恢复当前语言默认值 |
| `show-answer`       | `showAnswer`       | 仅本地挑战显示胡牌答案               |
| `asset-base`        | `assetBase`        | 麻将素材目录，HTTP(S) hierarchy URL  |
| `verify-endpoint`   | `verifyEndpoint`   | v3 JSON endpoint；留空启用本地验证   |
| `verify-timeout`    | `verifyTimeout`    | 1000–60000ms，默认 10000ms           |
| `verification-data` | `verificationData` | 作为 `context` 发送的 JSON 字符串    |

JavaScript-only 配置：

```ts
const captcha = document.querySelector('play-captcha')

captcha.verificationHeaders = { Authorization: 'Bearer …' }
captcha.verificationCredentials = 'include'
captcha.verificationTransport = async ({ request, signal }) => {
  const response = await fetch('/api/captcha', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  })
  return response.json()
}
```

Transport 会收到 `AbortSignal`；刷新、配置变化、超时和断开连接会取消过期请求。已签发挑战到期时组件自动创建新题。服务端拒绝、HTTP、网络、超时、配置和响应 schema 错误通过 `verification-error` 报告。

## 事件

### `verify`

```ts
type PlayCaptchaVerifyEventDetail = {
  mode: 'mahjong'
  source: 'local' | 'remote'
  token?: string
  expiresAt?: string
}
```

仅本地正确答案或服务端明确返回 `{ "verified": true }` 后发送。

### `verification-error`

```ts
type PlayCaptchaVerificationErrorDetail = {
  kind: 'config' | 'rejected' | 'http' | 'network' | 'timeout' | 'response'
  message: string
  status?: number
}
```

两个事件都 bubbling 且 composed。

## 麻将 API

包入口导出：

```ts
import {
  PlayCaptcha,
  PLAY_CAPTCHA_LOCALES,
  DEFAULT_PLAY_CAPTCHA_LOCALE,
  normalizeLocale,
  MAHJONG_TILE_IDS,
  MAHJONG_TILE_META,
  createMahjongChallenge,
  isMahjongTileId,
  isStandardMahjongWin,
  sortMahjongTiles,
  winningTilesForHand,
  parseIssuedChallenge,
  parseVerificationResponse,
  type MahjongChallenge,
  type MahjongTileId,
  type MahjongWaitType,
  type PlayCaptchaLocale,
  type PlayCaptchaVerifyEventDetail,
  type PlayCaptchaVerificationTransport,
} from '@bluesyoung/playcaptcha'
```

组件公开只读状态：

- `currentMahjongTarget`：本地题的胡牌答案；远端题为 `null`。
- `mahjongHand`：本地题用于界面展示的 7 张等价待胡手牌；远端题为空数组。

## 素材与自托管

默认资源由 bundler 解析。自托管时，`asset-base` 表示 **`majiang_ui` 目录本身**：

```html
<play-captcha asset-base="/assets/majiang_ui/"></play-captcha>
```

组件从该目录读取 `<assetValue>.webp`。只接受 HTTP(S) hierarchy URL；query/hash 会被移除，缺失尾部 `/` 会自动补全。

npm 包包含：

- `assets/majiang_ui/` 下 42 张最新 WebP：标准牌 34 张，加 `46.webp`–`53.webp` 八张花/季节牌。

当前规则只引用 34 张标准牌，因此消费者 bundle 的运行时资源精确为 34 张 WebP。八张花/季节牌仅作为完整最新源素材打包，不进入当前挑战 bundle。

Classic script：

```html
<script src="https://cdn.example/playcaptcha/dist/playcaptcha.umd.js"></script>
<play-captcha></play-captcha>
```

保持 `dist/playcaptcha.umd.js` 到包根 `assets/` 的相对布局；UMD 同步注册一个组件，不创建匿名 AMD module，不暴露受支持的全局 API。浏览器边界为 Chrome 80、Safari 13；不支持 IE11。

## 交互与无障碍

- 本地与服务端都展示 7 张等价待胡手牌、12 张候选牌；候选按 5/4/3 三排排列且每张横向可达。
- 摇杆或 `←` / `→` 移动，红色按钮或 Space/Enter 抓取和投放。
- 190px compact 与 440px 标准布局保留同一逻辑坐标和可达性。
- 帮助层非 modal，可由 Escape 关闭并恢复焦点。
- 支持 `prefers-reduced-motion`，刷新会清除 carry、反馈和成功状态。

## 本地开发

```bash
pnpm install
pnpm run dev
pnpm run check
pnpm run test
pnpm run build
pnpm run test:consumer
```

仓库使用 pnpm 管理 workspace。consumer gate 内部用 `npm pack` 和 `npm install` 模拟 npm 消费者，验证真实 tarball、UMD/native fixture 及 bundle 资源；这不是仓库依赖安装命令。

## Playground 与验证命令

- 根页面：本地纯前端麻将。
- Vanilla：DOM property、原生事件和宽度切换。
- React：ref、原生事件订阅和宽度切换。
- Vue：ref、mount/unmount、事件订阅和宽度切换。
- Server：远端 v3；非规范 Node 教学适配器。

```bash
pnpm check
pnpm test
pnpm build
pnpm run test:consumer-contract
node scripts/verify-package-consumer.mjs --skip-build
pnpm run playgrounds:check
pnpm run playgrounds:build
pnpm run test:playgrounds-contract
node scripts/verify-playgrounds.mjs --skip-build
```

`pnpm run playgrounds:check` 先构建一次根包，再直接检查四个 playground。`prepublishOnly` 串联根 check/test/build、consumer contract、四个 playground 的直接 check/build、playground contract 和最终产物验证。

## 来源与致谢

本仓库最初的 PlayCaptcha 概念与实现来源归功于 [mortspace/playcaptcha](https://github.com/mortspace/playcaptcha)。

## 许可证

MIT。
