---
name: visualize
description: "Add a visual: a diagram that renders inline"
allowed-tools: Agent
---
Call the `Agent` tool:

```json
{
  "description": "<3-5 word summary of the brief>",
  "prompt": "<brief>",
  "subagent_type": "fixture:maker"
}
```
