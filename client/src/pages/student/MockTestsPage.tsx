import { Link } from "react-router-dom";
import { useState } from "react";

import { Badge, Button, Card, Select } from "../../components/ui";
import { useMockTestCompanyOptions, useMockTests, useMockTestTopicOptions } from "../../hooks/use-mock-tests";

export default function MockTestsPage() {
  const [topicId, setTopicId] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [difficulty, setDifficulty] = useState("");

  const { data, error, isLoading } = useMockTests({
    topicId: topicId || undefined,
    companyId: companyId || undefined,
    difficulty: difficulty || undefined,
  });
  const { data: topicOptions, isLoading: topicOptionsLoading } = useMockTestTopicOptions();
  const { data: companyOptions, isLoading: companyOptionsLoading } = useMockTestCompanyOptions();

  return (
    <section className="mock-tests-page">
      <Card className="mock-tests-filter-card">
        <h1>Mock Tests</h1>
        <p>Browse and attempt tests by topic, company, and difficulty.</p>
        <div className="form-grid">
          <label>
            Topic
            <Select value={topicId} onChange={(event) => setTopicId(event.target.value)}>
              <option value="">All Topics</option>
              {(topicOptions ?? []).map((topic) => (
                <option key={topic.id} value={topic.id}>
                  {topic.name}
                </option>
              ))}
            </Select>
            {topicOptionsLoading ? <small className="muted-text">Loading topics...</small> : null}
          </label>
          <label>
            Company
            <Select value={companyId} onChange={(event) => setCompanyId(event.target.value)}>
              <option value="">All Companies</option>
              {(companyOptions ?? []).map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </Select>
            {companyOptionsLoading ? <small className="muted-text">Loading companies...</small> : null}
          </label>
          <label>
            Difficulty
            <Select value={difficulty} onChange={(event) => setDifficulty(event.target.value)}>
              <option value="">All</option>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </Select>
          </label>
        </div>
      </Card>

      {isLoading ? <Card>Loading tests...</Card> : null}
      {error ? <Card>Unable to load tests.</Card> : null}

      <div className="mock-tests-grid">
        {(data?.items ?? []).map((test) => (
          <Card key={test.id} className="mock-test-card">
            <h3>{test.title}</h3>
            <p>Duration: {Math.ceil(test.durationSec / 60)} min</p>
            <p>Attempts: {test.attemptCount}</p>
            <Badge>{test.difficulty}</Badge>
            <div className="hero-actions">
              <Link to={`/mock-tests/${test.id}`}>
                <Button>Open</Button>
              </Link>
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}
