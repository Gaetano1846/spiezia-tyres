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
      className="rounded-2xl p-5 flex items-start gap-4"
      style={{ background: "#fff", boxShadow: "var(--shadow-sm)", border: "1px solid var(--border)" }}
    >
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: accent + "20", color: accent }}
      >
        {icon}
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}>
          {label}
        </p>
        <p className="text-2xl font-bold mt-0.5" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
          {value}
        </p>
        {sub && <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>{sub}</p>}
      </div>
    </div>
  );
}
