import { cn } from "@/lib/cn";

type SpinnerProps = {
  /**
   * Announced to assistive tech as a status. Omit when the spinner sits in a
   * control that already says it is busy (e.g. a pending Button).
   */
  label?: string;
  className?: string;
};

export function Spinner({ label, className }: SpinnerProps) {
  const svg = (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className={cn("size-5 animate-spin", className)}
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.2"
        strokeWidth="3"
      />
      <path
        d="M21 12a9 9 0 00-9-9"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
  if (!label) return svg;
  return (
    <span role="status" className="inline-flex items-center">
      {svg}
      <span className="sr-only">{label}</span>
    </span>
  );
}
