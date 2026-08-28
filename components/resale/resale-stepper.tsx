"use client";

import { useEffect, useMemo, useState } from "react";

import { GeneratedCopy } from "./generated-copy";

type ConditionGrade = "LIKE_NEW" | "GOOD" | "FAIR" | "WORN";
type PhotoChecklist = {
  front: boolean;
  back: boolean;
  detail: boolean;
  components: boolean;
};
type ComponentItem = { id: string; name: string; isPresent: boolean };
type Draft = {
  conditionGrade: ConditionGrade;
  defectNote: string | null;
  askingPrice: number | null;
  photoChecklist: PhotoChecklist;
  generatedText: string;
};

const EMPTY_PHOTOS: PhotoChecklist = {
  front: false,
  back: false,
  detail: false,
  components: false,
};

const CONDITION_OPTIONS: Array<{ value: ConditionGrade; label: string }> = [
  { value: "LIKE_NEW", label: "거의 새것" },
  { value: "GOOD", label: "좋음" },
  { value: "FAIR", label: "보통" },
  { value: "WORN", label: "사용감 있음" },
];

export function ResaleStepper({ itemId }: { itemId: string }) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [conditionGrade, setConditionGrade] = useState<ConditionGrade | "">("");
  const [defectNote, setDefectNote] = useState("");
  const [askingPrice, setAskingPrice] = useState("");
  const [photoChecklist, setPhotoChecklist] = useState<PhotoChecklist>(EMPTY_PHOTOS);
  const [generatedText, setGeneratedText] = useState("");
  const [components, setComponents] = useState<ComponentItem[]>([]);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const [draftResponse, componentResponse] = await Promise.all([
          fetch(`/api/items/${itemId}/resale`, { cache: "no-store", signal: controller.signal }),
          fetch(`/api/items/${itemId}/components`, { cache: "no-store", signal: controller.signal }),
        ]);
        const draftBody = await draftResponse.json();
        const componentBody = await componentResponse.json();
        if (!draftResponse.ok || !componentResponse.ok) {
          setMessage(draftBody?.error?.message ?? componentBody?.error?.message ?? "판매 준비 정보를 불러오지 못했습니다.");
          return;
        }

        const draft = draftBody.draft as Draft | null;
        if (draft) {
          setConditionGrade(draft.conditionGrade);
          setDefectNote(draft.defectNote ?? "");
          setAskingPrice(draft.askingPrice ? String(draft.askingPrice) : "");
          setPhotoChecklist(draft.photoChecklist ?? EMPTY_PHOTOS);
          setGeneratedText(draft.generatedText ?? "");
        }
        setComponents(componentBody.components ?? []);
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        setMessage("네트워크 연결을 확인해주세요.");
      } finally {
        setLoading(false);
      }
    }

    void load();
    return () => controller.abort();
  }, [itemId]);

  const presentCount = useMemo(
    () => components.filter((component) => component.isPresent).length,
    [components],
  );

  async function savePatch(patch: Record<string, unknown>, nextStep: number) {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/items/${itemId}/resale`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = await response.json();
      if (!response.ok) {
        setMessage(body?.error?.message ?? "판매 준비 내용을 저장하지 못했습니다.");
        return;
      }
      const draft = body.draft as Draft;
      setConditionGrade(draft.conditionGrade);
      setDefectNote(draft.defectNote ?? "");
      setAskingPrice(draft.askingPrice ? String(draft.askingPrice) : "");
      setPhotoChecklist(draft.photoChecklist ?? EMPTY_PHOTOS);
      setGeneratedText(draft.generatedText ?? "");
      setStep(nextStep);
    } catch {
      setMessage("네트워크 연결을 확인해주세요.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <section className="status-card" aria-label="판매 준비 불러오는 중">
        <div className="loading-line" />
        <div className="loading-line short" />
      </section>
    );
  }

  return (
    <div className="resale-stepper">
      <div className="resale-progress" aria-label={`판매 준비 ${step}/6 단계`}>
        <span>{step}/6</span>
        <div className="resale-progress-track">
          <span style={{ width: `${(step / 6) * 100}%` }} />
        </div>
      </div>

      {message ? <p className="form-error" role="alert">{message}</p> : null}

      {step === 1 ? (
        <section className="section-card resale-step">
          <div>
            <p className="eyebrow">STEP 1</p>
            <h2>현재 상태</h2>
            <p className="subtle-text">판매글에 노출할 상태를 선택하세요.</p>
          </div>
          <div className="resale-choice-grid">
            {CONDITION_OPTIONS.map((option) => (
              <label className="resale-choice" key={option.value}>
                <input
                  type="radio"
                  name="condition-grade"
                  value={option.value}
                  checked={conditionGrade === option.value}
                  onChange={() => setConditionGrade(option.value)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
          <button
            className="primary-button"
            type="button"
            disabled={saving || !conditionGrade}
            onClick={() => void savePatch({ conditionGrade }, 2)}
          >
            {saving ? "저장 중..." : "저장하고 다음"}
          </button>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="section-card resale-step">
          <div>
            <p className="eyebrow">STEP 2</p>
            <h2>흠집과 하자</h2>
            <p className="subtle-text">구매자가 미리 알아야 할 상태를 간단히 남겨주세요.</p>
          </div>
          <label className="field" htmlFor="resale-defect-note">
            <span className="field-label">흠집/하자 메모 <span className="field-hint">선택</span></span>
            <textarea
              id="resale-defect-note"
              value={defectNote}
              maxLength={1000}
              onChange={(event) => setDefectNote(event.target.value)}
              placeholder="예: 케이스에 작은 생활 흠집"
            />
          </label>
          <button
            className="primary-button"
            type="button"
            disabled={saving}
            onClick={() => void savePatch({ defectNote }, 3)}
          >
            {saving ? "저장 중..." : "저장하고 다음"}
          </button>
        </section>
      ) : null}

      {step === 3 ? (
        <section className="section-card resale-step">
          <div>
            <p className="eyebrow">STEP 3</p>
            <h2>구성품 확인</h2>
            <p className="subtle-text">구성품 {presentCount}/{components.length}개 보유</p>
          </div>
          <div className="resale-component-list">
            {components.length === 0 ? <p className="subtle-text">등록된 구성품이 없습니다.</p> : null}
            {components.map((component) => (
              <div className="info-row" key={component.id}>
                <span>{component.name}</span>
                <strong>{component.isPresent ? "보유" : "없음"}</strong>
              </div>
            ))}
          </div>
          <button className="primary-button" type="button" onClick={() => setStep(4)}>
            다음
          </button>
        </section>
      ) : null}

      {step === 4 ? (
        <section className="section-card resale-step">
          <div>
            <p className="eyebrow">STEP 4</p>
            <h2>판매 사진 체크</h2>
            <p className="subtle-text">사진 자체는 다시값이 외부 마켓에 자동 게시하지 않습니다.</p>
          </div>
          <div className="resale-checklist">
            {([
              ["front", "앞면 사진"],
              ["back", "뒷면 사진"],
              ["detail", "상세 사진"],
              ["components", "구성품 사진"],
            ] as const).map(([key, label]) => (
              <label className="resale-check-row" key={key}>
                <input
                  type="checkbox"
                  checked={photoChecklist[key]}
                  onChange={(event) =>
                    setPhotoChecklist((current) => ({ ...current, [key]: event.target.checked }))
                  }
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <button
            className="primary-button"
            type="button"
            disabled={saving}
            onClick={() => void savePatch({ photoChecklist }, 5)}
          >
            {saving ? "저장 중..." : "저장하고 다음"}
          </button>
        </section>
      ) : null}

      {step === 5 ? (
        <section className="section-card resale-step">
          <div>
            <p className="eyebrow">STEP 5</p>
            <h2>희망 가격</h2>
            <p className="subtle-text">가격은 선택 사항이며 다시값이 시장가를 보장하지 않습니다.</p>
          </div>
          <label className="field" htmlFor="resale-asking-price">
            <span className="field-label">희망 가격 <span className="field-hint">선택</span></span>
            <input
              id="resale-asking-price"
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={askingPrice}
              onChange={(event) => setAskingPrice(event.target.value)}
              placeholder="170000"
            />
          </label>
          <button
            className="primary-button"
            type="button"
            disabled={saving}
            onClick={() =>
              void savePatch({ askingPrice: askingPrice ? Number(askingPrice) : null }, 6)
            }
          >
            {saving ? "저장 중..." : "저장하고 다음"}
          </button>
        </section>
      ) : null}

      {step === 6 ? (
        <GeneratedCopy generatedText={generatedText} onReviewPhotos={() => setStep(4)} />
      ) : null}
    </div>
  );
}
