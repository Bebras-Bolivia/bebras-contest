import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import type { ComponentProps } from "react";

import { Button } from "@/components/ui/button";

type StepProps = {
  label?: string;
  size?: ComponentProps<typeof Button>["size"];
  disabled?: boolean;
  onClick?: () => void;
  href?: string;
  className?: string;
  description?: string;
};

export function PreviousButton({
  label = "Anterior",
  size = "lg",
  disabled,
  onClick,
  href,
  className,
  description = "Tarea anterior",
}: StepProps) {
  const content = (
    <>
      <ChevronLeftIcon data-icon="inline-start" />
      {label}
    </>
  );
  return href ? (
    <Button asChild variant="outline" size={size} className={className}>
      <a href={href}>{content}</a>
    </Button>
  ) : (
    <Button
      type="button"
      variant="outline"
      size={size}
      className={className}
      aria-label={description}
      title={description}
      disabled={disabled}
      onClick={onClick}
    >
      {content}
    </Button>
  );
}

export function NextButton({
  label = "Siguiente",
  size = "lg",
  disabled,
  onClick,
  href,
  className,
  description = "Tarea siguiente",
}: StepProps) {
  const content = (
    <>
      {label}
      <ChevronRightIcon data-icon="inline-end" />
    </>
  );
  return href ? (
    <Button asChild variant="outline" size={size} className={className}>
      <a href={href}>{content}</a>
    </Button>
  ) : (
    <Button
      type="button"
      variant="outline"
      size={size}
      className={className}
      aria-label={description}
      title={description}
      disabled={disabled}
      onClick={onClick}
    >
      {content}
    </Button>
  );
}
