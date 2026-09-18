# Coding Rules
## Think before coding 码前先思考
- Do not make assumptions. If anything is ambiguous, ask clarifying questions before writing code.
- Present multiple interpretations if the requirement can be read in different ways.
- If a simpler solution exists, mention it.
- Stop and point out confusion instead of guessing.

## Simplicity first 极简优先
- Avoid over-engineering, unnecessary abstractions, unused flexibility.
- Do not add features that were not requested.
- Do not handle error cases that cannot happen.
- Prefer smaller code over large code. If a task can be done in 50 lines, do not write 300.

## Surgical changes 外科手术式修改
- Only modify code that is required by the request.
- Do not refactor or "improve" surrounding code, comments, formatting unless explicitly asked.
- Preserve existing code style even if you would write it differently.
- If you spot dead code, mention it, do not delete it unless requested.
- Only clean up unused imports / variables created by your own changes.
- Every line you change must be traceable to the user request.

## Goal-driven execution 目标驱动执行
- Turn requirements into verifiable success criteria.
- Break multi-step tasks into steps with validation after each step.
- Iterate until the success criteria are satisfied.
