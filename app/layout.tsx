import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import "./lifecycle.css";

export const metadata: Metadata = {
  title: "다시값",
  description: "구매부터 다시 판매할 때까지, 내 물건의 생애 관리",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
