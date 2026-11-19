# Thanh toán Premium: giải thích từ con số 0

Tài liệu này giải thích phần nhận tiền của Nhịp Bút cho người chưa từng làm thanh toán.
Trọng tâm là **backend, hạ tầng và thiết kế hệ thống**: các thành phần là gì, nói chuyện
với nhau thế nào, và vì sao mỗi chỗ được làm như vậy. Code nằm ở `apps/api/src/premium/`.

---

## 1. Bài toán, nói bằng lời thường

Người đọc trả 15.000đ thì được Premium 30 ngày. Nghe đơn giản, nhưng có một khó khăn
cốt lõi:

> **Tiền và thông tin đi hai đường khác nhau.**

Tiền đi từ ngân hàng của người đọc sang ngân hàng của mình. Website **không nhìn thấy**
đường đó. Website chỉ biết tiền đã tới khi có ai đó **báo lại**. Toàn bộ hệ thống là để
trả lời một câu: *"Khoản tiền vừa vào tài khoản là của ai, cho đơn nào, và đã đủ chưa?"*,
và trả lời **đúng một lần**, kể cả khi mạng chập chờn, tin báo bị gửi lặp, hay người dùng
ghi sai nội dung.

---

## 2. Các thành phần

```
 ┌─────────────┐   1. bấm "Lên Premium"    ┌──────────────┐      ┌────────────┐
 │  Trình duyệt│ ────────────────────────► │  API (NestJS)│ ───► │  Postgres  │
 │  người đọc  │ ◄──── mã đơn + mã QR ──── │              │ ◄─── │ (Supabase) │
 └─────┬───────┘                           └──────▲───────┘      └────────────┘
       │ 2. quét QR, chuyển tiền                  │ 4. webhook: "có 15.000đ vào,
       ▼                                          │    nội dung NBK7Q2XM"
 ┌─────────────┐   3. tiền   ┌─────────────┐  ┌───┴──────┐
 │ App ngân hàng│ ─────────► │ Tài khoản   │─►│  SePay   │
 │ người đọc   │             │ của mình    │  │ (theo dõi│
 └─────────────┘             └─────────────┘  │ giao dịch)│
                                              └──────────┘
```

| Thành phần | Vai trò |
|---|---|
| **Trình duyệt** | Trang `/premium`: xin mã đơn, hiện QR, hỏi lại trạng thái mỗi 4 giây. |
| **API** | Tạo đơn, nhận webhook, quyết định có bật Premium hay không. Mọi quyết định về tiền nằm ở đây, không bao giờ ở trình duyệt. |
| **Postgres** | Nguồn sự thật: đơn hàng, giao dịch, ngày hết hạn Premium. |
| **VietQR** | Chuẩn mã QR chung của ngân hàng Việt Nam. Mã chứa sẵn số tài khoản, số tiền, nội dung. Ảnh QR lấy từ `qr.sepay.vn`. |
| **SePay** | Dịch vụ trung gian được nối với tài khoản ngân hàng **cá nhân**. Mỗi khi có tiền vào, nó gửi một HTTP request (webhook) về server mình. |
| **Caddy** | Cửa ngõ HTTPS. `/api/*` (gồm `/api/payments/sepay`) được chuyển vào API. |

**Vì sao không dùng cổng thanh toán (Stripe, MoMo)?** Stripe không nhận người bán ở Việt
Nam; cổng MoMo cần tài khoản doanh nghiệp. SePay chỉ *đọc* giao dịch của tài khoản sẵn có,
nên không cần giấy phép. Đổi lại, mình phải tự làm phần "khớp tiền với đơn" mà cổng thanh
toán thường làm hộ. Đó chính là phần thú vị của tài liệu này.

---

## 3. Dữ liệu: ba thứ được lưu

```
users                    premium_orders                 bank_transfers
─────                    ──────────────                 ──────────────
id                       id                             id
premiumUntil  ◄───────── userId                         sepayId   (UNIQUE)
                         code       (UNIQUE) ◄───────── orderId   (có thể rỗng)
                         amount     15000               amount
                         days       30                  content   (nội dung CK)
                         status     PENDING/            reference
                                    UNDERPAID/PAID      receivedAt
                         paidAmount
                         paidAt
```

- **`users.premiumUntil`**: Premium là một **ngày hết hạn**, không phải cờ bật/tắt.
  "Đang Premium" nghĩa là `premiumUntil > bây giờ`. Lợi ích: không cần tác vụ chạy đêm
  để "tắt Premium khi hết hạn". Thời gian tự làm việc đó.
- **`premium_orders`**: mỗi lần bấm mua là một đơn, có **mã đơn** để người đọc ghi vào
  nội dung chuyển khoản. Đơn ghi lại giá *tại thời điểm mua*, nên sau này đổi giá cũng
  không ảnh hưởng đơn cũ.
- **`bank_transfers`**: **mọi** khoản tiền SePay báo về đều được lưu, khớp đơn hay không.
  Đây là sổ cái: lúc có tranh chấp ("tôi chuyển rồi mà!"), mở bảng này ra là thấy.

**Nguyên tắc:** không có đồng nào bị bỏ qua trong im lặng. Khoản tiền không hiểu được
thì được *ghi lại* để người xử lý, chứ không bị vứt đi.

---

## 4. Luồng đầy đủ, từng bước

```
Người đọc          Trình duyệt              API                  Postgres        SePay
   │ bấm mua           │                     │                      │              │
   │──────────────────►│ POST /premium/orders│                      │              │
   │                   │────────────────────►│ tạo đơn NBK7Q2XM     │              │
   │                   │                     │─────────────────────►│              │
   │                   │◄──── mã + QR ───────│                      │              │
   │ quét, chuyển tiền │                     │                      │              │
   │═══════════════════╪═════════════ tiền đi qua ngân hàng ════════╪═════════════►│
   │                   │                     │◄── POST /payments/sepay (webhook) ──│
   │                   │                     │ kiểm chữ ký, khớp mã, cộng Premium  │
   │                   │                     │─────────────────────►│              │
   │                   │                     │──── 200 {success} ──────────────────►│
   │                   │ GET /premium/orders/NBK7Q2XM (mỗi 4 giây)  │              │
   │                   │────────────────────►│ status = PAID        │              │
   │◄── "Đã nhận tiền" │◄────────────────────│                      │              │
```

Chú ý hai đường tách nhau: **webhook** (SePay → API) mang tin "tiền đã tới"; **polling**
(trình duyệt → API) chỉ để màn hình người đọc cập nhật. Nếu người đọc đóng tab, Premium
vẫn được bật, vì việc bật Premium không phụ thuộc vào trình duyệt.

### Bước 1: Tạo đơn (`createOrder`)
- Phải đăng nhập (và đã xác minh email ở production), vì Premium gắn với tài khoản.
- **Bấm lại trong 30 phút thì trả về đơn cũ**, không tạo mã mới. Nếu mỗi lần tải lại trang
  ra một mã khác, người đọc dễ chuyển tiền theo mã cũ trên màn hình khác.
- Mã đơn: `NB` + 6 ký tự ngẫu nhiên từ bảng chữ **bỏ ký tự dễ nhầm** (0/O, 1/I/L), vì
  có người sẽ gõ tay vào app ngân hàng. 31⁶ ≈ 900 triệu khả năng; trùng thì thử lại
  (cột `code` là UNIQUE nên database tự chặn trùng).

### Bước 2: Hiện QR
QR chứa sẵn số tiền và nội dung, nên người đọc chỉ cần bấm xác nhận. Nếu đơn đang thiếu
tiền, QR chỉ đòi **phần còn thiếu**.

### Bước 3: Nhận webhook (`POST /api/payments/sepay`)
Đây là trái tim của hệ thống, được giải thích kỹ ở mục 5 tới 8.

### Bước 4: Trả lời SePay
Trả `200 {"success": true}` cho mọi webhook hợp lệ, **kể cả** giao dịch không liên quan
(tiền chuyển ra, tiền người khác gửi). Nếu trả lỗi, SePay coi như chưa giao được và sẽ
gửi lại mãi.

---

## 5. Webhook là gì, và vì sao phải nghi ngờ nó

**Webhook** = thay vì mình hỏi liên tục "có tiền chưa?", bên kia chủ động gọi vào một URL
của mình khi có chuyện. Nó chỉ là một HTTP POST bình thường.

Vấn đề: URL `https://nhipbut.duckdns.org/api/payments/sepay` là **công khai**. Bất kỳ ai
cũng gửi được một request với nội dung *"có 15.000đ, nội dung NBK7Q2XM"*. Nếu tin ngay,
ai cũng có Premium miễn phí. Vì vậy câu hỏi đầu tiên luôn là: **request này có thật sự
từ SePay không?**

### Cách chứng minh: chữ ký HMAC (`sepay-signature.ts`)

Mình và SePay cùng giữ một **khoá bí mật** (`SEPAY_WEBHOOK_SECRET`), không ai khác biết.

```
SePay:   chữ_ký = HMAC_SHA256(khoá_bí_mật, "{timestamp}.{body}")
         gửi kèm header  X-SePay-Signature: sha256=<chữ_ký>
                         X-SePay-Timestamp: <timestamp>

Server:  tự tính lại HMAC từ đúng body nhận được, so với chữ ký gửi kèm.
         Giống nhau → thật. Khác → từ chối (401).
```

HMAC giống như một con dấu chỉ người có khoá mới đóng được. Kẻ giả mạo không có khoá nên
không tạo được chữ ký đúng; nếu sửa số tiền trong body thì chữ ký không còn khớp.

Ba chi tiết dễ sai:
1. **Ký trên byte gốc của body.** Server bình thường parse JSON thành object. Nếu
   serialize object đó lại thành chuỗi để kiểm chữ ký, thứ tự key hay khoảng trắng có thể
   khác, chữ ký lệch. Nên API bật `rawBody: true` (trong `main.ts`) để giữ nguyên byte gốc.
2. **Chống gửi lại (replay).** Kẻ xấu có thể bắt được một request thật và gửi lại sau.
   Timestamp nằm trong phần được ký, và server từ chối nếu lệch quá 5 phút.
3. **So sánh hằng thời gian** (`timingSafeEqual`). So chuỗi bình thường dừng ở ký tự sai
   đầu tiên; đo thời gian phản hồi có thể đoán dần chữ ký. So hằng thời gian thì không lộ gì.

Không cấu hình khoá nào thì **từ chối tất cả**: một endpoint "mặc định mở" là lỗ hổng.

---

## 6. Idempotency: xử lý một tin nhiều lần mà kết quả như một lần

Webhook được giao theo kiểu **"ít nhất một lần" (at-least-once)**: nếu SePay không nhận
được câu trả lời (mạng rớt, server đang khởi động lại), nó sẽ gửi lại. Có nghĩa là
**cùng một giao dịch có thể tới 2, 3 lần**. Nếu mỗi lần lại cộng 30 ngày thì người ta
trả 15.000đ được 90 ngày.

**Idempotent** = làm lại bao nhiêu lần thì kết quả vẫn như làm một lần.

Cách làm: mỗi giao dịch SePay có một `id` riêng. Cột `bank_transfers.sepayId` là
**UNIQUE**. Toàn bộ xử lý nằm trong **một transaction database**:

```
BEGIN
  INSERT bank_transfers (sepayId = 92704, ...)   ← lần 2 sẽ lỗi "trùng" ở đây
  khoá đơn, cộng tiền, có thể bật Premium
COMMIT
```

Lần gửi thứ hai: lệnh INSERT vi phạm UNIQUE → cả transaction bị huỷ → không cộng gì →
server trả `duplicate` kèm 200 để SePay thôi gửi.

**Vì sao phải cùng một transaction?** Giả sử tách làm hai bước: (1) lưu giao dịch, (2) cộng
Premium. Nếu server chết giữa (1) và (2), lần gửi lại thấy giao dịch "đã có" và bỏ qua →
người đọc mất tiền mà không có Premium. Transaction đảm bảo **cả hai cùng xảy ra hoặc
cùng không**.

**Bài học chung:** đừng tự kiểm tra "đã xử lý chưa?" bằng một câu SELECT rồi mới INSERT.
Hai request tới cùng lúc sẽ cùng thấy "chưa" và cùng xử lý. Hãy để **ràng buộc UNIQUE của
database** làm trọng tài, vì nó đúng cả khi có cạnh tranh.

---

## 7. Cạnh tranh (race condition): hai khoản tiền cho một đơn

Tình huống: người đọc chuyển 7.500đ hai lần, hai webhook tới **cùng lúc**, chạy song song:

```
Request A: đọc paidAmount = 0      Request B: đọc paidAmount = 0
Request A: ghi 0 + 7.500 = 7.500   Request B: ghi 0 + 7.500 = 7.500
→ kết quả 7.500 (mất một khoản!)
```

Đây là lỗi "lost update" kinh điển. Cách chữa: **khoá dòng** đơn hàng trước khi đọc:

```sql
SELECT status, "paidAmount" FROM premium_orders WHERE id = ... FOR UPDATE
```

`FOR UPDATE` bảo Postgres: "dòng này tôi đang sửa, ai muốn sửa thì xếp hàng tới khi tôi
COMMIT". Request B phải đợi A xong, rồi đọc thấy 7.500, cộng thành 15.000 → đủ → PAID.
Có test chạy đúng tình huống này trên Postgres thật.

Tương tự, cộng ngày Premium được viết thành **một câu SQL** thay vì "đọc → tính trong
code → ghi":

```sql
UPDATE users
SET "premiumUntil" = GREATEST(COALESCE("premiumUntil", NOW()), NOW()) + 30 days
```

Nghĩa là: lấy ngày muộn hơn giữa "hôm nay" và "ngày hết hạn hiện tại", cộng thêm 30 ngày.
Gia hạn sớm không mất ngày; hết hạn lâu rồi thì tính từ hôm nay. Một câu SQL là nguyên
tử, không có khe hở để hai request chen vào nhau.

---

## 8. Khớp tiền với đơn, khi con người làm sai

Nội dung chuyển khoản do **người** gõ và do **ngân hàng** xử lý, nên rất bẩn:

| Người đọc ghi | Ngân hàng gửi về |
|---|---|
| `NBK7Q2XM` | `NGUYEN VAN A chuyen tien NBK7Q2XM` |
| `nb k7q2-xm` | `MBVCB.123.NB K7Q2-XM.CT tu 0123` |

Hàm `orderCodeCandidates` tìm mã theo mẫu `NB` + 6 ký tự, trên cả bản gốc lẫn bản đã bỏ
dấu cách và gạch. Một cái tên như "THANH BINH" có thể vô tình tạo ra "ứng viên" giả, nên
hàm trả về **mọi ứng viên**, và server chỉ nhận cái nào **thật sự là một đơn trong
database**.

### Máy trạng thái của một đơn

```
                tiền đủ
   PENDING ─────────────────────► PAID
      │                            ▲
      │ tiền thiếu                 │ chuyển thêm cho đủ
      ▼                            │ (hoặc admin kích hoạt tay)
  UNDERPAID ───────────────────────┘
```

| Chuyện gì xảy ra | Hệ thống làm gì |
|---|---|
| Đủ tiền | PAID, cộng 30 ngày |
| Thiếu tiền | UNDERPAID, chưa bật; QR đòi phần còn thiếu |
| Chuyển dư hoặc chuyển thêm vào đơn đã PAID | Ghi nhận số tiền, **không** tự cộng thêm tháng nữa; admin thấy để xử lý |
| Không có mã / mã sai | Lưu vào `bank_transfers` với `orderId` rỗng; hiện ở `/quan-tri` mục "Tiền vào không khớp đơn nào" |
| Tiền chuyển ra (`transferType = out`) | Bỏ qua |
| Chuyển muộn sau khi QR hết 30 phút | **Vẫn chấp nhận**: tiền đã là tiền thật |

### Đối soát và xử lý tay (reconciliation)
Mọi hệ thống thanh toán thật đều có một "đường lui" cho con người. Ở `/quan-tri`, admin
chọn một khoản tiền chưa khớp, nhập mã đơn người dùng báo, bấm kích hoạt. Thao tác này
cũng khoá dòng và **từ chối nếu đơn đã PAID**, nên bấm hai lần cũng không cộng hai tháng.

---

## 9. Hạ tầng: những chi tiết vận hành

- **Đường đi của webhook:** Internet → Caddy (HTTPS) → `api:4000/api/payments/sepay`.
  HTTPS bắt buộc: chữ ký bảo vệ tính toàn vẹn, còn HTTPS bảo vệ khỏi bị nghe lén.
- **Rate limit:** endpoint webhook được `@SkipThrottle()`. Giới hạn 120 request/phút theo
  IP có thể chặn nhầm SePay lúc dồn nhiều giao dịch; bảo vệ ở đây là chữ ký, không phải
  số lượng.
- **Cấu hình bằng biến môi trường:** chưa điền `BANK_ACCOUNT_NO` thì Premium hiện "sắp mở
  bán" và API từ chối tạo đơn. Có thể deploy code trước, mở bán sau, không cần build lại.
  `infra/gcp/check-env.sh` báo nếu có số tài khoản mà thiếu khoá webhook.
- **Khi có sự cố:**

  | Sự cố | Hậu quả | Tự hồi phục? |
  |---|---|---|
  | API đang deploy/khởi động lại | SePay không nhận được 200 | Có, SePay gửi lại (kiểm tra chính sách retry cụ thể trong tài liệu SePay) |
  | Database chập chờn | Transaction huỷ, API trả 500 | Có, lần gửi lại xử lý bình thường; nhờ idempotency nên không sợ trùng |
  | SePay không bao giờ báo | Người đọc đã trả mà chưa có Premium | Không. Người đọc gửi email, admin đối chiếu sao kê rồi kích hoạt tay |
  | Lộ khoá webhook | Có thể giả mạo thanh toán | Không. Đổi khoá ở SePay và `.env` ngay |

- **Vì sao trình duyệt dùng polling 4 giây thay vì WebSocket?** Mỗi đơn chỉ chờ vài phút,
  một người một lúc. Polling đơn giản, chạy qua mọi proxy, và đóng tab là tự dừng. Tab ẩn
  thì không hỏi.
- **Sao lưu:** bảng đơn và giao dịch nằm trong Postgres, đã có backup mỗi đêm lên R2.

---

## 10. Kiểm thử

| File | Loại | Kiểm gì |
|---|---|---|
| `test/premium-payments.test.cjs` | Unit, không cần database | Chữ ký đúng/sai/bị sửa/quá hạn; chế độ API key; không cấu hình thì từ chối; tìm mã trong nội dung bẩn; mã sinh ra không có ký tự dễ nhầm |
| `test/integration/premium.itest.cjs` | Tích hợp, **Postgres thật** (database test local, không bao giờ Supabase) | Trả đủ → 30 ngày; gửi lặp → không cộng thêm; gia hạn nối tiếp; thiếu rồi bù; **hai khoản song song**; giao dịch không mã → admin gắn tay; chỉ admin xem được |

Phần idempotency và khoá dòng **phải** test trên database thật: chúng dựa vào UNIQUE index
và `FOR UPDATE` của Postgres, một bản giả trong bộ nhớ không mô phỏng đúng được.

```
npx tsx --test test/premium-payments.test.cjs
ITEST_DATABASE_URL=postgresql://aw:...@localhost:5432/aw_itest \
  npx tsx --test test/integration/premium.itest.cjs
```

---

## 11. Giới hạn hiện tại

- **Không tự gia hạn.** Chuyển khoản không trừ tiền tự động được như thẻ; hết 30 ngày
  người đọc phải mua lại.
- **Hoàn tiền làm tay**, ngoài hệ thống.
- **Một tài khoản ngân hàng, một loại gói.** Muốn thêm gói 3 tháng thì chỉ cần thêm giá và
  số ngày khi tạo đơn; bảng đã lưu sẵn `amount` và `days` theo từng đơn.
- Thu nhập từ Premium vẫn là thu nhập; có doanh thu đều thì cần tìm hiểu nghĩa vụ thuế.

---

## 12. Từ điển nhanh

| Từ | Nghĩa |
|---|---|
| **Webhook** | Bên kia chủ động gọi HTTP vào server mình khi có sự kiện. |
| **HMAC** | Chữ ký tạo từ nội dung + khoá bí mật; chứng minh ai gửi và nội dung không bị sửa. |
| **Replay attack** | Gửi lại một request thật đã bắt được. Chặn bằng timestamp trong chữ ký. |
| **At-least-once** | Tin được đảm bảo tới, nhưng có thể tới nhiều lần. |
| **Idempotent** | Làm lại nhiều lần, kết quả như một lần. |
| **Transaction** | Nhóm thao tác database: tất cả cùng thành công hoặc cùng huỷ. |
| **UNIQUE constraint** | Database cấm hai dòng trùng giá trị ở cột đó. |
| **Race condition** | Hai việc chạy song song đè lên kết quả của nhau. |
| **Row lock (`FOR UPDATE`)** | Khoá một dòng để các transaction khác phải đợi. |
| **Reconciliation (đối soát)** | So tiền thật nhận được với đơn trong hệ thống, xử lý phần lệch. |
| **Polling** | Hỏi lại định kỳ "xong chưa?". |

---

## 13. Câu hỏi phỏng vấn hay gặp

**"Nếu webhook tới hai lần thì sao?"**
Mỗi giao dịch có id riêng, cột đó UNIQUE, và việc cộng Premium nằm cùng transaction với
lệnh lưu giao dịch. Lần hai INSERT lỗi trùng, cả transaction huỷ, không cộng gì.

**"Làm sao biết webhook không bị giả?"**
HMAC-SHA256 trên byte gốc của body cùng timestamp, khoá bí mật chỉ mình và SePay giữ; so
hằng thời gian; lệch quá 5 phút thì từ chối để chặn gửi lại.

**"Hai khoản tiền cho cùng một đơn tới cùng lúc?"**
`SELECT ... FOR UPDATE` khoá dòng đơn, nên hai transaction cộng lần lượt. Có test song
song trên Postgres thật.

**"Người dùng ghi sai nội dung chuyển khoản?"**
Tìm mã trong cả bản gốc và bản đã bỏ khoảng trắng, đối chiếu với đơn thật. Không khớp thì
giao dịch vẫn được lưu và hiện cho admin gắn tay. Không đồng nào bị bỏ qua im lặng.

**"Vì sao Premium là ngày hết hạn chứ không phải cờ true/false?"**
Không cần tác vụ định kỳ để tắt; gia hạn chỉ là dời ngày; và một câu SQL làm được nguyên tử.

**"Vì sao không dùng Stripe?"**
Stripe không nhận người bán ở Việt Nam, cổng MoMo cần giấy phép kinh doanh. Chuyển khoản
QR là cách người Việt quen trả nhất; đổi lại phải tự làm phần khớp tiền, và đó là phần
được thiết kế kỹ nhất ở đây.
