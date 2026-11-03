# Web Agent Stabilization Walkthrough

This document summarizes the architectural and UI changes made in the `feat/web-agent` branch to stabilize the autonomous web research capabilities of the Socratic tutor.

## 1. Objective
The goal was to replace the brittle, model-driven tool-calling architecture with a deterministic, server-side retrieval pattern. This ensures that the web search triggers reliably when document context is missing and that the user receives clear visual feedback ("Web Search Used").

## 2. Core Architecture: Deterministic Fallback
We moved the "decision" to search from the LLM to a logic gate on the server.

### [rag.ts](file:///Users/deepali/Desktop/umass/courses/sem2/cs520/project/socrati/apps/web/lib/rag.ts)
*   **Similarity Threshold:** Introduced a `0.7` threshold for RAG retrieval.
*   **Noise Filtering:** Any document chunks with a similarity score below 0.7 are now discarded. This prevents "fuzzy" matches (e.g., a query about Harry Potter matching a word like "system" in a CS document) from blocking the web agent.

### [route.ts](file:///Users/deepali/Desktop/umass/courses/sem2/cs520/project/socrati/apps/web/app/api/chat/route.ts)
*   **Automatic Trigger:** If the RAG context is empty after filtering, the route now immediately invokes the `performWebSearch` utility before calling the LLM.
*   **Context Injection:** Search results are injected directly into the system prompt, providing the LLM with immediate grounding.

## 3. UI: Robust Badge Signaling
To ensure the "Web Search Used" badge appears reliably across different SDK versions and streaming formats, we implemented a **Hidden Signal** system.

### [prompts.ts](file:///Users/deepali/Desktop/umass/courses/sem2/cs520/project/socrati/apps/web/lib/prompts.ts)
*   **Hidden Tag:** When web results are used, the server injects `<!-- web_search_used -->` into the system instructions.
*   **Forced Inclusion:** The LLM is instructed to include this tag at the very beginning of its response.

### [ChatMessage.tsx](file:///Users/deepali/Desktop/umass/courses/sem2/cs520/project/socrati/apps/web/components/chat/ChatMessage.tsx)
*   **Detection & Stripping:** The component looks for the hidden tag. If found, it toggles the UI badge and then strips the tag from the final rendered text so the student never sees it.

## 4. Stability & Type Fixes
A significant portion of the work involved resolving build-time errors caused by dependency mismatches.

*   **Type Casting:** Applied strategic `any`-casts in `ChatContainer.tsx` and `ChatMessage.tsx` to handle type discrepancies between the project's custom message format and the `@ai-sdk/react` v6 definitions.
*   **Streaming Fix:** Reverted to the stable `toUIMessageStreamResponse()` method to resolve `TypeError: pipeThrough is not a function` and other runtime streaming protocol issues.

## 5. Verification
*   **Automated:** 129 tests passing (`npm run test`), including new unit tests for the web agent.
*   **Manual:** Verified that out-of-domain queries (e.g., "Taylor Swift") trigger the badge and search, while in-domain queries (e.g., "Supabase RLS") remain grounded in the documents.

---
**Branch:** `feat/web-agent`  
**Status:** Stable / Ready for Review
