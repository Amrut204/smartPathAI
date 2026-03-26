import { Link } from "react-router-dom";

import { Badge, Button, Card } from "../../components/ui";
import { useVaultCompanies } from "../../hooks/use-vault";

export default function VaultPage() {
  const { data, error, isLoading } = useVaultCompanies();

  if (isLoading) {
    return <Card>Loading vault companies...</Card>;
  }

  if (error || !data) {
    return <Card>Unable to load vault companies.</Card>;
  }

  return (
    <section className="dashboard-grid">
      {data.map((company) => (
        <Card key={company.id}>
          <h3>{company.name}</h3>
          <p>Slug: {company.slug}</p>
          <Badge>{company.resourceCount} resources</Badge>
          <div className="hero-actions">
            <Link to={`/vault/${company.id}`}>
              <Button>Open Vault</Button>
            </Link>
          </div>
        </Card>
      ))}
    </section>
  );
}
