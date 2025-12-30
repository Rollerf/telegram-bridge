# telegram-bridge

Small HTTP service that lets n8n (or any HTTP client) send Telegram messages as a user via MTProto (GramJS), because bots do not process messages from bots.

## Setup

1) Copy the environment template and fill in your values:

```bash
cp .env.example .env
```

2) Build and start the service:

```bash
docker compose up -d --build
```

3) Bootstrap the MTProto session (one-time interactive login):

```bash
docker exec -it telegram-bridge node dist/bootstrap.js
```

The session is saved to `TG_SESSION_PATH` (default `/data/tg_user.session`) on a persistent Docker volume.

## API

Health check:

```bash
curl http://<IP_OR_DOMAIN>:3000/health
```

Send a message:

```bash
curl -X POST http://<IP_OR_DOMAIN>:3000/send \
  -H "Authorization: Bearer <HTTP_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"chat_id":"@username","message":"/encender"}'
```

```bash
curl -X POST http://<IP_OR_DOMAIN>:3000/send \
  -H "Authorization: Bearer <HTTP_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"chat_id":123456789,"message":"/apagar"}'
```

## Notes

- n8n should call `http://<IP_OR_DOMAIN>:3000/send`.
- If `HTTP_TOKEN` is empty, `/send` does not require Authorization; set a token in production.
- `/send` returns a clear error if the MTProto session is missing or unauthorized; run the bootstrap command once to create it.
