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

## Lần đầu (Google Cloud, bản chạy thử)

Bản chạy thử dùng tín dụng dùng thử 300 USD / 90 ngày của Google Cloud (decisions.md
mục 11d) và tên miền miễn phí DuckDNS. Tài khoản dùng thử **không tự trừ tiền thẻ**:
hết tín dụng hoặc hết 90 ngày thì máy dừng, trừ khi tự bấm nâng cấp lên tài khoản trả phí.

1. **Tài khoản:** đăng ký Free Trial ở console.cloud.google.com, tạo project.
   *Billing → Budgets & alerts*: tạo budget 50 USD, báo ở 50% / 90% / 100%.
2. **Máy ảo:** mở Cloud Shell (nút `>_`), tải `infra/gcp/create-vm.sh` lên rồi chạy
   `bash create-vm.sh`. Nó tạo IP tĩnh, mở cổng 80/443 và máy `e2-highmem-2`
   (2 vCPU / 16 GB, Ubuntu 24.04, 30 GB) ở Singapore, cùng vùng với Supabase.
   Cuối cùng nó in ra IP.
3. **Tên miền:** đăng nhập duckdns.org, tạo tên (ví dụ `nhipbut`), dán IP vào ô
   *current ip* rồi bấm *update ip*. IP là IP tĩnh nên chỉ làm một lần.
   Kiểm tra: `nslookup nhipbut.duckdns.org` ra đúng IP.
4. **Vào máy chủ và lấy code:** `gcloud compute ssh nhipbut --zone asia-southeast1-b`, rồi
   `git clone https://github.com/<chủ>/Audio-Writer.git && cd Audio-Writer`.
   Repo private thì dùng fine-grained token chỉ đọc (Contents: Read) làm mật khẩu.
5. **Cài đặt máy:** `bash infra/gcp/setup-server.sh` (Docker, 4 GB swap, tự cập nhật
   bảo mật). Thoát ra vào lại một lần để dùng `docker` không cần sudo.
6. **`.env` trên máy chủ:** chép `.env.example` thành `.env` và điền **bộ khoá
   production**:
   - `DOMAIN=nhipbut.duckdns.org`, `MEDIA_BASE` = `R2_PUBLIC_BASE`
   - `AUTH_DEV_USER=false`, `DEV_ENDPOINTS=false`, `PAID_CHAPTERS=false`
   - `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `BYOK_ENCRYPTION_KEY` mới, mỗi cái
     tạo bằng `openssl rand -base64 48 | tr -d '/+=' | head -c 64`
   - `DATABASE_URL` (Supabase session pooler, `&connection_limit=5`), khoá R2, Gemini
   - `GOOGLE_CALLBACK_URL=https://nhipbut.duckdns.org/api/auth/google/callback`
   - `SMTP_URL` + `MAIL_FROM` bằng App password của Gmail (xem `.env.example`)

   Rồi `bash infra/gcp/check-env.sh .env` cho tới khi in `env OK`. File này chỉ nằm
   trên máy chủ, không bao giờ commit.
7. **Đăng nhập Google:** Google Cloud Console → *APIs & Services → Credentials* →
   OAuth client → thêm Authorized redirect URI
   `https://nhipbut.duckdns.org/api/auth/google/callback` và Authorized JavaScript
   origin `https://nhipbut.duckdns.org`. *OAuth consent screen*: bấm **Publish app**
   (chỉ xin email + tên nên không cần Google duyệt); để ở Testing thì chỉ 100 tài
   khoản test đăng nhập được.
8. **Ảnh bìa lên R2** (chỉ khi chưa làm, chạy từ laptop có thư mục ảnh):
   ```
   node apps/web/scripts/make-thumbs.mjs
   cd apps/api && npx dotenv -e ../../.env -- tsx scripts/upload-static-covers.ts
   ```
9. **Chạy:**
   ```
   docker compose -f infra/docker-compose.prod.yml --env-file .env up -d --build
   ```
   Lần build đầu mất khoảng 15 phút. Thứ tự tự động: Redis → `migrate` (cập nhật
   schema rồi thoát) → API → web → Caddy (tự lấy chứng chỉ HTTPS). **VieNeu** và
   **backup** chạy song song. Lần đầu VieNeu tải model (khoảng 580 MB) vào volume;
   trong lúc đó Edge đọc thay.
10. **Kiểm tra sao lưu ngay** thay vì chờ tới đêm:
    ```
    docker compose -f infra/docker-compose.prod.yml --env-file .env run --rm backup now
    ```
    Bản sao lưu nằm ở R2 `backups/db-YYYY-MM-DD.dump`, giữ 7 bản. Khôi phục:
    `pg_restore --clean --if-exists --no-owner -d "<DATABASE_URL không có ?...>" db-....dump`
11. **Đếm người dùng:** trang `/quan-tri` (chỉ tài khoản admin). Cloudflare Web
    Analytics: thêm site trong Cloudflare, chép token vào `CF_BEACON_TOKEN` rồi build lại.

12. **Premium (khi muốn mở bán):**
    - Đăng ký my.sepay.vn, nối tài khoản ngân hàng nhận tiền.
    - *Webhooks → Thêm*: URL `https://nhipbut.duckdns.org/api/payments/sepay`, loại giao dịch
      *Tiền vào*, xác thực **HMAC-SHA256**. Chép Secret key vào `SEPAY_WEBHOOK_SECRET`.
    - Điền `BANK_CODE`, `BANK_ACCOUNT_NO`, `BANK_ACCOUNT_NAME`, rồi
      `docker compose ... up -d api` (không cần build lại).
    - Thử: lên Premium bằng tài khoản của mình, chuyển 15.000đ. Trang tự chuyển sang
      "Đã nhận tiền"; `/quan-tri` hiện đơn. Nút *Gửi thử* của SePay sẽ ra "không khớp đơn"
      vì không có mã đơn, đó là đúng.

### Hết 90 ngày

Chuyển sang máy trả phí (decisions.md 11d) chỉ cần lặp lại bước 4–6 và 9 trên máy mới,
rồi đổi IP ở DuckDNS. Dữ liệu nằm ở Supabase và R2 nên không phải chuyển gì.

## Mỗi lần cập nhật

```
git pull
docker compose -f infra/docker-compose.prod.yml --env-file .env up -d --build
```

Migration luôn chạy trước API mới, nên code mới không bao giờ chạy trên schema cũ.

Điểm sao và số lượt đánh giá demo mặc định bật như bản local, kể cả truyện nhập
vào. Khi truyện có ít nhất 5 đánh giá thật, giao diện ưu tiên điểm và số lượt thật.
Muốn tắt phần demo thì đặt `NEXT_PUBLIC_DEMO_RATINGS=false` trong `.env` rồi build
lại web; biến này được đóng vào bundle lúc build. Chỉ cập nhật web:

```
docker compose -f infra/docker-compose.prod.yml --env-file .env up -d --build --no-deps web
```

## Kiểm tra

Mọi lệnh `docker compose` đều cần `--env-file .env`: Compose tìm `.env` cạnh file compose
(`infra/`), không phải ở thư mục gốc, nên thiếu cờ này sẽ báo `DOMAIN is missing`. Tạo lệnh
tắt một lần trên máy chủ:
`echo "alias dc='docker compose -f infra/docker-compose.prod.yml --env-file .env'" >> ~/.bashrc`


- `docker compose -f infra/docker-compose.prod.yml --env-file .env ps`: mọi dịch vụ `healthy`,
  riêng `migrate` là `exited (0)`.
- `curl https://<tên miền>/api/health`
- Log: `docker compose -f infra/docker-compose.prod.yml --env-file .env logs -f api`

## Giới hạn đã biết của cách chạy một máy

Phòng viết chung, worker giọng đọc và giới hạn request đều giả định chỉ có **một** bản
API. Muốn chạy nhiều bản thì xem [production-later.md](production-later.md), mức 2.
