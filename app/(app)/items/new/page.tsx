import Link from "next/link";

import { ItemForm } from "../../../../components/form/item-form";

export default function NewItemPage() {
  return (
    <main className="mobile-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">NEW ITEM</p>
          <h1 className="page-title">물건 등록</h1>
          <p className="page-description">
            구매 정보를 남겨두면 보증부터 판매 준비까지 한 흐름으로 이어집니다.
          </p>
        </div>
        <Link className="back-link" href="/items">
          취소
        </Link>
      </header>
      <ItemForm />
    </main>
  );
}
