import * as React from 'react';
import { cn } from '@/lib/utils';

const FieldGroup = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col gap-5', className)} {...props} />
  ),
);
FieldGroup.displayName = 'FieldGroup';

const Field = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col gap-2', className)} {...props} />
  ),
);
Field.displayName = 'Field';

const FieldLabel = React.forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement>
>(({ className, ...props }, ref) => (
  <label
    ref={ref}
    className={cn(
      'text-[13px] font-medium leading-none text-[#333] tracking-tight',
      className,
    )}
    {...props}
  />
));
FieldLabel.displayName = 'FieldLabel';

const FieldDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn('text-sm text-[#888]', className)} {...props} />
));
FieldDescription.displayName = 'FieldDescription';

export { Field, FieldGroup, FieldLabel, FieldDescription };
