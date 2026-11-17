import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CircleHelp } from "lucide-react";
import type { ClaimStatus } from "@/lib/claim-status";
import {
  statusGlossaryEntry,
  termGlossaryEntry,
  type GlossaryEntry,
  type GlossaryTerm,
} from "@/lib/glossary";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// Plain-English help (fix 49). The wording comes from src/lib/glossary.ts.
//
// <GlossaryTip term="paid" /> is a small "?" button; with children it turns
// them (a status badge) into the button. It is a popover, so it works the same
// for mouse (opens on hover, stays open on click), touch (tap to open, tap
// again or outside to close) and keyboard (Enter/Space to open, Escape to
// close), and focus stays on the button.
//
// Inside a link a button would be a nested control, so <GlossaryHoverTip>
// shows the same text on mouse hover only; the claim page the link opens has
// the full, tappable version.

type Subject = { term: GlossaryTerm; status?: never } | { status: ClaimStatus; term?: never };

function entryFor(subject: Subject): GlossaryEntry {
  return subject.status ? statusGlossaryEntry(subject.status) : termGlossaryEntry(subject.term!);
}

function EntryBody({ entry, headingId }: { entry: GlossaryEntry; headingId?: string }) {
  return (
    <div className="space-y-1.5 text-left">
      <p id={headingId} className="font-semibold text-navy">
        {entry.title}
      </p>
      {entry.lines.map((line, i) => (
        <p key={i} className="text-sm leading-snug">
          {line.label && <span className="font-medium">{line.label}: </span>}
          {line.text}
        </p>
      ))}
    </div>
  );
}

const HOVER_CLOSE_DELAY_MS = 150;

export function GlossaryTip({
  children,
  className,
  label,
  ...subject
}: Subject & {
  /** The trigger; a "?" icon when left out. */
  children?: ReactNode;
  className?: string;
  /** The button's name for screen readers; defaults to "What does <title> mean?". */
  label?: string;
}) {
  const entry = entryFor(subject as Subject);
  const [open, setOpen] = useState(false);
  const contentId = useId();
  const headingId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const pointerType = useRef<string | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const closeSoon = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), HOVER_CLOSE_DELAY_MS);
  };
  useEffect(() => cancelClose, []);

  const onMouse =
    (action: "enter" | "leave") =>
    (e: React.PointerEvent): void => {
      if (e.pointerType !== "mouse") return;
      if (action === "enter") {
        cancelClose();
        setOpen(true);
      } else {
        closeSoon();
      }
    };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <button
          ref={buttonRef}
          type="button"
          aria-label={label ?? `What does ${entry.title} mean?`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? contentId : undefined}
          onPointerDown={(e) => {
            pointerType.current = e.pointerType;
          }}
          onPointerEnter={onMouse("enter")}
          onPointerLeave={onMouse("leave")}
          onClick={(e) => {
            // Never let the click reach a row or card behind the button.
            e.preventDefault();
            e.stopPropagation();
            // A mouse already opened it on hover; a click keeps it open.
            if (pointerType.current === "mouse") setOpen(true);
            else setOpen((o) => !o);
            pointerType.current = null;
          }}
          className={cn(
            "relative z-10 inline-flex items-center rounded-full align-middle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
            !children &&
              "h-5 w-5 justify-center text-muted-foreground hover:text-navy normal-case tracking-normal",
            children && "cursor-help",
            className,
          )}
        >
          {children ?? <CircleHelp className="h-3.5 w-3.5" aria-hidden />}
        </button>
      </PopoverAnchor>
      <PopoverContent
        id={contentId}
        aria-labelledby={headingId}
        side="top"
        className="w-72 max-w-[calc(100vw-2rem)] p-3 text-sm normal-case tracking-normal font-normal"
        // Keep focus on the button: the popover is only text.
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        // A tap on the button itself is handled by its onClick.
        onInteractOutside={(e) => {
          const target = e.target as Node | null;
          if (target && buttonRef.current?.contains(target)) e.preventDefault();
        }}
        onPointerEnter={onMouse("enter")}
        onPointerLeave={onMouse("leave")}
      >
        <EntryBody entry={entry} headingId={headingId} />
      </PopoverContent>
    </Popover>
  );
}

/** Hover-only help for something inside a link (no second control in the link). */
export function GlossaryHoverTip({
  children,
  ...subject
}: Subject & {
  children: ReactNode;
}) {
  const entry = entryFor(subject as Subject);
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help">{children}</span>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="w-72 max-w-[calc(100vw-2rem)] p-3 bg-popover text-popover-foreground border shadow-md"
        >
          <EntryBody entry={entry} />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** A label with its "?" help button beside it. */
export function TermLabel({
  term,
  children,
  className,
}: {
  term: GlossaryTerm;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {children}
      <GlossaryTip term={term} />
    </span>
  );
}
