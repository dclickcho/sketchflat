"use client"

import { Loader2 } from "lucide-react"
import { useFormStatus } from "react-dom"
import { Button, type ButtonProps } from "@/components/ui/button"

type SubmitButtonProps = ButtonProps & {
  pendingLabel?: string
}

export function SubmitButton({
  children,
  pendingLabel,
  disabled,
  ...props
}: SubmitButtonProps) {
  const { pending } = useFormStatus()
  return (
    <Button
      type="submit"
      disabled={disabled || pending}
      aria-busy={pending}
      {...props}
    >
      {pending ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          <span>{pendingLabel ?? children}</span>
        </>
      ) : (
        children
      )}
    </Button>
  )
}
