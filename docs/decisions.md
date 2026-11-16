# Nhịp Bút: các quyết định kỹ thuật

Viết để kể khi phỏng vấn. Mỗi mục gồm: **bối cảnh → quyết định → vì sao → đánh đổi**,
kèm con số đo thật nếu có. Chỉ ghi những gì đã có trong repo và đã chạy. Việc còn đang
lên kế hoạch được đánh dấu rõ ở cuối.

Phần đăng nhập, rate limit và mô hình dữ liệu kiểu git (fork, branch) nằm ở
[system-design.md](system-design.md). File này nối tiếp từ đó.

**Sản phẩm, một câu:** nền tảng truyện tiếng Việt, nơi người đọc nghe truyện bằng giọng
đọc AI, "rẽ nhánh" (fork) một truyện từ chương bất kỳ để viết hướng khác, viết chung
theo thời gian thực, và nhờ AI gợi ý hướng đi.

**Stack:** NestJS, Prisma, Postgres (pgvector), Redis, BullMQ; Next.js App Router;
Hocuspocus/Yjs cho viết chung; Gemini cho AI; Edge TTS cho giọng đọc; Supabase cho
Postgres; Cloudflare R2 cho file.

**Cách làm:** mình tự thiết kế và quyết định; phần lớn code viết cùng trợ lý AI
(Claude Code, Codex) chạy song song trong cùng repo. Khi được hỏi thì nói thẳng điều
này, và nói về cách điều phối hai agent (mục 12).

---

## 1. Giọng đọc: Gemini TTS → Edge TTS

**Bối cảnh:** mỗi chương phải có giọng đọc. Gemini TTS tính tiền theo ký tự, mà
catalogue có khoảng 3.700 chương, 2,4 triệu ký tự trở lên.

**Quyết định:** chuyển sang Edge TTS (giọng đọc của Microsoft Edge, hai giọng Hoài My và
Nam Minh), gọi qua package Python `edge-tts`. Gemini và Piper vẫn giữ làm driver phụ.

**Vì sao:** không tốn tiền, giọng tiếng Việt tự nhiên.

**Đánh đổi, nói thẳng:**
- Đây là dịch vụ **không chính thức**. Microsoft có thể chặn bất cứ lúc nào.
- Vì vậy mọi giọng đọc đi qua một interface `TtsDriver`, và `MultiTtsDriver` chọn
  driver theo id giọng. Đổi sang Azure Speech (bản trả phí, cùng giọng) chỉ là
  thêm một driver, không đụng phần còn lại.
- "Đã cài trên máy" không có nghĩa là miễn phí vĩnh viễn: package chỉ là client gọi
  server của Microsoft.

**Chi tiết kỹ thuật đáng kể:**
- Chia văn bản theo đoạn rồi theo câu, gom thành khúc khoảng 700 ký tự, chạy song song
  4 khúc, mỗi khúc thử lại tối đa 3 lần, rồi ghép đúng thứ tự.
  **Một chương 3.823 ký tự: 136 giây xuống 50 giây.**
- File audio được đặt tên theo hash của (nội dung, giọng, phiên bản driver)
  (content-addressed). Hai chương giống hệt chữ dùng chung một file. Đổi driver thì ra
  tên file mới, không ghi đè file đang được phát.
- Máy dev có phần mềm diệt virus chặn và ký lại kết nối HTTPS (TLS interception). Cách
  xử lý: Node chạy với `--use-system-ca`, Python dùng `truststore` để tin kho chứng chỉ
  của Windows. **Không tắt** tính năng bảo mật của máy.

## 2. Hàng đợi tạo giọng đọc, và một lần nó tự chạy ngoài ý muốn

**Thiết kế:** tạo audio chạy qua hàng đợi BullMQ, nên request trả về ngay. Mỗi việc có
một dòng `render_jobs` trong database để theo dõi lâu dài. Một sweeper định kỳ đối chiếu
dòng đó với hàng đợi:
- Việc bị mất trước khi vào hàng đợi thì xếp lại.
- Việc đang chạy mà worker chết thì đánh dấu thất bại, **không** tự chạy lại, vì có thể
  đã bị tính tiền ở nhà cung cấp.

Khi nhà cung cấp giọng đọc báo vượt giới hạn tốc độ, cả worker tạm dừng trong khoảng
thời gian họ yêu cầu, thay vì tiêu hết lượt thử lại của từng việc.

**Sự cố:** một script tạo audio cho toàn bộ catalogue bị chạy trên laptop, xếp
**3.009 việc trong 2 phút**, và đã ghi ra 441 MB.

**Cách xử lý:**
- Tạm dừng hàng đợi (`queue.pause()`). Đây là thao tác có sẵn, đảo ngược được, giữ
  nguyên dữ liệu.
- **Không** xoá việc, **không** tắt tiến trình của agent khác.
- 441 MB đã tạo không bỏ đi mà chuyển lên R2 (mục 5).

**Bài học:** những việc tốn tài nguyên hàng loạt phải bật bằng cấu hình
(`PRERENDER_ON_PUBLISH`, `PRERENDER_CHAPTERS`), mặc định tắt trên máy dev.

## 3. Lưu file: interface, chọn R2, và chặn chi phí 9 GB

**Thiết kế:** một interface `StorageDriver` duy nhất. Không có cấu hình R2 thì ghi ra ổ
đĩa, có thì ghi lên R2, và việc chọn dựa trên **biến nào thật sự có mặt** chứ không dựa
vào `NODE_ENV`. Clone repo về là chạy được ngay không cần tài khoản cloud.

**Vì sao R2:** app audio gần như toàn là băng thông tải xuống (egress). R2 không tính tiền
egress. S3 hay Google Cloud tính khoảng 0,12 USD/GB, tức hơn 100 USD/tháng chỉ riêng
băng thông nếu có 1.000 người nghe mỗi ngày.

**Vấn đề:** R2 **không có giới hạn chi tiêu**. Vượt 10 GB free là tự trừ tiền thẻ.

**Quyết định: tự chặn ở 9 GB trong code.**
- Đo dung lượng bằng cách **liệt kê thật bucket** (tối đa nửa tiếng một lần), cộng thêm
  những gì vừa tự ghi giữa hai lần đo. Không tin con số trong database, vì có nhiều
  tiến trình cùng ghi.
- **Fail-closed:** không đo được thì coi như đầy. Thà dừng một phút còn hơn ghi mù rồi
  nhận hoá đơn.
- Kiểm tra **trước khi tạo giọng đọc**, để kho đầy thì không tốn công tạo rồi mới bỏ.
  Lỗi "đầy" được đánh dấu là không thử lại (`UnrecoverableError`).
- 5 unit test với một R2 giả lập: phân trang, tự đếm giữa hai lần đo, fail-closed.

## 4. Chuyển database lên Supabase

**Quyết định:**
- Dùng **Session pooler** chứ không kết nối trực tiếp: gói free chỉ cho kết nối trực tiếp
  qua IPv6, đa số mạng nhà và máy ảo không vào được.
- Đặt `connection_limit=5`, vì pooler free chỉ cho khoảng 15 kết nối, còn Prisma mặc định
  mở theo số nhân CPU.
- **Tắt Data API của Supabase.** Nếu để bật, bảng `users` (có email) và `sessions` có thể
  bị đọc bằng khoá công khai, vì bảng không có RLS. App nói chuyện thẳng với Postgres
  nên không cần Data API.

**Script chép dữ liệu (`copy-db-to-supabase.sh`):**
- Từ chối chạy nếu Supabase đã có bảng: chỉ chép vào project trống, không bao giờ ghi đè
  hay trộn.
- Chép trong **một transaction**: lỗi giữa chừng thì Supabase vẫn trống.
- Xong thì so số dòng **từng bảng**.
- Thử trước trên một database tạm trong máy, rồi mới chạy thật.

**Sự cố hay để kể:**
- Lần đầu, lệnh `COPY` qua pooler đứng 10 phút ở một bảng 6 MB, rồi mất kết nối.
- Mình đo riêng tốc độ mạng: gửi 0,9 MB mất khoảng 2 giây, vậy mạng không phải nguyên nhân.
- Kết luận: `COPY` không đi trơn qua pooler. Đổi sang `INSERT` gộp 50 dòng một câu:
  **toàn bộ database chép xong trong 3 phút, 18/18 bảng khớp số dòng.**
- Quy trình: đo, loại trừ từng giả thuyết, rồi mới sửa. Không đoán.

**Đánh đổi:** database nên ở gần **server API**, không phải gần người dùng, vì mỗi trang
web hỏi database hàng chục lần. Chọn Singapore vì server sẽ đặt ở châu Á cho người
Việt. Chạy thử từ laptop ở Mỹ thì chậm, và đó là bình thường.

## 5. Chuyển file audio lên R2

Script `move-media-to-r2`:
- Upload từng file, **chỉ đổi đường dẫn trong database sau khi upload thành công**.
  Dừng giữa chừng rồi chạy lại vẫn an toàn (idempotent).
- Có chế độ `--dry-run` chỉ đếm, chạy trước khi chạy thật.
- Kết quả: **152 file, 455 MB, không thiếu file nào**.
- Kiểm tra sau khi chuyển: file có header cache 1 năm, và hỗ trợ tải từng đoạn (HTTP 206)
  nên người nghe tua được.

## 6. Chi phí AI: tính trước khi chọn, và cache dùng chung

**Tính toán, để trả lời câu "sao không tự chạy model":**
- Gemini Flash-Lite: khoảng 0,0007 USD cho mỗi lần gợi ý plot (khoảng 4.000 token vào,
  800 token ra).
- Trường hợp xấu nhất (1.000 người dùng × 3 lượt mỗi ngày): khoảng 2 USD/ngày.
- Tự chạy model trên GPU thuê: 300–1.500 USD/tháng kể cả khi không ai dùng, mà văn tiếng
  Việt lại kém hơn. Server chỉ có CPU thì một lần gợi ý mất 2–4 phút.
- **Kết luận:** dùng API, trả theo lượt dùng, cho tới khi lượng gọi rất lớn.

**Gói free của Gemini (theo báo cáo gần nhất, khoảng 500 lượt/ngày cho Flash-Lite) là
nút thắt thật.** Vì vậy làm:

**a) Cache gợi ý dùng chung giữa mọi người dùng.**
- Key là **hash của chính xác đầu vào gửi cho model** (model, ngôn ngữ, số lựa chọn, văn
  bản truyện).
- Nhiều người đọc cùng một chương thì chỉ gọi AI một lần.
- **An toàn với paywall:** người chưa mở khoá chương trả phí đọc ra văn bản khác, nên ra
  key khác. Không ai nhận được gợi ý dựa trên đoạn họ chưa được đọc.
- Trúng cache thì không trừ lượt của người dùng. Có nút "ý khác" để hỏi lại (trừ 1 lượt).
- Đo được: **lần đầu 14 giây, lần sau 0,2 giây.**

**b) Hoàn lượt khi nhà cung cấp lỗi.** Phát hiện trong lúc test: Gemini trả 429 mà người
dùng vẫn bị trừ lượt. Giờ `consume()` trả về đã trừ lượt nào (free hay credit), lỗi thì
`refund()` đúng lượt đó. Với AI viết dạng stream, chỉ hoàn nếu lỗi **trước chữ đầu tiên**.

## 7. RAG: đánh giá thẳng rằng hiện chưa cần

**Đã build:** chia chương thành đoạn, tạo embedding bằng Gemini, lưu vào pgvector. Khi
"AI viết tiếp", tìm 3 đoạn cũ liên quan và 3 ghi chú kỹ thuật viết theo thể loại.

**Đánh giá sau đó:**
- Code đã gửi **nguyên truyện** cho model (Gemini đọc được tới cả triệu token), nên đoạn
  RAG tìm ra là thứ model vốn đã đọc.
- Ghi chú kỹ thuật chỉ có 20 cái, lọc theo thể loại là đủ.
- Phần tự lập chỉ mục khi khởi động tiêu hết lượt Gemini free (lỗi 429) khi có hàng nghìn
  chương mới seed.

**Khi nào RAG có giá trị:** khi truyện quá dài để gửi nguyên bản. Lúc đó gửi "tóm tắt +
vài chương gần nhất + đoạn liên quan" sẽ rẻ hơn nhiều.

Câu nên nói: biết lúc nào một kỹ thuật **chưa** đáng dùng cũng quan trọng như biết build nó.

**Đã quyết (16/11):** tắt bằng `RAG_INDEX_ON_COMMIT=false` và `RAG_BACKFILL_ON_BOOT=false`.
Code giữ nguyên. Ngay sau khi tắt, log hết hẳn lỗi 429 từ Gemini.

## 7b. Bỏ RAG cũ, xây tìm truyện bằng AI

**Đã gỡ:** cắt và lập chỉ mục từng chương, các endpoint `/rag/*`, bước tìm đoạn cũ khi
"AI viết tiếp". Ghi chú kỹ thuật viết giờ lấy thẳng theo thể loại (vài ghi chú mỗi thể
loại thì tra là đủ, không cần embedding). Bảng `rag_chunks` vẫn để đó, chưa xoá.

**Tìm bằng AI** (ô "Tìm bằng AI" ở trang Khám phá):
- Mỗi truyện có một **thẻ mô tả** do Flash-Lite viết từ phần đầu, giữa và cuối truyện:
  tóm tắt, motif ("chồng ngoại tình", "tiểu tam mang thai"), cảm xúc chọn từ **danh sách
  cố định** (để "buồn" ở câu hỏi và "buồn" trên thẻ là cùng một chuỗi), kiểu kết
  HE/SE/OE. Thẻ được embed bằng pgvector và đánh chỉ mục full-text không dấu.
- Khi tìm: LLM tách câu hỏi thành bộ lọc → tìm kết hợp vector + full-text, gộp bằng
  **RRF** → cộng điểm theo thể loại, cảm xúc, kiểu kết, đánh giá (Bayes) và độ hot →
  LLM chấm mức hợp và viết **một câu "vì sao hợp"**; truyện "không hợp" bị ẩn.
- Nói thêm để lọc: "kết có hậu thôi" gộp với câu trước thành một yêu cầu.
- Đo được: lần đầu 6-10 giây (hiểu câu hỏi ~2s, tìm ~1-3s từ Mỹ sang database
  Singapore, giải thích ~2-4s); câu đã hỏi lấy từ cache 0,02 giây.

**Chuyện thật khi làm, đáng kể:**
- `gemini-2.5-flash-lite` trả 404: Google đã đóng model này với tài khoản mới. Bộ tạo
  thẻ vẫn đếm các lần lỗi vào hạn mức. Sửa: lỗi cấu hình (400/404) **dừng ngay**, chỉ
  tính hạn mức cho lần gọi thật sự tới được model.
- Embedding-001 hết hạn mức (do RAG cũ tiêu hôm đó) nên 10 thẻ đã viết bị bỏ. Sửa:
  **lưu thẻ trước, embed sau**; thiếu vector thì lần sau bù. Chuyển sang
  `gemini-embedding-2` (hạn mức riêng, vẫn 768 chiều).
- Model trả tiếng Việt dạng mã thoát unicode, câu trả lời dài gấp nhiều lần và bị **cắt
  cụt giữa JSON**. Sửa: đánh số 1-8 thay UUID, nới giới hạn token.
- Flash-Lite mới hay báo 503 quá tải. Tạo thẻ chạy nền thì chờ lâu (4s, 12s); người
  đang chờ kết quả thì thử lại 1 lần rồi chuyển **model dự phòng**. Kết quả dự phòng
  không lưu cache.

**Chi phí:** gói free. Thẻ tạo 300/ngày trong nền, cả thư viện ~4 ngày. Mỗi lần tìm
mới ~2 lần gọi Flash-Lite + 1 embedding; mỗi người 20 lần/ngày, câu lặp lại miễn phí.

## 8. Hồ sơ người dùng và avatar

- **Username:** 3–24 ký tự gồm chữ thường, số, `_`. Có danh sách tên bị giữ (admin,
  tên thương hiệu…). Đổi xong phải đợi **14 ngày** mới đổi tiếp, để không ai đổi tên
  qua lại nhằm mạo danh.
- **Trang hồ sơ công khai:** không bao giờ lộ email, chỉ hiện truyện công khai.
- **Avatar:**
  - Trình duyệt tự cắt thành hình vuông 256 px và nén sang WebP **trước khi gửi**: ảnh
    1200×800 còn khoảng **3 KB**, server không phải nhận ảnh 12 megapixel từ điện thoại.
  - Server kiểm tra **byte đầu file** (magic bytes) chứ không tin đuôi file hay header.
  - Giới hạn 64 KB, nằm dưới giới hạn 100 KB của body JSON.
  - Tên file theo hash nội dung, nên ảnh mới có URL mới và không cache nào giữ ảnh cũ.
- **@username bấm được ở mọi nơi:** nhiều @username nằm trong một thẻ vốn đã là link, mà
  link lồng link là HTML không hợp lệ. Component `Handle` có chế độ `nested`: hiện
  `<span role="link">`, chặn sự kiện click lan ra thẻ ngoài.

## 9. Hiệu năng giao diện: hai lỗi thật

**Ảnh bìa quá nặng:** ô thumbnail rộng khoảng 200 px nhưng file gốc tới 3,3 MB. Script
tạo bản WebP 480 px:
- **1.273 ảnh, 292 MB xuống 52 MB.**
- Thiếu bản thu nhỏ thì tự quay về ảnh gốc, không vỡ hình.

**Lưới Khám phá chỉ hiện một ô:**
- Hiệu ứng GSAP ẩn các ô rồi chờ cuộn tới mới hiện. Dữ liệu về theo nhiều đợt nên hiệu
  ứng bị dựng lại giữa chừng, các ô kẹt ở trạng thái trong suốt.
- Đổi sang animation CSS (`animation-fill-mode: both`), luôn kết thúc ở trạng thái hiện.
- Câu nên nói: hiệu ứng không bao giờ được là thứ quyết định nội dung có hiện hay không.

## 10. Đổi tên thương hiệu và định vị

Từ "Rợn Bút" (chỉ truyện ma) sang **"Nhịp Bút"** (đa thể loại), vì catalogue thực tế phần
lớn là truyện ngắn, tuổi học trò, thiếu nhi, sắp có truyện Trung. Tên thương hiệu khai
báo ở một chỗ duy nhất (`lib/brand.ts`), nên đổi tên chỉ sửa một dòng. Giao diện tối giữ
nguyên, chỉ đổi cách giải thích: "dịu mắt khi đọc khuya" thay vì "hợp truyện ma".

## 11. Chọn nơi deploy

**Quyết định:** một máy ảo chạy Docker Compose (web, API, worker, Redis), database ở
Supabase, file ở R2. Dùng 300 USD tín dụng của Google Cloud để thử xem có người dùng không,
trước khi trả tiền.

**Vì sao không làm kiểu "chuẩn" Cloud Run + Cloud SQL + Memorystore:**
- Cloud SQL và Memorystore tính tiền theo giờ máy chạy, có người dùng hay không.
- Worker tạo giọng đọc và phòng viết chung (WebSocket) phải chạy liên tục, không hợp với
  Cloud Run vốn chỉ chạy khi có request.
- Một máy ảo với Docker Compose thì chuyển sang nhà cung cấp khác chỉ là chép sang.

**Ước lượng:** một máy cỡ vừa chịu được vài nghìn người dùng mỗi ngày. Những gì phải sửa
để chạy nhiều server được ghi ở [production-later.md](production-later.md).

## 11b. Đóng gói để deploy (Docker)

**Thiết kế:** hai image (web, API kèm worker giọng đọc) và một `docker-compose.prod.yml`:
- **Caddy** đứng trước, tự lấy chứng chỉ HTTPS và chia đường: `/api` và `/collab` sang
  API, còn lại sang web. Web và API **cùng một tên miền**, nên không cần CORS, cookie
  đăng nhập là cookie của chính trang.
- Một dịch vụ **`migrate`** chạy `prisma migrate deploy` rồi thoát. API chỉ khởi động khi
  bước này thành công, nên code mới không bao giờ chạy trên schema cũ.
- Redis đặt `maxmemory-policy noeviction`, vì BullMQ mất việc nếu Redis tự xoá key.
- Ảnh và audio nằm trên R2, nên **image web chỉ mang 7 MB ảnh thay vì gần 1 GB**. Web
  dùng Next.js `output: 'standalone'`, chỉ chép những gì server thật sự import.

**Đã chạy thử cả hệ thống trên laptop:** trang chủ, Khám phá, API, danh sách truyện từ
Supabase, socket phòng viết chung (HTTP 101), edge-tts sẵn sàng trong container.

**Ba lỗi tìm ra khi build, đáng kể:**
- npm báo "Exit handler never called" rất khó hiểu. Đọc log chi tiết mới thấy nguyên
  nhân thật: phần mềm diệt virus trên máy dev ký lại HTTPS, kể cả bên trong Docker.
  Cách sửa: build secret `extra_ca` **tuỳ chọn**, chỉ dùng lúc tải thư viện, không nằm
  trong image, server không cần.
- `docker run --env-file` giữ nguyên dấu ngoặc kép trong `.env`, nên `DATABASE_URL` hỏng.
  Docker Compose thì bỏ ngoặc, nên trên server không gặp. Phát hiện nhờ chạy thử image
  một mình trước khi chạy cả hệ thống.
- `.env` dev ghi `EDGE_TTS_PYTHON=python` mà image chỉ có `python3`, và biến trong env
  file luôn đè giá trị mặc định của image. Giọng đọc âm thầm bị tắt. Sửa bằng cách cho
  image có cả hai tên.

## 11c. Audio vừa 9 GB: đo trước, rồi chọn

- Đo trên 746 clip đã có: khoảng **501 byte audio cho mỗi ký tự** ở 64 kbps. Toàn bộ
  catalogue (7.297 chương, 56 triệu ký tự) sẽ là **khoảng 28 GB**, gấp 3 lần mức chặn,
  và khoảng 3 ngày tạo liên tục.
- Gửi hai mẫu 64 kbps và 32 kbps để nghe bằng tai rồi chọn **32 kbps** (nhẹ một nửa,
  giọng nói vẫn rõ).
- Chỉ tạo sẵn những gì người đọc gặp đầu tiên: **toàn bộ truyện AI** và **chương đầu của
  mỗi truyện nhập** (khoảng 1.040 chương, khoảng 1,75 GB). Chương sau tạo khi có người
  bấm nghe, vẫn dưới mức chặn.
- Phát hiện kèm theo: API đang chạy trên laptop là bản cũ **không có** phần chặn, và hàng
  đợi bị bật lại với 6.015 việc (khoảng 21 GB). Tạm dừng ngay, chuyển các dòng việc sang
  `CANCELLED` **trước** khi xoá khỏi hàng đợi (nếu làm ngược, bộ quét sẽ tự xếp lại),
  rồi chạy lại API bản mới.

## 12. Làm việc với hai AI agent trong cùng một repo

Claude Code và Codex sửa code song song trong cùng thư mục.

**Quy tắc đặt ra:**
- Mỗi agent chỉ commit phần mình viết. Nếu một file có thay đổi của cả hai, chỉ commit
  phần của mình: lấy bản HEAD, áp đúng phần sửa của mình, rồi đưa vào staging bằng
  `git hash-object` và `git update-index`, không đụng phần của agent kia.
- Không tắt tiến trình của agent khác. Khi cần dừng việc nó đang làm thì dùng thao tác
  đảo ngược được (ví dụ tạm dừng hàng đợi).
- Agent phụ không được giao việc nhạy cảm: bảo mật, thanh toán, xoá dữ liệu.
- Trước mỗi lần push, quét toàn bộ commit tìm mật khẩu và khoá API. Mật khẩu chỉ nằm
  trong `.env`, không bao giờ dán vào chat.

**Bài học:** build lại thư mục `dist` trong lúc một tiến trình đang chạy từ chính thư mục
đó sẽ làm nó sập. Giờ trước khi build luôn kiểm tra ai đang chạy.

## 13. Những thứ cố tình chưa phải dữ liệu thật

- Số sao đánh giá là **số giả cố định** (tính từ hash của id, nên không nhảy mỗi lần tải
  trang), đã hạ xuống dưới 500 lượt cho hợp lý với một web mới.
- Một số tên tác giả là tên mẫu.
- Hai thứ này được ghi rõ trong code là **không được tới tay người dùng thật**. Đây là
  việc phải dọn trước khi ra mắt (xem bên dưới).

---

## Trạng thái và kế hoạch (16/11/2026)

**Đã xong:**
1. Commit phần Codex (truyện nhập, kệ truyện Trung, chọn ảnh bìa). Nguồn và bản quyền
   đã liệt kê; quyết định: giữ hết, **repo phải chuyển sang private trước khi push**.
2. Docker (web, API kèm worker), `docker-compose.prod.yml`, Caddy, hướng dẫn
   [deploy.md](deploy.md). Đã chạy thử cả hệ thống trên laptop.
3. Ảnh bìa lên R2 (2.548 file, 345 MB). R2 khoảng 0,93 GB / 9 GB.

**Còn lại:** chuyển repo sang private rồi push; thuê máy ảo và deploy; xoá 441 MB audio
cũ trên laptop sau khi xác nhận web phát được từ R2.

**Chưa duyệt, để sau:**
- Dọn trước khi ra mắt: tắt `DEV_ENDPOINTS`, ẩn đánh giá và tác giả giả, chuyển Google
  OAuth sang production, xoay lại các khoá.
- Sao lưu database hằng đêm lên R2 (Supabase free không có bản sao lưu tải về được).

**Để khi có người dùng thật:** [production-later.md](production-later.md).
