import { Prisma } from "@prisma/client";

import { throwOwnedItemNotFound } from "../db/ownership";
import { prisma } from "../db/prisma";
import { buildResaleTemplateInput } from "./privacy-filter";
import {
  photoChecklistSchema,
  resaleDraftPatchSchema,
  type ParsedResaleDraftPatch,
  type ResaleDraftPatchInput,
  type ResalePhotoChecklist,
} from "./schemas";
import { generateResaleText } from "./template";

const EMPTY_PHOTO_CHECKLIST: ResalePhotoChecklist = {
  front: false,
  back: false,
  detail: false,
  components: false,
};

export class ResaleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResaleValidationError";
  }
}

function parseStoredPhotoChecklist(value: Prisma.JsonValue | null | undefined): ResalePhotoChecklist {
  const parsed = photoChecklistSchema.safeParse(value);
  return parsed.success ? parsed.data : EMPTY_PHOTO_CHECKLIST;
}

function publicDraft(draft: {
  id: string;
  itemId: string;
  conditionGrade: string;
  defectNote: string | null;
  askingPrice: number | null;
  photoChecklist: Prisma.JsonValue | null;
  generatedText: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: draft.id,
    itemId: draft.itemId,
    conditionGrade: draft.conditionGrade,
    defectNote: draft.defectNote,
    askingPrice: draft.askingPrice,
    photoChecklist: parseStoredPhotoChecklist(draft.photoChecklist),
    generatedText: draft.generatedText,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
  };
}

async function findOwnedResaleContext(
  client: Prisma.TransactionClient | typeof prisma,
  userId: string,
  itemId: string,
) {
  const item = await client.item.findFirst({
    where: { id: itemId, userId },
    include: {
      components: { select: { name: true, isPresent: true } },
      maintenance: { select: { type: true } },
      documents: { select: { type: true } },
      resaleDraft: true,
    },
  });

  if (!item) throwOwnedItemNotFound();
  return item;
}

export async function getOwnedResaleDraft(userId: string, itemId: string) {
  const item = await findOwnedResaleContext(prisma, userId, itemId);
  return item.resaleDraft ? publicDraft(item.resaleDraft) : null;
}

function mergeDraft(
  current: {
    conditionGrade: string;
    defectNote: string | null;
    askingPrice: number | null;
    photoChecklist: Prisma.JsonValue | null;
  } | null,
  patch: ParsedResaleDraftPatch,
) {
  const conditionGrade = patch.conditionGrade ?? current?.conditionGrade;
  if (!conditionGrade) {
    throw new ResaleValidationError("판매 준비를 시작하려면 물건 상태를 먼저 선택해주세요.");
  }

  return {
    conditionGrade,
    defectNote:
      patch.defectNote !== undefined ? patch.defectNote : (current?.defectNote ?? null),
    askingPrice:
      patch.askingPrice !== undefined ? patch.askingPrice : (current?.askingPrice ?? null),
    photoChecklist:
      patch.photoChecklist ?? parseStoredPhotoChecklist(current?.photoChecklist),
  };
}

export async function saveOwnedResaleDraft(
  userId: string,
  itemId: string,
  input: ResaleDraftPatchInput,
) {
  const patch = resaleDraftPatchSchema.parse(input);

  return prisma.$transaction(async (tx) => {
    const item = await findOwnedResaleContext(tx, userId, itemId);
    if (item.status === "SOLD") {
      throw new ResaleValidationError("이미 판매 완료된 물건은 판매 준비를 수정할 수 없습니다.");
    }

    const merged = mergeDraft(item.resaleDraft, patch);
    const generatedText = generateResaleText(
      buildResaleTemplateInput({
        item: {
          name: item.name,
          modelName: item.modelName,
          purchaseDate: item.purchaseDate,
        },
        components: item.components,
        maintenance: item.maintenance,
        documents: item.documents,
        draft: {
          conditionGrade: merged.conditionGrade,
          defectNote: merged.defectNote,
          askingPrice: merged.askingPrice,
        },
      }),
    );

    const draft = await tx.resaleDraft.upsert({
      where: { itemId },
      create: {
        itemId,
        conditionGrade: merged.conditionGrade,
        defectNote: merged.defectNote,
        askingPrice: merged.askingPrice,
        photoChecklist: merged.photoChecklist,
        generatedText,
      },
      update: {
        conditionGrade: merged.conditionGrade,
        defectNote: merged.defectNote,
        askingPrice: merged.askingPrice,
        photoChecklist: merged.photoChecklist,
        generatedText,
      },
    });

    await tx.item.updateMany({
      where: { id: itemId, userId, status: { not: "SOLD" } },
      data: { status: "SELL_PREPARING" },
    });

    return publicDraft(draft);
  });
}
