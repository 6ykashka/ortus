## impl driver notif
### Result
{
  "Уведомления": {
    "box": {
      "top": 63,
      "rightGap": 12
    },
    "dialog": {
      "w": 380,
      "h": 133.8,
      "background-color": "rgb(255, 255, 255)",
      "color": "rgb(28, 42, 38)",
      "border": "1px solid rgb(220, 226, 217)",
      "border-radius": "12px",
      "box-shadow": "rgba(28, 42, 38, 0.18) 0px 16px 40px 0px",
      "padding": "0px",
      "gap": "normal",
      "max-height": "420px",
      "font-size": "14px"
    },
    "head": {
      "w": 378,
      "h": 57,
      "padding": "12px 14px",
      "border-bottom": "1px solid rgb(232, 236, 229)",
      "display": "flex",
      "font-size": "14px",
      "line-height": "20.3px"
    },
    "strong": {
      "w": 94,
      "h": 20.3,
      "font-size": "14px",
      "font-weight": "600",
      "color": "rgb(28, 42, 38)"
    },
    "button": {
      "w": 105.1,
      "h": 32,
      "font-size": "13px",
      "font-weight": "500",
      "color": "rgb(31, 107, 82)",
      "min-height": "32px",
      "padding": "1px 6px",
      "border": "0px none rgb(31, 107, 82)",
      "background-color": "rgba(0, 0, 0, 0)",
      "cursor": "pointer",
      "opacity": "1"
    },
    "children": [
      {
        "text": "Новых событий нет",
        "w": 378,
        "h": 74.8,
        "padding": "28px 16px",
        "border-bottom": "0px none rgb(92, 105, 100)",
        "border-top": "0px none rgb(92, 105, 100)",
        "font-size": "13px",
        "color": "rgb(92, 105, 100)",
        "gap": "normal",
        "text-align": "center",
        "line-height": "18.85px"
      }
    ],
    "leaves": [
      {
        "t": "Новых событий нет",
        "w": 378,
        "h": 74.8,
        "font-size": "13px",
        "font-weight": "400",
        "color": "rgb(92, 105, 100)",
        "text-transform": "none",
        "letter-spacing": "normal",
        "line-height": "18.85px"
      }
    ]
  }
}
### Ran Playwright code
```js
await page.evaluate('() => {\n  const pick = (el, props) => {\n    if (!el) return null;\n    const cs = getComputedStyle(el);\n    const r = el.getBoundingClientRect();\n    const o = { w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 };\n    for (const p of props) o[p] = cs.getPropertyValue(p);\n    return o;\n  };\n  const out = {};\n  for (const d of document.querySelectorAll(\'[role=dialog]\')) {\n    const name = d.getAttribute(\'aria-label\') || d.getAttribute(\'aria-labelledby\');\n    const hb = d.getBoundingClientRect();\n    const head = d.firstElementChild;\n    const btn = d.querySelector(\'button\');\n    const strong = d.querySelector(\'strong\');\n    const rowSel = [...d.children].slice(1);\n    out[name] = {\n      box: { top: hb.top, rightGap: innerWidth - hb.right },\n      dialog: pick(d, [\'background-color\', \'color\', \'border\', \'border-radius\', \'box-shadow\', \'padding\', \'gap\', \'max-height\', \'font-size\']),\n      head: pick(head, [\'padding\', \'border-bottom\', \'display\', \'font-size\', \'line-height\']),\n      strong: pick(strong, [\'font-size\', \'font-weight\', \'color\']),\n      button: pick(btn, [\'font-size\', \'font-weight\', \'color\', \'min-height\', \'padding\', \'border\', \'background-color\', \'cursor\', \'opacity\']),\n      children: rowSel.map((c) => ({ text: c.textContent.slice(0, 60), ...pick(c, [\'padding\', \'border-bottom\', \'border-top\', \'font-size\', \'color\', \'gap\', \'text-align\', \'line-height\']) })),\n      leaves: [...d.querySelectorAll(\'span, div\')]\n        .filter((e) => e.children.length === 0 && e.textContent.trim())\n        .map((e) => ({ t: e.textContent.trim().slice(0, 50), ...pick(e, [\'font-size\', \'font-weight\', \'color\', \'text-transform\', \'letter-spacing\', \'line-height\']) })),\n    };\n  }\n  return out;\n}\n');
```
## impl driver profile
### Result
{
  "Профиль": {
    "box": {
      "top": 63,
      "rightGap": 12
    },
    "dialog": {
      "w": 340,
      "h": 124.6,
      "background-color": "rgb(255, 255, 255)",
      "color": "rgb(28, 42, 38)",
      "border": "1px solid rgb(220, 226, 217)",
      "border-radius": "12px",
      "box-shadow": "rgba(28, 42, 38, 0.18) 0px 16px 40px 0px",
      "padding": "16px",
      "gap": "10px",
      "max-height": "420px",
      "font-size": "14px"
    },
    "head": {
      "w": 306,
      "h": 40.6,
      "padding": "0px",
      "border-bottom": "0px none rgb(28, 42, 38)",
      "display": "block",
      "font-size": "14px",
      "line-height": "20.3px"
    },
    "strong": null,
    "button": {
      "w": 306,
      "h": 40,
      "font-size": "14px",
      "font-weight": "400",
      "color": "rgb(28, 42, 38)",
      "min-height": "40px",
      "padding": "0px 12px",
      "border": "1px solid rgb(205, 213, 203)",
      "background-color": "rgb(255, 255, 255)",
      "cursor": "pointer",
      "opacity": "1"
    },
    "children": [
      {
        "text": "logoutВыйти",
        "w": 306,
        "h": 40,
        "padding": "0px 12px",
        "border-bottom": "1px solid rgb(205, 213, 203)",
        "border-top": "1px solid rgb(205, 213, 203)",
        "font-size": "14px",
        "color": "rgb(28, 42, 38)",
        "gap": "6px",
        "text-align": "center",
        "line-height": "20.3px"
      }
    ],
    "leaves": [
      {
        "t": "Илья Васильев",
        "w": 306,
        "h": 21.8,
        "font-size": "15px",
        "font-weight": "600",
        "color": "rgb(28, 42, 38)",
        "text-transform": "none",
        "letter-spacing": "normal",
        "line-height": "21.75px"
      },
      {
        "t": "Альта Групп",
        "w": 306,
        "h": 18.8,
        "font-size": "13px",
        "font-weight": "400",
        "color": "rgb(92, 105, 100)",
        "text-transform": "none",
        "letter-spacing": "normal",
        "line-height": "18.85px"
      },
      {
        "t": "logout",
        "w": 18,
        "h": 18,
        "font-size": "18px",
        "font-weight": "400",
        "color": "rgb(28, 42, 38)",
        "text-transform": "none",
        "letter-spacing": "normal",
        "line-height": "18px"
      }
    ]
  }
}
### Ran Playwright code
```js
await page.evaluate('() => {\n  const pick = (el, props) => {\n    if (!el) return null;\n    const cs = getComputedStyle(el);\n    const r = el.getBoundingClientRect();\n    const o = { w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 };\n    for (const p of props) o[p] = cs.getPropertyValue(p);\n    return o;\n  };\n  const out = {};\n  for (const d of document.querySelectorAll(\'[role=dialog]\')) {\n    const name = d.getAttribute(\'aria-label\') || d.getAttribute(\'aria-labelledby\');\n    const hb = d.getBoundingClientRect();\n    const head = d.firstElementChild;\n    const btn = d.querySelector(\'button\');\n    const strong = d.querySelector(\'strong\');\n    const rowSel = [...d.children].slice(1);\n    out[name] = {\n      box: { top: hb.top, rightGap: innerWidth - hb.right },\n      dialog: pick(d, [\'background-color\', \'color\', \'border\', \'border-radius\', \'box-shadow\', \'padding\', \'gap\', \'max-height\', \'font-size\']),\n      head: pick(head, [\'padding\', \'border-bottom\', \'display\', \'font-size\', \'line-height\']),\n      strong: pick(strong, [\'font-size\', \'font-weight\', \'color\']),\n      button: pick(btn, [\'font-size\', \'font-weight\', \'color\', \'min-height\', \'padding\', \'border\', \'background-color\', \'cursor\', \'opacity\']),\n      children: rowSel.map((c) => ({ text: c.textContent.slice(0, 60), ...pick(c, [\'padding\', \'border-bottom\', \'border-top\', \'font-size\', \'color\', \'gap\', \'text-align\', \'line-height\']) })),\n      leaves: [...d.querySelectorAll(\'span, div\')]\n        .filter((e) => e.children.length === 0 && e.textContent.trim())\n        .map((e) => ({ t: e.textContent.trim().slice(0, 50), ...pick(e, [\'font-size\', \'font-weight\', \'color\', \'text-transform\', \'letter-spacing\', \'line-height\']) })),\n    };\n  }\n  return out;\n}\n');
```
### Result
58
### Ran Playwright code
```js
await page.evaluate('() => document.querySelector(\'header\').getBoundingClientRect().bottom');
```