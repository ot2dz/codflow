import { ArrowDown, ArrowUp, Image as ImageIcon, Layers, Plus, Trash2 } from "lucide-react";
import { Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { useT } from "@/i18n/react";

export type ContentBlock = Record<string, any>;

interface Props {
  blocks: ContentBlock[];
  setBlocks: (blocks: ContentBlock[]) => void;
  /** Images already attached to the product (chosen from, not uploaded). */
  imageUrls: string[];
  busy?: boolean;
}

/**
 * Rich page-blocks editor: image+text sections, step cards and two-image
 * rows rendered by PDP templates below the order form. Blocks are composed
 * from the product's own uploaded images (plus a URL fallback).
 */
export function ProductContentBlocks({ blocks, setBlocks, imageUrls, busy = false }: Props) {
  const t = useT("products");

  function add(type: "image_text" | "steps" | "two_images") {
    if (type === "steps") setBlocks([...blocks, { type, title: "", items: [{ image: "", title: "", text: "" }] }]);
    else if (type === "two_images") setBlocks([...blocks, { type, images: ["", ""] }]);
    else setBlocks([...blocks, { type, image: "", title: "", text: "", imageSide: "start" }]);
  }

  function patch(index: number, changes: ContentBlock) {
    setBlocks(blocks.map((block, i) => (i === index ? { ...block, ...changes } : block)));
  }

  function remove(index: number) {
    setBlocks(blocks.filter((_, i) => i !== index));
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    [next[index], next[target]] = [next[target], next[index]];
    setBlocks(next);
  }

  function patchStep(blockIndex: number, stepIndex: number, changes: ContentBlock) {
    const items = [...(blocks[blockIndex].items ?? [])];
    items[stepIndex] = { ...items[stepIndex], ...changes };
    patch(blockIndex, { items });
  }

  function addStep(blockIndex: number) {
    const items = [...(blocks[blockIndex].items ?? []), { image: "", title: "", text: "" }];
    patch(blockIndex, { items });
  }

  function removeStep(blockIndex: number, stepIndex: number) {
    const items = (blocks[blockIndex].items ?? []).filter((_: unknown, i: number) => i !== stepIndex);
    patch(blockIndex, { items });
  }

  function patchTwoImages(blockIndex: number, imageIndex: number, value: string) {
    const images = [...(blocks[blockIndex].images ?? ["", ""])];
    images[imageIndex] = value;
    patch(blockIndex, { images });
  }

  const typeLabel: Record<string, string> = {
    image_text: t("blocks.type_image_text"),
    steps: t("blocks.type_steps"),
    two_images: t("blocks.type_two_images"),
  };

  function ImageField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
    return (
      <div className="space-y-2">
        {imageUrls.length > 0 && (
          <Select
            value={imageUrls.includes(value) ? value : ""}
            onChange={(event) => onChange(event.currentTarget.value)}
            disabled={busy}
          >
            <option value="">{t("blocks.pick_image")}</option>
            {imageUrls.map((url) => (
              <option key={url} value={url}>
                {url.split("/").pop()?.slice(0, 40) ?? url}
              </option>
            ))}
          </Select>
        )}
        <Input
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          placeholder={t("blocks.image_url")}
          dir="ltr"
          disabled={busy}
        />
      </div>
    );
  }

  return (
    <Card title={t("blocks.title")}>
      <p className="mb-4 text-xs text-muted-foreground">{t("blocks.hint")}</p>

      {blocks.length === 0 && (
        <p className="mb-4 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
          {t("blocks.empty")}
        </p>
      )}

      <div className="space-y-3">
        {blocks.map((block, index) => (
          <div key={index} className="space-y-3 rounded-xl border border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-foreground">
                <Layers size={13} />
                {typeLabel[block.type] ?? block.type}
              </span>
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => move(index, -1)}
                  disabled={busy || index === 0}
                  aria-label={t("blocks.move_up")}
                  className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => move(index, 1)}
                  disabled={busy || index === blocks.length - 1}
                  aria-label={t("blocks.move_down")}
                  className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                  <ArrowDown size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => remove(index)}
                  disabled={busy}
                  aria-label={t("blocks.remove")}
                  className="rounded p-1 text-destructive hover:opacity-80"
                >
                  <Trash2 size={14} />
                </button>
              </span>
            </div>

            {block.type === "image_text" && (
              <>
                <Field label={t("blocks.image")}>
                  <ImageField value={block.image ?? ""} onChange={(value) => patch(index, { image: value })} />
                </Field>
                <Field label={t("blocks.block_title")}>
                  <Input value={block.title ?? ""} onChange={(e) => patch(index, { title: e.currentTarget.value })} disabled={busy} />
                </Field>
                <Field label={t("blocks.text")}>
                  <Textarea rows={3} value={block.text ?? ""} onChange={(e) => patch(index, { text: e.currentTarget.value })} disabled={busy} />
                </Field>
                <Field label={t("blocks.image_side")}>
                  <Select value={block.imageSide ?? "start"} onChange={(e) => patch(index, { imageSide: e.currentTarget.value })} disabled={busy}>
                    <option value="start">{t("blocks.side_start")}</option>
                    <option value="end">{t("blocks.side_end")}</option>
                  </Select>
                </Field>
              </>
            )}

            {block.type === "steps" && (
              <>
                <Field label={t("blocks.block_title")}>
                  <Input value={block.title ?? ""} onChange={(e) => patch(index, { title: e.currentTarget.value })} disabled={busy} />
                </Field>
                <div className="space-y-3">
                  {(block.items ?? []).map((item: ContentBlock, stepIndex: number) => (
                    <div key={stepIndex} className="space-y-2 rounded-lg bg-muted/40 p-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-muted-foreground">
                          {t("blocks.step").replace("{n}", String(stepIndex + 1))}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeStep(index, stepIndex)}
                          disabled={busy || (block.items ?? []).length <= 1}
                          aria-label={t("blocks.remove")}
                          className="rounded p-1 text-destructive hover:opacity-80 disabled:opacity-30"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                      <ImageField value={item.image ?? ""} onChange={(value) => patchStep(index, stepIndex, { image: value })} />
                      <Input value={item.title ?? ""} placeholder={t("blocks.block_title")} onChange={(e) => patchStep(index, stepIndex, { title: e.currentTarget.value })} disabled={busy} />
                      <Textarea rows={2} value={item.text ?? ""} placeholder={t("blocks.text")} onChange={(e) => patchStep(index, stepIndex, { text: e.currentTarget.value })} disabled={busy} />
                    </div>
                  ))}
                  <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => addStep(index)}>
                    <Plus size={14} />
                    {t("blocks.add_step")}
                  </Button>
                </div>
              </>
            )}

            {block.type === "two_images" && (
              <div className="grid gap-3 sm:grid-cols-2">
                {[0, 1].map((imageIndex) => (
                  <Field key={imageIndex} label={t("blocks.image_n").replace("{n}", String(imageIndex + 1))}>
                    <ImageField
                      value={(block.images ?? [])[imageIndex] ?? ""}
                      onChange={(value) => patchTwoImages(index, imageIndex, value)}
                    />
                  </Field>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => add("image_text")}>
          <ImageIcon size={14} />
          {t("blocks.add_image_text")}
        </Button>
        <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => add("steps")}>
          <Layers size={14} />
          {t("blocks.add_steps")}
        </Button>
        <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => add("two_images")}>
          <ImageIcon size={14} />
          {t("blocks.add_two_images")}
        </Button>
      </div>
    </Card>
  );
}
