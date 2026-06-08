type Props = {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  accent?: string;
  /** Variante compatta per mobile: card più strette affiancate. Su mobile l'icona è nascosta e
   *  label/valore usano tutta la larghezza disponibile (niente overflow). Su md+ resta identica alla standard. */
  compact?: boolean;
};

export default function StatCard({ label, value, sub, icon, accent = "var(--brand)", compact = false }: Props) {
  return (
    <div
      className={
        (compact ? "p-2.5 md:p-5 gap-2 md:gap-4" : "p-3 md:p-5 gap-2.5 md:gap-4") +
        " rounded-xl md:rounded-2xl flex items-center md:items-start overflow-hidden"
      }
      style={{ background: "#fff", boxShadow: "var(--shadow-sm)", border: "1px solid var(--border)" }}
    >
      <div
        className={
          (compact ? "hidden md:flex w-12 h-12" : "flex w-9 h-9 md:w-12 md:h-12") +
          " rounded-lg md:rounded-xl items-center justify-center flex-shrink-0"
        }
        style={{ background: accent + "20", color: accent }}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p
          className={
            (compact ? "text-[9px] md:text-xs tracking-wider" : "text-[10px] md:text-xs tracking-wider md:tracking-widest") +
            " font-semibold uppercase leading-tight break-words"
          }
          style={{ color: "var(--text-muted)", fontFamily: "var(--font-montserrat)" }}
        >
          {label}
        </p>
        <p
          className={(compact ? "text-base md:text-2xl" : "text-lg md:text-2xl") + " font-bold leading-none mt-0.5 truncate"}
          style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}
        >
          {value}
        </p>
        {sub && (
          <p
            className={(compact ? "hidden md:block" : "") + " text-[10px] md:text-xs mt-0.5 leading-tight break-words"}
            style={{ color: "var(--text-secondary)" }}
          >
            {sub}
          </p>
        )}
      </div>
    </div>
  );
}
