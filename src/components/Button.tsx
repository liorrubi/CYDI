import type { ButtonHTMLAttributes, MouseEvent } from "react";
import { playDangerSound, playPrimarySound, playSecondarySound } from "../engine/soundEngine";

type ButtonVariant = "primary" | "secondary" | "danger";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

const VARIANT_SOUND: Record<ButtonVariant, () => void> = {
  primary: playPrimarySound,
  secondary: playSecondarySound,
  danger: playDangerSound,
};

export default function Button({ variant = "primary", className, onClick, ...rest }: ButtonProps) {
  const classes = ["btn", `btn-${variant}`, className].filter(Boolean).join(" ");

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    VARIANT_SOUND[variant]();
    onClick?.(event);
  }

  return <button type="button" className={classes} onClick={handleClick} {...rest} />;
}
