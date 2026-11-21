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

## 7c. Sắp xếp và hai cách tìm trong Khám phá

**Lần đầu làm quá tay.** Mình xây một trang Xếp hạng riêng: "Hay nhất" theo trung bình Bayes,
"Đang hot" theo lượt đọc 7 ngày lưu trong Redis sorted set. Chủ dự án xem và nói không cần
trang riêng: chỉ cần **bộ lọc sắp xếp** trong Khám phá. Đã gỡ trang và API đó. Bài học kể
được khi phỏng vấn: hỏi rõ phạm vi trước khi xây, đừng tự mở rộng tính năng.

**Bản hiện tại:** trong Khám phá có ba kiểu sắp xếp: *Phổ biến nhất* (lượt đọc),
*Mới nhất* (ngày đăng), *Được thích nhất* (đúng điểm sao đang hiện trên thẻ, hoà điểm thì
truyện nhiều lượt chấm hơn đứng trước). Sắp trên dữ liệu đã tải về trình duyệt, nên đổi kiểu
là tức thì, không gọi API. Đi chung với lọc thể loại sẵn có.

**Hai cách tìm:** nút chuyển giữa *Tìm theo tên & bộ lọc* (tức thì, không tốn gì) và
*Tìm bằng AI* (tả bằng lời, tốn lượt gọi model, có hạn mức mỗi ngày). Tách ra để người chỉ
muốn gõ tên truyện không phải đợi AI.

**Thể loại bị tách đôi theo chữ hoa/thường.** Tag là chữ tự do nên có cả "Gia đình" (60)
và "gia đình" (11). Giờ gom không phân biệt hoa thường và hiện cách viết phổ biến hơn.

**Bỏ trang Tham khảo.** Trang liệt kê các web truyện audio khác cùng ghi chú kỹ thuật viết.
Chủ dự án thấy không cần thiết nên đã gỡ trang, link trên menu và API `/references`. Ô lớn
trên trang chủ trước giới thiệu tủ tham khảo, giờ giới thiệu **Tìm bằng AI** (link
`/kham-pha?tim=ai` mở thẳng chế độ AI). Ghi chú kỹ thuật viết vẫn ở trong database, vì "AI
viết tiếp" còn đọc chúng theo thể loại.

**Admin chấm được mọi truyện.** Luật "không tự chấm truyện của mình" và "đọc rồi mới chấm"
không áp cho admin, vì 1.111 truyện mẫu đứng tên tài khoản admin.

**Phần chấm điểm của tìm kiếm AI** (RRF và các mức cộng) được tách thành hàm thuần để unit
test. Một test từng thất bại và chỉ ra: khi khớp cả thể loại, cảm xúc và kiểu kết, truyện hạng
10 của một danh sách có thể vượt truyện cả hai danh sách đều xếp đầu. Giữ nguyên, vì người đọc
đã hỏi đúng cả ba điều đó.

**Lỗi làm sập API khi tạo audio:** tiến trình con (Python/ffmpeg) thoát trước khi đọc hết
dữ liệu, pipe báo lỗi EOF mà không ai bắt, nên cả API chết. Thêm bộ bắt lỗi cho stdin; việc
báo lỗi đã có ở handler `close`.

Bảng `rag_chunks` cũ đã xoá bằng migration.

## 7d. Đăng nhập bằng email, và popup thay cho tường chặn

**Popup ở mọi chỗ cần tài khoản.** Trước đây người chưa đăng nhập thấy dòng "Đăng nhập để
chấm sao", bấm vào thì bị đưa sang Google rồi quay về trang chủ. Giờ mọi hành động cần tài
khoản (chấm sao, rẽ nhánh, nút Đăng nhập) đều gọi chung một hàm `signIn(lý do)`, và hàm
đó mở popup ngay tại trang. Vì mọi chỗ đã đi qua một hàm duy nhất, đổi hành vi chỉ cần sửa
một nơi. Sao bấm lúc chưa đăng nhập được nhớ lại và tự chấm sau khi đăng nhập xong.

**Email + mật khẩu bên cạnh Google.**
- Mật khẩu băm bằng argon2id, không bao giờ lưu hay trả về bản gốc.
- Đăng nhập sai luôn trả cùng một câu, dù email không tồn tại, tài khoản chỉ dùng Google hay
  sai mật khẩu, và vẫn chạy băm cả khi không có tài khoản, để thời gian phản hồi không lộ
  email nào đã đăng ký.
- Giới hạn sai: 10 lần mỗi tài khoản và 30 lần mỗi IP trong 15 phút. Dùng bộ đếm riêng, vì
  dùng chung với bộ chặn refresh token thì 5 lần gõ sai sẽ làm cả mạng đó bị đăng xuất.

**Lỗ hổng đã chặn trước: chiếm tài khoản bằng email chưa xác minh.** Chưa có dịch vụ gửi
mail nên email đăng ký chưa được xác minh. Kẻ xấu có thể đăng ký trước bằng email của người
khác với mật khẩu họ biết, chờ chủ thật đăng nhập Google và được nối vào tài khoản đó. Cách
chặn: khi Google nối vào tài khoản có sẵn, mật khẩu chưa xác minh bị xoá, vì Google vừa
chứng minh ai là chủ email. Có unit test cho đúng tình huống này.

**Xác minh email và quên mật khẩu (Resend).**
- Gửi mail bằng một lệnh `fetch` tới API của Resend, không thêm SDK. Không có key thì mail
  được ghi vào log, nên trên laptop vẫn bấm thử được toàn bộ luồng.
- Link chứa token ngẫu nhiên 256-bit; chỉ lưu **SHA-256** của token trong Redis kèm thời hạn
  (xác minh 24 giờ, đặt lại mật khẩu 1 giờ). Lộ dữ liệu Redis cũng không mở được tài khoản nào.
  Token chỉ dùng một lần (`GETDEL`), và xin link mới thì link cũ hết hiệu lực.
- "Quên mật khẩu" luôn trả cùng một câu, nên không ai dò được email nào có tài khoản. Mỗi
  email nhận tối đa 3 mail mỗi loại mỗi giờ, để form không bị dùng để spam người khác.
- Đặt lại mật khẩu thì **đăng xuất mọi thiết bị**: nếu có người biết mật khẩu cũ (có thể là
  lý do phải đổi), họ cũng mất phiên. Mở được link nghĩa là đã chứng minh hộp thư, nên tài
  khoản được tính là đã xác minh.
- Trang nhận link đọc token rồi xoá nó khỏi thanh địa chỉ, để link đã dùng không nằm lại
  trong lịch sử trình duyệt.
- Luật nối Google được tinh chỉnh: tài khoản **đã xác minh** giữ mật khẩu khi nối Google;
  chỉ mật khẩu đặt khi email chưa được chứng minh mới bị xoá.
- Chưa xác minh vẫn dùng được mọi thứ; chỉ có một dòng nhắc dưới thanh menu kèm nút gửi lại.

## 7e. Đợt cải thiện lớn: tốc độ, nghe tiếp, theo dõi, bình luận

**Lỗi hiệu năng lớn nhất: danh sách truyện mất 10–15 giây.** Trang chủ và Khám phá đều tải
toàn bộ 1.111 truyện. Mỗi lần là ba truy vấn tới database ở Singapore trong khi máy chủ ở
Mỹ, và kết quả nặng 1,75 MB. Cách sửa: dựng danh sách một lần, lưu sẵn dạng JSON trong
Redis, trả về ngay rồi làm mới ngầm khi có thay đổi (đăng truyện, thêm chương, chấm sao).
Kỹ thuật này gọi là *stale-while-revalidate*. Còn **0,06 giây**. Có xử lý trường hợp một thay
đổi xảy ra đúng lúc đang dựng lại: đếm "thế hệ", nếu trong lúc dựng có thay đổi thì dựng tiếp.

**Lượt xem bị đếm trùng.** Mỗi chương mở ra đều cộng một lượt, nên đọc hết truyện 20 chương
là 20 lượt, và tải lại trang liên tục là đẩy được truyện lên "Phổ biến nhất". Giờ mỗi người
đọc (tài khoản, hoặc IP nếu chưa đăng nhập) chỉ được tính một lần mỗi 30 phút.

**Thời lượng audio hiển thị sai.** Mục lục chia thời lượng cho 1,5 (tốc độ mặc định cũ của
giọng Gemini), nên số phút hiện ra thấp hơn thật khoảng một phần ba. Giờ tính theo đúng tốc
độ người nghe đang chọn.

**Nghe tiếp chỗ đang dở.** Vị trí (chương và giây) được lưu trên máy trước, nên chạy được
cả khi chưa đăng nhập hay mất mạng. Khi đã đăng nhập thì đồng bộ lên máy chủ: gộp theo nguyên
tắc *mới nhất thắng*, quyết định ngay trong câu lệnh SQL để hai thiết bị ghi cùng lúc không
đè nhau. Thời gian lấy theo đồng hồ của thiết bị nhưng không được vượt quá giờ máy chủ: một
điện thoại đặt sai giờ sang năm sau không thể chiếm vị trí mãi mãi.

**Theo dõi truyện không cần gửi thông báo cho từng người.** "Có chương mới" là phép so sánh
số chương hiện có với số chương người theo dõi đã xem, làm lúc họ mở chuông. Đăng một chương
mới không ghi gì cho từng người theo dõi, nên truyện có 100.000 người theo dõi tốn chi phí
như truyện không ai theo dõi. Cách kia (tạo một dòng thông báo cho mỗi người mỗi chương)
gây bão ghi đúng vào những truyện đang ăn khách.

**Bình luận gắn vào chính dòng chương**, không phải "truyện X, chương số 5". Chương 5 của
một nhánh rẽ là nội dung khác chương 5 bản gốc, còn các chương nhánh thừa hưởng từ bản gốc
là cùng một dòng dữ liệu, nên bình luận dùng chung đúng chỗ nội dung giống nhau. Lưu và hiển
thị dạng chữ thuần (không có HTML nên không phải lọc mã độc). Có lọc ký tự điều khiển và
ký tự đảo chiều văn bản (hay dùng để giả mạo nội dung). Tác giả xoá được bình luận trên
truyện của mình.

**Truyện tương tự không tốn lượt gọi AI.** Mỗi truyện đã có sẵn embedding từ phần tìm kiếm
AI, nên "tương tự" chỉ là một truy vấn tìm các embedding gần nhất. Truyện chưa có embedding
thì lấy truyện cùng thể loại được đọc nhiều nhất, và tiêu đề nói rõ là "cùng thể loại", không
nhận là "tương tự" khi chưa đo.

**Trình phát:** hẹn giờ tắt (15/30/45/60 phút hoặc hết chương, nhỏ dần trong 10 giây cuối
thay vì tắt cái bụp), điều khiển từ màn hình khoá và tai nghe (Media Session API), phím tắt,
trình phát nhỏ bám theo khi cuộn, cỡ chữ đọc.

**Bảo mật:**
- API **từ chối khởi động** ở production nếu còn bật `AUTH_DEV_USER`, `DEV_ENDPOINTS` hoặc
  còn dùng khoá mẫu. File `.env.example` để sẵn các giá trị đó, nên chép nguyên lên máy chủ
  là mở cửa; giờ thì máy chủ không chạy.
- Ở production, tài khoản email chưa xác minh không có lượt AI miễn phí và không bình luận
  được; mỗi IP tạo tối đa 5 tài khoản mỗi ngày. Mục đích là không cho tạo tài khoản hàng loạt
  để ăn lượt AI.
- Caddy gửi header bảo mật: HSTS, chặn nhúng iframe, CSP, Referrer-Policy.

**Chia sẻ link:** trang truyện vốn dựng trên trình duyệt, nên Facebook/Zalo chỉ thấy chữ
"Nhịp Bút". Thêm một layout chạy phía máy chủ chỉ để lấy tên, mô tả và ảnh bìa của truyện.

**Kiểm thử:** 50 unit test, cùng 13 test tích hợp chạy trên một Postgres thử dựng riêng
(không đụng Supabase), cho các phần là SQL thật: ghi đè theo thời gian, phân trang bình
luận, tìm láng giềng gần nhất bằng pgvector.

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

## 11d. Chạy thử 90 ngày trước khi trả tiền (18/11/2026)

**Quyết định:** chưa trả tiền máy chủ. Deploy lên **gói dùng thử Google Cloud** (300 USD
tín dụng, hạn 90 ngày), quảng bá, và chỉ trả tiền deploy thật khi có **20 người dùng quay
lại** (đăng nhập ít nhất 2 ngày khác nhau trong 30 ngày).

**Vì sao không chọn nơi rẻ nhất ngay:**
- Mục 11 tính giá máy 4 GB, nhưng giọng mặc định nay là VieNeu Trúc Ly, riêng nó dùng
  khoảng 3,6 GB RAM. Cần máy 8 GB trở lên.
- Kiểm tra giá thật (18/11/2026): gói 8 GB rẻ của Contabo ở **Singapore hết hàng**. Gói
  còn hàng ở Singapore khoảng 25,6 USD/tháng. Ở Nhật khoảng 9,75 USD nhưng database
  Supabase nằm ở Singapore, mỗi truy vấn thêm khoảng 70 ms. Hetzner Singapore tăng giá lên
  khoảng 49 EUR. Oracle miễn phí bị cắt còn 2 lõi ARM.
- Chưa biết có người dùng không thì chưa nên cam kết tiền. 90 ngày tín dụng vừa đủ cho
  một vòng quảng bá, máy đặt ở Singapore cùng chỗ với database, và **không tự trừ tiền**
  khi hết hạn.
- Laptop ở nhà qua Cloudflare Tunnel là phương án dự phòng (miễn phí), nhưng phụ thuộc
  điện và mạng nhà.

**Bản chạy thử không được kém bản thật:**
- **Giọng: tạo khi có người bấm, chỉ tạo sẵn phần người mới thấy đầu tiên.** Ban đầu định
  tạo trước toàn bộ 1.604 chương đã lên kế hoạch (khoảng 2,3 GB, 5 ngày laptop chạy liên
  tục). Bỏ, vì phần lớn số chương đó có thể không ai mở, và không đáng đợi 5 ngày mới ra
  mắt. Thay bằng: tạo sẵn chương 1 của 24 truyện trang đầu Khám phá (script
  `narrate-stories`, khoảng 20 phút), còn lại tạo khi người nghe bấm, và bấm một chương
  thì chương sau được xếp hàng luôn.
- Lần đầu chạy, script xếp hàng dừng giữa chừng hai lần vì mạng tới Supabase chập chờn
  (hết kết nối, rồi "Can't reach database server"). Sửa: chương nào lỗi thì bỏ qua và đếm
  lại, chạy lại script là xếp nốt, thay vì một lỗi làm dừng cả nghìn chương.
- **VieNeu chạy trong Docker** cạnh API, model tải về một volume ở lần chạy đầu. API
  không phụ thuộc vào nó: trong lúc VieNeu chưa sẵn sàng thì Edge đọc thay.
- **Sao lưu database mỗi đêm lên R2**, giữ 7 bản. Gói miễn phí của Supabase không có bản
  sao lưu để tự khôi phục.
- **Đo được người dùng:** trang `/quan-tri` (chỉ admin) đếm người quay lại so với mục tiêu
  20, cùng Cloudflare Web Analytics (không dùng cookie nên không cần hỏi đồng ý).
- Chuyển nơi khác chỉ là chép sang rồi chạy lại một lệnh, vì mọi thứ đã đóng gói Docker.

**Không mua tên miền, không bán chương (19/11/2026):**
- Google Cloud không cho tên miền miễn phí, chỉ cho IP. Dùng **DuckDNS**
  (`nhipbut.duckdns.org`), Caddy vẫn tự lấy HTTPS. IP tĩnh nên chỉ trỏ một lần.
- Resend chỉ gửi email tới người lạ từ tên miền đã xác minh, mà tên miền con DuckDNS không
  xác minh được. Thêm đường **gửi qua Gmail (SMTP, App password)**, dùng trước Resend khi
  có cấu hình. Gmail cho khoảng 500 email/ngày, quá đủ cho xác minh tài khoản giai đoạn này.
- **Tắt chương trả phí** (`PAID_CHAPTERS=false`). Chưa có cổng thanh toán, nên tác giả đặt
  giá thì người đọc gặp khoá mà không có cách nào trả. Tắt thì mọi chương miễn phí và ô đặt
  giá ẩn đi. Giá đã đặt vẫn giữ trong database, bật lại là dùng được.

## 11e. Premium trả bằng chuyển khoản, xác nhận qua SePay (19/11/2026)

**Quyết định:** Premium **15.000đ / 30 ngày**: nhiều lượt AI hơn (3 → 30/ngày), tìm truyện
bằng AI 20 → 200 lần/ngày, giọng đọc được ưu tiên trong hàng đợi, huy hiệu cạnh tên. Đọc và
nghe vẫn miễn phí cho mọi người. Trả bằng **VietQR chuyển khoản**, **SePay** báo về khi tiền vào.

**Vì sao không Stripe, không MoMo:**
- Stripe không mở tài khoản cho người bán ở Việt Nam.
- Cổng MoMo cần tài khoản doanh nghiệp (M4B), và từ 01/03/2026 tên tài khoản nhận tiền phải
  khớp giấy đăng ký hộ kinh doanh. Không hợp với một dự án cá nhân đang chạy thử.
- Chuyển khoản QR là cách người Việt quen trả nhất. SePay đọc giao dịch của **tài khoản
  ngân hàng cá nhân** và gọi webhook, nên không cần cổng thanh toán hay giấy phép.

**Cách làm đúng tiền:**
- Mỗi lần bấm tạo một **mã đơn** (`NB` + 6 ký tự, bỏ ký tự dễ nhầm 0/O, 1/I/L). Mã nằm trong
  nội dung chuyển khoản. Ngân hàng hay viết hoa, chèn tên người gửi, xoá hoặc thêm dấu cách,
  nên mã được tìm cả trong bản gốc lẫn bản đã bỏ khoảng trắng, và từng ứng viên được đối
  chiếu với đơn thật chứ không tin cái đầu tiên.
- **Xác thực webhook bằng HMAC-SHA256** trên đúng byte của body (bật `rawBody` của Nest; parse
  rồi serialize lại thì chữ ký không khớp). Lệch giờ quá 5 phút là từ chối, để không ai gửi
  lại một request cũ. Không cấu hình khoá thì từ chối tất cả.
- **Không bao giờ cộng hai lần:** mỗi giao dịch SePay lưu một dòng, id SePay là unique, và
  việc cộng Premium nằm cùng transaction với dòng đó. SePay gửi lại thì insert lỗi, cả
  transaction huỷ.
- **Chuyển làm hai lần cùng lúc** vẫn cộng đủ: khoá dòng đơn hàng (`SELECT ... FOR UPDATE`)
  trước khi cộng số tiền. Có test chạy hai webhook song song trên Postgres thật.
- **Thiếu tiền** thì không kích hoạt, QR hiện số còn thiếu. **Quên ghi mã** thì giao dịch vẫn
  được lưu, admin gắn tay vào đơn ở `/quan-tri`. Không đồng nào bị bỏ qua im lặng.
- Gia hạn sớm cộng nối từ ngày hết hạn hiện tại, trong một câu SQL (`GREATEST(...) + 30 ngày`).

Giải thích từ đầu cho người mới, kèm sơ đồ và câu hỏi phỏng vấn: [payments.md](payments.md).

**Còn thiếu / sau này:** không tự gia hạn (chuyển khoản không trừ tự động được); hoàn tiền làm
tay. Thu nhập từ Premium vẫn là thu nhập, có doanh thu đều thì phải tìm hiểu nghĩa vụ thuế.

## 11f. Tự tấn công thử web (red team, 19/11/2026)

**Cách làm:** chạy một bản API riêng trên database thử nghiệm ở máy (tắt mail, R2 và khoá AI để
không gửi gì ra ngoài), rồi viết script đóng hai vai: Alice (chủ truyện) và Mallory (kẻ tấn công).
Mallory thử sửa, xoá, đăng chương, xem truyện riêng tư, tự mời mình vào phòng viết, gọi API quản
trị, gửi webhook SePay giả, tự gán `role=ADMIN`, dùng token `alg=none`. Trên web thật chỉ thử
những lệnh không ghi gì: cổng mở (chỉ 22, 80, 443), header, API dev và API quản trị khi chưa đăng nhập.

**Kết quả:** phần quyền sở hữu vững vì mọi kiểm tra nằm trong service, không nằm ở giao diện. Hỏng
ở chỗ khác: **chi phí và tài nguyên**.

- **Ai cũng gọi được "đọc cả truyện"** (`POST /audio/branches/:id`), kể cả người chưa đăng nhập.
  Một request xếp hàng mọi chương của một truyện bất kỳ. Vài trăm request là máy đọc bận nhiều
  ngày và kho 9 GB đầy. Sửa: chỉ chủ nhánh hoặc admin.
- **Ảnh đại diện và ảnh bìa chỉ bị giới hạn theo phút** (6 lần/phút). Mỗi ảnh là một file mới
  nằm chung kho với giọng đọc, và ảnh cũ không bị xoá. Sửa: tối đa 10 ảnh đại diện và 30 ảnh bìa
  mỗi ngày cho mỗi tài khoản (bộ đếm trong Redis).
- **Ai cũng xem được ai đang ở trong phòng viết riêng tư**, chỉ cần biết id. Sửa: cần quyền đọc.
- **Header `X-Powered-By: Next.js`** cho kẻ quét biết nên thử lỗ của framework nào. Đã tắt.

**Bài học (để kể khi phỏng vấn):** test phân quyền hay chỉ hỏi "người này có được làm việc này
không". Câu hỏi bị bỏ sót là "việc này tốn bao nhiêu, và ai trả". Rate limit theo phút không thay
được hạn mức theo ngày khi mỗi request ghi thêm dữ liệu vào một kho có trần.

## 11g. Red team lần hai, trước khi marketing (21/11/2026)

Lần một tìm lỗ ở chi phí. Lần này đóng vai kẻ xấu muốn **chiếm tài khoản, mạo danh và lừa
người dùng** khi web bắt đầu đông người.

- **Chiếm tài khoản trước (pre-hijacking):** kẻ xấu đăng ký trước bằng email của nạn nhân. Khi
  nạn nhân đăng nhập Google, code đã xoá mật khẩu của kẻ xấu, nhưng **phiên đăng nhập của kẻ xấu
  vẫn còn**, và refresh token tự gia hạn mãi. Sửa: khi Google chứng minh chủ email, đăng xuất mọi
  phiên có từ trước.
- **Mạo danh:** danh sách tên cấm (`admin`, `nhipbut`…) chỉ được kiểm khi đổi tên trong cài đặt.
  Đăng ký với tên "Admin" là được `@admin`. Sửa: một bộ lọc chung (`users/impersonation.ts`), bỏ
  dấu rồi so theo từ, áp cho đăng ký, Google và cài đặt. Có test cho tên thật như "Hồ Trọng" để
  không chặn nhầm.
- **Mượn email của web để lừa đảo:** thư xác minh mở đầu bằng "Chào <tên hiển thị>", mà tên là
  thứ kẻ đăng ký tự gõ, với email của người lạ. Ai cũng gửi được một câu tuỳ ý từ
  `no-reply@nhipbut.com`. Sửa: thư chỉ chào "Chào bạn,".
- **Thư viện:** `npm audit` có 2 lỗ critical (Next.js cache poisoning, `proxy-addr` giả IP) và
  nhiều lỗ high. Đã vá những gì không phá tương thích, và nâng nodemailer lên 10. Phần còn lại
  (Prisma CLI, PostCSS) chỉ chạy lúc build.

**Đã thử mà không thủng:** lịch sử git (repo công khai) không lộ khoá nào. Giả `X-Forwarded-For`
không lách được giới hạn request (Caddy ghi đè header). Link `javascript:` trong chương bị lọc.
Không có SQL ghép chuỗi. Tải ảnh chỉ từ `images.pexels.com`, có trần số pixel. Token email
256-bit, dùng một lần, lưu dạng băm. Webhook SePay không có khoá thì từ chối hết.

**Bài học:** lỗ nguy hiểm nằm ở chỗ nối giữa hai tính năng đúng. Liên kết tài khoản Google đúng,
phiên đăng nhập đúng, nhưng ghép lại thì kẻ xấu ở lại trong tài khoản người khác.

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

## 13. Số liệu thật và số liệu demo

- **Sao đánh giá là thật**: người đọc chấm 1–5 sao, phải đọc ít nhất một chương mới được
  chấm, đủ 5 lượt mới hiện điểm trung bình. Số đếm và tổng sao lưu ngay trên dòng truyện,
  cập nhật trong cùng transaction với lượt chấm, nên danh sách không phải cộng lại mỗi lần.
- **Chế độ demo** (bật khi chạy dev, tắt ở production): truyện chưa đủ lượt chấm hiện một số
  sao giả cố định, tính từ hash của id, để xem bố cục. Không bao giờ hiện sao giả cho tác
  phẩm của tác giả thật. Lý do: sao giả tới tay người dùng thật là nói sai về truyện, và
  đánh giá giả là trái luật ở nhiều nơi.
- Admin chấm được mọi truyện, vì 1.111 truyện mẫu đứng tên tài khoản admin.

## 14. Hỏi đáp phỏng vấn

**"Project có dùng RAG không?"**
Có từng dùng, rồi gỡ, và nói được vì sao.
- *RAG* = lấy đoạn văn liên quan (Retrieval), nhét vào prompt, để LLM sinh câu trả lời dựa
  trên đó (Augmented Generation).
- *Bản cũ:* "AI viết tiếp" cắt từng chương thành đoạn, tạo embedding, lấy các đoạn giống
  nhất đưa vào prompt. Đã gỡ: model nhận được cả truyện trong prompt nên các đoạn lấy thêm
  gần như không giúp gì, còn việc tạo embedding cho mọi chương thì tiêu hạn mức Gemini của
  người đọc (mục 7, 7b).
- *Bây giờ:* **Tìm bằng AI** là dạng gần RAG nhất: LLM đọc câu người dùng gõ thành bộ lọc,
  tìm ứng viên bằng vector + từ khoá (hybrid search, gộp bằng RRF), rồi đưa ứng viên cho LLM
  viết một câu "vì sao hợp". LLM chỉ diễn giải kết quả đã tìm, không tự bịa truyện.
- *Truyện tương tự* **không phải RAG**: chỉ là tìm vector gần nhất (pgvector, `<=>` cosine),
  không gọi LLM. Embedding đã có sẵn từ lúc viết thẻ cho tìm kiếm, nên chi phí bằng 0.

**"Vector search khác full-text search thế nào, sao dùng cả hai?"**
Vector hiểu nghĩa ("chồng phản bội" gần với "ngoại tình") nhưng hay bỏ sót từ hiếm, cụ thể
("tiệm nail", "bé ba"). Full-text bắt đúng chữ nhưng không hiểu đồng nghĩa. Dùng cả hai rồi
gộp bằng *reciprocal rank fusion*: cộng `1/(60 + hạng)` từ mỗi danh sách. Gộp theo hạng
thay vì theo điểm, vì khoảng cách cosine và `ts_rank` không cùng thang đo.

**"Làm sao để một truyện 1 lượt 5 sao không đứng trên truyện 40 lượt 4,7?"**
Trung bình Bayes: coi như mỗi truyện có sẵn 10 lượt chấm ở mức trung bình toàn site.
Ít lượt thì điểm bị kéo về mức trung bình, nhiều lượt thì điểm thật mới hiện rõ.

**"Hệ thống chậm thì bạn tìm nguyên nhân thế nào?"** (mục 7e)
Đo trước, không đoán. API danh sách truyện mất 10–15 giây. Tách ra đo: một lần ping database
mất 215 ms (database ở Singapore, máy chủ ở Mỹ); đọc 1.111 truyện mất 2 giây, thêm phần
join mất 4 giây; kết quả nặng 1,75 MB. Danh sách giống nhau với mọi người xem, nên cache.
Chọn *stale-while-revalidate*: luôn trả bản đã lưu ngay, làm mới ngầm khi có thay đổi. Xử lý
race: một thay đổi xảy ra đúng lúc đang dựng lại thì dựng lại lần nữa (đếm "thế hệ"). Kết quả
0,06 giây. Có unit test cho đúng tình huống race đó.

**"Thông báo chương mới cho người theo dõi: làm sao scale?"**
Không tạo thông báo cho từng người (fan-out on write). "Có chương mới" là phép so sánh số
chương hiện có với số chương người đó đã xem, tính lúc họ mở chuông (fan-out on read). Đăng
chương mới không tốn thêm gì dù truyện có 100.000 người theo dõi. Đánh đổi: không có push
notification; muốn có thì thêm hàng đợi gửi sau, nhưng nguồn sự thật vẫn là phép so sánh.

**"Đồng bộ vị trí nghe giữa hai thiết bị, xung đột thì sao?"**
Mới nhất thắng, theo thời điểm người nghe thật sự ở đó (đồng hồ thiết bị), quyết định ngay
trong câu `INSERT ... ON CONFLICT DO UPDATE ... WHERE cũ <= mới`, nên hai thiết bị ghi cùng
lúc không đè nhau. Đồng hồ thiết bị không được vượt quá giờ máy chủ: một điện thoại để sai
giờ sang năm sau sẽ không chiếm vị trí mãi mãi. Thiết bị lưu cục bộ trước, nên chưa đăng
nhập hay mất mạng vẫn chạy.

**"Bảo mật: nếu bị tấn công thì sao?"** (mục 7d, 7e)
Điểm yếu thật thường nằm ở cấu hình deploy, không phải code. Ví dụ ở đây: `.env.example`
để sẵn chế độ dev (ai vào cũng thành tài khoản dev), nên API được sửa để **từ chối khởi
động** ở production nếu còn cấu hình đó. Những chỗ khác: mật khẩu băm argon2id; đăng nhập
sai luôn trả cùng một câu; giới hạn số lần sai; token trong link email chỉ lưu bản băm và chỉ
dùng một lần; refresh token trong cookie httpOnly có xoay vòng; truyện riêng tư trả 404 chứ
không phải 403; bình luận là chữ thuần và lọc ký tự đảo chiều văn bản; giới hạn tạo tài khoản
để không ai tạo hàng loạt ăn lượt AI miễn phí.

**"Kiểm thử thế nào?"**
Logic thuần (tính điểm tìm kiếm, cache, rate limit, xác thực) có unit test với dữ liệu giả.
Phần là SQL thật (ghi đè theo thời gian, phân trang, pgvector) có test tích hợp chạy trên
một Postgres thử dựng riêng; script từ chối chạy nếu địa chỉ database không phải localhost,
để không bao giờ lỡ chạy lên database thật. Giao diện được thử bằng tay trên trình duyệt.

**"Chuyển chương khi đang nghe bị khựng: tìm và sửa thế nào?"**
Đo trên trình duyệt, không đoán. Từ lúc sang chương mới đến lúc có tiếng mất 4,6 giây: trang
chương mới hỏi lại API truyện (1,3 s), rồi cả nhánh (2,2 s), rồi danh sách audio, nối đuôi
nhau, dù chẳng có gì thay đổi giữa chương 3 và chương 4. Nếu chương sau chưa có giọng thì
thêm 1–4 phút chờ tạo giọng (Edge đọc nhanh hơn thời gian thật khoảng 3–4 lần).
- *Cache theo tab* cho ba lượt đọc đó (5 phút, theo từng người dùng vì chương bị khoá phụ thuộc
  người xem). Lần đầu làm, cache bị xoá bởi *mọi* lệnh ghi, kể cả lệnh lưu vị trí nghe mỗi 15
  giây, nên vô dụng; đo lại mới thấy. Sửa: chỉ xoá phần bị ảnh hưởng (tạo giọng chỉ xoá danh
  sách audio của nhánh đó). Trang soạn truyện luôn đọc mới vì sửa cộng tác không đi qua POST.
- *Chuẩn bị trước*: nghe được 30 giây thì tạo sẵn giọng chương sau và tải sẵn dữ liệu trang
  của nó. Server vốn đã tạo trước một chương, nhưng chỉ khi người nghe bấm tạo giọng; chương
  đã có giọng thì không ai gọi server, nên trường hợp phổ biến nhất lại không được chuẩn bị.
  Đợi 30 giây vì lúc đó người ta đang nghe thật, không phải bấm thử.
- Kết quả: 4,6 s xuống 0,36 s. Server gộp yêu cầu trùng theo khoá `audio:{chương}:{giọng}`,
  nên người nghe tới nơi khi bản tạo trước còn đang chạy cũng không tạo trùng.

**"Thêm giọng đọc tự chạy (self-hosted) thế nào, gặp lỗi gì?"**
Người dùng muốn thêm giọng nữ miền Bắc. Edge chỉ có một giọng nữ tiếng Việt. Đã thử FPT.AI
(phải đăng ký và bật dịch vụ, bỏ). Chọn VieNeu-TTS v3 Turbo: giấy phép Apache 2.0, các giọng
có sẵn (Trúc Ly, Ngọc Huyền) được người thật đồng ý cho dùng, chạy được trên CPU. Đo trên
laptop (i5 4 nhân): nhanh hơn thời gian thật khoảng 1,3 lần, so với Edge khoảng 3,7 lần.
- *Kiến trúc:* model nằm trong một tiến trình Python chạy thường trực trên cùng máy
  (`tools/vieneu/sidecar.py`), API Node gọi qua HTTP nội bộ. Vì API viết bằng Node, không chạy
  model Python trực tiếp được, và nạp model mỗi lần thì tốn thời gian.
- *Lỗi 1:* gửi nguyên chương thì một yêu cầu chiếm model 8 phút; chương ngắn người đọc vừa
  bấm phải chờ sau chương tạo trước của người khác. Sửa: cắt thành đoạn khoảng 1.200 ký tự,
  các chương xen nhau theo từng đoạn. Chương ngắn còn chờ 50 giây thay vì 7,5 phút.
- *Lỗi 2:* kết quả hay bị mất giữa đường (ECONNRESET, "terminated"). Tách từng giả thuyết và
  đo: giữ kết nối lâu thì bị cắt, nên đổi sang gửi việc rồi hỏi kết quả; vẫn lỗi; thêm
  `Connection: close`, vẫn lỗi; viết script Node riêng thì thấy cứ 2 lần hỏng 1, kể cả với
  JSON vài byte. Kết luận: `http.server` có sẵn của Python không hợp. Chuyển sang uvicorn thì
  3/3 lần thành công, chương 12.000 ký tự xong sau 6 phút 47 giây. Vẫn giữ thiết kế chịu
  lỗi: kết quả chỉ xoá khi API báo đã nhận đủ, tải hỏng thì tải lại.
- *Bài học:* khi lỗi lúc có lúc không, viết một bản dựng lại nhỏ nhất rồi đổi từng thứ một,
  thay vì sửa theo giả thuyết đầu tiên.

**"Bạn dùng AI để code thế nào?"** (mục 12)
Tự quyết định kiến trúc, phạm vi và đánh đổi; AI viết phần lớn code. Bài học thật: một lần
AI tự mở rộng phạm vi (làm trang Xếp hạng riêng khi chỉ cần bộ lọc sắp xếp), và một lần hai
agent cùng sửa một file. Từ đó: hỏi rõ phạm vi trước khi xây; mỗi agent chỉ commit đúng phần
của mình.

---

## Trạng thái (17/11/2026)

**Đã xong và đã push (nhánh `auth`):** mọi thứ ở các mục trên.

**Quyết định về bản quyền:** repo để public nhưng **không chứa văn bản truyện nhập**
(truyện Trung, tác giả nổi tiếng): thư mục đó nằm trong `.gitignore`, chỉ có trong database.
Lịch sử git đã được làm sạch trước lần push đầu.

**Còn lại:**
- Merge `auth` vào `main`.
- Thuê máy chủ, mua tên miền, deploy; thêm tên miền vào Resend để gửi mail cho mọi người.
- Sao lưu database hằng đêm (Supabase bản free không cho tải bản sao lưu về).
- Codex đang gỡ watermark ảnh bìa truyện Trung: 150/500 xong, chưa commit.
- Bật xác minh 2 bước cho tài khoản Google admin.

**Để khi có người dùng thật:** [production-later.md](production-later.md).
