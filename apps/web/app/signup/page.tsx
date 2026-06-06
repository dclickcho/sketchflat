import Image from "next/image"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { SignupForm } from "@/components/signup-form"

export const dynamic = "force-dynamic"

export default async function Page({
  searchParams,
}: {
  searchParams: { error?: string }
}) {
  const supabase = createClient()
  const { data } = await supabase.auth.getUser()
  if (data.user) redirect("/")

  return (
    <div className="flex min-h-svh w-full items-center justify-center bg-[#fafaf8] p-6 md:p-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-4">
          <Image
            src="/logo.png"
            alt="SketchFlat"
            width={44}
            height={44}
            priority
            className="h-11 w-auto"
          />
          <h1 className="text-2xl font-bold tracking-tight text-[#333]">
            Welcome to SketchFlat
          </h1>
        </div>
        <SignupForm error={searchParams.error} />
      </div>
    </div>
  )
}
