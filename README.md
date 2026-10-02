# pi-ark-usage

在 pi TUI 中显示**火山引擎方舟 Coding Plan / Agent Plan** 的套餐用量，数据直接来自火山方舟 OpenAPI `GetCodingPlanUsage`（AK/SK 签名，官方 [`@volcengine/openapi`](https://github.com/volcengine/volc-sdk-nodejs) SDK 的 Signer）。

```
1% 4h38m | 15% 5d4h | 54% 23d4h | 3m ago
```

## 特性

- **AK/SK 直连 OpenAPI**：不走子进程、不依赖 SSO 登录态；凭据只从环境变量或配置文件读取，本扩展不保存、不上传任何 Key
- **三个周期同屏**：session（会话）/ weekly（周）/ monthly（月），并显示各周期重置倒计时
- **Powerline 状态段（唯一展示位）**：通过 `ctx.ui.setStatus("ark-usage", …)` 发布单行摘要（`1% 4h38m | 15% 5d4h | 54% 23d4h | 3m ago`，固定按 session/weekly/monthly 顺序），显示在 [pi-powerline-footer](https://www.npmjs.com/package/pi-powerline-footer) 上；百分比按阈值绿/黄/红着色，时间部分紫色，分隔符跟随主题 `thinkingHigh`（编辑器边框色），末尾的「上次刷新」用 `dim` 渲染以示区隔。不安装 powerline 时也可通过内置 footer 的 extension statuses 区域或 `/arkusage` 查看
- **上次刷新时间**：状态段末尾显示距今多久前**成功**刷新过（分钟精度：`just now` / `3m ago` / `4h38m ago` / `5d4h ago`）。抓取失败时沿用上一次成功的时间，因此该值持续变大即表示刷新已经失败或长时间未刷新
- **阈值着色**：低用量绿色（<50%）、接近上限黄色（50–79%）、超过红线红色（≥80%，默认值，可用 `/arkset` 调整）
- **持久化缓存**：重启 pi 后立即显示上次快照（`~/.pi/agent/pi-ark-usage/cache.json`，0600 权限，临时文件原子写入）
- 可选空闲自动刷新（默认关闭）

## 前置条件

1. 火山引擎 AK/SK（具有方舟/Coding Plan 查询权限），按以下顺序解析：

   1. 环境变量 `VOLC_ACCESSKEY` / `VOLC_SECRETKEY`（可选 `VOLC_SESSION_TOKEN`）
   2. `~/.volc/config`，JSON 格式（与官方 SDK 默认路径一致）：

   ```json
   { "VOLC_ACCESSKEY": "AKXXX", "VOLC_SECRETKEY": "SKXXX" }
   ```

   建议将文件权限设为 0600。

2. pi 版本 >= 0.86（扩展机制）。

> 注：OpenAPI 返回的是凭据所属账号的套餐用量，`/arkset product|seat` 仅影响展示映射，接口本身不支持按产品/Seat 过滤。

## 安装

开发期可直接加载本地文件：

```bash
pi --extension ~/Documents/pi-ark-usage/extensions/index.ts
```

发布到 npm 后可用 pi 包机制安装：

```bash
pi install npm:pi-ark-usage
```

## 命令

| 命令 | 说明 |
|---|---|
| `/arkcheck` | 强制刷新用量，并以通知形式展示当前各周期百分比 |
| `/arkusage` | 查看当前套餐各周期用量及重置时间 |
| `/arkset` | 查看/修改设置（见下） |

### `/arkset` 用法

无参数查看当前设置：

```text
/arkset
```

| 用法 | 说明 |
|---|---|
| `/arkset yellow <n>` | 黄色阈值（百分比，默认 40），须低于红线 |
| `/arkset red <n>` | 红色阈值（百分比，默认 80），须高于黄线 |
| `/arkset auto <分钟>` | 空闲自动刷新间隔，0–30 的整数，`0` 关闭（默认 5 分钟） |
| `/arkset product <id>` | 展示映射的产品：`auto`（默认）/ `coding-plan` / `agent-plan` / `coding-plan-team` / `agent-plan-team` |
| `/arkset seat <id>` | 团队版指定 SeatID；`/arkset seat none` 清除 |
| `/arkset lang <zh\|en>` | UI language, default English |
| `/arkset reset` | 恢复全部默认设置 |

### 产品选择规则

- `/arkset product` 非 `auto` 时，固定展示指定产品。
- `auto`（默认）：
  1. 按当前模型的 provider 映射（`coding-plan` → coding-plan 等）；
  2. 映射不到时，显示最近一次成功抓取的已订阅产品。

## 刷新时机

| 时机 | 行为 |
|---|---|
| 会话启动 | 后台非阻塞抓取；先显示磁盘缓存 |
| 切换模型/provider | 产品可能变化，立即抓取 |
| `agent_start` | 建立本轮基线（缓存 1 小时内有效；否则限时 3 秒补抓，超时沿用缓存） |
| `agent_settled` | 本轮结算抓取，并与基线对比标注消耗 |
| `/arkcheck` | 手动强制刷新 |
| 可选自动刷新 | 默认每 5 分钟（`/arkset auto` 可调 0–30，`0` 关闭） |

> 注意：`auto` 设置会持久化到磁盘 cache；旧版本用户若曾显式设过 `0`，升级后仍是关闭，需手动 `/arkset auto 5` 开启。

## 工作原理

1. 用官方 `@volcengine/openapi` 的 `Signer` 对 `POST open.volcengineapi.com?Action=GetCodingPlanUsage&Version=2024-01-01`（service `ark`，region `cn-beijing`）做 V4 签名后 fetch。
2. 解析 `Result.QuotaUsage[]`（`Level/Percent/ResetTimestamp`，秒级时间戳转 `+08:00` ISO 字符串），做结构与取值校验。
3. 快照存入内存 Map，并以原子写（tmp 文件 + rename）持久化到 `~/.pi/agent/pi-ark-usage/`。
4. 摘要通过 `ctx.ui.setStatus("ark-usage", …)` 发布到 extension status，由 pi-powerline-footer 渲染到 powerline 行；每分钟 ticker 在空闲时重发，保持重置倒计时与「上次刷新」时长显示为最新。

## 开发

```bash
npm install
npm run typecheck
```

## License

MIT
