"use client";

import { useState } from "react";

export function GeneratedCopy({
  generatedText,
  onReviewPhotos,
}: {
  generatedText: string;
  onReviewPhotos: () => void;
}) {
  const [copyMessage, setCopyMessage] = useState<string | null>(null);

  async function copyText() {
    try {
      await navigator.clipboard.writeText(generatedText);
      setCopyMessage("판매글을 복사했습니다.");
    } catch {
      setCopyMessage("복사하지 못했습니다. 내용을 길게 눌러 직접 복사해주세요.");
    }
  }

  return (
    <section className="resale-copy-card">
      <div>
        <p className="eyebrow">SAFE COPY</p>
        <h2>개인정보 없는 판매글 초안</h2>
        <p className="subtle-text">
          영수증 원본, 주문번호, 주소, 연락처, 결제 정보는 이 초안에 포함하지 않습니다.
        </p>
      </div>

      <div className="generated-copy" aria-label="생성된 판매글">
        {generatedText.split("\n").map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>

      {copyMessage ? <p className="subtle-text" role="status">{copyMessage}</p> : null}

      <div className="resale-actions">
        <button className="primary-button" type="button" onClick={copyText}>
          판매글 복사
        </button>
        <button className="secondary-button" type="button" onClick={onReviewPhotos}>
          사진 확인
        </button>
      </div>

      <p className="legal-copy">
        실제 판매 등록은 이용하려는 중고거래 서비스에서 직접 확인하고 게시해주세요.
      </p>
    </section>
  );
}
