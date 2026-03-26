interface AvatarProps { name: string; }
export function Avatar({ name }: AvatarProps) {
  const initials = name.split(" ").map((chunk) => chunk[0]).join("").slice(0, 2).toUpperCase();
  return <span className="ui-avatar">{initials || "U"}</span>;
}
