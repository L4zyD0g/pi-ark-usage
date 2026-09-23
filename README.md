# pi-ark-usage

在 pi TUI 中显示**火山引擎方舟 Coding Plan / Agent Plan** 的套餐用量，数据来自 [`arkcli`](https://www.volcengine.com/docs/82379) 的 `arkcli usage plan`。

```
Volc Usage: sess 30%(reset after 4h18m) / wk 37%(reset after 4d) / mo 19%(reset after 29d)        now
```

## 特性

- **零额外鉴权**：认证完全由 arkcli 自己管理（SSO / profile），本扩展不接触、不保存任何 API Key
- **三个周期同屏**：session（会话）/ weekly（周）/ monthly（月），并显示各周期重置倒计时
- **阈值着色**：低用量绿色、接近上限黄色、超过红线红色
- **单轮消耗**：以每轮对话开始前的快照为基线，结算时标注各周期增量（如 `(+2)`）
- **产品切换感知**：在个人版/团队版、Coding Plan/Agent Plan 之间切换时标注 `(变更)`；套餐周期重置时标注 `(已重置)`
- **持久化缓存**：重启 pi 后立即显示上次快照（`~/.pi/agent/pi-ark-usage/cache.json`，0600 权限，临时文件原子写入）
- 可选空闲自动刷新（默认关闭）

## 前置条件

1. 已安装并登录 arkcli：

   ```bash
   arkcli --help
   arkcli auth login   # 按 arkcli 自己的流程完成 SSO 登录
   ```

   也可用环境变量 `PI_ARK_USAGE_ARKCLI` 指定 arkcli 的绝对路径。

2. pi 版本 >= 0.86（扩展机制）。

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
| `/arkset auto <分钟>` | 空闲自动刷新间隔，0–30 的整数，`0` 关闭（默认关闭） |
| `/arkset product <id>` | 固定查询的产品：`auto`（默认）/ `coding-plan` / `agent-plan` / `coding-plan-team` / `agent-plan-team` |
| `/arkset seat <id>` | 团队版指定 SeatID；`/arkset seat none` 清除 |
| `/arkset lang <zh\|en>` | UI language, default English |
| `/arkset reset` | 恢复全部默认设置 |

### 产品选择规则

- `/arkset product` 非 `auto` 时，固定查询指定产品（团队版可配合 `seat`）。
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
| 可选自动刷新 | 仅当 `/arkset auto` 开启时按间隔执行 |

## 工作原理

1. 通过 `child_process.execFile` 调用 `arkcli usage plan --format json`（固定产品时加 `--product`，团队版可加 `--seat`）。
2. 对返回 JSON 做结构校验（产品 ID、period 百分比、长度上限），只保留已订阅且含周期数据的条目。
3. 快照存入内存 Map，并以原子写（tmp 文件 + rename）持久化到 `~/.pi/agent/pi-ark-usage/`。
4. Widget 通过 `ctx.ui.setWidget(..., { placement: "belowEditor" })` 渲染在编辑器下方；age（抓取于多久前）右对齐，终端过窄时自动折成两行。

## 开发

```bash
npm install
npm run typecheck
```

## License

MIT
