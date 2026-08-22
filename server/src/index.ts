import Fastify from "fastify";
import cors from "@fastify/cors";

const app = Fastify({ logger: true });

await app.register(cors, { origin: "http://localhost:5173" });

app.get("/api/health", async () => {
  return { status: "ok" };
});

const port = Number(process.env.PORT) || 3001;

app.listen({ port }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
});
