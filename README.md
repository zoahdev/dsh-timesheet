# dsh-timesheet

[![CI](https://github.com/zoahdev/dsh-timesheet/actions/workflows/ci.yml/badge.svg)](https://github.com/zoahdev/dsh-timesheet/actions)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![dsh-plugin](https://img.shields.io/badge/dsh--plugin-verified-blue)](https://github.com/topics/dsh-plugin)

Timesheet for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh): **turn-based time tracking from session logs**.

Token dashboards tell you what you spent; this one tells you **how much wall-clock time** you spent with your agents — totals, per-day, per-project, per-provider, per-source, plus tool-call counts, failure rates, and time-to-first-token. Zero runtime dependencies; reads `*.jsonl` session logs only.

## Install

```sh
dsh plugin add dsh-timesheet
```

Or run standalone:

```sh
npx dsh-timesheet ~/.codex/sessions
```

## CLI

```sh
dsh-timesheet <dir> [--json]
```

- `dir` must contain `*.jsonl` session logs (e.g. `~/.codex/sessions`, a dsh session directory, or any exported session folder).
- Prints a Markdown report; `--json` prints the machine-readable `dsh-timesheet/v1` envelope.
- Exit codes: `0` report generated, `1` no turns found / warnings, `2` usage/IO error.

```sh
npx dsh-timesheet ~/.codex/sessions
npx dsh-timesheet ~/.codex/sessions --json
```

## In-harness usage (agent-callable)

Ask your dsh agent:

> 给我出一份时间报表：`timesheet`，目录指向会话日志目录。
> Give me a timesheet report: `timesheet` with `dir` set to your session-log directory.

The tool returns a `dsh-timesheet/v1` report:

```json
{
  "schema": "dsh-timesheet/v1",
  "target": "~/.codex/sessions",
  "ok": true,
  "scannedFiles": 42,
  "sessions": 42,
  "turns": 310,
  "totalDurationMs": 64800000,
  "failedTurns": 7,
  "toolCalls": 1284,
  "byDay": [ { "key": "2026-08-18", "turns": 22, "durationMs": 5400000, "ttftMs": 110000, "failed": 1, "avgMs": 245454 } ],
  "byProject": [ ... ],
  "byProvider": [ ... ],
  "bySource": [ ... ],
  "warnings": []
}
```

## What it reads

Session logs use the standard dsh event envelope:

- `session_meta` → session id, workspace (`cwd`), model provider, source (desktop / CLI / VS Code / ...)
- `event_msg` / `task_started` → turn begin
- `event_msg` / `task_complete` → turn end, `duration_ms`, `time_to_first_token_ms`, `error`
- `response_item` / `function_call` → tool-call counts

Files ending in `.jsonl` are parsed; malformed lines are skipped with a warning. Compressed `.jsonl.zstd` logs are not read directly — export or decompress them first (the format is plain JSONL after decompression).

## Why it exists

- The ecosystem tracks tokens and cost, but **no plugin tracked wall-clock time** — the WakaTime-shaped hole in the dsh plugin registry.
- Answering “where did my 6 hours go?” is the first step to spending agent time deliberately.
- Zero runtime dependencies, read-only by construction: it never writes to your sessions.

## Development

```sh
pnpm install
pnpm typecheck
pnpm build
pnpm test
pnpm test:integration
```

CI runs the dsh-plugin-doctor preflight, unit tests, packed-artifact integration (real `timesheet` invocation), and a fresh-profile `dsh web` boot smoke on Windows.

## License

MIT © 2026 zoahdev

---

# dsh-timesheet（中文）

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）的**时间报表插件**：从会话日志做基于 turn 的时间跟踪。

Token 仪表盘告诉你花了多少钱；这个插件告诉你**真实花了多少墙钟时间**——总计、按天、按项目、按模型供应商、按来源，外加工具调用次数、失败率和首 token 延迟。零运行时依赖，只读 `*.jsonl` 会话日志。

## 安装

```sh
dsh plugin add dsh-timesheet
```

独立使用：

```sh
npx dsh-timesheet ~/.codex/sessions
```

## CLI

```sh
dsh-timesheet <dir> [--json]
```

- `dir` 需要包含 `*.jsonl` 会话日志（如 `~/.codex/sessions`、dsh 会话目录或导出的会话目录）。
- 输出 Markdown 报告；`--json` 输出机器可读的 `dsh-timesheet/v1` 报告。
- 退出码：`0` 生成成功，`1` 没有 turn / 有警告，`2` 用法/IO 错误。

```sh
npx dsh-timesheet ~/.codex/sessions
npx dsh-timesheet ~/.codex/sessions --json
```

## 在 harness 内使用（agent 可调用）

对 agent 说：

> 给我出一份时间报表：`timesheet`，目录指向会话日志目录。

工具返回 `dsh-timesheet/v1` 报告（结构见英文版 JSON 示例）。

## 读取什么

会话日志使用标准 dsh 事件结构：

- `session_meta` → 会话 id、工作区（`cwd`）、模型供应商、来源（desktop / CLI / VS Code / ...）
- `event_msg` / `task_started` → turn 开始
- `event_msg` / `task_complete` → turn 结束、`duration_ms`、`time_to_first_token_ms`、`error`
- `response_item` / `function_call` → 工具调用计数

只解析 `.jsonl`，畸形行跳过并告警。压缩的 `.jsonl.zstd` 不直接读取——先解压（解压后就是纯 JSONL）。

## 为什么需要它

- 生态里到处是 token 和成本统计，但**没有人统计墙钟时间**——这是 dsh 插件注册表里 WakaTime 形状的空洞。
- 回答“我 6 小时去哪了”是开始有意支配 agent 时间的第一步。
- 零运行时依赖、天然只读：永远不会写你的会话。

## 开发

```sh
pnpm install
pnpm typecheck
pnpm build
pnpm test
pnpm test:integration
```

CI 跑 dsh-plugin-doctor 预检、单元测试、打包集成（真实 `timesheet` 调用）、Windows 全新 profile 的 `dsh web` 启动冒烟。

## 许可证

MIT © 2026 zoahdev
## Related ecosystem tools

- [dsh-dep-audit](https://github.com/zoahdev/dsh-dep-audit) - dependency supply-chain hygiene
- [dsh-quality-score](https://github.com/zoahdev/dsh-quality-score) - plugin quality scorecard + full-registry leaderboard
- [dsh-ecosystem](https://github.com/zoahdev/dsh-ecosystem) - health scan, impact, trend, live dashboard
- [dsh-tutorials](https://github.com/zoahdev/dsh-tutorials) - bilingual plugin pipeline tutorials
## FAQ

- **How do I install?** dsh plugin add dsh-timesheet or run the CLI directly (see README).
- **Does it need an API key?** No.
- **Is it read-only?** Yes by default; any write/apply is an explicit flag.
## Examples

See the README for full CLI usage. Quick start:

```sh
npx dsh-timesheet --help
```

