# Mind Map UI Changes

## Summary

The chat page now includes a `Mind Map` button that opens an interactive React Flow node-link diagram for the selected session document. The diagram uses the backend mind map graph, displays the document title as the root node, lays branches out left-to-right with dagre, and lets students inspect node descriptions, collapse branches, and export the rendered map as a PNG.

## UI Files Changed

### `apps/web/components/chat/ChatContainer.tsx`

- Added a `Mind Map` button next to the existing quiz action in the tutoring session header.
- Added local `showMindMap` state to toggle the mind map panel.
- Accepts a new `documents` prop containing `document_id` and `title`.
- Renders `MindMapPanel` below the chat input when the button is active.
- Disables the button when the session has no documents.

### `apps/web/app/sessions/[sessionId]/page.tsx`

- Passes document IDs and titles into `ChatContainer`.
- This allows the mind map UI to use the actual document title as the root node label.

### `apps/web/components/mindmap/MindMapPanel.tsx`

- New client component for the full mind map UI.
- Fetches `/api/mindmap/generate` for the selected document.
- Renders the graph with React Flow.
- Shows a right-side description panel when a node is clicked.
- Supports expanding and collapsing branches with per-node `+` and `-` controls.
- Supports multi-document sessions with a document selector.
- Exports the visible mind map as a PNG using `html2canvas`.
- Logs major UI events with `[mindmap:view]`, including fetch, render, branch collapse/expand, export, and fetch errors.
- Shows backend warnings, such as short-document or unstructured-document fallback messages.
- Includes a text outline fallback when required browser APIs for React Flow are unavailable.

### `apps/web/lib/mindmap-view.ts`

- New UI adapter/helper module for rendering backend mind map graphs.
- Converts backend graph data into a display graph.
- Ensures the document title is used as the root label.
- Adds a synthetic document root for flat fallback graphs that do not contain a backend root node.
- Computes parent and child relationships.
- Computes visible nodes and edges when branches are collapsed.
- Uses dagre to calculate automatic left-to-right node positions.

### `apps/web/app/layout.tsx`

- Imports React Flow's base stylesheet:

```ts
import 'reactflow/dist/style.css';
```

## Test Files Added

### `tests/mindmap-view.test.ts`

Added focused tests for the UI graph adapter:

- Existing backend root nodes are relabeled with the document title.
- Flat fallback graphs receive a synthetic document root.
- Collapsed branches hide descendant nodes and edges.
- Dagre layout positions child nodes to the right of the root.

## Dependencies Added

### Runtime dependencies

Added to `apps/web/package.json`:

- `reactflow`
- `dagre`
- `html2canvas`

### Dev dependency

Added to `apps/web/package.json`:

- `@types/dagre`

`package-lock.json` was updated by `npm install`.

## Behavior Implemented

- A mind map view is accessible from the chat page through the `Mind Map` button.
- The diagram renders the document title as the root node.
- Topics and subtopics render as left-to-right branches.
- Nodes are clickable and show their AI-generated descriptions in a sidebar.
- Branches can be expanded and collapsed.
- The current map view can be exported as a PNG.
- If React Flow cannot run in the browser, the UI shows a text-based outline fallback.
- Styling follows the existing project theme variables, including `--main`, `--card`, `--b1`, `--acc`, `--acl`, and related text colors.

## Verification

Commands run:

```bash
node --import tsx --test tests/mindmap.test.ts tests/mindmap-view.test.ts
npm test
npm run check-types -- --filter=web
npm run build -- --filter=web
npx eslint components/mindmap/MindMapPanel.tsx lib/mindmap-view.ts --max-warnings 0
```

Results:

- Focused mind map tests passed.
- Full test suite passed: 154 tests.
- Web type check passed.
- Web production build passed.
- Targeted eslint for the new mind map UI files passed.

Note: full web lint still fails because the repo has existing warnings in unrelated/pre-existing files. The new mind map files pass targeted lint.
