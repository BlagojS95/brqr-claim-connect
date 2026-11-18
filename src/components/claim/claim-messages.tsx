import { useId, useRef, useState, type KeyboardEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import {
  fetchClaimMessages,
  fetchMessageMentionCandidates,
  postClaimMessage,
} from "@/lib/claim-messages.functions";
import {
  MAX_MESSAGE_LENGTH,
  filterMentionCandidates,
  insertMention,
  mentionQueryAt,
  splitMentions,
  type ClaimMessage,
  type MentionCandidate,
} from "@/lib/claim-messages";
import { formatActivityTimestamp } from "@/lib/claim-activity";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

// Messages on a claim (fix 47): the thread oldest to newest, and a box to
// write one. Typing "@" offers the agency staff and the client's people who
// can see this claim; the server works out the mentions again from the text.
export function ClaimMessages({ claimId }: { claimId: string }) {
  const { viewingAs } = useAuth();
  const getMessages = useServerFn(fetchClaimMessages);
  const {
    data: messages,
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.claimMessages(claimId),
    queryFn: () => getMessages({ data: { claimId } }),
  });

  return (
    <div className="space-y-4">
      {isLoading && <div className="text-sm text-muted-foreground">Loading messages…</div>}
      {error && (
        <div className="text-sm text-destructive">
          Couldn't load messages: {error instanceof Error ? error.message : "Unknown error"}
        </div>
      )}
      {messages && messages.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No messages yet. Ask a question or share an update; type @ to mention someone.
        </p>
      )}
      {messages && messages.length > 0 && (
        <ol className="space-y-3" aria-label="Messages, oldest first">
          {messages.map((m) => (
            <MessageItem key={m.id} message={m} />
          ))}
        </ol>
      )}
      {/* View as client (fix 55) is read only. */}
      {!viewingAs && <MessageComposer claimId={claimId} />}
    </div>
  );
}

function MessageItem({ message: m }: { message: ClaimMessage }) {
  return (
    <li
      className={cn(
        "rounded-md border p-3 text-sm",
        m.isMine ? "border-navy/20 bg-navy/5" : "border-border bg-background",
      )}
    >
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium text-foreground">{m.isMine ? "You" : m.authorName}</span>
        {m.authorIsStaff && (
          <span className="rounded bg-gold/20 px-1.5 py-0.5 text-[11px] font-medium text-navy">
            BRQR Agency
          </span>
        )}
        <span className="text-xs text-muted-foreground">
          {formatActivityTimestamp(m.createdAt)}
        </span>
      </div>
      <p className="mt-1 whitespace-pre-wrap break-words text-foreground/90">
        {splitMentions(m.body, m.mentionNames).map((part, i) =>
          part.mention ? (
            <span key={i} className="font-semibold text-navy">
              {part.text}
            </span>
          ) : (
            <span key={i}>{part.text}</span>
          ),
        )}
      </p>
    </li>
  );
}

function MessageComposer({ claimId }: { claimId: string }) {
  const queryClient = useQueryClient();
  const post = useServerFn(postClaimMessage);
  const getCandidates = useServerFn(fetchMessageMentionCandidates);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const [draft, setDraft] = useState("");
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [sending, setSending] = useState(false);

  const { data: candidates = [] } = useQuery({
    queryKey: queryKeys.claimMentionCandidates(claimId),
    queryFn: () => getCandidates({ data: { claimId } }),
    staleTime: 5 * 60_000,
  });

  const mention = mentionQueryAt(draft, caret);
  const matches =
    mention && mention.start !== dismissedAt
      ? filterMentionCandidates(candidates, mention.query)
      : [];
  const open = matches.length > 0;
  const activeIndex = Math.min(active, Math.max(matches.length - 1, 0));

  function syncCaret() {
    const el = textareaRef.current;
    if (el) setCaret(el.selectionStart ?? el.value.length);
  }

  function pick(candidate: MentionCandidate) {
    if (!mention) return;
    const next = insertMention(draft, mention.start, caret, candidate.name);
    setDraft(next.text);
    setCaret(next.caret);
    setActive(0);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.caret, next.caret);
    });
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (open) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((activeIndex + 1) % matches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((activeIndex - 1 + matches.length) % matches.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pick(matches[activeIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setDismissedAt(mention?.start ?? null);
        return;
      }
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void send();
    }
  }

  async function send() {
    const body = draft.trim();
    if (!body) {
      toast.error("Write a message first");
      return;
    }
    if (body.length > MAX_MESSAGE_LENGTH) {
      toast.error("That message is too long");
      return;
    }
    setSending(true);
    try {
      const res = await post({ data: { claimId, body } });
      setDraft("");
      setCaret(0);
      setDismissedAt(null);
      toast.success(
        res.mentioned
          ? `Message sent; ${res.mentioned} ${res.mentioned === 1 ? "person" : "people"} mentioned`
          : "Message sent",
      );
      // The thread and the activity log (the message is logged there too).
      queryClient.invalidateQueries({ queryKey: queryKeys.claimMessages(claimId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.claimActivity(claimId) });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't send the message");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <label htmlFor={`${listId}-box`} className="sr-only">
          Write a message
        </label>
        <Textarea
          id={`${listId}-box`}
          ref={textareaRef}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          onKeyUp={(e) => {
            if (!["ArrowUp", "ArrowDown", "Enter", "Tab", "Escape"].includes(e.key)) syncCaret();
          }}
          onClick={syncCaret}
          placeholder="Write a message… type @ to mention someone"
          maxLength={MAX_MESSAGE_LENGTH}
          rows={3}
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={open ? `${listId}-${activeIndex}` : undefined}
        />
        {open && (
          <ul
            id={listId}
            role="listbox"
            aria-label="People to mention"
            className="absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-auto rounded-md border border-border bg-popover p-1 shadow-md sm:right-auto sm:min-w-[16rem]"
          >
            {matches.map((c, i) => (
              <li
                key={c.userId}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === activeIndex}
                // mousedown, so the textarea keeps focus and caret.
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(c);
                }}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-3 rounded px-2 py-2 text-sm",
                  i === activeIndex ? "bg-muted" : "hover:bg-muted/60",
                )}
              >
                <span className="truncate">{c.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {c.kind === "staff" ? "BRQR Agency" : "Client"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">
          {draft.length}/{MAX_MESSAGE_LENGTH}
        </span>
        <Button size="sm" onClick={send} disabled={sending || !draft.trim()}>
          <Send className="h-3.5 w-3.5" aria-hidden />
          {sending ? "Sending…" : "Send message"}
        </Button>
      </div>
    </div>
  );
}
