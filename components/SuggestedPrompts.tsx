"use client";

const prompts = [
  "Show live cricket matches",
  "Show upcoming cricket matches",
  "Show recent cricket results",
  "Show live football matches",
  "Show India recent form",
  "🏏 India cricket team and players",
  "🏏 Virat Kohli recent performance",
  "🏏 Jasprit Bumrah player profile",
  "IND latest match score",
  "India next cricket match",
  "Who won yesterday's India match?",
  "Explain Team India history",
  "⚽ India football team and players",
  "⚽ Sunil Chhetri recent performance",
  "⚽ Lionel Messi recent performance",
  "India football recent matches",
  "Who won the 2026 Men's T20 World Cup?",
  "Who won the 2026 FIFA World Cup?",
  "Who won the 2011 Cricket World Cup final?",
  "Show football matches today"
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
