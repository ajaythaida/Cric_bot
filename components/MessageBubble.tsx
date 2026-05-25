import ReactMarkdown from "react-markdown";
import type { ChatMessage } from "@/components/Chat";

interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <article
        className={`max-w-[86%] rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm sm:max-w-[78%] ${
          isUser
            ? "rounded-br-md bg-pitch-700 text-white"
            : "rounded-bl-md border border-pitch-100 bg-white text-slate-800"
        }`}
      >
        {isUser ? (
          <div className="whitespace-pre-wrap">{message.content}</div>
        ) : (
          <ReactMarkdown
            components={{
              h1: ({ children }) => <h2 className="mb-2 text-lg font-bold text-pitch-900">{children}</h2>,
              h2: ({ children }) => <h2 className="mb-2 text-base font-bold text-pitch-900">{children}</h2>,
              h3: ({ children }) => <h3 className="mb-1.5 text-sm font-bold text-pitch-900">{children}</h3>,
              p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
              ul: ({ children }) => <ul className="mb-3 space-y-1.5 pl-4 last:mb-0">{children}</ul>,
              ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1.5 pl-4 last:mb-0">{children}</ol>,
              li: ({ children }) => <li className="list-disc pl-1">{children}</li>,
              strong: ({ children }) => <strong className="font-semibold text-pitch-900">{children}</strong>,
              code: ({ children }) => (
                <code className="rounded bg-pitch-50 px-1.5 py-0.5 text-[0.85em] text-pitch-900">{children}</code>
              )
            }}
          >
            {message.content}
          </ReactMarkdown>
        )}
      </article>
    </div>
  );
}
