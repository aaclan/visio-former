# visio-former

Monorepo with a React (Vite + TypeScript) frontend and a Fastify (TypeScript) backend.

```
client/   React UI (Vite, port 5173)
server/   Node API (Fastify, port 3001)
```

## Prerequisites

- Node.js 22+
- npm 10+

## Install

Install dependencies for each app separately:

```bash
cd client && npm install
cd ../server && npm install
```

## Run in development

Open two terminals.

**Backend** (http://localhost:3001):

```bash
cd server
npm run dev
```

**Frontend** (http://localhost:5173):

```bash
cd client
npm run dev
```

The frontend dev server runs independently; the backend allows CORS from `http://localhost:5173` by default. Check the API is up:

```bash
curl http://localhost:3001/api/health
```

## Build for production

**Backend:**

```bash
cd server
npm run build
npm start
```

**Frontend:**

```bash
cd client
npm run build
npm run preview
```
