import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SketchFlat',
  description: '패션 디자이너를 위한 작업지시서 및 도식화 AI 툴',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
