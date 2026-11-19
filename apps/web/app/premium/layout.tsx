import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Premium',
  description: 'Nhiều lượt AI hơn, tìm truyện bằng AI thoải mái, giọng đọc được tạo trước. 15.000đ một tháng, trả bằng chuyển khoản.',
};

export default function PremiumLayout({ children }: { children: React.ReactNode }) {
  return children;
}
