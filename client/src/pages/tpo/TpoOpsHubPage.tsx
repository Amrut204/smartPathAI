import { useState } from "react";

import { Badge, Button, Card, Input, Table } from "../../components/ui";
import {
  addCalendarEvent,
  addCampaign,
  addRecruiterPartner,
  updateBillingPlan,
  useOpsHub,
} from "../../hooks/use-career";

export default function TpoOpsHubPage() {
  const { data, error, isLoading, mutate } = useOpsHub();
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [recruiterForm, setRecruiterForm] = useState({
    company: "",
    contactName: "",
    contactEmail: "",
    openRoles: "Software Engineer, Analyst",
    notes: "",
  });
  const [campaignForm, setCampaignForm] = useState({
    name: "",
    audience: "Eligible Students",
    channel: "email",
    scheduledFor: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 16),
    goal: "",
  });
  const [calendarForm, setCalendarForm] = useState({
    title: "",
    type: "drive-reminder",
    startsAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString().slice(0, 16),
    audience: "students",
    reminderOffsetHours: "24",
  });
  const [billingForm, setBillingForm] = useState({
    planName: "Growth",
    billingCycle: "annual" as "monthly" | "quarterly" | "annual",
    studentLimit: "500",
    aiQuota: "10000",
    messageQuota: "25000",
    monthlyPrice: "24999",
    renewalDate: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  });

  const runAction = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setStatus(null);
    try {
      await action();
      await mutate();
      setStatus("Saved.");
    } catch (submitError) {
      setStatus(submitError instanceof Error ? submitError.message : "Unable to save changes");
    } finally {
      setBusy(null);
    }
  };

  if (isLoading) {
    return <Card>Loading ops hub...</Card>;
  }

  if (error || !data) {
    return <Card>Unable to load operations hub.</Card>;
  }

  return (
    <section className="career-page">
      <Card className="career-hero-card">
        <h1>Operations Hub</h1>
        <p className="muted-text">
          Recruiter portal, campaigns, drive calendar, reminders, and admin revenue controls.
        </p>
        <div className="career-stat-grid">
          <div>
            <h3>Plan</h3>
            <p>{data.revenue.plan_name}</p>
          </div>
          <div>
            <h3>Students</h3>
            <p>{data.revenue.usage.students} / {data.revenue.student_limit}</p>
          </div>
          <div>
            <h3>Campaigns</h3>
            <p>{data.campaigns.items.length}</p>
          </div>
        </div>
      </Card>

      <div className="career-grid">
        <Card>
          <h2>Recruiter Portal</h2>
          <div className="form-grid">
            <label>
              Company
              <Input value={recruiterForm.company} onChange={(event) => setRecruiterForm((current) => ({ ...current, company: event.target.value }))} />
            </label>
            <label>
              Contact Name
              <Input value={recruiterForm.contactName} onChange={(event) => setRecruiterForm((current) => ({ ...current, contactName: event.target.value }))} />
            </label>
            <label>
              Contact Email
              <Input value={recruiterForm.contactEmail} onChange={(event) => setRecruiterForm((current) => ({ ...current, contactEmail: event.target.value }))} />
            </label>
            <label>
              Open Roles
              <Input value={recruiterForm.openRoles} onChange={(event) => setRecruiterForm((current) => ({ ...current, openRoles: event.target.value }))} />
            </label>
            <label>
              Notes
              <textarea rows={4} value={recruiterForm.notes} onChange={(event) => setRecruiterForm((current) => ({ ...current, notes: event.target.value }))} />
            </label>
            <Button
              onClick={() => runAction("recruiter", async () => {
                await addRecruiterPartner({
                  company: recruiterForm.company,
                  contactName: recruiterForm.contactName,
                  contactEmail: recruiterForm.contactEmail,
                  openRoles: recruiterForm.openRoles.split(",").map((item) => item.trim()).filter(Boolean),
                  notes: recruiterForm.notes || undefined,
                });
              })}
              disabled={busy === "recruiter"}
            >
              {busy === "recruiter" ? "Adding..." : "Add Recruiter Partner"}
            </Button>
          </div>
          <div className="career-section-stack">
            {data.recruiterPortal.partners.length > 0 ? data.recruiterPortal.partners.map((partner) => (
              <div key={partner.id} className="career-list-row">
                <div>
                  <strong>{partner.company}</strong>
                  <p className="muted-text">{partner.contact_name} | {partner.contact_email}</p>
                  <p className="muted-text">{partner.open_roles.join(", ")}</p>
                </div>
                <Badge variant="success">{partner.status}</Badge>
              </div>
            )) : <p className="muted-text">No recruiter partners added yet.</p>}
          </div>
        </Card>

        <Card>
          <h2>Communication Campaigns</h2>
          <div className="form-grid">
            <label>
              Campaign Name
              <Input value={campaignForm.name} onChange={(event) => setCampaignForm((current) => ({ ...current, name: event.target.value }))} />
            </label>
            <label>
              Audience
              <Input value={campaignForm.audience} onChange={(event) => setCampaignForm((current) => ({ ...current, audience: event.target.value }))} />
            </label>
            <label>
              Channel
              <Input value={campaignForm.channel} onChange={(event) => setCampaignForm((current) => ({ ...current, channel: event.target.value }))} />
            </label>
            <label>
              Scheduled For
              <Input type="datetime-local" value={campaignForm.scheduledFor} onChange={(event) => setCampaignForm((current) => ({ ...current, scheduledFor: event.target.value }))} />
            </label>
            <label>
              Goal
              <textarea rows={4} value={campaignForm.goal} onChange={(event) => setCampaignForm((current) => ({ ...current, goal: event.target.value }))} />
            </label>
            <Button
              onClick={() => runAction("campaign", async () => {
                await addCampaign({
                  name: campaignForm.name,
                  audience: campaignForm.audience,
                  channel: campaignForm.channel,
                  scheduledFor: new Date(campaignForm.scheduledFor).toISOString(),
                  goal: campaignForm.goal,
                });
              })}
              disabled={busy === "campaign"}
            >
              {busy === "campaign" ? "Scheduling..." : "Schedule Campaign"}
            </Button>
          </div>
          <Table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Audience</th>
                <th>Channel</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.campaigns.items.map((item) => (
                <tr key={item.id}>
                  <td>{item.name}</td>
                  <td>{item.audience}</td>
                  <td>{item.channel}</td>
                  <td>{item.status}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>

        <Card>
          <h2>Drive Calendar & Reminders</h2>
          <div className="form-grid">
            <label>
              Event Title
              <Input value={calendarForm.title} onChange={(event) => setCalendarForm((current) => ({ ...current, title: event.target.value }))} />
            </label>
            <label>
              Type
              <Input value={calendarForm.type} onChange={(event) => setCalendarForm((current) => ({ ...current, type: event.target.value }))} />
            </label>
            <label>
              Starts At
              <Input type="datetime-local" value={calendarForm.startsAt} onChange={(event) => setCalendarForm((current) => ({ ...current, startsAt: event.target.value }))} />
            </label>
            <label>
              Audience
              <Input value={calendarForm.audience} onChange={(event) => setCalendarForm((current) => ({ ...current, audience: event.target.value }))} />
            </label>
            <label>
              Reminder Offset (hours)
              <Input type="number" value={calendarForm.reminderOffsetHours} onChange={(event) => setCalendarForm((current) => ({ ...current, reminderOffsetHours: event.target.value }))} />
            </label>
            <Button
              onClick={() => runAction("calendar", async () => {
                await addCalendarEvent({
                  title: calendarForm.title,
                  type: calendarForm.type,
                  startsAt: new Date(calendarForm.startsAt).toISOString(),
                  audience: calendarForm.audience,
                  reminderOffsetHours: Number(calendarForm.reminderOffsetHours),
                });
              })}
              disabled={busy === "calendar"}
            >
              {busy === "calendar" ? "Saving..." : "Add Calendar Reminder"}
            </Button>
          </div>
          <div className="career-section-stack">
            {data.calendar.driveTimeline.map((item) => (
              <div key={item.id} className="career-list-row">
                <div>
                  <strong>{item.title}</strong>
                  <p className="muted-text">
                    {new Date(item.startsAt).toLocaleString()} | shortlisted {item.shortlisted} | selected {item.selected}
                  </p>
                </div>
                <Badge>{item.status}</Badge>
              </div>
            ))}
            {data.calendar.events.map((item) => (
              <div key={item.id} className="career-list-row">
                <div>
                  <strong>{item.title}</strong>
                  <p className="muted-text">
                    {new Date(item.starts_at).toLocaleString()} | {item.audience} | {item.reminder_offset_hours}h prior
                  </p>
                </div>
                <Badge variant="warning">{item.reminder_status}</Badge>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <h2>Admin Revenue Features</h2>
          <div className="form-grid">
            <label>
              Plan Name
              <Input value={billingForm.planName} onChange={(event) => setBillingForm((current) => ({ ...current, planName: event.target.value }))} />
            </label>
            <label>
              Billing Cycle
              <select
                className="ui-select"
                value={billingForm.billingCycle}
                onChange={(event) => setBillingForm((current) => ({
                  ...current,
                  billingCycle: event.target.value as "monthly" | "quarterly" | "annual",
                }))}
              >
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annual">Annual</option>
              </select>
            </label>
            <label>
              Student Limit
              <Input type="number" value={billingForm.studentLimit} onChange={(event) => setBillingForm((current) => ({ ...current, studentLimit: event.target.value }))} />
            </label>
            <label>
              AI Quota
              <Input type="number" value={billingForm.aiQuota} onChange={(event) => setBillingForm((current) => ({ ...current, aiQuota: event.target.value }))} />
            </label>
            <label>
              Message Quota
              <Input type="number" value={billingForm.messageQuota} onChange={(event) => setBillingForm((current) => ({ ...current, messageQuota: event.target.value }))} />
            </label>
            <label>
              Monthly Price
              <Input type="number" value={billingForm.monthlyPrice} onChange={(event) => setBillingForm((current) => ({ ...current, monthlyPrice: event.target.value }))} />
            </label>
            <label>
              Renewal Date
              <Input type="date" value={billingForm.renewalDate} onChange={(event) => setBillingForm((current) => ({ ...current, renewalDate: event.target.value }))} />
            </label>
            <Button
              onClick={() => runAction("billing", async () => {
                await updateBillingPlan({
                  planName: billingForm.planName,
                  billingCycle: billingForm.billingCycle,
                  studentLimit: Number(billingForm.studentLimit),
                  aiQuota: Number(billingForm.aiQuota),
                  messageQuota: Number(billingForm.messageQuota),
                  monthlyPrice: Number(billingForm.monthlyPrice),
                  renewalDate: billingForm.renewalDate,
                });
              })}
              disabled={busy === "billing"}
            >
              {busy === "billing" ? "Updating..." : "Update Billing Plan"}
            </Button>
          </div>
          <div className="career-section-stack">
            <div className="career-list-row">
              <div>
                <strong>{data.revenue.plan_name}</strong>
                <p className="muted-text">
                  {data.revenue.billing_cycle} | renews {data.revenue.renewal_date}
                </p>
              </div>
              <Badge variant="success">{data.revenue.status}</Badge>
            </div>
            <ul className="tpo-list">
              <li>Students used: {data.revenue.usage.students} / {data.revenue.student_limit}</li>
              <li>AI usage: {data.revenue.usage.ai} / {data.revenue.ai_quota}</li>
              <li>Messages used: {data.revenue.usage.messages} / {data.revenue.message_quota}</li>
              <li>Price: Rs. {data.revenue.monthly_price}</li>
            </ul>
          </div>
        </Card>
      </div>

      {status ? <p className="muted-text">{status}</p> : null}
    </section>
  );
}
