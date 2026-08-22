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

**Client** reads public config from `client/.env` (copy `client/.env.example`):

```bash
cp client/.env.example client/.env
```

- `client/.env` — `VITE_GOOGLE_CLIENT_ID` (Google OAuth Client ID)

**Server** reads secrets from `server/secrets.yaml`, which is gitignored (copy `server/secrets.example.yaml`):

```bash
cp server/secrets.example.yaml server/secrets.yaml
```

```yaml
port: 3001
jwtSecret: ""                     # any random string, used to sign session JWTs
googleClientId: ""                # same value as client/.env's VITE_GOOGLE_CLIENT_ID
gcsBucketName: ""                 # GCS bucket used for video storage
googleApplicationCredentials: ""  # absolute path to a GCS service account JSON key
demoUsername: "demo"              # demo login username
demoPassword: "password123"       # demo login password (hashed in memory at startup)
openaiApiKey: ""                  # OpenAI API key, used to caption exercise-form frames
openaiVisionModel: "gpt-4o"       # vision-capable OpenAI model
pioneerApiKey: ""                 # Pioneer (GLiNER2) API key, used to classify form descriptions
pioneerBaseUrl: "https://api.pioneer.ai"
pioneerModelId: "fastino/gliner2-base-v1"
```

Never commit `server/secrets.yaml` — it's listed in `server/.gitignore`. To point the server at a secrets file in a different location, set `SECRETS_FILE=/path/to/file.yaml`.

### Google login setup

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and select or create a project.
2. **APIs & Services → OAuth consent screen** — choose "External", fill in app name and support email, save.
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**, application type **Web application**.
4. Under **Authorized JavaScript origins**, add `http://localhost:5173`.
5. Copy the generated Client ID into both `client/.env` (`VITE_GOOGLE_CLIENT_ID`) and `server/secrets.yaml` (`googleClientId`).

The demo username/password login (`demoUsername` / `demoPassword` in `server/secrets.yaml`) still works alongside Google login — replace it with a real user store before shipping.

### Video storage setup (Google Cloud Storage)

1. In the [Google Cloud Console](https://console.cloud.google.com/), go to **Cloud Storage → Buckets → Create**. Pick a globally unique bucket name.
2. Create a service account with the **Storage Object Admin** role on that bucket (**IAM & Admin → Service Accounts**), then create a JSON key for it and download it.
3. Set in `server/secrets.yaml`:
   - `gcsBucketName` — the bucket name from step 1
   - `googleApplicationCredentials` — absolute path to the downloaded JSON key file

### Video endpoints

All require `Authorization: Bearer <token>` from `/api/login` or `/api/login/google`.

- `POST /api/videos` — multipart upload, field name `video`, `.mp4` only, 500MB max. Returns `{ id, filename }`.
- `GET /api/videos` — lists stored videos.
- `GET /api/videos/:id` — returns a short-lived signed URL to read/download the video.

### Form check (server-side, no client page yet)

`POST /api/compare` compares a reference video against an uploaded video. No client UI wires into this
endpoint yet — it's server-only for now. Pipeline:

1. Drop the reference video (e.g. generated with fal) at `server/assets/reference-video.mp4`. The server also serves it back at `GET /reference-video.mp4`.
2. Upload the user's video as multipart form data (field name `video`) to `POST /api/compare`.
3. The server extracts frames every 0.4s (10 frames, first 4s) from both videos with ffmpeg (`server/src/video.ts` — `captureFrames`, added by @Tiannan). The reference video's first frame is also uploaded to GCS at `reference-frames/reference.jpg` (overwritten each run) — non-fatal if `gcsBucketName` isn't configured.
4. Each frame sequence is captioned into plain-text descriptions by OpenAI Vision (`server/src/vision.ts` — `describeFrames`), one call per video.
5. Both sets of descriptions are classified against a fixed set of form categories (`FORM_CLASSIFICATIONS` in `server/src/pioneer.ts`) via a single call to Pioneer's GLiNER2 inference endpoint (`POST https://api.pioneer.ai/inference`).
6. The reference vs. user classification confidences are averaged and diffed (`compareClassifications`) into plain-language feedback text, returned alongside the raw per-category scores (`referenceScores` / `userScores`) — that raw data is what a future fine-tuning dataset or VEED script would consume.

Note: Pioneer's classification response shape isn't documented in detail, so `classifyDescriptions` parses defensively (accepts a couple of plausible shapes) — worth double-checking against a real response once `pioneerApiKey` is set.

Routing the feedback onward — either into a fine-tuning dataset or to VEED to generate an advice video — is not implemented yet.

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
