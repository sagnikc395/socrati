# LLM Orchestrator Branch Walkthrough

This document summarizes the changes introduced in the `feat/llm-orchestrator` branch, which focused on integrating high-performance LLMs and establishing the Socratic tutoring persona.

## 1. Objective
The primary goal of this branch was to replace the local mock chat logic with a production-ready LLM orchestration layer using **Groq** and the **Vercel AI SDK**. It also defined the core Socratic rules that govern how the AI interacts with students.

## 2. Core Implementation: Groq & Socratic Logic

### [route.ts](file:///Users/deepali/Desktop/umass/courses/sem2/cs520/project/socrati/apps/web/app/api/chat/route.ts)
*   **Groq Provider:** Integrated `@ai-sdk/groq` to leverage Llama 3 models for ultra-fast inference.
*   **Streaming Pipeline:** Implemented `streamText` to provide real-time responses to the user.
*   **Context Grounding:** Hooked the RAG retrieval results into the LLM's system prompt, ensuring the tutor stays grounded in the uploaded course material.

### [prompts.ts](file:///Users/deepali/Desktop/umass/courses/sem2/cs520/project/socrati/apps/web/lib/prompts.ts)
*   **Socratic Rules:** Defined a strict set of instructions that prevent the AI from giving direct answers.
*   **Guidance vs. Answers:** Instructed the model to warmthly acknowledge correct answers but always push deeper with a follow-up question.
*   **Formatting:** Ensured responses are concise (1-2 sentences) to keep the student engaged.

## 3. UI Enhancements

### [ChatMessage.tsx](file:///Users/deepali/Desktop/umass/courses/sem2/cs520/project/socrati/apps/web/components/chat/ChatMessage.tsx)
*   **Streaming Support:** Updated the component to handle the `parts` format emitted by the Vercel AI SDK during real-time streaming.
*   **Casing/Formatting:** Ensured consistent font and spacing for AI-generated responses.

## 4. Verification

### [prompts.test.ts](file:///Users/deepali/Desktop/umass/courses/sem2/cs520/project/socrati/tests/prompts.test.ts)
*   **System Prompt Builder:** Added unit tests to ensure that document context is correctly injected into the system prompt.
*   **Edge Cases:** Verified that the prompt builder handles empty context gracefully by providing a fallback "no context" instruction.

---
**Branch:** `feat/llm-orchestrator`  
**Key Commit:** `f9c948e` (feat: implement LLM orchestration with Groq and Socratic prompting)
