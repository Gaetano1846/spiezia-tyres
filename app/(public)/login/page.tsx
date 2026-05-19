import type { Metadata } from "next";
import LoginForm from "@/components/auth/LoginForm";

export const metadata: Metadata = { title: "Accedi" };

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F5F6FA] p-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8">
          <div className="text-2xl font-black tracking-tight text-[#111]">
            Spiezia <span className="text-[#FFC300]">Tyres</span>
          </div>
        </div>
        <div className="bg-white rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.10)] p-8">
          <h1 className="text-xl font-bold text-[#111] mb-6">Accedi al gestionale</h1>
          <LoginForm />
        </div>
      </div>
    </div>
  );
}
