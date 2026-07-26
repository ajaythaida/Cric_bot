"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { MessageBubble } from "@/components/MessageBubble";
import { SuggestedPrompts } from "@/components/SuggestedPrompts";

const WELCOME_MESSAGE =
  "Hi, I am SportBot AI. Ask me about football and cricket matches, schedules, scorecards, team form, team history, and basic predictions.";
const EMPTY_RESPONSE_MESSAGE =
  "I could not find a complete answer this time. Please rephrase the question with the sport, team, competition, or year.";
const EMPTY_RESPONSE_PREFIX = "I could not generate a response this time.";
const MODEL_ERROR_PREFIXES = [
  "I could not generate a sports answer right now.",
  "I could not generate a cricket answer right now."
];

function shouldSendToModel(message: ChatMessage): boolean {
  const content = message.content.trim();
  return Boolean(
    content &&
      content !== WELCOME_MESSAGE &&
      content !== EMPTY_RESPONSE_MESSAGE &&
      !content.startsWith(EMPTY_RESPONSE_PREFIX) &&
      !MODEL_ERROR_PREFIXES.some((prefix) => content.startsWith(prefix))
  );
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

function newId(): string {
  return crypto.randomUUID();
}

export function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: newId(),
      role: "assistant",
      content: WELCOME_MESSAGE
    }
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isLoading) {
      return;
    }

    const userMessage: ChatMessage = {
      id: newId(),
      role: "user",
      content: trimmed
    };
    const assistantId = newId();

    const history = [...messages, userMessage]
      .filter(shouldSendToModel)
      .map(({ role, content }) => ({
        role,
        content
      }));

    setMessages((current) => [
      ...current,
      userMessage,
      {
        id: assistantId,
        role: "assistant",
        content: ""
      }
    ]);
    setInput("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ messages: history })
      });

      if (!response.ok || !response.body) {
        const errorText = await response.text();
        throw new Error(errorText || "The chat service is unavailable.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }

        assistantText += decoder.decode(value, { stream: true });
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId ? { ...message, content: assistantText } : message
          )
        );
      }

      const finalText = assistantText + decoder.decode();
      if (finalText !== assistantText) {
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId ? { ...message, content: finalText } : message
          )
        );
      }

      if (!finalText.trim()) {
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId
              ? {
                  ...message,
                  content: EMPTY_RESPONSE_MESSAGE
                }
              : message
          )
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Something went wrong. Please try again.";
      setMessages((current) =>
        current.map((item) =>
          item.id === assistantId
            ? {
                ...item,
                content: message
              }
            : item
        )
      );
    } finally {
      setIsLoading(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(input);
  }

  return (
    <section className="mx-auto flex h-[calc(100vh-2.5rem)] max-w-5xl flex-col overflow-hidden rounded-[1.75rem] border border-pitch-100 bg-white/82 shadow-soft backdrop-blur">
      <header className="border-b border-pitch-100 bg-white px-5 py-4 sm:px-7">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-normal text-pitch-900 sm:text-3xl">SportBot AI</h1>
            <p className="mt-1 text-sm text-slate-600">
              Football & cricket matches, form, history and predictions
            </p>
          </div>
          <div className="w-fit rounded-full bg-pitch-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-pitch-700">
            Football + Cricket AI
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-7">
        <div className="space-y-4">
          {messages.map((message) =>
            message.content || message.role === "user" ? (
              <MessageBubble key={message.id} message={message} />
            ) : null
          )}
          {isLoading ? (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-md border border-pitch-100 bg-white px-4 py-3 text-sm text-slate-500 shadow-sm">
                SportBot is checking the sports data...
              </div>
            </div>
          ) : null}
          <div ref={scrollRef} />
        </div>
      </div>

      <footer className="border-t border-pitch-100 bg-white px-4 py-4 sm:px-7">
        <SuggestedPrompts disabled={isLoading} onSelect={(prompt) => void sendMessage(prompt)} />
        <form onSubmit={handleSubmit} className="mt-3 flex gap-2">
          <input
            value={input}
            disabled={isLoading}
            onChange={(event) => setInput(event.currentTarget.value)}
            placeholder="Ask about football or cricket matches, teams, players, or predictions..."
            className="min-w-0 flex-1 rounded-2xl border border-pitch-100 bg-pitch-50 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-500 focus:border-pitch-500 focus:bg-white focus:ring-4 focus:ring-pitch-100 disabled:opacity-70"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="rounded-2xl bg-pitch-700 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-pitch-900 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            Send
          </button>
        </form>
      </footer>
    </section>
  );
}
