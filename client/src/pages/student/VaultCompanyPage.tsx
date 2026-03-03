import { useParams } from "react-router-dom";
import { useState } from "react";

import { Card, Select } from "../../components/ui";
import { useVaultItems } from "../../hooks/use-vault";

export default function VaultCompanyPage() {
  const { companyId } = useParams<{ companyId: string }>();

  const [type, setType] = useState("");
  const { data, error, isLoading } = useVaultItems(companyId ?? null, type || undefined);

  if (isLoading) {
    return <Card>Loading company vault...</Card>;
  }

  if (error || !data) {
    return <Card>Unable to load vault items.</Card>;
  }

  return (
    <section className="dashboard-grid">
      <Card>
        <h1>Company Vault</h1>
        <label>
          Filter by type
          <Select value={type} onChange={(event) => setType(event.target.value)}>
            <option value="">All</option>
            <option value="question">Question</option>
            <option value="tip">Tip</option>
            <option value="past_paper">Past Paper</option>
            <option value="experience">Experience</option>
          </Select>
        </label>
      </Card>

      {data.map((item) => (
        <Card key={item.id}>
          <h3>{item.type}</h3>
          <p>{item.content}</p>
          <p>Difficulty: {item.difficulty ?? "N/A"}</p>
        </Card>
      ))}
    </section>
  );
}
