import { cn } from "@/lib/utils"
import { signup, loginWithGoogle } from "@/app/login/actions"
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
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"

export function SignupForm({
  className,
  error,
  ...props
}: React.ComponentProps<"div"> & { error?: string }) {
  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle>Create your account</CardTitle>
          <CardDescription>
            Enter your email below to create a new account
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}
          <form action={signup}>
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
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  minLength={6}
                  required
                />
                <FieldDescription className="text-[#5f5f5f]">
                  Must be at least 6 characters.
                </FieldDescription>
              </Field>
              <Field>
                <SubmitButton>Sign up</SubmitButton>
              </Field>
            </FieldGroup>
          </form>
          <form action={loginWithGoogle} className="mt-4">
            <GoogleSignInButton label="Sign up with Google" />
          </form>
          <p className="mt-4 text-center text-sm text-[#5f5f5f]">
            Already have an account?{" "}
            <a
              href="/login"
              className="font-medium text-[#333] underline-offset-4 hover:underline"
            >
              Sign in
            </a>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
