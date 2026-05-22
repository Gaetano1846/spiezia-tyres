import { cn } from "@/lib/utils";

type Props = {
  children: React.ReactNode;
  className?: string;
  padding?: "none" | "sm" | "md" | "lg";
  style?: React.CSSProperties;
};

const paddings = { none: "", sm: "p-4", md: "p-6", lg: "p-8" };

export default function Card({ children, className, padding = "md", style }: Props) {
  return (
    <div
      className={cn("rounded-2xl", paddings[padding], className)}
      style={{
        background: "#fff",
        boxShadow: "var(--shadow-sm)",
        border: "1px solid var(--border)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
