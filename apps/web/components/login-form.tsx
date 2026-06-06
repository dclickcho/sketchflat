import { cn } from "@/lib/utils"
import { login, loginWithGoogle } from "@/app/login/actions"
import { SubmitButton } from "@/components/submit-button"
import { GoogleSignInButton } from "@/components/google-sign-in-button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"

export function LoginForm({
  className,
  error,
  info,
  next,
  ...props
}: React.ComponentProps<"div"> & { error?: string; info?: string; next?: string }) {
  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle>Sign in to your account</CardTitle>
          <CardDescription>
            Enter your email below to sign in to your account
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}
          {info ? (
            <p className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {info}
            </p>
          ) : null}
          <form action={login}>
            {next ? <input type="hidden" name="next" value={next} /> : null}
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="m@example.com"
                  required
                />
              </Field>
              <Field>
                <div className="flex items-center">
                  <FieldLabel htmlFor="password">Password</FieldLabel>
                  <a
                    href="#"
                    className="ml-auto inline-block text-sm text-[#5f5f5f] tracking-tight underline-offset-4 hover:text-[#333] hover:underline"
                  >
                    Forgot your password?
                  </a>
                </div>
                <Input id="password" name="password" type="password" required />
              </Field>
              <Field>
                <SubmitButton>Sign in</SubmitButton>
              </Field>
            </FieldGroup>
          </form>
          <form action={loginWithGoogle} className="mt-4">
            <GoogleSignInButton label="Sign in with Google" />
          </form>
          <p className="mt-4 text-center text-sm text-[#5f5f5f]">
            Don&apos;t have an account?{" "}
            <a
              href="/signup"
              className="font-medium text-[#333] underline-offset-4 hover:underline"
            >
              Sign up
            </a>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
