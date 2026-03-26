import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { mutate as globalMutate } from "swr";

import { Button } from "../../components/ui";
import { buildCareerSwitchPrompts, CROSS_BRANCH_PROMPT_LIBRARY } from "../../config/branch-exploration";
import {
  streamAiChat,
  useAiConversation,
  useAiConversations,
  useAiUsage,
} from "../../hooks/use-ai-assistant";
import { useStudentDashboard } from "../../hooks/use-student-dashboard";

const DEFAULT_STARTER_PROMPTS = [
  "Give me a 7-day aptitude prep plan",
  "Mock HR interview questions and answers",
  "How should I prepare for my next campus placement round",
];

function topicTitle(topic: string): string {
  if (topic === "dsa") return "DSA";
  if (topic === "sql") return "SQL";
  if (topic === "aptitude") return "Aptitude";
  if (topic === "interview") return "Interview";
  return "General";
}

export default function AiAssistantPage() {
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [pendingUserMessage, setPendingUserMessage] = useState<string | null>(null);
  const [streamedResponse, setStreamedResponse] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const { data: conversations, mutate: mutateConversations } = useAiConversations();
  const { data: conversation } = useAiConversation(selectedConversationId);
  const { data: usage, mutate: mutateUsage } = useAiUsage();
  const { data: dashboard } = useStudentDashboard();
  const starterPrompts = useMemo(() => {
    if (!dashboard) return DEFAULT_STARTER_PROMPTS;

    return [
      ...dashboard.branchTrack.starterPrompts,
      ...buildCareerSwitchPrompts(dashboard.branch, dashboard.branchTrack.label),
      CROSS_BRANCH_PROMPT_LIBRARY.aptitude,
    ].filter((prompt, index, array) => array.indexOf(prompt) === index).slice(0, 6);
  }, [dashboard]);

  const messages = useMemo(() => {
    const base = [...(conversation?.messages ?? [])];
    if (pendingUserMessage) {
      base.push({
        role: "user",
        content: pendingUserMessage,
        timestamp: new Date().toISOString(),
      });
    }
    if (streamedResponse) {
      base.push({
        role: "assistant",
        content: streamedResponse,
        timestamp: new Date().toISOString(),
      });
    }
    return base;
  }, [conversation?.messages, pendingUserMessage, streamedResponse]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const resetDraft = () => {
    setSelectedConversationId(null);
    setPendingUserMessage(null);
    setStreamedResponse("");
    setError(null);
    composerRef.current?.focus();
  };

  const onSend = async () => {
    if (!input.trim() || sending) {
      return;
    }

    setSending(true);
    setError(null);
    setPendingUserMessage(input.trim());
    setStreamedResponse("");

    const userMessage = input.trim();
    setInput("");
    let doneConversationId = selectedConversationId;

    try {
      await streamAiChat({
        message: userMessage,
        conversationId: selectedConversationId ?? undefined,
        onToken(token) {
          setStreamedResponse((current) => current + token);
        },
        onDone(payload) {
          doneConversationId = payload.conversationId;
        },
      });

      setSelectedConversationId(doneConversationId);
      setPendingUserMessage(null);
      setStreamedResponse("");

      await Promise.all([
        mutateConversations(),
        mutateUsage(),
        doneConversationId ? globalMutate(`/api/v1/ai/conversations/${doneConversationId}`) : Promise.resolve(),
      ]);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "AI response failed");
    } finally {
      setSending(false);
    }
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void onSend();
    }
  };

  const onPromptPick = (prompt: string) => {
    setInput(prompt);
    composerRef.current?.focus();
  };

  return (
    <section className="gemini-shell">
      <aside className="gemini-sidebar">
        <div className="gemini-sidebar-top">
          <Button className="gemini-new-chat" onClick={resetDraft}>
            + New chat
          </Button>
          <div className="gemini-sidebar-title">Recent</div>
        </div>

        <ul className="gemini-conversation-list">
          {(conversations ?? []).map((item) => {
            const active = item.id === selectedConversationId;
            return (
              <li key={item.id}>
                <button
                  className={`gemini-conversation-item${active ? " active" : ""}`}
                  onClick={() => {
                    setSelectedConversationId(item.id);
                    setError(null);
                  }}
                >
                  <span className="gemini-conversation-topic">{topicTitle(item.topic)}</span>
                  <span className="gemini-conversation-preview">{item.preview || "Open conversation"}</span>
                </button>
              </li>
            );
          })}
          {!conversations?.length ? <li className="gemini-empty-note">No conversations yet.</li> : null}
        </ul>

        <div className="gemini-usage-box">
          <span>Usage</span>
          {usage ? (
            <div>
              <strong>
                {usage.userTokensToday}/{usage.userTokenLimit}
              </strong>
              {usage.groqBudget?.warning || usage.groqBudget?.blocked ? (
                <p className="muted-text" style={{ marginTop: 6 }}>
                  {usage.groqBudget.message ?? "Groq budget protection is active."}
                </p>
              ) : null}
            </div>
          ) : (
            <strong>Loading...</strong>
          )}
        </div>
      </aside>

      <section className="gemini-main">
        <header className="gemini-header">
          <div>
            <h1>Smart Path Assistant</h1>
            <p>
              {dashboard
                ? `${dashboard.branchTrack.label} placement prep assistant for branch-specific strategy and cross-branch career exploration.`
                : "Placement prep assistant for aptitude, core subjects, coding, interviews, and strategy."}
            </p>
          </div>
          <span className="gemini-model-chip">{conversation?.model ?? "chat"}</span>
        </header>

        <div className="gemini-messages">
          {!messages.length ? (
            <div className="gemini-starter-grid">
              {starterPrompts.map((prompt) => (
                <button key={prompt} className="gemini-starter" onClick={() => onPromptPick(prompt)}>
                  {prompt}
                </button>
              ))}
            </div>
          ) : (
            messages.map((message, index) => (
              <div
                key={`${message.timestamp}_${index}`}
                className={`gemini-message-row ${message.role === "user" ? "user" : "assistant"}`}
              >
                <div className={`gemini-bubble ${message.role === "user" ? "user" : "assistant"}`}>
                  {message.content}
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {error ? (
          <div className="gemini-error-card">
            <p className="gemini-error">{
              error.includes("temporarily unavailable") || error.includes("rate limit")
                ? error
                : `Something went wrong: ${error}`
            }</p>
            <button className="gemini-retry-btn" onClick={() => { setError(null); composerRef.current?.focus(); }}>
              Dismiss
            </button>
          </div>
        ) : null}

        <div className="gemini-composer-wrap">
          <textarea
            ref={composerRef}
            rows={3}
            className="gemini-composer"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onComposerKeyDown}
            placeholder="Message Smart Path Assistant"
          />
          <div className="gemini-composer-actions">
            <small>Press Enter to send, Shift+Enter for new line.</small>
            <Button onClick={onSend} disabled={sending || !input.trim()}>
              {sending ? "Thinking..." : "Send"}
            </Button>
          </div>
        </div>
      </section>
    </section>
  );
}
