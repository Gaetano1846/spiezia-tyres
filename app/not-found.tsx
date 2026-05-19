import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 text-center p-8">
      <h1 className="text-6xl font-black text-[#111]">404</h1>
      <p className="text-[#9DA5AE]">Pagina non trovata</p>
      <Link href="/" className="text-sm font-bold text-[#FFC300] hover:text-[#E6B000] transition-colors">
        Torna alla home
      </Link>
    </div>
  );
}
