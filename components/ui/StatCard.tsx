type Props = {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  accent?: string;
};

export default function StatCard({ label, value, sub, icon, accent = "var(--brand)" }: Props) {
  return (
    <div
      className="rounded-xl md:rounded-2xl p-3 md:p-5 flex items-center md:items-start gap-2.5 md:gap-4"
      style={{ background: "#fff", boxShadow: "var(--shadow-sm)", border: "1px solid var(--border)" }}
    >
      <div
        className="w-9 h-9 md:w-12 md:h-12 rounded-lg md:rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: accent + "20", color: accent }}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[10px] md:text-xs font-semibold uppercase tracking-wider md:tracking-widest leading-tight" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
          {label}
        </p>
        <p className="text-lg md:text-2xl font-bold leading-none mt-0.5" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
          {value}
        </p>
        {sub && <p className="text-[10px] md:text-xs mt-0.5 leading-tight" style={{ color: "var(--text-secondary)" }}>{sub}</p>}
      </div>
    </div>
  );
}
