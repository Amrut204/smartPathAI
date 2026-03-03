interface ToggleProps { checked: boolean; onChange: (next: boolean) => void; }
export function Toggle({ checked, onChange }: ToggleProps) {
  return <button type="button" className={`ui-toggle ${checked ? "on" : ""}`.trim()} role="switch" aria-checked={checked} onClick={() => onChange(!checked)} />;
}
