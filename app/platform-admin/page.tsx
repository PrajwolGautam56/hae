"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Tenant = {
  id: string;
  slug: string;
  name: string;
  primary_domain: string;
  status: string;
  active: boolean;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
  notes: string | null;
  onboarding_stage: string;
  created_at: string;
};
type Company = {
  id: string;
  tenant_id: string;
  app_company_id: string | null;
  slug: string;
  name: string;
  legal_name: string | null;
  connection_key: string | null;
  status: string;
  login_enabled: boolean;
  database_status: string;
  portal_enabled: boolean;
  notes: string | null;
};
type CompanyUser = {
  id: string;
  company_id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  active: boolean;
  auth_user_id: string | null;
  created_at: string;
};
type Subscription = {
  tenant_id: string;
  plan_name: string;
  status: string;
  starts_on: string | null;
  expires_on: string | null;
  company_limit: number;
  user_limit: number;
  monthly_amount: number;
  notes: string | null;
};
type Administrator = {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  last_login_at: string | null;
};
type Audit = {
  id: number;
  admin_email: string | null;
  action: string;
  entity_type: string;
  summary: string;
  created_at: string;
};
type Entitlement = {
  tenant_id: string;
  feature_key: string;
  enabled: boolean;
  limits?: Record<string, unknown>;
};
type Payload = {
  viewer: { id: string; name: string; email: string; role: string };
  tenants: Tenant[];
  companies: Company[];
  subscriptions: Subscription[];
  administrators: Administrator[];
  audits: Audit[];
  entitlements: Entitlement[];
  companyUsers: CompanyUser[];
  unifiedReady: boolean;
  unifiedError?: string;
  entitlementMigrationRequired?: boolean;
  registryMigrationRequired?: boolean;
  registryMigrationError?: string;
  rootDomain: string;
};
type Modal = {
  type: "tenant" | "company" | "companyUser" | "subscription" | "admin";
  tenant?: Tenant;
  company?: Company;
} | null;

const nav = [
  ["overview", "Overview", "⌂"],
  ["clients", "Clients", "◇"],
  ["companies", "Companies", "▦"],
  ["team", "Platform team", "◎"],
  ["activity", "Audit log", "≋"],
] as const;

const featureOptions = [
  ["accounting", "Accounting & ledger"], ["sales", "Sales invoices"],
  ["purchases", "Purchases"], ["inventory", "Inventory & stock"],
  ["manufacturing", "Manufacturing"], ["crm", "Lead management"],
  ["tasks", "Tasks & follow-ups"], ["orders", "Customer orders"],
  ["customer_portal", "Customer portal"], ["cash_bank", "Cash & bank"],
  ["cheques", "Cheque management"], ["reports", "Reports & exports"],
] as const;

function Field({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={wide ? "wide" : ""}>
      <span>{label}</span>
      {children}
    </label>
  );
}
function Status({ value }: { value: string }) {
  return (
    <span className={`pc-status ${value}`}>{value.replaceAll("_", " ")}</span>
  );
}
function initials(value: string) {
  return value
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
function formatted(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("en-NP", { dateStyle: "medium" }).format(
        new Date(value),
      )
    : "—";
}

export default function PlatformAdminPage() {
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [tab, setTab] = useState<(typeof nav)[number][0]>("overview");
  const [modal, setModal] = useState<Modal>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [renewalCutoff] = useState(() => Date.now() + 30 * 86400000);
  const load = useCallback(async () => {
    setError("");
    const response = await fetch("/api/platform/admin", { cache: "no-store" });
    const body = await response.json();
    if (response.status === 401) {
      router.replace("/platform-admin/login");
      return;
    }
    if (!response.ok) {
      setError(body.error || "Control data could not be loaded");
      return;
    }
    setData(body);
  }, [router]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  async function action(payload: Record<string, unknown>) {
    setBusy(true);
    setError("");
    setNotice("");
    const response = await fetch("/api/platform/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(body.error || "Action failed");
      return false;
    }
    setNotice("Saved successfully");
    setModal(null);
    await load();
    return true;
  }
  async function logout() {
    await fetch("/api/platform/auth/logout", { method: "POST" });
    router.replace("/platform-admin/login");
    router.refresh();
  }
  const query = search.trim().toLowerCase();
  const tenants = useMemo(
    () =>
      data?.tenants.filter(
        (item) =>
          !query ||
          `${item.name} ${item.slug} ${item.primary_domain} ${item.contact_email || ""}`
            .toLowerCase()
            .includes(query),
      ) || [],
    [data, query],
  );
  const companies = useMemo(
    () =>
      data?.companies.filter(
        (item) =>
          !query ||
          `${item.name} ${item.slug}`
            .toLowerCase()
            .includes(query),
      ) || [],
    [data, query],
  );
  if (!data)
    return (
      <main className="pc-loading">
        <div>
          <span>K</span>
          <strong>Loading Kritech Control…</strong>
          {error && <p>{error}</p>}
        </div>
      </main>
    );
  const canEdit =
    data.viewer.role === "super_admin" || data.viewer.role === "operator";
  const activeClients = data.tenants.filter(
    (item) => item.status === "active",
  ).length;
  const readyCompanies = data.companies.filter(
    (item) => item.database_status === "ready",
  ).length;
  const pending = data.companies.filter(
    (item) => item.database_status !== "ready",
  ).length;
  const expiring = data.subscriptions.filter(
    (item) =>
      item.expires_on && new Date(item.expires_on).getTime() < renewalCutoff,
  ).length;

  return (
    <main className="pc-shell">
      <aside className="pc-sidebar">
        <div className="pc-logo">
          <span>K</span>
          <div>
            <strong>Kritech Control</strong>
            <small>PLATFORM OPERATIONS</small>
          </div>
        </div>
        <nav>
          {nav.map(([key, label, icon]) => (
            <button
              key={key}
              className={tab === key ? "active" : ""}
              onClick={() => setTab(key)}
            >
              <i>{icon}</i>
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="pc-profile">
          <div>{initials(data.viewer.name)}</div>
          <span>
            <strong>{data.viewer.name}</strong>
            <small>{data.viewer.role.replace("_", " ")}</small>
          </span>
          <button title="Sign out" onClick={logout}>
            ↗
          </button>
        </div>
      </aside>
      <section className="pc-main">
        <header className="pc-topbar">
          <button
            className="pc-mobile-brand"
            onClick={() => setTab("overview")}
          >
            <b>K</b> Control
          </button>
          <div>
            <small>CONTROL PLANE</small>
            <strong>{nav.find((item) => item[0] === tab)?.[1]}</strong>
          </div>
          <div className="pc-top-actions">
            <span className="pc-live">
              <i />
              Systems online
            </span>
            {canEdit && (
              <button
                className="pc-button primary"
                onClick={() => setModal({ type: "tenant" })}
              >
                ＋ New client
              </button>
            )}
          </div>
        </header>
        <div className="pc-content">
          {error && (
            <div className="pc-alert error">
              {error}
              <button onClick={() => setError("")}>×</button>
            </div>
          )}
          {notice && (
            <div className="pc-alert success">
              {notice}
              <button onClick={() => setNotice("")}>×</button>
            </div>
          )}
          {!data.unifiedReady && (
            <div className="pc-alert error">
              Shared company database is not ready: {data.unifiedError || "configure the UNIFIED_SUPABASE server variables"}. Company and user provisioning is paused.
            </div>
          )}
          {data.registryMigrationRequired && (
            <div className="pc-alert error pc-migration-alert">
              <strong>One-time Control setup required</strong>
              <span>Apply <code>202608270001_unified_entitlements.sql</code> to the Control Supabase project. Until then company provisioning, module access and activation cannot finish.</span>
              {data.registryMigrationError && <small>{data.registryMigrationError}</small>}
            </div>
          )}
          {tab === "overview" && (
            <>
              <section className="pc-welcome">
                <div>
                  <span>KRITECH PLATFORM</span>
                  <h1>Good to see you, {data.viewer.name.split(" ")[0]}.</h1>
                  <p>
                    Onboard clients, provision isolated companies, invite their
                    first administrators and control subscriptions from one place.
                  </p>
                </div>
                {canEdit && (
                  <button
                    className="pc-button light"
                    onClick={() => setModal({ type: "tenant" })}
                  >
                    Onboard a client →
                  </button>
                )}
              </section>
              <section className="pc-kpis">
                <article>
                  <span>Active clients</span>
                  <strong>{activeClients}</strong>
                  <small>{data.tenants.length} total workspaces</small>
                </article>
                <article>
                  <span>Ready companies</span>
                  <strong>{readyCompanies}</strong>
                  <small>{data.companies.length} tenant-isolated workspaces</small>
                </article>
                <article>
                  <span>Setup queue</span>
                  <strong>{pending}</strong>
                  <small>Needs provisioning, admin or domain</small>
                </article>
                <article>
                  <span>Renewal attention</span>
                  <strong>{expiring}</strong>
                  <small>Within 30 days</small>
                </article>
              </section>
              <div className="pc-grid">
                <section className="pc-panel">
                  <div className="pc-panel-head">
                    <div>
                      <small>CLIENT HEALTH</small>
                      <h2>Workspace readiness</h2>
                    </div>
                    <button onClick={() => setTab("clients")}>
                      View clients →
                    </button>
                  </div>
                  <div className="pc-health-list">
                    {data.tenants.slice(0, 6).map((tenant) => {
                      const owned = data.companies.filter(
                        (company) => company.tenant_id === tenant.id,
                      );
                      const ready = owned.filter(
                        (company) => company.database_status === "ready",
                      ).length;
                      return (
                        <button
                          key={tenant.id}
                          onClick={() =>
                            canEdit
                              ? setModal({ type: "tenant", tenant })
                              : setTab("clients")
                          }
                        >
                          <span className="pc-avatar">
                            {initials(tenant.name)}
                          </span>
                          <span>
                            <strong>{tenant.name}</strong>
                            <small>{tenant.primary_domain}</small>
                          </span>
                          <em>
                            {ready}/{owned.length} provisioned
                          </em>
                          <Status value={tenant.status} />
                        </button>
                      );
                    })}
                    {!data.tenants.length && (
                      <p className="pc-empty">No client workspaces yet.</p>
                    )}
                  </div>
                </section>
                <section className="pc-panel">
                  <div className="pc-panel-head">
                    <div>
                      <small>RECENT ACTIVITY</small>
                      <h2>Audit trail</h2>
                    </div>
                    <button onClick={() => setTab("activity")}>
                      Full log →
                    </button>
                  </div>
                  <div className="pc-activity-list">
                    {data.audits.slice(0, 6).map((log) => (
                      <div key={log.id}>
                        <i>✓</i>
                        <span>
                          <strong>{log.summary}</strong>
                          <small>
                            {log.admin_email || "System"} ·{" "}
                            {formatted(log.created_at)}
                          </small>
                        </span>
                      </div>
                    ))}
                    {!data.audits.length && (
                      <p className="pc-empty">Actions will appear here.</p>
                    )}
                  </div>
                </section>
              </div>
            </>
          )}

          {tab === "clients" && (
            <section className="pc-panel pc-register">
              <div className="pc-panel-head">
                <div>
                  <small>TENANT REGISTRY</small>
                  <h2>Clients and workspaces</h2>
                  <p>
                    Each client receives a dedicated subdomain and one or more
                    isolated companies.
                  </p>
                </div>
                {canEdit && (
                  <button
                    className="pc-button primary"
                    onClick={() => setModal({ type: "tenant" })}
                  >
                    ＋ Add client
                  </button>
                )}
              </div>
              <div className="pc-tools">
                <div>
                  ⌕
                  <input
                    placeholder="Search client or domain"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>
                <span>{tenants.length} clients</span>
              </div>
              <div className="pc-client-grid">
                {tenants.map((tenant) => {
                  const sub = data.subscriptions.find(
                    (item) => item.tenant_id === tenant.id,
                  );
                  const owned = data.companies.filter(
                    (company) => company.tenant_id === tenant.id,
                  );
                  return (
                    <article key={tenant.id}>
                      <div className="pc-client-title">
                        <span className="pc-avatar">
                          {initials(tenant.name)}
                        </span>
                        <div>
                          <h3>{tenant.name}</h3>
                          <a
                            href={`https://${tenant.primary_domain}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {tenant.primary_domain} ↗
                          </a>
                        </div>
                        <Status value={tenant.status} />
                      </div>
                      <div className="pc-client-meta">
                        <span>
                          <small>Companies</small>
                          <strong>
                            {owned.length} / {sub?.company_limit || 1}
                          </strong>
                        </span>
                        <span>
                          <small>Plan</small>
                          <strong>{sub?.plan_name || "Starter"}</strong>
                        </span>
                        <span>
                          <small>Onboarding</small>
                          <strong>{tenant.onboarding_stage}</strong>
                        </span>
                        <span>
                          <small>Expires</small>
                          <strong>{formatted(sub?.expires_on || null)}</strong>
                        </span>
                      </div>
                      <div className="pc-client-contact">
                        <strong>
                          {tenant.contact_name || "No contact assigned"}
                        </strong>
                        <span>
                          {tenant.contact_email ||
                            tenant.contact_phone ||
                            "Contact information pending"}
                        </span>
                      </div>
                      {canEdit && <div className="pc-card-actions">
                        <button
                          onClick={() => setModal({ type: "tenant", tenant })}
                        >
                          Edit client
                        </button>
                        <button
                          onClick={() => setModal({ type: "company", tenant })}
                        >
                          Add company
                        </button>
                        <button
                          onClick={() =>
                            setModal({ type: "subscription", tenant })
                          }
                        >
                          Subscription
                        </button>
                      </div>}
                    </article>
                  );
                })}
              </div>
            </section>
          )}

          {tab === "companies" && (
            <section className="pc-panel pc-register">
              <div className="pc-panel-head">
                <div>
                  <small>DATABASE REGISTRY</small>
                  <h2>Company onboarding</h2>
                  <p>
                    Provision a tenant-isolated workspace, add the first company
                    administrator, then activate staff login.
                  </p>
                </div>
              </div>
              <div className="pc-tools">
                <div>
                  ⌕
                  <input
                    placeholder="Search company or client"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>
                <span>{companies.length} companies</span>
              </div>
              <div className="pc-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Company</th>
                      <th>Client</th>
                      <th>Data workspace</th>
                      <th>Company users</th>
                      <th>Staff login</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {companies.map((company) => {
                      const tenant = data.tenants.find(
                        (item) => item.id === company.tenant_id,
                      );
                      const companyUsers = data.companyUsers.filter((user) => user.company_id === company.app_company_id && user.active);
                      const hasAdmin = companyUsers.some((user) => user.role === "admin");
                      const setupStep = !company.app_company_id ? 1 : !hasAdmin ? 2 : !company.login_enabled ? 3 : 4;
                      return (
                        <tr key={company.id}>
                          <td>
                            <strong>{company.name}</strong>
                            <small>{company.slug}</small>
                          </td>
                          <td>{tenant?.name || "—"}</td>
                          <td>
                            {company.app_company_id ? <><Status value="ready" /><small>Shared DB · company isolated</small></> : <><Status value="pending" /><small>Provisioning required</small></>}
                          </td>
                          <td>
                            <strong>{companyUsers.length}</strong>
                            <small>active seats</small>
                          </td>
                          <td>
                            <span
                              className={`pc-toggle-read ${company.login_enabled ? "on" : ""}`}
                            >
                              {company.login_enabled ? "Enabled" : "Disabled"}
                            </span>
                          </td>
                          <td>
                            {setupStep === 4 ? <Status value="ready" /> : <span className="pc-setup-step">Setup {setupStep}/3</span>}
                          </td>
                          <td>
                          {canEdit && (
                            <div className="pc-row-actions">
                              {setupStep === 1 && <button disabled={busy || !data.unifiedReady || data.registryMigrationRequired} onClick={() => action({ action: "provisionCompany", companyId: company.id })}>1 · Provision workspace</button>}
                              {setupStep === 2 && <button onClick={() => setModal({ type: "companyUser", tenant, company })}>2 · Add first admin</button>}
                              {setupStep === 3 && <button disabled={busy} onClick={() => action({ action: "activateCompany", companyId: company.id })}>3 · Activate login</button>}
                              {setupStep === 4 && <button onClick={() => setModal({ type: "companyUser", tenant, company })}>Manage users</button>}
                              <button onClick={() => setModal({ type: "company", tenant, company })}>Manage</button>
                            </div>
                          )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {tab === "team" && (
            <section className="pc-panel pc-register">
              <div className="pc-panel-head">
                <div>
                  <small>SECURITY</small>
                  <h2>Platform administrators</h2>
                  <p>
                    These users manage Kritech infrastructure, not individual
                    company accounting.
                  </p>
                </div>
                {data.viewer.role === "super_admin" && (
                  <button
                    className="pc-button primary"
                    onClick={() => setModal({ type: "admin" })}
                  >
                    ＋ Add administrator
                  </button>
                )}
              </div>
              <div className="pc-team-list">
                {data.administrators.map((person) => (
                  <div key={person.id}>
                    <span className="pc-avatar">{initials(person.name)}</span>
                    <span>
                      <strong>{person.name}</strong>
                      <small>
                        {person.email} · Last login{" "}
                        {formatted(person.last_login_at)}
                      </small>
                    </span>
                    <select
                      value={person.role}
                      disabled={
                        data.viewer.role !== "super_admin" ||
                        person.id === data.viewer.id
                      }
                      onChange={(event) =>
                        action({
                          action: "adminStatus",
                          adminId: person.id,
                          active: person.active,
                          role: event.target.value,
                        })
                      }
                    >
                      <option value="super_admin">Super admin</option>
                      <option value="operator">Operator</option>
                      <option value="support">Support</option>
                      <option value="viewer">Viewer</option>
                    </select>
                    <button
                      className={person.active ? "danger" : ""}
                      disabled={
                        data.viewer.role !== "super_admin" ||
                        person.id === data.viewer.id
                      }
                      onClick={() =>
                        action({
                          action: "adminStatus",
                          adminId: person.id,
                          active: !person.active,
                          role: person.role,
                        })
                      }
                    >
                      {person.active ? "Deactivate" : "Activate"}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {tab === "activity" && (
            <section className="pc-panel pc-register">
              <div className="pc-panel-head">
                <div>
                  <small>SECURITY HISTORY</small>
                  <h2>Platform audit log</h2>
                  <p>
                    Administrative changes are recorded with actor, time and
                    affected entity.
                  </p>
                </div>
              </div>
              <div className="pc-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Administrator</th>
                      <th>Action</th>
                      <th>Entity</th>
                      <th>Summary</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.audits.map((log) => (
                      <tr key={log.id}>
                        <td>{formatted(log.created_at)}</td>
                        <td>{log.admin_email || "System"}</td>
                        <td>
                          <code>{log.action}</code>
                        </td>
                        <td>{log.entity_type}</td>
                        <td>{log.summary}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      </section>
      <nav className="pc-mobile-nav">
        {nav.slice(0, 5).map(([key, label, icon]) => (
          <button
            key={key}
            className={tab === key ? "active" : ""}
            onClick={() => setTab(key)}
          >
            <i>{icon}</i>
            <span>{label.replace("Platform ", "")}</span>
          </button>
        ))}
      </nav>
      {modal && (
        <Editor
          modal={modal}
          data={data}
          busy={busy}
          close={() => setModal(null)}
          submit={action}
        />
      )}
    </main>
  );
}

function Editor({
  modal,
  data,
  busy,
  close,
  submit,
}: {
  modal: Exclude<Modal, null>;
  data: Payload;
  busy: boolean;
  close: () => void;
  submit: (payload: Record<string, unknown>) => Promise<boolean>;
}) {
  const tenant = modal.tenant;
  const company = modal.company;
  const subscription = data.subscriptions.find(
    (item) => item.tenant_id === tenant?.id,
  );
  function values(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    return Object.fromEntries(new FormData(event.currentTarget).entries());
  }
  if (modal.type === "tenant")
    return (
      <div
        className="pc-modal-bg"
        onMouseDown={(event) => event.target === event.currentTarget && close()}
      >
        <form
          className="pc-modal"
          onSubmit={(event) => {
            const form = values(event);
            void submit({
              action: tenant ? "updateTenant" : "createTenant",
              tenantId: tenant?.id,
              ...form,
            });
          }}
        >
          <ModalHead
            title={tenant ? "Edit client workspace" : "Onboard new client"}
            subtitle="Tenant, domain and primary contact"
            close={close}
          />
          <div className="pc-form">
            <Field label="Client / group name">
              <input name="name" required defaultValue={tenant?.name} />
            </Field>
            <Field label="Subdomain slug">
              <input
                name="slug"
                required
                disabled={Boolean(tenant)}
                defaultValue={tenant?.slug}
                placeholder="ecsc"
              />
            </Field>
            <Field label="Primary domain">
              <input
                name="primaryDomain"
                required={Boolean(tenant)}
                defaultValue={tenant?.primary_domain}
                placeholder={`client.${data.rootDomain}`}
              />
            </Field>
            <Field label="Contact person">
              <input
                name="contactName"
                defaultValue={tenant?.contact_name || ""}
              />
            </Field>
            <Field label="Contact email">
              <input
                name="contactEmail"
                type="email"
                defaultValue={tenant?.contact_email || ""}
              />
            </Field>
            <Field label="Contact phone">
              <input
                name="contactPhone"
                defaultValue={tenant?.contact_phone || ""}
              />
            </Field>
            {tenant && (
              <>
                <Field label="Workspace status">
                  <select name="status" defaultValue={tenant.status}>
                    <option value="pending">Pending</option>
                    <option value="active">Active</option>
                    <option value="suspended">Suspended</option>
                    <option value="expired">Expired</option>
                  </select>
                </Field>
                <Field label="Onboarding stage">
                  <select
                    name="onboardingStage"
                    defaultValue={tenant.onboarding_stage}
                  >
                    <option value="new">New</option>
                    <option value="database">Database</option>
                    <option value="admin">First admin</option>
                    <option value="domain">Domain</option>
                    <option value="ready">Ready</option>
                  </select>
                </Field>
              </>
            )}
            <Field label="Address" wide>
              <input name="address" defaultValue={tenant?.address || ""} />
            </Field>
            <Field label="Internal notes" wide>
              <textarea name="notes" defaultValue={tenant?.notes || ""} />
            </Field>
          </div>
          <ModalActions
            busy={busy}
            close={close}
            label={tenant ? "Save client" : "Create client"}
          />
        </form>
      </div>
    );
  if (modal.type === "company")
    return (
      <div
        className="pc-modal-bg"
        onMouseDown={(event) => event.target === event.currentTarget && close()}
      >
        <form
          className="pc-modal"
          onSubmit={(event) => {
            const form = values(event);
            void submit({
              action: company ? "updateCompany" : "createCompany",
              companyId: company?.id,
              tenantId: tenant?.id,
              ...form,
              loginEnabled:
                new FormData(event.currentTarget).get("loginEnabled") === "on",
              portalEnabled:
                new FormData(event.currentTarget).get("portalEnabled") === "on",
            });
          }}
        >
          <ModalHead
            title={company ? "Manage company" : "Add company"}
            subtitle={tenant?.name || "Dedicated company environment"}
            close={close}
          />
          <div className="pc-form">
            <Field label="Company name">
              <input name="name" required defaultValue={company?.name} />
            </Field>
            <Field label="Registry slug">
              <input
                name="slug"
                required
                disabled={Boolean(company)}
                defaultValue={company?.slug}
                placeholder="company-name"
              />
            </Field>
            <Field label="Legal name">
              <input
                name="legalName"
                defaultValue={company?.legal_name || ""}
              />
            </Field>
            {company && (
              <>
                <div className="pc-workspace-summary wide">
                  <span className={company.app_company_id ? "ready" : "pending"}>{company.app_company_id ? "✓" : "!"}</span>
                  <div><strong>{company.app_company_id ? "Tenant-isolated workspace provisioned" : "Workspace provisioning required"}</strong><small>{company.app_company_id ? "This company uses the shared Supabase database with company-level isolation." : "Provision the workspace from the Companies screen before adding users."}</small></div>
                </div>
                <Field label="Company status">
                  <select name="status" defaultValue={company.status}>
                    <option value="pending">Pending</option>
                    <option value="active">Active</option>
                    <option value="disabled">Disabled</option>
                  </select>
                </Field>
                <Field label="Staff login">
                  <span className="pc-check">
                    <input
                      name="loginEnabled"
                      type="checkbox"
                      disabled={!company.app_company_id || !data.companyUsers.some((user) => user.company_id === company.app_company_id && user.role === "admin" && user.active)}
                      defaultChecked={company.login_enabled}
                    />{" "}
                    Enable after first company admin is active
                  </span>
                </Field>
                <Field label="Customer portal">
                  <span className="pc-check">
                    <input
                      name="portalEnabled"
                      type="checkbox"
                      defaultChecked={company.portal_enabled}
                    />{" "}
                    Enable portal workflow
                  </span>
                </Field>
              </>
            )}
            <Field label="Internal notes" wide>
              <textarea name="notes" defaultValue={company?.notes || ""} />
            </Field>
          </div>
          <ModalActions
            busy={busy}
            close={close}
            label={company ? "Save company" : "Add company"}
          />
        </form>
      </div>
    );
  if (modal.type === "companyUser") {
    const users = data.companyUsers.filter((user) => user.company_id === company?.app_company_id);
    const tenantCompanyIds = data.companies.filter((item) => item.tenant_id === tenant?.id).map((item) => item.app_company_id).filter(Boolean);
    const usedSeats = data.companyUsers.filter((user) => user.active && tenantCompanyIds.includes(user.company_id)).length;
    const firstUser = users.length === 0;
    return (
      <div className="pc-modal-bg" onMouseDown={(event) => event.target === event.currentTarget && close()}>
        <form className="pc-modal" onSubmit={(event) => {
          const form = values(event);
          void submit({ action: "createCompanyUser", companyId: company?.id, ...form });
        }}>
          <ModalHead title={firstUser ? "Add first company administrator" : "Company users"} subtitle={`${company?.name || "Company"} · ${usedSeats}/${subscription?.user_limit || 10} tenant seats used`} close={close} />
          <div className="pc-company-user-body">
            <section className="pc-existing-users">
              <div className="pc-section-copy"><strong>Existing access</strong><small>Roles and access are scoped only to this company.</small></div>
              {users.map((user) => <div key={user.id} className="pc-company-user-row">
                <span className="pc-avatar">{initials(user.name)}</span>
                <span><strong>{user.name}</strong><small>{user.email}</small></span>
                <select value={user.role} disabled={busy} onChange={(event) => void submit({ action: "companyUserStatus", companyId: company?.id, memberId: user.id, role: event.target.value, active: user.active })}>
                  <option value="admin">Admin</option><option value="manager">Manager</option><option value="accountant">Accountant</option><option value="staff">Staff</option>
                </select>
                <button type="button" className={user.active ? "danger" : ""} disabled={busy} onClick={() => void submit({ action: "companyUserStatus", companyId: company?.id, memberId: user.id, role: user.role, active: !user.active })}>{user.active ? "Deactivate" : "Activate"}</button>
              </div>)}
              {!users.length && <p className="pc-empty">No company user exists yet. Create the first administrator below.</p>}
            </section>
            <section className="pc-user-create">
              <div className="pc-section-copy"><strong>{firstUser ? "First administrator" : "Add another user"}</strong><small>A one-time password setup link will be emailed to the user.</small></div>
              <div className="pc-form">
                <Field label="Full name"><input name="name" required /></Field>
                <Field label="Email address"><input name="email" type="email" required /></Field>
                <Field label="Phone (optional)"><input name="phone" /></Field>
                <Field label="Company role"><select name="role" defaultValue={firstUser ? "admin" : "staff"}><option value="admin">Administrator</option><option value="manager">Manager</option><option value="accountant">Accountant</option><option value="staff">Staff</option></select></Field>
              </div>
            </section>
          </div>
          <ModalActions busy={busy} close={close} label={firstUser ? "Create admin & send invite" : "Add user & send invite"} />
        </form>
      </div>
    );
  }
  if (modal.type === "subscription")
    return (
      <div className="pc-modal-bg">
        <form
          className="pc-modal"
          onSubmit={(event) => {
            const form = values(event);
            const formData = new FormData(event.currentTarget);
            void submit({
              action: "updateSubscription",
              tenantId: tenant?.id,
              ...form,
              features: Object.fromEntries(featureOptions.map(([key]) => [key, formData.get(`feature_${key}`) === "on"])),
            });
          }}
        >
          <ModalHead
            title="Subscription and limits"
            subtitle={tenant?.name || ""}
            close={close}
          />
          <div className="pc-form">
            <Field label="Plan name">
              <input
                name="planName"
                required
                defaultValue={subscription?.plan_name || "Starter"}
              />
            </Field>
            <Field label="Subscription status">
              <select
                name="status"
                defaultValue={subscription?.status || "trial"}
              >
                <option value="trial">Trial</option>
                <option value="active">Active</option>
                <option value="past_due">Past due</option>
                <option value="cancelled">Cancelled</option>
                <option value="expired">Expired</option>
              </select>
            </Field>
            <Field label="Starts on">
              <input
                name="startsOn"
                type="date"
                defaultValue={subscription?.starts_on || ""}
              />
            </Field>
            <Field label="Expires on">
              <input
                name="expiresOn"
                type="date"
                defaultValue={subscription?.expires_on || ""}
              />
            </Field>
            <Field label="Company limit">
              <input
                name="companyLimit"
                type="number"
                min="1"
                defaultValue={subscription?.company_limit || 1}
              />
            </Field>
            <Field label="User limit">
              <input
                name="userLimit"
                type="number"
                min="1"
                defaultValue={subscription?.user_limit || 10}
              />
            </Field>
            <Field label="Monthly amount (Rs.)">
              <input
                name="monthlyAmount"
                type="number"
                min="0"
                step="0.01"
                defaultValue={subscription?.monthly_amount || 0}
              />
            </Field>
            <Field label="Notes" wide>
              <textarea name="notes" defaultValue={subscription?.notes || ""} />
            </Field>
            <div className="wide">
              <span className="pc-field-label">Enabled modules</span>
              <div className="pc-feature-grid">
                {featureOptions.map(([key, label]) => (
                  <label className="pc-check" key={key}>
                    <input
                      name={`feature_${key}`}
                      type="checkbox"
                      defaultChecked={data.entitlements.some((item) => item.tenant_id === tenant?.id && item.feature_key === key && item.enabled)}
                    />
                    {label}
                  </label>
                ))}
              </div>
              {data.entitlementMigrationRequired && <small>Apply the Control entitlement migration before saving module access.</small>}
            </div>
          </div>
          <ModalActions busy={busy} close={close} label="Save subscription" />
        </form>
      </div>
    );
  return (
    <div className="pc-modal-bg">
      <form
        className="pc-modal small"
        onSubmit={(event) => {
          const form = values(event);
          void submit({ action: "createAdmin", ...form });
        }}
      >
        <ModalHead
          title="Add platform administrator"
          subtitle="A secure setup link will be emailed"
          close={close}
        />
        <div className="pc-form">
          <Field label="Full name" wide>
            <input name="name" required />
          </Field>
          <Field label="Email address" wide>
            <input name="email" type="email" required />
          </Field>
          <Field label="Platform role" wide>
            <select name="role" defaultValue="operator">
              <option value="super_admin">Super admin</option>
              <option value="operator">Operator</option>
              <option value="support">Support</option>
              <option value="viewer">Viewer</option>
            </select>
          </Field>
        </div>
        <ModalActions busy={busy} close={close} label="Send invitation" />
      </form>
    </div>
  );
}
function ModalHead({
  title,
  subtitle,
  close,
}: {
  title: string;
  subtitle: string;
  close: () => void;
}) {
  return (
    <div className="pc-modal-head">
      <div>
        <small>KRITECH CONTROL</small>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      <button type="button" onClick={close}>
        ×
      </button>
    </div>
  );
}
function ModalActions({
  busy,
  close,
  label,
}: {
  busy: boolean;
  close: () => void;
  label: string;
}) {
  return (
    <div className="pc-modal-actions">
      <button type="button" onClick={close}>
        Cancel
      </button>
      <button className="pc-button primary" disabled={busy}>
        {busy ? "Saving…" : label}
      </button>
    </div>
  );
}
