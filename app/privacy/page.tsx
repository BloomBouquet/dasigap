import Link from "next/link";

export default function PrivacyPage() {
  return (
    <main className="mobile-shell legal-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">PRIVACY</p>
          <h1 className="page-title">개인정보처리방침</h1>
          <p className="page-description">다시값 MVP에서 처리하는 정보와 보호 원칙을 안내합니다.</p>
        </div>
        <Link className="back-link" href="/">홈</Link>
      </header>

      <section className="legal-card">
        <h2>처리하는 정보</h2>
        <p><strong>계정 사용자 ID</strong>는 로그인한 사용자의 물건과 기록을 구분하고 접근 권한을 확인하는 데 사용합니다.</p>
        <p>제품명, 카테고리, 구매일, 구매가, 보증 정보, 구성품, 관리 이력, 판매 준비 및 판매 기록처럼 사용자가 직접 등록한 물건 정보를 처리합니다.</p>
      </section>

      <section className="legal-card">
        <h2>비공개 문서</h2>
        <p>사용자가 등록한 영수증 등 <strong>비공개 문서</strong>는 일반 공개 경로가 아니라 접근 권한이 제한된 객체 저장소에 보관합니다.</p>
        <p>문서 접근에는 소유권 확인과 제한된 접근 URL을 사용하며, 판매글 초안에 원본 영수증이나 주소·전화번호·주문번호·결제정보를 자동으로 포함하지 않습니다.</p>
      </section>

      <section className="legal-card">
        <h2>보관과 삭제</h2>
        <p>사용자가 물건 또는 문서를 삭제하면 서비스 데이터베이스의 관련 기록과 객체 저장소의 해당 파일을 함께 삭제하는 것을 원칙으로 합니다.</p>
        <p>계정 삭제 기능을 제공할 때에도 법령상 별도 보관 의무가 없는 정보는 서비스 목적이 끝난 뒤 삭제하도록 운영합니다.</p>
      </section>

      <section className="legal-card">
        <h2>처리 위탁과 저장소</h2>
        <p>서비스 운영에 외부 <strong>객체 저장소</strong> 사업자를 사용하는 경우 실제 운영 사업자, 처리 목적, 보관 위치와 필요한 개인정보 보호 사항을 운영 정책에 맞게 공개합니다.</p>
        <p>운영 환경의 처리업체가 확정되기 전에는 특정 사업자를 사용한다고 표시하지 않습니다.</p>
      </section>
    </main>
  );
}
