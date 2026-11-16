# Việc để sau: scale và chạy lâu dài

Ghi lại ngày 16/11/2026. Đây là những việc **chưa cần làm khi mới deploy lên một server**.
Làm khi app có người dùng thật và bắt đầu cần thêm server, hoặc khi gặp đúng vấn đề.
Mức 1 (dọn dẹp, đóng gói, sao lưu) làm trước, không nằm ở đây.

## Mức 2: Khi cần chạy nhiều hơn một server

Một server cỡ vừa chịu được vài nghìn người dùng mỗi ngày. Khi không đủ nữa thì chạy
2 bản trở lên, và lúc đó các mục dưới đây sẽ hỏng nếu chưa sửa.

- **Phòng viết chung chỉ chạy trên một server.** Nội dung đang gõ nằm trong bộ nhớ của
  từng server. Hai người cùng phòng mà vào hai server khác nhau sẽ không thấy chữ của nhau.
  Cách sửa: thêm `@hocuspocus/extension-redis` để các server chia sẻ qua Redis, hoặc
  cấu hình để mọi người trong cùng một phòng luôn vào cùng một server.
- **Tách worker tạo giọng đọc khỏi API.** Hiện API vừa trả lời web vừa tạo audio. Tạo audio
  rất nặng nên có thể làm web chậm. Code đã có sẵn cờ `RUN_WORKER`: chạy API với
  `RUN_WORKER=false`, và chạy một tiến trình worker riêng.
- **Giới hạn số request phải dùng chung Redis.** Nếu mỗi server tự đếm thì có N server là
  người dùng được gửi gấp N lần giới hạn. Cần kiểm tra bộ throttler đang lưu ở đâu.
- **Redis lên cloud.** Nên tự chạy một Redis nhỏ trên máy ảo. Upstash tính tiền theo số lệnh,
  mà hàng đợi BullMQ gửi lệnh liên tục nên sẽ tốn.

## Mức 3: Để biết khi có chuyện và không bị bất ngờ

- **Theo dõi lỗi:** Sentry (gói free) cho web và API, để biết khi người dùng gặp lỗi
  mà không cần họ báo.
- **Báo khi web sập:** một dịch vụ kiểm tra định kỳ (ví dụ UptimeRobot, gói free) gửi
  email khi `/api/health` không trả lời.
- **CI trên GitHub:** mỗi lần push tự kiểm tra lỗi kiểu dữ liệu, lint, chạy test và build.
  Repo có 13 file test nhưng chưa có gì tự chạy chúng.
- **Dự phòng dịch vụ bên ngoài:**
  - Edge TTS là dịch vụ không chính thức, Microsoft có thể chặn bất cứ lúc nào. Nên có sẵn
    driver Azure Speech (trả phí, cùng giọng Hoài My / Nam Minh) để chuyển sang.
  - Gemini chưa có model dự phòng. `LLM_DRIVER_CHAIN` ghi groq và openrouter nhưng
    chưa có driver nào cho hai cái đó.
- **Load test:** giả lập nhiều người dùng cùng lúc để biết một server chịu được bao nhiêu,
  và database qua pooler của Supabase có thành nút thắt không.

## Mức 4: Khi muốn tăng người dùng

- **SEO:** trang truyện (`apps/web/app/doc/[id]`) hiện chỉ render trên trình duyệt.
  Google đọc trang sẽ thấy gần như trống, nên truyện không lên kết quả tìm kiếm.
  Cần chuyển phần nội dung chính sang render phía server.
- **CDN:** đặt Cloudflare trước web; gắn tên miền riêng cho bucket R2 (thay link `r2.dev`,
  vốn bị giới hạn tốc độ và không cache) để audio và ảnh được cache gần người dùng.
- **RAG:** hiện chưa giúp được nhiều vì AI đã được gửi nguyên truyện, mà lại tiêu lượt
  Gemini để tạo embedding (có thể tắt bằng `RAG_INDEX_ON_COMMIT=false` và
  `RAG_BACKFILL_ON_BOOT=false`). Đáng dùng khi truyện dài làm chi phí AI tăng: gửi
  "tóm tắt + vài chương gần nhất + đoạn liên quan" thay cho nguyên truyện.
