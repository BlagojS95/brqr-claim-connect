import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { cn } from "@/lib/utils";

export interface SignaturePadHandle {
  clear: () => void;
  isEmpty: () => boolean;
  toBlob: () => Promise<Blob | null>;
}

// Mouse, pen or finger signature drawn on a canvas. Exported as a transparent
// PNG so it can be laid over any form.
export const SignaturePad = forwardRef<
  SignaturePadHandle,
  { className?: string; onChange?: (empty: boolean) => void }
>(function SignaturePad({ className, onChange }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const empty = useRef(true);

  // Size the backing store to the element's real pixels so strokes stay sharp.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = canvas.offsetWidth * ratio;
    canvas.height = canvas.offsetHeight * ratio;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0A1628";
  }, []);

  useImperativeHandle(ref, () => ({
    clear() {
      const canvas = canvasRef.current!;
      canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height);
      empty.current = true;
      onChange?.(true);
    },
    isEmpty: () => empty.current,
    toBlob: () => new Promise((resolve) => canvasRef.current!.toBlob(resolve, "image/png")),
  }));

  function point(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  return (
    <canvas
      ref={canvasRef}
      className={cn(
        "w-full h-40 touch-none rounded-md border border-input bg-background",
        className,
      )}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        drawing.current = true;
        const ctx = e.currentTarget.getContext("2d")!;
        const { x, y } = point(e);
        ctx.beginPath();
        ctx.moveTo(x, y);
        // A tap with no movement should still leave a dot.
        ctx.lineTo(x + 0.01, y);
        ctx.stroke();
        if (empty.current) {
          empty.current = false;
          onChange?.(false);
        }
      }}
      onPointerMove={(e) => {
        if (!drawing.current) return;
        const ctx = e.currentTarget.getContext("2d")!;
        const { x, y } = point(e);
        ctx.lineTo(x, y);
        ctx.stroke();
      }}
      onPointerUp={() => (drawing.current = false)}
      onPointerCancel={() => (drawing.current = false)}
    />
  );
});
