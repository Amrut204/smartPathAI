# DigitalOcean Deployment

This deployment path is an alternate option for a single Ubuntu droplet hosting only the app containers.

For the current pilot-safe launch tranche, Render is the primary recommended path. Use this document only if you explicitly want a self-managed Docker host instead of Render.

Runtime shape:
- Hosting: DigitalOcean droplet
- Database: MongoDB Atlas
- Files: AWS S3
- Email: Resend
- AI: off by default
- Domain/TLS: your own domain + host Nginx + Let's Encrypt

## Files

- `docker-compose.digitalocean.yml`: droplet-specific app compose
- `ops/digitalocean/server.env.example`: backend env template
- `ops/digitalocean/nginx/smartpath.conf.example`: host Nginx domain config

## 1. Create the droplet

Recommended baseline:
- Ubuntu 24.04 LTS
- 2 vCPU / 2 GB RAM minimum
- open ports `22`, `80`, `443`

## 2. Install Docker and Nginx on the droplet

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg nginx certbot python3-certbot-nginx
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo $VERSION_CODENAME) stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER
```

Re-login after adding your user to the docker group.

## 3. Point your domain to the droplet

Create DNS records:
- `A` record for `campusdrive.me` -> droplet public IP
- optional `A` record for `www.campusdrive.me` -> droplet public IP
- optional `AAAA` record if you use IPv6

## 4. Copy the repo and env file

```bash
git clone <your-repo-url> smartpath
cd smartpath
cp ops/digitalocean/server.env.example ops/digitalocean/server.env
```

Fill `ops/digitalocean/server.env` with real values.

Minimum required values:
- `MONGODB_URI`
- `MONGODB_DB_NAME=campusdrive_prod`
- `APP_JWT_SECRET`
- `APP_URL=https://campusdrive.me`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_S3_BUCKET`
- `AWS_REGION`
- `STORAGE_MODE=s3`
- `STORAGE_S3_PUBLIC_BASE_URL`

## 5. Start the app containers

```bash
docker compose -f docker-compose.digitalocean.yml build
docker compose -f docker-compose.digitalocean.yml up -d
```

The client container binds only to `127.0.0.1:8080`.
The backend stays private on the compose network.

## 6. Configure host Nginx

```bash
sudo cp ops/digitalocean/nginx/smartpath.conf.example /etc/nginx/sites-available/smartpath.conf
sudo nano /etc/nginx/sites-available/smartpath.conf
```

Replace:
- nothing else if you are using `campusdrive.me`
- if you do not want `www`, remove `www.campusdrive.me` from `server_name`

Then enable it:

```bash
sudo ln -s /etc/nginx/sites-available/smartpath.conf /etc/nginx/sites-enabled/smartpath.conf
sudo nginx -t
sudo systemctl reload nginx
```

## 7. Issue HTTPS certificate

```bash
sudo certbot --nginx -d campusdrive.me -d www.campusdrive.me
```

## 8. Verify

```bash
curl -I https://campusdrive.me/
curl -I https://campusdrive.me/api/v1/health
```

Expected:
- frontend responds over HTTPS
- `/api/v1/health` returns healthy

## 9. Update and restart later

```bash
git pull
docker compose -f docker-compose.digitalocean.yml build
docker compose -f docker-compose.digitalocean.yml up -d
```

## Notes

- This path keeps Atlas, S3, and Resend as external managed services.
- It does not use local Mongo, local file serving, Redis, or BullMQ.
- The backend already has app-side Atlas and S3 billing guards enabled through env.
- Leave Groq unset unless you explicitly want AI enabled later.
