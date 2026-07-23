"use client";

const prompts = [
  "Show current cricket matches",
  "Show football matches today",
  "Show Arsenal past matches",
  "Show Barcelona upcoming fixtures",
  "Show India recent form",
  "Search Virat Kohli stats",
  "Explain CSK team history"
];

interface SuggestedPromptsProps {
  onSelect: (prompt: string) => void;
  disabled?: boolean;
}

export function SuggestedPrompts({ onSelect, disabled }: SuggestedPromptsProps) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-2">
      {prompts.map((prompt) => (
        <button
          key={prompt}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(prompt)}
          className="shrink-0 rounded-full border border-pitch-100 bg-white px-3 py-2 text-sm font-medium text-pitch-900 shadow-sm transition hover:border-pitch-500 hover:bg-pitch-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {prompt}
        </button>
      ))}
    </div>
  );
}
