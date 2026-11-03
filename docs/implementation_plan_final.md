# Socrati - Final End-to-End Implementation Plan

This plan is organized incrementally to ensure that foundational systems (data persistence, auth, and backend pipelines) are fully functional before building the advanced UI and AI features on top of them.

---

## Phase 1: Ingestion & Auth Finalization
*This phase focuses on completing the background ingestion pipeline, securing user sessions, and ensuring documents are properly saved and linked to users in the database.*

### 1. [Feature-1] Implement Background Job Processing
- **Status:** Completed (documented in `BullMQ.md`), but not yet merged.
- **Description:** Moves the heavy ML pipeline (PDF parsing, chunking, embedding) out of the Vercel serverless API route and into a durable background job queue.
- **Acceptance Criteria:**
  - BullMQ + Upstash Redis is installed and configured.
  - The upload route only enqueues the job and immediately returns the `documentId`.
  - A separate worker process executes parsing, chunking, and embedding.
  - Document `parse_status` is updated to `ready` or `failed` upon completion.
- **Implementation Steps:**
  1. Define the BullMQ queue instance in `apps/web/lib/queue.ts` using `@upstash/redis`.
  2. Create the worker script in `apps/web/lib/worker.ts` containing the PDF parsing, chunking, and embedding logic.
  3. Refactor `apps/web/app/api/documents/upload/route.ts` to only accept the file, enqueue it via `queue.add()`, and return the `documentId`.
  4. Add an `npm run worker` command to `package.json` to spin up the separate worker process.

### 2. [Feature-1] Add logout functionality and session management UI
- **Description:** Wires up real user details in the sidebar and implements secure logout.
- **Acceptance Criteria:**
  - Sidebar displays the logged-in user's actual name and email.
  - Clicking "Settings" or logout calls `supabase.auth.signOut()` and redirects to `/auth`.
  - Handles idle timeout session expiry.
  - Hardcoded user data is completely removed from `Sidebar.tsx`.
- **Implementation Steps:**
  1. Open `apps/web/components/Sidebar.tsx` and convert it to a Client Component (`"use client"`) if necessary, or pass user data down from a Server layout.
  2. Use `@supabase/ssr` `createBrowserClient` to call `supabase.auth.getUser()` and hydrate the UI state.
  3. Attach an `onClick` handler to the Settings/Logout button that triggers `await supabase.auth.signOut()` followed by `router.push('/auth')`.

### 3. [Feature-2] Associate uploaded documents with the authenticated user
- **Description:** Adds auth context to the upload route so every document is linked to its owner.
- **Acceptance Criteria:**
  - The upload API route reads the `user_id` from the active Supabase server session.
  - Returns 401 if unauthenticated.
  - The `documents` DB row is created with the correct `user_id` foreign key.
- **Implementation Steps:**
  1. In `apps/web/app/api/documents/upload/route.ts`, initialize the Supabase server client.
  2. Call `const { data: { user } } = await supabase.auth.getUser()`. Return a 401 response if no user exists.
  3. Pass `user.id` into the document creation query so the foreign key is properly set in the `documents` table.

### 4. [Feature-2] Persist documents and chunks to PostgreSQL
- **Description:** Saves the parsed documents and their vector embeddings to the database after the pipeline completes.
- **Acceptance Criteria:**
  - Prisma is installed and configured with `pgvector` enabled.
  - `documents` row is created, and `document_chunks` rows are inserted with their `vector(3072)` embeddings.
  - Replaces the `// TODO` in the upload route with real DB writes.
- **Implementation Steps:**
  1. Install Prisma (`npm i prisma @prisma/client`) and initialize it (`npx prisma init`).
  2. Define the `Document` and `DocumentChunk` models in `schema.prisma`.
  3. Inside the BullMQ worker (`apps/web/lib/worker.ts`), write logic to perform a Prisma batch insert into the `document_chunks` table for all generated chunks.
  4. Use `prisma.$executeRaw` to safely insert the 3072-dimensional arrays into the `vector` column type.

### 5. [Feature-2] Load persisted documents on the upload page
- **Description:** Hydrates the "My documents" page with the user's previously uploaded files.
- **Acceptance Criteria:**
  - `GET /api/documents` fetches the user's documents on mount.
  - Displays name, file size, and `parse_status`.
  - List is sorted by most recently uploaded first.
- **Implementation Steps:**
  1. Create a new route handler at `apps/web/app/api/documents/route.ts` handling `GET` requests.
  2. Query Prisma for all `Document` rows where `user_id` matches the authenticated user, ordered by `created_at` descending.
  3. In `apps/web/app/session/new/page.tsx`, add a `useEffect` or React Query hook to fetch and map this data into the UI list.

### 6. [Feature-2] Set up the session creation flow
- **Description:** Allows a user to select documents and start a new tutoring session.
- **Acceptance Criteria:**
  - `POST /api/sessions` accepts an array of `documentIds` and creates a `sessions` DB row.
  - Redirects the user to `/sessions/[sessionId]`.
  - Button remains disabled if no documents are selected.
- **Implementation Steps:**
  1. Define a `Session` model in `schema.prisma` linking `user_id` and an array of `document_ids`.
  2. Create `apps/web/app/api/sessions/route.ts` (`POST`) to accept the `documentIds` payload and insert the new `Session` record.
  3. In `session/new/page.tsx`, update the `handleStartSession` function to hit this API and use `router.push('/sessions/' + result.sessionId)`.

---

## Phase 2: Core AI Tutor & RAG Foundation
*This phase builds the core intelligence of Socrati, allowing the tutor to reference documents and chat contextually with the student.*

### 7. [Feature-3] Build the AI Socratic tutor chat UI
- **Description:** The main chat interface where students interact with the AI tutor.
- **Acceptance Criteria:**
  - Chat page renders at `/sessions/[sessionId]`.
  - AI opens each session with a Socratic question based on the document.
  - AI responses stream in real-time via SSE.
  - "Hint" button requests a partial explanation without giving the full answer.
  - Session transcripts are saved to the `messages` table.
- **Implementation Steps:**
  1. Create the dynamic route page `apps/web/app/sessions/[sessionId]/page.tsx`.
  2. Build the chat interface components (message bubbles, input box, hint button).
  3. Implement the frontend logic using the Vercel AI SDK (`useChat` hook) or native fetch to handle the streaming response.
  4. On mount, trigger an initial hidden system prompt to make the AI ask the first Socratic question.

### 8. [Feature-3] Implement the RAG retrieval pipeline
- **Description:** Fetches relevant chunks from the database to ground the AI's responses.
- **Acceptance Criteria:**
  - Performs semantic similarity search against `document_chunks` using pgvector's cosine similarity.
  - Retrieves top-k chunks and assembles them into a context string.
  - Injects context into the LLM system prompt.
  - Tracks retrieved chunk sources.
- **Implementation Steps:**
  1. Create a `retrieveContext(query, documentIds)` function in `apps/web/lib/rag.ts`.
  2. Inside this function, call the Gemini API to embed the user's string `query`.
  3. Use `prisma.$queryRaw` to perform a `ORDER BY embedding <=> ${vector} LIMIT 5` query on the `document_chunks` table.
  4. Concatenate the returned chunk contents into a single formatted string.

### 9. [Feature-3] Build the LLM Orchestrator
- **Description:** Central orchestration layer that manages prompt construction, model routing, and token budgets.
- **Acceptance Criteria:**
  - Reusable `llmOrchestrator` module handles routing to Groq (Llama 3 70B for tutoring, 8B for structured tasks).
  - Assembles system prompt, RAG context, and conversation history.
  - Enforces token budget to avoid exceeding the context window.
  - Returns streamed responses for chat and complete JSON for structured tasks.
- **Implementation Steps:**
  1. Install the `groq-sdk` package.
  2. Create `apps/web/lib/llmOrchestrator.ts`.
  3. Write a factory function that accepts the task type, history, and the RAG context string (from Step 8).
  4. Prepend the system instructions (enforcing the Socratic method for tutoring).
  5. Call `groq.chat.completions.create` and return the streaming or JSON response to the `app/api/chat/route.ts` endpoint (from Step 7).

---

## Phase 3: Advanced Agents & Output Features
*This phase extends the application beyond simple chat, adding web research, interactive quizzes, and learning analytics.*

### 10. [Feature-4] Implement the web research agent
- **Description:** Allows the AI to search the web for supplementary information when uploaded materials lack detail.
- **Acceptance Criteria:**
  - AI detects knowledge gaps (e.g., low RAG similarity score) and queries academic sources.
  - System notifies the student: *"Your materials don't cover this — searching for more context..."*
  - Retrieves and summarizes web results, citing the source URL.
  - Gracefully falls back to uploaded materials if search fails or takes >10 seconds.
- **Implementation Steps:**
  1. Install `langchain` and `@langchain/community`. Add Tavily or Brave Search API keys to `.env`.
  2. Update the `llmOrchestrator.ts` to register a "search_web" tool definition with Groq.
  3. In the routing logic, if the RAG similarity score is below `0.5`, append a system instruction allowing the LLM to call the search tool.
  4. Handle the tool-call response recursively, parse the web results, and send them back to the LLM to generate the final response.

### 11. [Feature-3] Build the quiz generation backend
- **Description:** Automatically generates practice quizzes grounded in document chunks.
- **Acceptance Criteria:**
  - `POST /api/quiz/generate` prompts Llama 3 8B to generate 5, 10, or 20 questions.
  - Questions mix multiple-choice, short answer, and true/false types.
  - Generates valid JSON and saves the quiz to the `quizzes` and `quiz_questions` tables.
- **Implementation Steps:**
  1. Add `Quiz` and `QuizQuestion` models to `schema.prisma`.
  2. Create `apps/web/app/api/quiz/generate/route.ts`.
  3. Fetch a random, diverse subset of document chunks from the DB.
  4. Call `llmOrchestrator` with the "quiz" task, passing a strict JSON Schema requirement via Groq's JSON mode.
  5. Validate the returned JSON with Zod and save it to Prisma.

### 12. [Feature-3] Build the quiz UI
- **Description:** The frontend interface for taking quizzes and viewing results.
- **Acceptance Criteria:**
  - Renders questions interactively.
  - On submission, displays correct/incorrect feedback with explanations per question.
  - Displays a final score and saves results to `quiz_attempts`.
- **Implementation Steps:**
  1. Create a `apps/web/app/sessions/[sessionId]/quiz/page.tsx` route.
  2. Fetch the generated quiz JSON from the DB and store it in React state.
  3. Render the form controls (radio buttons, text inputs) for the questions.
  4. On submit, evaluate answers against the source-of-truth JSON, render the score, and POST the result to `apps/web/app/api/quiz/submit/route.ts` to save the `quiz_attempts` record.

### 13. [Feature-3] Build the learning analytics / progress dashboard
- **Description:** Allows students to track their performance over time.
- **Acceptance Criteria:**
  - `/progress` page displays overall performance scores per topic and quiz.
  - Recharts is used to show score improvement over time.
  - Topics are categorized as "Mastered" (≥80%), "In Progress" (50-79%), or "Needs Review" (<50%).
  - Provides actionable study recommendations.
- **Implementation Steps:**
  1. Create the `apps/web/app/progress/page.tsx` route.
  2. Create a server action or API route to aggregate all `quiz_attempts` for the user, grouping by topic and calculating averages.
  3. Install `recharts` and build a line chart component to plot scores by date.
  4. Render a categorized list applying the `<50%`, `50-79%`, and `>80%` badge logic.

### 14. [Feature-5] Implement mind map generation backend
- **Description:** Extracts hierarchical topics, subtopics, and relationships from document chunks.
- **Acceptance Criteria:**
  - `POST /api/mindmap/generate` uses Llama 3 8B to build a structured JSON node-link graph.
  - Each node includes a short AI-generated description.
  - Returns a flat outline if the document is too unstructured.
- **Implementation Steps:**
  1. Create `apps/web/app/api/mindmap/generate/route.ts`.
  2. Retrieve a subset of document chunks to fit within the 8B context window.
  3. Call `llmOrchestrator` with a system prompt dictating an exact output schema: `{ nodes: [...], edges: [...] }`.
  4. Validate the response with Zod and save the JSON string to a new `MindMap` Prisma table (or cache it).

### 15. [Feature-5] Build the mind map UI with React Flow
- **Description:** Renders the mind map returned by the backend interactively.
- **Acceptance Criteria:**
  - Diagram renders with the document title as the root node.
  - Nodes are clickable, revealing descriptions in a tooltip or side panel.
  - Branches can be expanded/collapsed.
  - Export to PNG functionality included.
- **Implementation Steps:**
  1. Install `reactflow` and `html2canvas`.
  2. Create a `MindMapViewer.tsx` component that maps the JSON nodes to `<ReactFlow />` nodes.
  3. Use an auto-layout library (like `dagre`) to set X/Y positions for the nodes based on the edge hierarchy.
  4. Add an `onNodeClick` handler to display the node's `description` in a sidebar drawer.

---

## Phase 4: Infrastructure
*This final phase tracks student progress and automates project deployment.*

### 16. [Infrastructure] Set up CI/CD with GitHub Actions
- **Description:** Automated pipeline to ensure code quality and seamless deployment.
- **Acceptance Criteria:**
  - GitHub Actions run `eslint`, `tsc --noEmit`, and `jest` on every PR.
  - PRs are blocked from merging if checks fail.
  - Merges to `main` automatically deploy to Vercel.
  - Environment secrets are securely configured.
- **Implementation Steps:**
  1. Create `.github/workflows/ci.yml`.
  2. Define a job using `actions/setup-node@v4` that runs `npm ci`, `npm run lint`, `npm run typecheck`, and `npm run test`.
  3. Create `.github/workflows/deploy.yml` that triggers on `push` to `main` and uses the official Vercel GitHub Action (or let Vercel handle it natively by linking the repository and setting the required PR checks).
