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
        <h2>계정 사용자 ID</h2>
        <p>로그인 식별자는 사용자의 물건과 기록을 구분하고 모든 조회·변경 요청의 소유권을 확인하는 데 사용합니다.</p>
        <p>제품명, 카테고리, 구매일, 구매가, 보증 정보, 구성품, 관리 이력, 판매 준비 및 판매 기록처럼 사용자가 직접 등록한 물건 정보도 처리합니다.</p>
      </section>

      <section className="legal-card">
        <h2>제품 검증용 이용 기록</h2>
        <p>서비스 사용성 및 핵심 기능의 전환·재방문 여부를 확인하기 위해 로그인 사용자 ID, 정해진 행동 이벤트 종류, 관련 물건 ID가 필요한 경우 해당 ID, 서버 기록 시각, 물건 등록 소요시간을 최소 범위로 기록할 수 있습니다.</p>
        <p>이 이용 기록에는 제품명·브랜드·모델명·구매처·영수증 또는 문서 원문·하자 메모·생성된 판매글 원문·광고 식별자·기기 지문을 저장하지 않으며, 외부 제품 분석 SDK를 사용하지 않습니다.</p>
        <p>제품 검증용 원본 행동 이벤트는 180일 보존 기준을 적용하며, 180일을 초과한 기록은 서버 계측 및 운영 정리 과정에서 삭제합니다.</p>
      </section>

      <section className="legal-card">
        <h2>비공개 문서</h2>
        <p>사용자가 등록한 영수증 등 증빙 파일은 일반 공개 경로가 아닌 제한된 저장 영역에 보관하고, 접근 전에 사용자 소유권을 확인합니다.</p>
        <p>판매글 초안에는 원본 영수증이나 주소·전화번호·주문번호·결제정보를 자동으로 포함하지 않습니다.</p>
      </section>

      <section className="legal-card">
        <h2>삭제</h2>
        <p>사용자가 물건 또는 문서를 제거하면 서비스 데이터베이스의 관련 기록과 저장된 해당 파일도 함께 제거하는 것을 원칙으로 하며, 법령상 별도 보관 의무가 있는 경우만 필요한 기간 동안 보관합니다.</p>
        <p>제품 검증용 원본 행동 이벤트는 위 180일 보존 기준에 따라 별도로 정리합니다.</p>
      </section>

      <section className="legal-card">
        <h2>객체 저장소</h2>
        <p>서비스 운영에 외부 저장 사업자를 사용하는 경우 실제 사업자, 처리 목적, 보관 위치와 필요한 개인정보 보호 사항을 운영 정책에 맞게 공개하며, 운영 환경이 확정되기 전에는 특정 사업자를 사용한다고 표시하지 않습니다.</p>
      </section>
    </main>
  );
}
