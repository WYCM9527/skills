# 浏览器工具引导

本 skill 的取证只走 `agent-browser`（Playwright 驱动的 CLI）：`open` → `wait --load networkidle` → `set viewport` / `set media` → `eval --stdin` 读运行时样式 → `hover` / `focus` 探针。不做静态抓取，不用截图当主证据，不静默换成别的浏览器栈。

## 检测

```bash
node <本 skill>/scripts/check-browser-tooling.mjs        # 打印 node / npm / agent-browser 是否可用与下一步
agent-browser --help                                       # 能跑就行
```

## 缺失时

1. 安装或把它暴露到 `PATH`（团队统一的安装方式以维护者说明为准；装完 `agent-browser doctor` 自检）。
2. 首次运行浏览器内核缺失时 `agent-browser install`。
3. 网络 / 沙箱受限导致安装失败：申请对应权限后重试，不要直接改用 Playwright 脚本或 fetch HTML。
4. 用户明确拒绝安装：说明本 skill 只在 agent-browser 上运行，停下；不要用截图或源码猜 token。

## 用到的能力（都已验证）

| 用途 | 命令 |
| --- | --- |
| 隔离会话 | `--session <name>`（脚本自动生成；登录态复用时自己指定并加 `--restore`） |
| 视口 | `set viewport <w> <h>` |
| 系统偏好（暗色探测） | `set media dark` / `set media light` + `reload` |
| 运行时读样式 | `eval --stdin`（脚本把探针整段喂进去，返回 JSON 字符串；无输出上限） |
| 交互探针 | `hover <css选择器>`、`focus <css选择器>`、`scrollintoview <css选择器>` |
| 等待 | `wait --load networkidle`、`wait <ms>` |

## 常见故障

| 现象 | 处理 |
| --- | --- |
| `eval` 返回空 / 非 JSON | 页面还在 hydration：加大 `--settle`（默认 800ms）；或站点 CSP 拦了 eval——记进 AUDIT，换页面 |
| 颜色全是 `oklch(...)` / `color(srgb …)` | 正常，`lib/color.mjs` 会换算 |
| 悬停探针全部「无变化」 | 站点 hover 靠 JS 加类且延迟 > 180ms，或元素被遮挡；可跳过（`--no-hover`）后手动补 `action.primary-hover` 并标 `[推断]` |
| 暗色两条路都「无变化」 | 站点切换靠 JS + localStorage：用 agent-browser 手动点切换按钮后，另开一次只带 `--no-dark` 的取证，把两份证据分别当 Core 与另一模式处理（当前版本需手工合并 delta） |
| 跨域样式表 `inaccessibleSheets > 0` | 断点 / 焦点规则可能读不全，但计算样式不受影响 |
| 登录墙 | `agent-browser --session s --restore open <url>` 手动登录后，脚本加 `--session s` |
