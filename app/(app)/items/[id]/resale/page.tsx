import Link from "next/link";

import { ResaleStepper } from "../../../../../components/resale/resale-stepper";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function ResalePage({ params }: PageProps) {
  const { id } = await params;

  return (
    <main className="mobile-shell resale-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">RESALE PREP</p>
          <h1 className="page-title">판매 준비</h1>
          <p className="page-description">
            물건 상태와 구성품을 확인하고 개인정보를 제외한 판매글 초안을 준비합니다.
          </p>
        </div>
        <Link className="back-link" href={`/items/${id}`}>
          상세
        </Link>
      </header>

      <ResaleStepper itemId={id} />
    </main>
  );
}
