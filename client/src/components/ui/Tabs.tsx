interface TabsProps { tabs: Array<{ id: string; label: string }>; activeId: string; onChange: (id: string) => void; }
export function Tabs({ tabs, activeId, onChange }: TabsProps) {
  return (
    <div className="ui-tabs" role="tablist" aria-label="Tabs">
      {tabs.map((tab) => (
        <button key={tab.id} type="button" className={`ui-tab ${tab.id === activeId ? "active" : ""}`.trim()} role="tab" aria-selected={tab.id === activeId} onClick={() => onChange(tab.id)}>
          {tab.label}
        </button>
      ))}
    </div>
  );
}
