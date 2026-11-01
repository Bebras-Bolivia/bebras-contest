import { countryFlag } from "@/lib/countries";
import { cn } from "@/lib/utils";

export function TaskCountry({
  country,
  className,
}: {
  country?: string | null;
  className?: string;
}) {
  const flag = countryFlag(country);
  if (!country || !flag) return null;

  return (
    <img
      alt={country}
      title={country}
      src={flag}
      className={cn(
        "h-5 w-auto shrink-0 rounded-[2px] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.12)]",
        className,
      )}
    />
  );
}
