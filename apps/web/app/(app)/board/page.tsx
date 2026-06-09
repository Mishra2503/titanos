"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/Placeholder";
import { CardDetail } from "@/components/CardDetail";
import {
  ApiError,
  type BoardCard,
  type BoardColumn,
  type CardPatch,
  createCard,
  createColumn,
  deleteCard,
  deleteColumn,
  getBoard,
  reorderColumn,
  updateCard,
} from "@/lib/api";

const COLOR: Record<string, { chip: string; bar: string }> = {
  slate: { chip: "bg-charcoal-600 text-ink-muted", bar: "bg-ink-faint/40" },
  amber: { chip: "bg-amber-400/10 text-amber-300", bar: "bg-amber-400/60" },
  rose: { chip: "bg-rose-400/10 text-rose-300", bar: "bg-rose-400/60" },
  emerald: { chip: "bg-emerald-400/10 text-emerald-300", bar: "bg-emerald-400/60" },
  sky: { chip: "bg-sky-400/10 text-sky-300", bar: "bg-sky-400/60" },
  lime: { chip: "bg-lime/10 text-lime", bar: "bg-lime/60" },
};
const color = (c: string) => COLOR[c] ?? COLOR.slate;

export default function BoardPage() {
  const [columns, setColumns] = useState<BoardColumn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [newColumn, setNewColumn] = useState<string | null>(null);
  const [editing, setEditing] = useState<BoardCard | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const drag = useRef<{ cardId: string; from: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await getBoard();
      setColumns(data.columns);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load board");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function addCard(columnId: string) {
    const title = draftTitle.trim();
    if (!title) {
      setAddingTo(null);
      return;
    }
    setDraftTitle("");
    setAddingTo(null);
    const card = await createCard(columnId, title);
    setColumns((cols) =>
      cols.map((c) => (c.id === columnId ? { ...c, cards: [...c.cards, card] } : c)),
    );
  }

  async function saveEdit(patch: CardPatch) {
    if (!editing) return;
    const id = editing.id;
    const updated = await updateCard(id, patch);
    setColumns((cols) =>
      cols.map((c) => ({
        ...c,
        cards: c.cards.map((card) => (card.id === id ? updated : card)),
      })),
    );
  }

  async function removeCard(id: string) {
    setEditing(null);
    setColumns((cols) => cols.map((c) => ({ ...c, cards: c.cards.filter((x) => x.id !== id) })));
    await deleteCard(id);
  }

  async function addColumn() {
    const name = newColumn?.trim();
    setNewColumn(null);
    if (!name) return;
    const col = await createColumn(name);
    setColumns((cols) => [...cols, { ...col, cards: [] }]);
  }

  async function removeColumn(id: string) {
    if (!confirm("Delete this column and all its cards?")) return;
    setColumns((cols) => cols.filter((c) => c.id !== id));
    await deleteColumn(id);
  }

  async function drop(targetId: string, beforeCardId?: string) {
    setDragOver(null);
    const info = drag.current;
    drag.current = null;
    if (!info) return;

    const source = columns.find((c) => c.id === info.from);
    const card = source?.cards.find((x) => x.id === info.cardId);
    if (!card) return;

    // Build the next board state optimistically.
    const next = columns.map((c) => ({ ...c, cards: c.cards.filter((x) => x.id !== info.cardId) }));
    const target = next.find((c) => c.id === targetId)!;
    const moved = { ...card, column_id: targetId };
    const idx = beforeCardId ? target.cards.findIndex((x) => x.id === beforeCardId) : -1;
    if (idx >= 0) target.cards.splice(idx, 0, moved);
    else target.cards.push(moved);
    setColumns(next);

    try {
      await reorderColumn(
        targetId,
        target.cards.map((x) => x.id),
      );
    } catch {
      void load();
    }
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="Content Board" />
        <p className="font-mono text-sm text-ink-faint">Loading board…</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Content Board"
        subtitle="Move ideas from spark to scheduled — drag a card across the pipeline."
      />
      {error && <p className="mb-4 font-mono text-sm text-red-400">{error}</p>}

      <div className="flex flex-1 gap-4 overflow-x-auto pb-4">
        {columns.map((col) => {
          const c = color(col.color);
          const over = dragOver === col.id;
          return (
            <div
              key={col.id}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(col.id);
              }}
              onDragLeave={() => setDragOver((d) => (d === col.id ? null : d))}
              onDrop={() => drop(col.id)}
              className={`flex w-72 flex-shrink-0 flex-col rounded-xl border bg-charcoal-800 transition-studio duration-studio ease-studio-out ${
                over ? "border-lime/50" : "border-charcoal-700"
              }`}
            >
              <div className="flex items-center justify-between border-b border-charcoal-700 px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${c.bar}`} />
                  <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${c.chip}`}>
                    {col.name}
                  </span>
                  <span className="font-mono text-[11px] text-ink-faint">{col.cards.length}</span>
                </div>
                <button
                  onClick={() => removeColumn(col.id)}
                  className="press text-ink-faint hover:text-red-400"
                  title="Delete column"
                >
                  ×
                </button>
              </div>

              <div className="flex-1 space-y-2 overflow-y-auto p-3">
                {col.cards.map((card) => (
                  <div
                    key={card.id}
                    draggable
                    onDragStart={() => (drag.current = { cardId: card.id, from: col.id })}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.stopPropagation();
                      void drop(col.id, card.id);
                    }}
                    onClick={() => setEditing(card)}
                    className="press cursor-grab rounded-lg border border-charcoal-700 bg-charcoal-700/50 p-3 hover:border-charcoal-600 active:cursor-grabbing"
                  >
                    <div className="flex items-start gap-2">
                      {card.emoji && <span className="text-base leading-tight">{card.emoji}</span>}
                      <p className="flex-1 text-sm text-ink">{card.title}</p>
                    </div>
                    {(card.status || card.publish_date) && (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {card.status && (
                          <span className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] ${c.chip}`}>
                            {card.status}
                          </span>
                        )}
                        {card.publish_date && (
                          <span className="font-mono text-[10px] text-ink-faint">
                            {new Date(card.publish_date).toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                            })}
                          </span>
                        )}
                      </div>
                    )}
                    {card.platforms.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {card.platforms.map((p) => (
                          <span
                            key={p}
                            className="rounded-full border border-charcoal-600 px-1.5 py-0.5 font-mono text-[9px] text-ink-muted"
                          >
                            {p}
                          </span>
                        ))}
                      </div>
                    )}
                    {card.notes && !card.status && !card.publish_date && (
                      <p className="mt-1 line-clamp-2 text-xs text-ink-faint">{card.notes}</p>
                    )}
                    {card.hashtags.length > 0 && (
                      <p className="mt-1.5 truncate font-mono text-[10px] text-lime/70">
                        {card.hashtags.slice(0, 4).join(" ")}
                      </p>
                    )}
                  </div>
                ))}

                {addingTo === col.id ? (
                  <div className="rounded-lg border border-lime/40 bg-charcoal-700/50 p-2">
                    <textarea
                      autoFocus
                      value={draftTitle}
                      onChange={(e) => setDraftTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          void addCard(col.id);
                        }
                        if (e.key === "Escape") setAddingTo(null);
                      }}
                      placeholder="Post idea, hook, or caption…"
                      rows={2}
                      className="w-full resize-none bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
                    />
                    <div className="mt-1 flex gap-2">
                      <button
                        onClick={() => addCard(col.id)}
                        className="press rounded bg-lime px-2.5 py-1 text-xs font-semibold text-charcoal"
                      >
                        Add
                      </button>
                      <button
                        onClick={() => setAddingTo(null)}
                        className="press px-2 py-1 text-xs text-ink-faint hover:text-ink"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setDraftTitle("");
                      setAddingTo(col.id);
                    }}
                    className={`press flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-charcoal-600 py-2 text-sm ${c.chip.split(" ")[1]} hover:border-charcoal-500`}
                  >
                    + Write a post
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {/* Add column */}
        <div className="w-72 flex-shrink-0">
          {newColumn !== null ? (
            <div className="rounded-xl border border-lime/40 bg-charcoal-800 p-3">
              <input
                autoFocus
                value={newColumn}
                onChange={(e) => setNewColumn(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void addColumn();
                  if (e.key === "Escape") setNewColumn(null);
                }}
                placeholder="Column name"
                className="w-full rounded bg-charcoal-700 px-2 py-1.5 text-sm text-ink outline-none"
              />
              <div className="mt-2 flex gap-2">
                <button
                  onClick={addColumn}
                  className="press rounded bg-lime px-2.5 py-1 text-xs font-semibold text-charcoal"
                >
                  Add column
                </button>
                <button
                  onClick={() => setNewColumn(null)}
                  className="press px-2 py-1 text-xs text-ink-faint hover:text-ink"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setNewColumn("")}
              className="press w-full rounded-xl border border-dashed border-charcoal-700 py-3 text-sm text-ink-muted hover:border-charcoal-600 hover:text-ink"
            >
              + New column
            </button>
          )}
        </div>
      </div>

      {editing && (
        <CardDetail
          card={editing}
          onClose={() => setEditing(null)}
          onSave={saveEdit}
          onDelete={() => removeCard(editing.id)}
        />
      )}
    </div>
  );
}
