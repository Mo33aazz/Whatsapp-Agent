Summary: System Prompt limit removed (unlimited)

Changes
- public/index.html:167 — Removed `maxlength="500"` and `/500` display. Kept only `#promptCharCount`.
- public/js/ai-config.js:358 — `validateSystemPrompt` now always valid; counter shows current length only.
- public/js/ai-config.js:689 — Reset counter to `0` (no max suffix).
- public/script.legacy.js:883 — `validateSystemPrompt` updated similarly; removed 500‑char validation.
- public/script.legacy.js:1164 — Reset counter to `0`.

Notes
- No backend limit was enforcing prompt length (routes/config.js stores as-is).
- CSS `.char-counter` retained; `over-limit` state no longer used for system prompt.
- If extremely long prompts are used, model/token limits may still apply when calling OpenRouter.

Test hints
- Load dashboard, type long text into System Prompt; no validation error appears.
- Character counter increments without a max cap.
