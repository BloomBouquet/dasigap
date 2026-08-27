"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

type ItemField =
  | "name"
  | "category"
  | "purchaseDate"
  | "purchasePrice"
  | "brand"
  | "modelName"
  | "storeName";

type FieldErrors = Partial<Record<ItemField | "_root", string>>;

type FormState = Record<ItemField, string>;

const initialState: FormState = {
  name: "",
  category: "",
  purchaseDate: "",
  purchasePrice: "",
  brand: "",
  modelName: "",
  storeName: "",
};

const fields: Array<{
  name: ItemField;
  label: string;
  required?: boolean;
  placeholder?: string;
  type?: "text" | "date" | "number";
  inputMode?: "text" | "numeric";
}> = [
  { name: "name", label: "제품명", required: true, placeholder: "예: AirPods Pro" },
  { name: "category", label: "카테고리", required: true, placeholder: "예: 오디오" },
  { name: "purchaseDate", label: "구매일", required: true, type: "date" },
  {
    name: "purchasePrice",
    label: "구매가",
    required: true,
    type: "number",
    inputMode: "numeric",
    placeholder: "249000",
  },
  { name: "brand", label: "브랜드", placeholder: "예: Apple" },
  { name: "modelName", label: "모델", placeholder: "예: A3047" },
  { name: "storeName", label: "구매처", placeholder: "예: Apple Store" },
];

export function ItemForm() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(initialState);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  function updateField(name: ItemField, value: string) {
    setForm((current) => ({ ...current, [name]: value }));
    setErrors((current) => {
      if (!current[name] && !current._root) return current;
      const next = { ...current };
      delete next[name];
      delete next._root;
      return next;
    });
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setErrors({});

    try {
      const response = await fetch("/api/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          category: form.category,
          purchaseDate: form.purchaseDate,
          purchasePrice: Number(form.purchasePrice),
          brand: form.brand,
          modelName: form.modelName,
          storeName: form.storeName,
        }),
      });

      const body = await response.json();

      if (!response.ok) {
        const fieldErrors = body?.error?.fields as FieldErrors | undefined;
        setErrors(
          fieldErrors && Object.keys(fieldErrors).length > 0
            ? fieldErrors
            : { _root: body?.error?.message ?? "물건을 등록하지 못했습니다." },
        );
        return;
      }

      router.push(`/items/${body.item.id}`);
    } catch {
      setErrors({ _root: "네트워크 연결을 확인하고 다시 시도해주세요." });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="item-form" onSubmit={onSubmit} noValidate>
      <section className="form-card">
        <h2 className="form-section-title">구매 정보</h2>
        <p className="form-section-description">
          지금 아는 것만 기록해도 괜찮아요. 나머지는 나중에 채울 수 있습니다.
        </p>

        {fields.map((field) => {
          const error = errors[field.name];
          const errorId = `${field.name}-error`;

          return (
            <label className="field" key={field.name} htmlFor={field.name}>
              <span className="field-label">
                <span>{field.label}</span>
                <span className="field-hint">{field.required ? "필수" : "선택"}</span>
              </span>
              <input
                id={field.name}
                name={field.name}
                type={field.type ?? "text"}
                inputMode={field.inputMode}
                min={field.name === "purchasePrice" ? 1 : undefined}
                step={field.name === "purchasePrice" ? 1 : undefined}
                value={form[field.name]}
                placeholder={field.placeholder}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? errorId : undefined}
                onChange={(event) => updateField(field.name, event.target.value)}
              />
              {error ? (
                <p className="field-error" id={errorId}>
                  {error}
                </p>
              ) : null}
            </label>
          );
        })}
      </section>

      {errors._root ? <p className="form-error">{errors._root}</p> : null}

      <div className="sticky-action">
        <button className="primary-button" type="submit" disabled={submitting}>
          {submitting ? "등록 중..." : "물건 등록"}
        </button>
      </div>
    </form>
  );
}
