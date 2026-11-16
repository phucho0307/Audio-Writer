# Deploy lên một máy ảo

Một máy Linux chạy Docker Compose: Caddy (HTTPS) → web + API, Redis bên cạnh.
Database là Supabase, file (audio, ảnh) là R2, nên máy ảo không giữ dữ liệu nào
không dựng lại được, trừ hàng đợi trong Redis.

```
Internet ──► Caddy :443 ──┬─ /api, /collab ──► api (NestJS + worker giọng đọc)
                          └─ còn lại ────────► web (Next.js)
api ──► Supabase (Postgres)   api ──► R2 (audio, avatar)   api ──► redis (hàng đợi)
trình duyệt ──► R2 (ảnh bìa, audio) trực tiếp
```

## Lần đầu

1. **Máy ảo:** Ubuntu 24.04, 2 vCPU / 4 GB RAM là đủ để bắt đầu (ví dụ GCP `e2-medium`
   ở `asia-southeast1`, cùng vùng Singapore với Supabase). Mở cổng 80 và 443.
2. **Cài Docker:** `curl -fsSL https://get.docker.com | sh`
3. **Tên miền:** tạo bản ghi DNS `A` trỏ tên miền về IP máy ảo. Caddy cần cái này để
   lấy chứng chỉ HTTPS.
4. **Code:** `git clone` repo (repo private thì dùng deploy key hoặc token chỉ đọc).
5. **`.env` trên máy chủ:** chép từ `.env.example` và điền bằng **bộ khoá production**,
   không dùng lại khoá dev. Thêm `DOMAIN` và `MEDIA_BASE` (link R2 công khai).
   File này chỉ nằm trên máy chủ, không bao giờ commit.
6. **Ảnh bìa lên R2** (chạy một lần từ máy có thư mục ảnh, ví dụ laptop):
   ```
   node apps/web/scripts/make-thumbs.mjs
   cd apps/api && npx dotenv -e ../../.env -- tsx scripts/upload-static-covers.ts
   ```
7. **Chạy:**
   ```
   docker compose -f infra/docker-compose.prod.yml --env-file .env up -d --build
   ```
   Thứ tự tự động: Redis → `migrate` (cập nhật schema database rồi thoát) → API →
   web → Caddy.

## Mỗi lần cập nhật

```
git pull
docker compose -f infra/docker-compose.prod.yml --env-file .env up -d --build
```

Migration luôn chạy trước API mới, nên code mới không bao giờ chạy trên schema cũ.

## Kiểm tra

- `docker compose -f infra/docker-compose.prod.yml ps`: mọi dịch vụ `healthy`,
  riêng `migrate` là `exited (0)`.
- `curl https://<tên miền>/api/health`
- Log: `docker compose -f infra/docker-compose.prod.yml logs -f api`

## Giới hạn đã biết của cách chạy một máy

Phòng viết chung, worker giọng đọc và giới hạn request đều giả định chỉ có **một** bản
API. Muốn chạy nhiều bản thì xem [production-later.md](production-later.md), mức 2.
