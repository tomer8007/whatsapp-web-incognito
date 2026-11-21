## 2026-10-25 - MutationObserver Performance Pitfalls
**Learning:** In highly dynamic web apps (like WhatsApp Web), traversing deeply nested DOM trees or repeatedly querying `getElementsByClassName` on removed/added nodes inside a `MutationObserver` creates substantial performance bottlenecks. `querySelectorAll` being run indiscriminately on leaf nodes (e.g. text nodes, SVG fragments) is equally inefficient.
**Action:** Always replace O(N) detached DOM node iterations with O(1) global DOM state checks (e.g., checking `document.getElementsByClassName("root").length` once) when detecting app unmounts. For added node processing, apply a `node.firstElementChild` guard before running `node.querySelectorAll` to cleanly skip leaf nodes.

## 2024-10-24 - Lazy evaluation for log messages
**Learning:** WhatsApp creates a massive number of log messages at errorLevel 1 and 2, and previously the interception code executed computationally expensive string array mapping and string concatenation (makeLogMessage) for every log frame before determining it should be dropped.
**Action:** Compute log messages lazily. Only perform string parsing and joining after verifying that the debugMode is on or the log level requires execution.

## 2026-10-29 - Array Allocations in Hot Paths
**Learning:** Frequent string parsing logic using `.split()` creates unnecessary short-lived arrays, triggering garbage collection pressure in message-heavy applications like WhatsApp.
**Action:** Replace `.split()` usage with `indexOf()` and `substring()` for parsing JIDs and checking if chats are blocked, maintaining logic while significantly reducing memory allocations.
