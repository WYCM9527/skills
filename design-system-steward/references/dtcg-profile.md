# DTCG 2025.10 CSS Profile

本 Skill 以 [DTCG Format 2025.10](https://www.designtokens.org/tr/2025.10/format/) 的 token、group 和 alias 语义为基础，但 V1 只承诺构建一个经过 Style Dictionary 5.5.2 验证的 CSS 子集。

验证器执行的是该 Profile 的离线结构、类型、alias 目标和循环检查，不声称替代完整官方 JSON Schema。完整 Schema 包含当前 CSS Profile 不构建的类型与规则；如以后引入它，应固定离线版本、保留相应通知，并另做升级测试。

## 可构建类型

- `color`：结构化 `srgb` 色彩值；
- `dimension`：CSS 单位（优先 `px`、`rem`、`em`、`%`、`vw`、`vh`）；
- `duration`：`ms` 或 `s`；
- `number`、`fontWeight`、`fontFamily`、`cubicBezier`、`string`、`boolean`；
- 指向上述 token 的完整 alias，例如 `"{color.blue.500}"`。

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

## 有意不在 V1 自动构建的类型

`shadow`、`gradient`、`typography`、`border`、`transition`、复杂 `strokeStyle`、`link` 和 `other` 仍可能是合法 DTCG 数据，但没有经过本 Skill 的 CSS 构建 profile 验证。验证器会明确报告它们为当前 profile 不支持，而不是偷偷降级成字符串。

这不是对 DTCG 的否定：DTCG 规定格式与引用；三层命名、目录拆分、平台输出和哪些复合类型先上线，都是项目治理决定。

## 构建和引用

生成的 `style-dictionary.config.mjs` 使用：

- `transformGroup: "css"`；
- `format: "css/variables"`；
- `outputReferences: true`，让可保留的 alias 输出为 `var(--...)`；
- `showFileHeader: false`，让连续构建保持字节稳定，便于 Guard 检查。

请固定 Style Dictionary `5.5.2`，并在升级前运行 fixture 构建和 Guard。Style Dictionary 对 DTCG 的支持会继续演进，不能把未来版本的行为当成 V1 的保证。
