import { cn } from "@/lib/utils";

type Variant = "brand" | "success" | "warning" | "error" | "neutral";

const styles: Record<Variant, { bg: string; color: string }> = {
  brand:   { bg: "#FFF3CD", color: "#92610A" },
  success: { bg: "#D1FAE5", color: "#065F46" },
  warning: { bg: "#FEF9C3", color: "#854D0E" },
  error:   { bg: "#FEE2E2", color: "#991B1B" },
  neutral: { bg: "#F3F4F6", color: "#374151" },
};

type Props = {
  children: React.ReactNode;
  variant?: Variant;
  className?: string;
};

export default function Badge({ children, variant = "neutral", className }: Props) {
  const s = styles[variant];
  return (
    <span
      className={cn("inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold", className)}
      style={{ background: s.bg, color: s.color, fontFamily: "var(--font-montserrat)" }}
    >
      {children}
    </span>
  );
}
