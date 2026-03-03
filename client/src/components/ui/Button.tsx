import type { ButtonHTMLAttributes } from "react";
type ButtonVariant = "primary" | "secondary" | "ghost";
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> { variant?: ButtonVariant; }
export function Button({ variant = "primary", className = "", ...props }: ButtonProps) {
  return <button className={`ui-button ${variant} ${className}`.trim()} {...props} />;
}
