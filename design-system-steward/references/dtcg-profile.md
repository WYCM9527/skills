# DTCG 2025.10 CSS Profile

本 Skill 以 [DTCG Format 2025.10](https://www.designtokens.org/tr/2025.10/format/) 的 token、group 和 alias 语义为基础，但只承诺构建一个经过 fixture 验证的 CSS 子集。

验证器执行的是离线的结构、类型、alias 目标和循环检查，**不声称替代完整官方 JSON Schema**。完整 Schema 包含当前 CSS Profile 不构建的类型与规则；如以后引入它，应固定离线版本、保留相应通知，并另做升级测试。

## 当前 CSS Profile

已被构建 fixture 覆盖的基础类型包括：结构化 sRGB `color`、`dimension`、`duration`、`number`、`fontWeight`、`fontFamily`、`cubicBezier`、`string`、`boolean`，以及指向这些 Token 的完整 alias，例如 `"{color.blue.500}"`。结构化 dimension 与 duration 会分别输出为 CSS 长度和时间值；cubicBezier 会输出为 `cubic-bezier(...)`。

最小示例：

```json
{
  "color": {
    "blue": {
      "500": {
        "$type": "color",
        "$value": {
          "colorSpace": "srgb",
          "components": [0.145, 0.388, 0.922],
          "alpha": 1
        }
      }
    },
    "action": {
      "primary": {
        "$type": "color",
        "$value": "{color.blue.500}"
      }
    }
  }
}
```

## 有意不在当前 Profile 自动构建的类型

`shadow`、`gradient`、`typography`、`border`、`transition`、复杂 `strokeStyle`、`link` 和 `other` 仍可能是合法 DTCG 数据，但没有经过本 Skill 的 CSS 构建 Profile 验证。验证器必须明确报告它们为当前 Profile 不支持，而不是偷偷降级成字符串。

这不是对 DTCG 的否定：DTCG 规定格式与引用；三层命名、目录拆分、Scope 树、平台输出和哪些复合类型先上线，都是项目治理决定。

## 构建、引用与 Scope 组合

Core 使用 `transformGroup: "css"` 与受控 CSS variables formatter，并保持稳定的无文件头输出。固定 Style Dictionary `5.5.2`，升级前必须重新运行 fixture 构建和 Guard。

Scope 不是又一份完整构建输入：构建一个 Scope 时，Core 与祖先 Scope 作为 `include`，当前 Scope Token 作为 `source`。这样当前 Scope 可以继续使用父级 alias，而兄弟 Scope 不会互相覆盖。生成器只把当前 Scope 的实际 delta 写到 `dist/scopes/<id>.css`，并按父→子顺序更新 `dist/index.css`。

Style Dictionary 的 DTCG 与 CSS 处理会继续演进，不能把未来版本行为当成当前 Profile 的保证。
