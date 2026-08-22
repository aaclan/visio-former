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

## Configuration

Both apps read from a `.env` file (copy the provided `.env.example`):

```bash
cp client/.env.example client/.env
cp server/.env.example server/.env
```

- `client/.env` — `VITE_GOOGLE_CLIENT_ID` (Google OAuth Client ID)
- `server/.env` — `PORT`, `JWT_SECRET`, `GOOGLE_CLIENT_ID` (same Client ID as above)

### Google login setup

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and select or create a project.
2. **APIs & Services → OAuth consent screen** — choose "External", fill in app name and support email, save.
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**, application type **Web application**.
4. Under **Authorized JavaScript origins**, add `http://localhost:5173`.
5. Copy the generated Client ID into both `client/.env` (`VITE_GOOGLE_CLIENT_ID`) and `server/.env` (`GOOGLE_CLIENT_ID`).

The demo username/password login (`demo` / `password123`, defined in `server/src/auth.ts`) still works alongside Google login — replace it with a real user store before shipping.

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
