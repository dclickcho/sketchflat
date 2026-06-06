import Image from "next/image"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { LoginForm } from "@/components/login-form"

export const dynamic = "force-dynamic"

export default async function Page({
  searchParams,
}: {
  searchParams: { error?: string; info?: string; mode?: string; next?: string }
}) {
  const supabase = createClient()
  const { data } = await supabase.auth.getUser()
  // 같은 사이트 안의 경로만 로그인 후 이동 대상으로 허용한다(열린 리다이렉트 차단).
  const next =
    searchParams.next && searchParams.next.startsWith('/') && !searchParams.next.startsWith('//')
      ? searchParams.next
      : '/'
  if (data.user) redirect(next)

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
        <LoginForm error={searchParams.error} info={searchParams.info} next={next} />
      </div>
    </div>
  )
}
