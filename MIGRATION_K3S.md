# Migration: docker-compose to k3s

This guide describes a safe, repeatable migration from a production docker-compose deployment of `telegram-bridge` to the k3s manifests in this repo.

## Assumptions

- You already have a working MTProto session created via `bootstrap`.
- The current docker-compose service stores the session at the same `TG_SESSION_PATH` (default `/data/tg_user.session`) on a persistent volume.
- Your k3s cluster can pull or import the Docker image you build.

## Step 1: Build and publish the image

Build the image and push it to a registry your k3s nodes can pull from, or import it into containerd on the nodes.

Example (registry):
```bash
docker build -t <registry>/telegram-bridge:<tag> .
docker push <registry>/telegram-bridge:<tag>
```

Then update the image in `k8s/telegram-bridge.yaml`.

## Step 2: Create the Kubernetes Secret

Copy the example secret and fill in the values that currently live in `.env`.
```bash
cp k8s/telegram-bridge.secret.example.yaml k8s/telegram-bridge.secret.yaml
```

Edit `k8s/telegram-bridge.secret.yaml`:
- `TG_API_ID`
- `TG_API_HASH`
- `HTTP_TOKEN`

Note: `k8s/telegram-bridge.secret.yaml` is gitignored.

## Step 3: Prepare the PVC

The manifest creates a PVC named `telegram-bridge-data`. Make sure your k3s cluster has a default StorageClass or update the PVC to match your storage setup.

If you are migrating an existing session file, you will need to copy it into the PVC later (see Step 5).

## Step 4: Apply the manifests

```bash
kubectl apply -f k8s/telegram-bridge.secret.yaml -f k8s/telegram-bridge.yaml
```

This creates the deployment, service, and PVC (if it does not already exist).

## Step 5: Migrate or create the Telegram session

You have two options:

Option A: Create a new session in k3s
- Exec into the pod and run the bootstrap command once:
  ```bash
  kubectl exec -it deploy/telegram-bridge -- node dist/bootstrap.js
  ```
- The session will be stored in the PVC at `/data/tg_user.session`.

Option B: Reuse the existing session from docker-compose
- Copy the existing `tg_user.session` file from the docker-compose volume to your local machine.
- Copy it into the k3s pod at `/data/tg_user.session`.
  ```bash
  kubectl cp tg_user.session deploy/telegram-bridge:/data/tg_user.session
  ```
- Restart the deployment to load the session.

## Step 6: Verify health and traffic

- Health: `http://<IP_OR_DOMAIN>:3000/health`
- Telegram health: `http://<IP_OR_DOMAIN>:3000/health/telegram`
- Send a test message via `/send`.

The liveness probe uses `/health/telegram`. It will fail until the session exists.

## Step 7: Cut over

Once the k3s service is verified:
- Update your clients (e.g. n8n) to point at the k3s service address.
- Stop the docker-compose service.

## Rollback plan

If anything fails after cutover:
- Switch clients back to the docker-compose endpoint.
- Scale down or delete the k3s deployment:
  ```bash
  kubectl delete -f k8s/telegram-bridge.yaml
  ```
