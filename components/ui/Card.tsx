import { cn } from "@/lib/utils";

type Props = {
  children: React.ReactNode;
  className?: string;
  padding?: "sm" | "md" | "lg";
};

const paddings = { sm: "p-4", md: "p-6", lg: "p-8" };

export default function Card({ children, className, padding = "md" }: Props) {
  return (
    <div
      className={cn("rounded-2xl", paddings[padding], className)}
      style={{
        background: "#fff",
        boxShadow: "var(--shadow-sm)",
        border: "1px solid var(--border)",
      }}
    >
      {children}
    </div>
  );
}
