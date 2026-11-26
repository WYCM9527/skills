# model-team

Cursor 按需触发的多模型协作工作流。平时默认不介入，只在输入 `/model-team` 或明确说出「开启多模型协作」「用多模型协作来做」时启用，配合 Plan 模式按「规划 → 拍板 → 执行」跑完大任务。

## 角色分工

| 角色 | 位置 | 默认模型 | 职责 |
| --- | --- | --- | --- |
| 主代理 | 当前对话 | 当前所选模型（建议 Claude Opus） | 听懂需求、拆解任务、前端与视觉实现、验收子代理产物、向用户汇报 |
| `advisor` | 子代理（只读） | `gemini-4-neon-xhigh` | 大方案独立给第二份方案；拍板前审流程与文案草稿、实现后按需补审新增部分（不评视觉） |
| `backend-worker` | 子代理 | `claude-opus-5-5-max` | 接口已定死、与页面无关的成块后端、算法、数据处理与性能优化 |
| `browser-worker` | 子代理 | `claude-opus-5-5-max` | 多步或需登录后台的网页操作、多来源大型联网调研（规划阶段只看不改） |

配套的三个子代理定义在 `assets/agents/` 下，需要一并放入 Cursor 的 `agents/` 目录。

## 安装

### 方式一：克隆仓库一键安装（本机或 Remote-SSH 服务器）

在运行 Agent 的那台机器上执行（Remote-SSH 开发时需在服务器终端执行）：

```bash
git clone https://github.com/WYCM9527/skills.git /tmp/wycm9527-skills
bash /tmp/wycm9527-skills/model-team/scripts/install.sh
```

默认写入 `~/.cursor/skills/model-team/` 和 `~/.cursor/agents/{advisor,backend-worker,browser-worker}.md`。

若使用 Cursor CLI（CLI 不读取 `~/.cursor/agents/`）或只想对单个项目启用，改用 `--project` 写入项目目录：

```bash
bash /tmp/wycm9527-skills/model-team/scripts/install.sh --project /absolute/path/to/repo
```

### 方式二：通过 `npx skills` 安装技能后再补装子代理

```bash
npx skills add WYCM9527/skills --skill model-team
bash ~/.cursor/skills/model-team/scripts/install.sh --agents-only
```

若 `npx skills` 将技能装到了 `~/.agents/skills/model-team/`，把第二行路径改成对应目录即可。

安装完成后，在已打开的远程窗口里执行一次 `Reload Window`，并新开一个对话使新子代理生效。

## 使用

1. 按 `Shift+Tab` 切到 Plan 模式，输入 `/model-team` 加你的需求（或在消息里写「用多模型协作来做」）。
2. 规划阶段主代理按需调用 `browser-worker`（只看不改）和 `advisor`（独立方案 + 审流程与文案草稿），把分工写成待办放进计划。
3. 你确认计划并在本机点击 `Build`（不要选 `Build in Cloud`，云端 VM 读不到用户目录里的子代理）。
4. 执行阶段主代理后台派发 `backend-worker`、自己完成前端，并对计划外新增的文案与交互做一次补审后汇报。

## 目录结构

```text
model-team/
├── SKILL.md                       # 协作分工与规划/拍板/执行节奏
├── README.md                      # 安装与使用说明
├── scripts/
│   └── install.sh                 # 安装技能与三个配套子代理
└── assets/
    └── agents/
        ├── advisor.md
        ├── backend-worker.md
        └── browser-worker.md
```
