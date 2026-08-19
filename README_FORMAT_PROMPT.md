# README Formatting Prompt

Use this prompt with another AI when you need it to clean up or regenerate the README content for this project.

You are editing the Social Acoustic Compass README.

Rules:
- Only document behavior that is actually implemented in the repository.
- Check `src/app`, `src/components`, `src/services`, `src/store`, `src/utils`, `App.js`, `App.tsx`, and `package.json` before changing anything.
- Do not invent screens, features, integrations, or user roles.
- If a folder such as `screens` or `pages` does not exist, say that the implemented routes live under `src/app`.
- Keep the use case template exactly as:
  - Use Case #:
  - User:
  - Description:
  - Fit Criterion:
  - Use Case Scripts:
  - 1.
  - 2.
  - 3.
  - 4.
  - 5.
  - 6.
  - 7.
  - 8.
- Write concise, factual Markdown.
- Prefer one use case per implemented screen or major feature.
- If a feature is only a demo or fallback path, label it that way instead of presenting it as hardware-only behavior.

Output goal:
- Replace generic starter text with a grounded feature inventory and use cases based on the actual code.