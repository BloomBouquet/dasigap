import Link from "next/link";

export default function TermsPage() {
  return (
    <main className="mobile-shell legal-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">TERMS</p>
          <h1 className="page-title">이용약관</h1>
          <p className="page-description">다시값 MVP의 서비스 범위와 이용 원칙을 안내합니다.</p>
        </div>
        <Link className="back-link" href="/">홈</Link>
      </header>

      <section className="legal-card">
        <h2>서비스 범위</h2>
        <p>다시값은 사용자가 자신의 물건 구매 정보, 보증·관리 이력, 구성품, 판매 준비와 판매 결과를 기록하는 개인용 관리 서비스입니다.</p>
      </section>

      <section className="legal-card">
        <h2>외부 거래</h2>
        <p>다시값 MVP는 구매자와 판매자를 연결하거나 거래를 중개하지 않으며 결제, 에스크로, 거래 채팅을 제공하지 않습니다.</p>
        <p>생성한 판매글 초안은 사용자가 외부 중고거래 서비스에서 직접 확인하고 게시합니다.</p>
      </section>

      <section className="legal-card">
        <h2>참고 정보</h2>
        <p>반품일과 보증기간은 사용자가 등록한 정보에 따른 참고값입니다. 실제 적용 여부는 판매처와 제조사 정책을 확인해야 합니다.</p>
        <p>희망 판매가는 사용자가 직접 입력하는 값이며 서비스가 실제 거래 가격이나 판매 성사를 보장하지 않습니다.</p>
      </section>
    </main>
  );
}
