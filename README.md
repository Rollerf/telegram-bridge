# telegram-bridge

Small HTTP service that lets n8n (or any HTTP client) send Telegram messages as a user via MTProto (GramJS), because bots do not process messages from bots.

## Docker (Compose)

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

Telegram connectivity health check:

```bash
curl http://<IP_OR_DOMAIN>:3000/health/telegram
```

If `HEALTH_TELEGRAM_CHAT_ID` is set, `/health/telegram` sends
`HEALTH_TELEGRAM_COMMAND` (default `/estado_luces`) to that chat and waits for a
response within `HEALTH_TELEGRAM_TIMEOUT_MS`.

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

## Kubernetes (k3s)

1) Build and publish the image somewhere k3s can pull it from (or import it into containerd).
2) Copy `k8s/telegram-bridge.secret.example.yaml` to `k8s/telegram-bridge.secret.yaml` and fill in the secrets.
3) Update `k8s/telegram-bridge.yaml` with your image name if needed.
4) Apply the manifests:

```bash
kubectl apply -f k8s/telegram-bridge.secret.yaml -f k8s/telegram-bridge.yaml
```

5) Bootstrap the MTProto session once in a pod that mounts the same PVC:

```bash
kubectl exec -it deploy/telegram-bridge -- node dist/bootstrap.js
```

If you already have a session file from docker-compose, you can copy it into the pod instead:

```bash
kubectl cp tg_user.session deploy/telegram-bridge:/data/tg_user.session
kubectl rollout restart deploy/telegram-bridge
```

The liveness probe uses `/health/telegram` and will fail until the session exists.
`k8s/telegram-bridge.secret.yaml` is gitignored to avoid committing secrets.

### Ingress (Traefik)

The manifest includes an Ingress for Traefik with host `telegram-bridge.test`. Add a hosts entry that points to your node IP:

```
<NODE_IP> telegram-bridge.test
```

Then access the service at:

```bash
curl http://telegram-bridge.test/health
```

Note: `.test` avoids the mDNS delays that `.local` can introduce.

### Migration (docker-compose → k3s)

For a step-by-step cutover and rollback plan, see `MIGRATION_K3S.md`. In short:

- Build and publish the image.
- Create the Secret from your `.env` values.
- Apply the k8s manifests and bootstrap or migrate the session file.
- Verify `/health`, `/health/telegram`, then switch clients and stop docker-compose.

### GitHub Container Registry (GHCR)

Create a GitHub token with `read:packages` and `write:packages` (fine-grained tokens: Repository access to `Rollerf/telegram-bridge`, Repository permissions → Packages: Read and write).

Login:

```bash
echo <GHCR_TOKEN> | docker login ghcr.io -u rollerf --password-stdin
```

Build and push:

```bash
docker build -t ghcr.io/rollerf/telegram-bridge:<tag> .
docker push ghcr.io/rollerf/telegram-bridge:<tag>
```

If the package is private, create a pull secret and attach it to the default service account:

```bash
kubectl create secret docker-registry ghcr-pull \
  --docker-server=ghcr.io \
  --docker-username=rollerf \
  --docker-password=<GHCR_TOKEN> \
  --docker-email=<EMAIL>
kubectl patch serviceaccount default -p '{"imagePullSecrets":[{"name":"ghcr-pull"}]}'
```

Then set the image in `k8s/telegram-bridge.yaml`:

```yaml
image: ghcr.io/rollerf/telegram-bridge:<tag>
```
