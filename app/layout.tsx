import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "다시값",
  description: "구매부터 다시 판매할 때까지, 내 물건의 생애 관리",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ko">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f7f7f5", color: "#1c1c1a" }}>
        {children}
      </body>
    </html>
  );
}
