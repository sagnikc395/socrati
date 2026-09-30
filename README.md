# Socrati

Socrati is a conversational AI tutor for studying from course materials. Students upload documents, create study sessions around selected files, and interact with a Socratic assistant that guides them with questions instead of giving direct answers.

The application is built as a TypeScript monorepo with a Next.js web app, shared UI/config packages, Supabase-backed persistence, Redis-backed background jobs, and AI-powered document retrieval.

## What It Does

- Upload and track study documents for an authenticated user.
- Process uploaded materials through a background pipeline that parses, chunks, embeds, and stores document content.
- Start study sessions using one or more ready documents.
- Chat with a Socratic tutor grounded in retrieved document context.
- Fall back to web search when the uploaded material does not contain enough relevant context.
- Generate quiz questions from uploaded documents.
- Generate study mind maps from document chunks.
- Persist sessions, messages, documents, quizzes, and document-processing state.

## Architecture

The main user experience lives in `apps/web`, a Next.js App Router application. It exposes pages for document upload, session creation, chat sessions, quiz generation, mind maps, authentication, and progress.

Document ingestion runs through a BullMQ worker. Uploaded files are queued, parsed, chunked, embedded, and saved for retrieval. Chat responses use retrieval-augmented generation over the stored document chunks so tutor responses stay tied to the student's selected materials.

Supabase provides authentication, relational storage, row-level security, and vector search support. Redis is used for document-processing queues and worker coordination.

## Repository Layout

```text
apps/
  web/      Main Socrati web application

packages/
  ui/                   Shared React UI primitives
  eslint-config/        Shared ESLint configuration
  typescript-config/    Shared TypeScript configuration

supabase/
  migrations/           Database schema and RPC migrations

tests/
  *.test.ts             Node test suite for core app behavior
```

## Key Areas

- `apps/web/app`: Next.js routes, pages, and API endpoints.
- `apps/web/components`: Sidebar, chat UI, and mind map UI components.
- `apps/web/lib`: Auth, document ingestion, retrieval, quiz, mind map, session, queue, and worker logic.
- `supabase/migrations`: Database tables, indexes, policies, and retrieval RPC definitions.
- `tests`: Focused tests for auth, uploads, RAG, quizzes, sessions, prompts, progress, and repository behavior.

## Tech Stack

- TypeScript
- Next.js
- React
- Turborepo
- Supabase
- BullMQ
- Redis
- Groq-backed chat and quiz generation
- Vector retrieval over embedded document chunks

## Operational Docs

Build, database, development, production, and test workflows are documented in [BUILD.md](./BUILD.md).
