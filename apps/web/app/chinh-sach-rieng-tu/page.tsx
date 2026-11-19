import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Quyền riêng tư',
  description: 'Nhịp Bút thu thập gì, dùng để làm gì, lưu ở đâu và cách xoá.',
};

/**
 * The privacy policy. Written to match what the code actually does; when a
 * feature starts collecting something new, this page changes with it.
 */
export default function PrivacyPage() {
  return (
    <article className="mx-auto flex w-full max-w-[68ch] flex-col gap-6 px-4 py-12 text-[14.5px] leading-relaxed text-[var(--color-muted)] sm:px-0 [&_h2]:mt-4 [&_h2]:text-[16px] [&_h2]:font-semibold [&_h2]:text-[var(--color-ink)] [&_li]:ml-5 [&_li]:list-disc [&_strong]:font-semibold [&_strong]:text-[var(--color-ink)] [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1.5">
      <header className="flex flex-col gap-2">
        <h1 className="display text-[2.2rem] leading-tight text-[var(--color-ink)]">Quyền riêng tư</h1>
        <p className="text-[13px] text-[var(--color-faint)]">Cập nhật ngày 19/11/2026</p>
      </header>

      <p>
        Nhịp Bút là trang đọc, nghe và viết truyện do một cá nhân phát triển. Trang này nói rõ chúng tôi lưu
        gì về bạn, để làm gì, và cách xoá. Chúng tôi không bán dữ liệu, không chạy quảng cáo và không dùng
        cookie theo dõi.
      </p>

      <h2>Thông tin chúng tôi lưu</h2>
      <ul>
        <li>
          <strong>Tài khoản:</strong> email, tên hiển thị, tên người dùng (@handle), ảnh đại diện, giới thiệu
          ngắn. Đăng nhập bằng Google thì chỉ nhận email, tên và ảnh từ Google. Đăng ký bằng email thì mật khẩu
          được lưu dưới dạng băm (argon2), không ai đọc được.
        </li>
        <li>
          <strong>Hoạt động trên trang:</strong> truyện và chương bạn viết, bình luận, điểm đánh giá, truyện
          bạn theo dõi, và vị trí đang nghe/đọc dở để bạn nghe tiếp trên thiết bị khác.
        </li>
        <li>
          <strong>Phiên đăng nhập:</strong> một cookie <em>httpOnly</em> giữ bạn đăng nhập. Đây là cookie duy
          nhất, chỉ dùng để đăng nhập.
        </li>
        <li>
          <strong>Premium:</strong> khi bạn chuyển khoản, chúng tôi lưu mã đơn, số tiền, nội dung chuyển khoản
          và mã giao dịch ngân hàng để đối soát. Chúng tôi không bao giờ thấy hay lưu số thẻ, số tài khoản
          hay mật khẩu ngân hàng của bạn.
        </li>
        <li>
          <strong>Trên trình duyệt của bạn</strong> (không gửi về máy chủ): giao diện sáng/tối, cài đặt đọc,
          nhạc nền, hẹn giờ tắt.
        </li>
      </ul>

      <h2>Bên thứ ba xử lý dữ liệu</h2>
      <ul>
        <li><strong>Google Cloud</strong> (Singapore): máy chủ chạy trang web.</li>
        <li><strong>Supabase</strong> (Singapore): cơ sở dữ liệu.</li>
        <li><strong>Cloudflare R2</strong>: lưu ảnh bìa, ảnh đại diện và file giọng đọc; bản sao lưu cơ sở dữ liệu hằng đêm.</li>
        <li>
          <strong>Cloudflare Web Analytics</strong>: đếm lượt xem trang, không dùng cookie và không theo dõi
          từng người.
        </li>
        <li><strong>Gmail</strong>: gửi email xác minh và đặt lại mật khẩu.</li>
        <li>
          <strong>Dịch vụ AI</strong> (Google Gemini, Groq, OpenRouter): khi bạn dùng tính năng AI viết cùng
          hoặc tìm truyện bằng AI, đoạn văn hoặc câu tìm kiếm liên quan được gửi tới dịch vụ đó để tạo câu trả
          lời.
        </li>
        <li>
          <strong>Giọng đọc Microsoft Edge</strong>: khi chọn giọng Edge, văn bản của chương được gửi tới dịch
          vụ đọc của Microsoft. Giọng Trúc Ly chạy ngay trên máy chủ của chúng tôi.
        </li>
        <li><strong>SePay</strong>: báo cho chúng tôi khi có tiền chuyển vào, để kích hoạt Premium.</li>
      </ul>

      <h2>Ai thấy được gì</h2>
      <p>
        Mọi người thấy tên hiển thị, @handle, ảnh đại diện, giới thiệu, truyện công khai và bình luận của bạn.
        Email của bạn không bao giờ hiện cho người khác. Truyện để riêng tư chỉ bạn và người được bạn mời thấy.
      </p>

      <h2>Xoá dữ liệu</h2>
      <p>
        Muốn xoá tài khoản và toàn bộ dữ liệu, hãy trả lời bất kỳ email nào Nhịp Bút đã gửi cho bạn (hoặc gửi
        tới địa chỉ đó) từ chính email của tài khoản. Chúng tôi xoá trong vòng 30 ngày. Bản sao lưu cũ tự hết
        hạn sau 7 ngày.
      </p>

      <h2>Thay đổi</h2>
      <p>Khi trang thu thập thêm loại thông tin mới, chúng tôi cập nhật trang này và ngày ở đầu trang.</p>
    </article>
  );
}
