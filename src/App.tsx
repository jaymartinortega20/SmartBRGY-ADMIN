import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Bell,
  BellRing,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock,
  FileText,
  Gauge,
  Info as InfoIcon,
  LogOut,
  Megaphone,
  Menu,
  MessageSquareWarning,
  MessagesSquare,
  RefreshCw,
  Search,
  ShieldCheck,
  Siren,
  Trash2,
  UserPlus,
  UserRound,
  UserX,
  Users,
  X,
} from "lucide-react";
import { supabase } from "./lib/supabase";

type Row = Record<string, any>;
type Section =
  | "overview"
  | "residents"
  | "documents"
  | "fees"
  | "reports"
  | "concerns"
  | "announcements";
type Toast = { id: number; message: string; tone: "success" | "error" | "info" };
type AttentionItem = {
  key: string;
  section: Section;
  icon: typeof Bell;
  tone: "amber" | "red" | "blue" | "green";
  count: number;
  title: [string, string];
  detail: string;
};
const itemTitle = (item: AttentionItem) =>
  item.count === 1 ? item.title[0] : item.title[1];

// ---------------------------------------------------------------------------
// Plain-language labels. Shown everywhere instead of database values.
// ---------------------------------------------------------------------------
const STATUS_LABELS: Record<string, string> = {
  pending: "New",
  open: "New",
  processing: "Processing",
  ready_to_claim: "Ready to claim",
  claimed: "Claimed",
  rejected: "Rejected",
  under_review: "Under review",
  ongoing: "In progress",
  scheduled: "Meeting scheduled",
  for_scheduling: "Needs a schedule",
  resolved: "Resolved",
  waiting_for_resident: "Waiting for resident",
  closed: "Closed",
  assigned: "Assigned",
  normal: "Normal",
  important: "Important",
  emergency: "Emergency",
  active: "Active",
  banned: "Banned",
};
const statusLabel = (value?: string) =>
  STATUS_LABELS[String(value || "")] ||
  String(value || "—").replaceAll("_", " ");

type StatusOption = {
  value: string;
  label: string;
  tone?: "success" | "danger";
  confirm?: string;
  extra?: () => Row;
  askReason?: string;
};

const DOCUMENT_STATUSES: StatusOption[] = [
  { value: "processing", label: "Processing" },
  {
    value: "ready_to_claim",
    label: "Ready to claim",
    tone: "success",
    extra: () => ({ claim_schedule: new Date().toISOString() }),
  },
  { value: "claimed", label: "Claimed", tone: "success" },
  {
    value: "rejected",
    label: "Reject",
    tone: "danger",
    askReason:
      "Why is this request rejected? The resident will see this reason.\n(Example: Your address does not match your valid ID.)",
  },
];
const INCIDENT_STATUSES: StatusOption[] = [
  { value: "under_review", label: "Under review" },
  { value: "ongoing", label: "In progress" },
  {
    value: "resolved",
    label: "Resolved",
    tone: "success",
    confirm: "Mark this incident report as resolved?",
  },
  {
    value: "rejected",
    label: "Reject",
    tone: "danger",
    askReason:
      "Why is this report rejected? The resident will see this reason.\n(Example: Outside Barangay Tubod. Please report to the police.)",
  },
];
const CONCERN_STATUSES: StatusOption[] = [
  { value: "under_review", label: "Under review" },
  { value: "ongoing", label: "In progress" },
  { value: "waiting_for_resident", label: "Waiting for resident" },
  {
    value: "resolved",
    label: "Resolved",
    tone: "success",
    confirm:
      "Mark this concern as resolved? The resident is notified and can still reply if the problem is not fixed.",
  },
  {
    value: "closed",
    label: "Close",
    confirm: "Close this conversation? The resident can no longer reply.",
  },
];

const navItems: {
  key: Section;
  label: string;
  icon: typeof Gauge;
  help: string;
}[] = [
  {
    key: "overview",
    label: "Dashboard",
    icon: Gauge,
    help: "Start here. Items that need your action are listed first.",
  },
  {
    key: "residents",
    label: "Residents",
    icon: Users,
    help: "Click a resident to see their details and valid ID.",
  },
  {
    key: "documents",
    label: "Document Requests",
    icon: FileText,
    help: "Pick a resident on the left, then change the request status on the right.",
  },
  {
    key: "fees",
    label: "Document Fees",
    icon: CircleDollarSign,
    help: "Type the new price and click Save. Residents see it right away.",
  },
  {
    key: "reports",
    label: "Incident Reports",
    icon: Siren,
    help: "Review each report and update its status. Schedule meetings when requested.",
  },
  {
    key: "concerns",
    label: "Help Desk",
    icon: MessagesSquare,
    help: "Pick a conversation on the left, read it, then type your reply.",
  },
  {
    key: "announcements",
    label: "Announcements",
    icon: Megaphone,
    help: "Fill in the form, check the preview, then publish to all residents.",
  },
];

const FINISHED_DOCUMENTS = ["claimed", "rejected"];
const FINISHED_CASES = ["resolved", "rejected", "closed"];
const DAY = 24 * 60 * 60 * 1000;

const emptyData = {
  residents: [] as Row[],
  documents: [] as Row[],
  documentTypes: [] as Row[],
  reports: [] as Row[],
  concerns: [] as Row[],
  announcements: [] as Row[],
};

const formatDate = (value?: string, withTime = true) =>
  value
    ? new Date(value).toLocaleString("en-PH", {
        month: "short",
        day: "numeric",
        year: "numeric",
        ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
      })
    : "—";

const friendlyError = (message?: string) => {
  const text = String(message || "");
  if (/invalid login credentials/i.test(text))
    return "Wrong email or password. Please try again.";
  if (/failed to fetch|network/i.test(text))
    return "No internet connection. Check your connection and try again.";
  if (/row-level security|permission denied/i.test(text))
    return "This account is not allowed to do that. Ask the system administrator to check the database permissions.";
  return text || "Something went wrong. Please try again.";
};

export default function Home() {
  const [booting, setBooting] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [section, setSection] = useState<Section>("overview");
  const [search, setSearch] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [data, setData] = useState(emptyData);
  const [adminName, setAdminName] = useState("Barangay Administrator");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const loadingRef = useRef(false);

  // -- Small pop-up messages so the operator always sees what happened. ----
  const notify = useCallback(
    (message: string, tone: Toast["tone"] = "success") => {
      const id = Date.now() + Math.random();
      setToasts((current) => [...current.slice(-3), { id, message, tone }]);
      window.setTimeout(
        () => setToasts((current) => current.filter((toast) => toast.id !== id)),
        tone === "error" ? 8000 : 5000,
      );
    },
    [],
  );

  const showError = useCallback(
    (message?: string) => {
      const text = friendlyError(message);
      setError(text);
      notify(text, "error");
    },
    [notify],
  );

  const loadDashboard = useCallback(
    async (silent = false) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      if (!silent) setLoading(true);
      const results = await Promise.all([
        supabase
          .from("profiles")
          .select("*")
          .eq("role", "resident")
          .order("full_name"),
        supabase
          .from("document_requests")
          .select(
            "*, profiles(full_name,address,purok,phone), document_types(name), request_attachments(attachment_type,storage_path)",
          )
          .order("created_at", { ascending: false }),
        supabase.from("document_types").select("*").order("name"),
        supabase
          .from("incident_reports")
          .select("*")
          .order("created_at", { ascending: false }),
        supabase
          .from("concerns")
          .select(
            "*, profiles(full_name,address,purok,phone), concern_messages(*)",
          )
          .order("updated_at", { ascending: false }),
        supabase
          .from("announcements")
          .select("*")
          .order("created_at", { ascending: false }),
      ]);

      const failed = results.find((result) => result.error);
      if (failed?.error && !silent) showError(failed.error.message);
      const residents = results[0].data || [];
      const reports = (results[3].data || []).map((report: Row) => ({
        ...report,
        profiles:
          residents.find((resident: Row) => resident.id === report.resident_id) ||
          null,
        respondent_profile:
          residents.find((resident: Row) => resident.id === report.respondent_id) ||
          null,
      }));

      if (!failed) {
        setData({
          residents,
          documents: results[1].data || [],
          documentTypes: results[2].data || [],
          reports,
          concerns: results[4].data || [],
          announcements: results[5].data || [],
        });
        setLastUpdated(new Date());
      }
      setLoading(false);
      loadingRef.current = false;
    },
    [showError],
  );

  const verifyAdmin = useCallback(
    async (userId: string) => {
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("full_name, role")
        .eq("id", userId)
        .single();

      if (profileError || profile?.role !== "admin") {
        await supabase.auth.signOut();
        setLoggedIn(false);
        setError(
          "This account is not an administrator account. Residents use the SmartBRGY mobile app.",
        );
        return false;
      }

      setAdminName(profile.full_name || "Barangay Administrator");
      setLoggedIn(true);
      await loadDashboard();
      return true;
    },
    [loadDashboard],
  );

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: sessionData }) => {
      if (sessionData.session?.user)
        await verifyAdmin(sessionData.session.user.id);
      setBooting(false);
    });
  }, [verifyAdmin]);

  // -- Live updates: new requests, reports, messages and registrations ----
  // appear by themselves and pop up a message (plus a desktop alert when
  // the operator allowed it).
  useEffect(() => {
    if (!loggedIn) return;

    let reloadTimer: number | undefined;
    const queueReload = () => {
      if (reloadTimer) window.clearTimeout(reloadTimer);
      reloadTimer = window.setTimeout(() => void loadDashboard(true), 400);
    };
    const announce = (message: string) => {
      notify(message, "info");
      if (
        typeof Notification !== "undefined" &&
        Notification.permission === "granted" &&
        document.visibilityState !== "visible"
      ) {
        new Notification("SmartBRGY Admin", { body: message });
      }
    };

    const channel = supabase
      .channel("smartbrgy-admin-live")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "document_requests" },
        () => {
          announce("New document request received.");
          queueReload();
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "incident_reports" },
        () => {
          announce("New incident report received.");
          queueReload();
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "concern_messages" },
        (payload: Row) => {
          if (payload?.new?.sender_role === "resident")
            announce("New Help Desk message from a resident.");
          queueReload();
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "profiles" },
        (payload: Row) => {
          if (payload?.new?.role === "resident")
            announce("A new resident registered.");
          queueReload();
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "document_requests" },
        queueReload,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "incident_reports" },
        queueReload,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "concerns" },
        queueReload,
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "concern_messages" },
        queueReload,
      )
      .subscribe();

    // Backup in case the live connection is paused by the browser.
    const fallback = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadDashboard(true);
    }, 30000);

    return () => {
      if (reloadTimer) window.clearTimeout(reloadTimer);
      window.clearInterval(fallback);
      void supabase.removeChannel(channel);
    };
  }, [loggedIn, loadDashboard, notify]);

  async function handleLogin(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    const { data: authData, error: authError } =
      await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

    if (authError || !authData.user) {
      setError(friendlyError(authError?.message || "Unable to sign in."));
      setLoading(false);
      return;
    }
    await verifyAdmin(authData.user.id);
    setLoading(false);
  }

  async function logout() {
    if (!window.confirm("Sign out of SmartBRGY Admin?")) return;
    await supabase.auth.signOut();
    setLoggedIn(false);
    setData(emptyData);
    setPassword("");
    setSection("overview");
  }

  // Every status change goes through here: confirm (when needed), save,
  // tell the operator it worked, and refresh.
  async function updateStatus(
    table: string,
    id: string,
    option: StatusOption,
  ) {
    if (option.confirm && !window.confirm(option.confirm)) return false;
    let reasonNote: Row = {};
    if (option.askReason) {
      const reason = window.prompt(option.askReason, "");
      if (reason === null) return false; // Cancel
      if (!reason.trim()) {
        showError("Please type a reason so the resident knows what to do.");
        return false;
      }
      reasonNote = { admin_note: reason.trim().slice(0, 500) };
    }
    setLoading(true);
    const { error: updateError } = await supabase
      .from(table)
      .update({
        status: option.value,
        updated_at: new Date().toISOString(),
        ...(option.extra ? option.extra() : {}),
        ...reasonNote,
      })
      .eq("id", id);
    setLoading(false);
    if (updateError) {
      showError(updateError.message);
      return false;
    }
    const residentNotified =
      table !== "document_requests" ||
      ["ready_to_claim", "claimed", "rejected"].includes(option.value);
    notify(
      `Status changed to "${statusLabel(option.value)}".${residentNotified ? " The resident has been notified." : ""}`,
    );
    await loadDashboard(true);
    return true;
  }

  async function updateFee(id: string, fee: number, name: string) {
    if (!Number.isFinite(fee) || fee < 0) {
      showError("Enter a valid amount (0 or more).");
      return false;
    }
    const { error: feeError } = await supabase
      .from("document_types")
      .update({ fee })
      .eq("id", id);
    if (feeError) {
      showError(feeError.message);
      return false;
    }
    notify(`${name} fee saved: ₱${fee.toFixed(2)}.`);
    await loadDashboard(true);
    return true;
  }

  // -- What needs the operator's attention (used by the bell, the sidebar
  // badges and the dashboard). ---------------------------------------------
  const attention = useMemo(() => {
    const newDocuments = data.documents.filter((row) => row.status === "pending");
    const readyToClaim = data.documents.filter(
      (row) => row.status === "ready_to_claim",
    );
    const newReports = data.reports.filter((row) => row.status === "pending");
    const meetings = data.reports.filter(
      (row) =>
        row.request_meeting &&
        !row.scheduled_meeting_date &&
        !FINISHED_CASES.includes(row.status),
    );
    const unreadTickets = data.concerns.filter(
      (row) =>
        !FINISHED_CASES.includes(row.status) &&
        (row.concern_messages || []).some(
          (message: Row) => message.sender_role === "resident" && !message.is_read,
        ),
    );
    const newResidents = data.residents.filter(
      (row) =>
        row.created_at &&
        Date.now() - new Date(row.created_at).getTime() < 7 * DAY,
    );

    const items: AttentionItem[] = [
      {
        key: "documents",
        section: "documents",
        icon: FileText,
        tone: "amber",
        count: newDocuments.length,
        title: ["New document request", "New document requests"],
        detail: "Waiting for you to start processing.",
      },
      {
        key: "reports",
        section: "reports",
        icon: Siren,
        tone: "red",
        count: newReports.length,
        title: ["New incident report", "New incident reports"],
        detail: "Not yet reviewed.",
      },
      {
        key: "meetings",
        section: "reports",
        icon: CalendarClock,
        tone: "red",
        count: meetings.length,
        title: ["Meeting to schedule", "Meetings to schedule"],
        detail: "Residents asked for a barangay meeting.",
      },
      {
        key: "concerns",
        section: "concerns",
        icon: MessagesSquare,
        tone: "blue",
        count: unreadTickets.length,
        title: ["Conversation with unread messages", "Conversations with unread messages"],
        detail: "Residents are waiting for a reply.",
      },
      {
        key: "claims",
        section: "documents",
        icon: Clock,
        tone: "green",
        count: readyToClaim.length,
        title: ["Document waiting for pickup", "Documents waiting for pickup"],
        detail: "Mark them Claimed once released.",
      },
      {
        key: "residents",
        section: "residents",
        icon: UserPlus,
        tone: "green",
        count: newResidents.length,
        title: ["New resident this week", "New residents this week"],
        detail: "Check their valid ID.",
      },
    ];
    return items.filter((item) => item.count > 0);
  }, [data]);

  const urgentCount = attention
    .filter((item) => ["documents", "reports", "meetings", "concerns"].includes(item.key))
    .reduce((sum, item) => sum + item.count, 0);

  const navBadges: Partial<Record<Section, number>> = {
    documents: attention.find((item) => item.key === "documents")?.count || 0,
    reports:
      (attention.find((item) => item.key === "reports")?.count || 0) +
      (attention.find((item) => item.key === "meetings")?.count || 0),
    concerns: attention.find((item) => item.key === "concerns")?.count || 0,
  };

  const counts = useMemo(
    () => ({
      residents: data.residents.length,
      documents: data.documents.filter(
        (row) => !FINISHED_DOCUMENTS.includes(row.status),
      ).length,
      reports: data.reports.filter((row) => !FINISHED_CASES.includes(row.status))
        .length,
      concerns: data.concerns.filter((row) => !FINISHED_CASES.includes(row.status))
        .length,
    }),
    [data],
  );

  const filterRows = (rows: Row[]) => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) =>
      JSON.stringify(row).toLowerCase().includes(term),
    );
  };

  function goTo(next: Section) {
    setSection(next);
    setSearch("");
    setSidebarOpen(false);
    setBellOpen(false);
    window.scrollTo({ top: 0 });
  }

  if (booting) return <LoadingScreen />;
  if (!loggedIn)
    return (
      <LoginScreen
        email={email}
        password={password}
        setEmail={setEmail}
        setPassword={setPassword}
        onSubmit={handleLogin}
        loading={loading}
        error={error}
      />
    );

  const current = navItems.find((item) => item.key === section)!;

  return (
    <main className="admin-shell">
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark">
            <ShieldCheck size={25} />
          </div>
          <div>
            <strong>SmartBRGY</strong>
            <span>Barangay Tubod Admin</span>
          </div>
          <button
            className="mobile-close"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close menu"
          >
            <X size={22} />
          </button>
        </div>
        <nav>
          {navItems.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              className={section === key ? "active" : ""}
              onClick={() => goTo(key)}
            >
              <Icon size={20} />
              <span>{label}</span>
              {!!navBadges[key] && (
                <b className="nav-badge" title="Needs your action">
                  {navBadges[key]}
                </b>
              )}
            </button>
          ))}
        </nav>
        <div className="admin-card">
          <div className="avatar">{adminName.slice(0, 1).toUpperCase()}</div>
          <div>
            <strong>{adminName}</strong>
            <span>Administrator</span>
          </div>
        </div>
        <button className="logout-button" onClick={logout}>
          <LogOut size={19} /> Sign out
        </button>
      </aside>

      {sidebarOpen && (
        <button
          className="sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close menu"
        />
      )}

      <section className="workspace">
        <header className="topbar">
          <button
            className="menu-button"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
          >
            <Menu />
          </button>
          <div className="topbar-title">
            <h1>{current.label}</h1>
            <p>{current.help}</p>
          </div>
          <div className="top-actions">
            <div className="bell-wrap">
              <button
                className={`icon-button ${urgentCount ? "has-alerts" : ""}`}
                aria-label={`Notifications (${urgentCount} need action)`}
                onClick={() => setBellOpen((open) => !open)}
              >
                {urgentCount ? <BellRing size={21} /> : <Bell size={21} />}
                {urgentCount > 0 && (
                  <b className="bell-count">{urgentCount > 99 ? "99+" : urgentCount}</b>
                )}
              </button>
              {bellOpen && (
                <BellPanel
                  items={attention}
                  onOpen={goTo}
                  onClose={() => setBellOpen(false)}
                />
              )}
            </div>
            <button
              className="refresh-button"
              onClick={() => loadDashboard()}
              disabled={loading}
              title={lastUpdated ? `Last updated ${lastUpdated.toLocaleTimeString("en-PH")}` : ""}
            >
              <RefreshCw size={18} className={loading ? "spin" : ""} />
              <span>Refresh</span>
            </button>
          </div>
        </header>

        <div className="content">
          {error && (
            <div className="alert">
              <MessageSquareWarning size={20} />
              <span>{error}</span>
              <button onClick={() => setError("")} aria-label="Dismiss">
                <X size={18} />
              </button>
            </div>
          )}
          {section !== "overview" && section !== "announcements" && (
            <label className="search-box">
              <Search size={20} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Type a name, purok, or reference number to search…"
              />
              {search && (
                <button onClick={() => setSearch("")} aria-label="Clear search">
                  <X size={18} />
                </button>
              )}
            </label>
          )}

          {section === "overview" && (
            <Overview
              adminName={adminName}
              counts={counts}
              data={data}
              attention={attention}
              onNavigate={goTo}
            />
          )}
          {section === "residents" && (
            <Residents
              rows={filterRows(data.residents)}
              reload={() => loadDashboard(true)}
              showError={showError}
              notify={notify}
            />
          )}
          {section === "documents" && (
            <Documents rows={filterRows(data.documents)} updateStatus={updateStatus} />
          )}
          {section === "fees" && (
            <Fees rows={filterRows(data.documentTypes)} updateFee={updateFee} />
          )}
          {section === "reports" && (
            <IncidentCases
              rows={filterRows(data.reports)}
              residents={data.residents}
              updateStatus={updateStatus}
              reload={() => loadDashboard(true)}
              showError={showError}
              notify={notify}
            />
          )}
          {section === "concerns" && (
            <ConcernInbox
              rows={filterRows(data.concerns)}
              reload={() => loadDashboard(true)}
              showError={showError}
              notify={notify}
              updateStatus={updateStatus}
            />
          )}
          {section === "announcements" && (
            <Announcements
              rows={data.announcements}
              reload={() => loadDashboard(true)}
              showError={showError}
              notify={notify}
            />
          )}
        </div>
      </section>

      <div className="toast-stack" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.tone}`}>
            {toast.tone === "error" ? (
              <MessageSquareWarning size={20} />
            ) : toast.tone === "info" ? (
              <BellRing size={20} />
            ) : (
              <CheckCircle2 size={20} />
            )}
            <span>{toast.message}</span>
            <button
              onClick={() =>
                setToasts((list) => list.filter((item) => item.id !== toast.id))
              }
              aria-label="Dismiss"
            >
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </main>
  );
}

function BellPanel({
  items,
  onOpen,
  onClose,
}: {
  items: AttentionItem[];
  onOpen: (section: Section) => void;
  onClose: () => void;
}) {
  const [permission, setPermission] = useState(
    typeof Notification === "undefined" ? "unsupported" : Notification.permission,
  );
  return (
    <>
      <button className="bell-backdrop" onClick={onClose} aria-label="Close notifications" />
      <section className="bell-panel" role="dialog" aria-label="Notifications">
        <header>
          <strong>Needs your action</strong>
          <button onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        {items.length ? (
          items.map((item) => (
            <button key={item.key} className="bell-item" onClick={() => onOpen(item.section)}>
              <span className={`stat-icon ${item.tone}`}>
                <item.icon size={20} />
              </span>
              <span className="bell-item-copy">
                <strong>
                  {item.count} · {itemTitle(item)}
                </strong>
                <small>{item.detail}</small>
              </span>
              <ChevronRight size={18} />
            </button>
          ))
        ) : (
          <div className="bell-empty">
            <CheckCircle2 size={28} />
            <strong>All caught up</strong>
            <span>New requests, reports and messages will appear here.</span>
          </div>
        )}
        {permission === "default" && (
          <button
            className="secondary-button bell-enable"
            onClick={async () => setPermission(await Notification.requestPermission())}
          >
            <BellRing size={17} /> Also alert me when this tab is in the background
          </button>
        )}
      </section>
    </>
  );
}

function LoginScreen({
  email,
  password,
  setEmail,
  setPassword,
  onSubmit,
  loading,
  error,
}: any) {
  return (
    <main className="login-page">
      <section className="login-brand-panel">
        <div className="login-brand">
          <div className="brand-mark large">
            <ShieldCheck />
          </div>
          <span>SmartBRGY</span>
        </div>
        <div className="login-message">
          <span className="eyebrow">Barangay Tubod, Toledo City</span>
          <h1>Barangay services in one place.</h1>
          <p>
            Process document requests, review incident reports, reply to
            residents, and post announcements.
          </p>
        </div>
        <div className="security-note">
          <ShieldCheck size={22} />
          <div>
            <strong>For authorized barangay staff only</strong>
            <span>Sign in with your administrator email and password.</span>
          </div>
        </div>
      </section>
      <section className="login-form-panel">
        <form className="login-form" onSubmit={onSubmit}>
          <div className="login-mobile-brand">
            <div className="brand-mark">
              <ShieldCheck />
            </div>
            <strong>SmartBRGY</strong>
          </div>
          <span className="eyebrow">Administrator sign in</span>
          <h2>Welcome</h2>
          <p>Enter your administrator email address and password.</p>
          {error && <div className="login-error">{error}</div>}
          <label>
            Email address
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="admin@barangay.gov.ph"
              autoComplete="email"
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your password"
              autoComplete="current-password"
              required
            />
          </label>
          <button className="primary-button login-submit" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
          <small>Residents use the SmartBRGY mobile app, not this website.</small>
        </form>
      </section>
    </main>
  );
}

function LoadingScreen() {
  return (
    <main className="loading-screen">
      <div className="brand-mark large">
        <ShieldCheck />
      </div>
      <strong>Opening SmartBRGY Admin</strong>
      <span>Please wait…</span>
    </main>
  );
}

function Overview({ adminName, counts, data, attention, onNavigate }: any) {
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const stats = [
    ["Registered residents", counts.residents, Users, "green", "residents"],
    ["Open document requests", counts.documents, FileText, "amber", "documents"],
    ["Open incident reports", counts.reports, Siren, "red", "reports"],
    ["Open Help Desk conversations", counts.concerns, MessagesSquare, "blue", "concerns"],
  ];
  return (
    <>
      <div className="welcome-banner">
        <div>
          <span className="eyebrow">
            {new Date().toLocaleDateString("en-PH", {
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </span>
          <h2>
            {greeting}, {String(adminName).split(/\s+/)[0]}!
          </h2>
          <p>
            {attention.length
              ? "Here is what needs your action today."
              : "Everything is up to date. Great work!"}
          </p>
        </div>
        <div className="banner-icon">
          <ShieldCheck />
        </div>
      </div>

      <h2 className="section-title">Needs your action</h2>
      {attention.length ? (
        <div className="attention-grid">
          {attention.map((item: AttentionItem) => (
            <button
              key={item.key}
              className={`attention-card tone-${item.tone}`}
              onClick={() => onNavigate(item.section)}
            >
              <span className={`stat-icon ${item.tone}`}>
                <item.icon />
              </span>
              <span className="attention-copy">
                <strong>{item.count}</strong>
                <span>{itemTitle(item)}</span>
                <small>{item.detail}</small>
              </span>
              <span className="attention-open">
                Open <ChevronRight size={18} />
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="all-clear">
          <CheckCircle2 size={26} />
          <div>
            <strong>Nothing needs your action right now.</strong>
            <span>New requests, reports and messages will appear here automatically.</span>
          </div>
        </div>
      )}

      <h2 className="section-title">Summary</h2>
      <div className="stat-grid">
        {stats.map(([label, value, Icon, color, target]: any) => (
          <button className="stat-card" key={label} onClick={() => onNavigate(target)}>
            <span className={`stat-icon ${color}`}>
              <Icon />
            </span>
            <strong>{value}</strong>
            <span>{label}</span>
            <ChevronRight className="stat-arrow" size={18} />
          </button>
        ))}
      </div>
      <div className="overview-grid">
        <Panel
          title="Latest document requests"
          action="View all"
          onAction={() => onNavigate("documents")}
        >
          {data.documents.slice(0, 5).map((row: Row) => (
            <MiniRow
              key={row.id}
              icon={FileText}
              title={row.profiles?.full_name || "Resident"}
              detail={`${row.document_types?.name || "Document"} · ${formatDate(row.created_at)}`}
              status={row.status}
            />
          ))}
          {!data.documents.length && <EmptyState text="No document requests yet." />}
        </Panel>
        <Panel
          title="Latest incident reports"
          action="View all"
          onAction={() => onNavigate("reports")}
        >
          {data.reports.slice(0, 5).map((row: Row) => (
            <MiniRow
              key={row.id}
              icon={Siren}
              title={row.incident_type || "Incident report"}
              detail={`${row.profiles?.full_name || "Resident"} · ${formatDate(row.created_at)}`}
              status={row.status}
            />
          ))}
          {!data.reports.length && <EmptyState text="No incident reports yet." />}
        </Panel>
        <Panel
          title="Latest Help Desk conversations"
          action="View all"
          onAction={() => onNavigate("concerns")}
        >
          {data.concerns.slice(0, 5).map((row: Row) => (
            <MiniRow
              key={row.id}
              icon={MessagesSquare}
              title={row.profiles?.full_name || "Resident"}
              detail={row.category || row.subject || "Concern"}
              status={row.status}
            />
          ))}
          {!data.concerns.length && <EmptyState text="No Help Desk conversations yet." />}
        </Panel>
        <Panel
          title="Latest announcements"
          action="View all"
          onAction={() => onNavigate("announcements")}
        >
          {data.announcements.slice(0, 5).map((row: Row) => (
            <MiniRow
              key={row.id}
              icon={Megaphone}
              title={row.title}
              detail={formatDate(row.created_at)}
              status={row.priority || "normal"}
            />
          ))}
          {!data.announcements.length && <EmptyState text="No announcements yet." />}
        </Panel>
      </div>
    </>
  );
}

function Residents({
  rows,
  reload,
  showError,
  notify,
}: {
  rows: Row[];
  reload: () => Promise<void>;
  showError: (value?: string) => void;
  notify: (value: string, tone?: Toast["tone"]) => void;
}) {
  const [selected, setSelected] = useState<Row | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [working, setWorking] = useState(false);
  const [frontUrl, setFrontUrl] = useState("");
  const [backUrl, setBackUrl] = useState("");
  const [loadingIds, setLoadingIds] = useState(false);

  async function openUser(row: Row) {
    setSelected(row);
    setConfirming(false);
    setReason("");
    setFrontUrl("");
    setBackUrl("");
    setLoadingIds(true);

    try {
      const paths = [row.id_front_path, row.id_back_path].filter(Boolean);
      if (!paths.length) return;

      const { data: signedFiles, error } = await supabase.storage
        .from("resident-valid-ids")
        .createSignedUrls(paths, 300);

      if (error) throw error;
      setFrontUrl(
        signedFiles?.find((file: Row) => file.path === row.id_front_path)
          ?.signedUrl || "",
      );
      setBackUrl(
        signedFiles?.find((file: Row) => file.path === row.id_back_path)
          ?.signedUrl || "",
      );
    } catch (idError: any) {
      showError(idError.message || "Unable to open the resident's valid ID.");
    } finally {
      setLoadingIds(false);
    }
  }

  function closeUser() {
    if (working) return;
    setSelected(null);
    setConfirming(false);
    setReason("");
    setFrontUrl("");
    setBackUrl("");
  }

  async function changeAccess(action: "ban" | "unban") {
    if (!selected) return;
    if (action === "ban" && !reason.trim()) {
      showError("Please write the reason before blocking this resident.");
      return;
    }
    if (
      action === "unban" &&
      !window.confirm(`Allow ${selected.full_name || "this resident"} to sign in again?`)
    )
      return;

    setWorking(true);
    const { data: result, error } = await supabase.functions.invoke(
      "manage-resident-access",
      {
        body: {
          residentId: selected.id,
          action,
          reason: action === "ban" ? reason.trim() : null,
        },
      },
    );

    if (error || !result?.success) {
      showError(result?.error || error?.message || "Unable to update this account.");
      setWorking(false);
      return;
    }

    notify(
      action === "ban"
        ? `${selected.full_name || "Resident"} is now blocked from signing in.`
        : `${selected.full_name || "Resident"} can sign in again.`,
    );
    await reload();
    setWorking(false);
    closeUser();
  }

  const isNew = (row: Row) =>
    row.created_at && Date.now() - new Date(row.created_at).getTime() < 7 * DAY;

  return (
    <>
      <Panel
        title={`Registered residents (${rows.length})`}
        subtitle="Click a resident to see their information and valid ID."
      >
        <div className="users-list">
          {rows.map((row) => (
            <button className="user-row" key={row.id} onClick={() => openUser(row)}>
              <span className="user-list-avatar">
                {(row.full_name || "U").slice(0, 1).toUpperCase()}
              </span>
              <span className="user-list-main">
                <strong>
                  {row.full_name || "Unnamed resident"}
                  {isNew(row) && <em className="new-pill">New</em>}
                </strong>
                <span>
                  {[row.purok, row.phone, row.email].filter(Boolean).join(" · ") ||
                    "No contact details"}
                </span>
              </span>
              <Status value={row.is_banned ? "banned" : "active"} />
              <ChevronRight size={20} className="user-row-arrow" />
            </button>
          ))}
        </div>
        {!rows.length && <EmptyState text="No residents found." />}
      </Panel>

      {selected && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeUser();
          }}
        >
          <section className="user-modal" role="dialog" aria-modal="true">
            <header className="user-modal-header">
              <div className="user-modal-heading">
                <span className="user-detail-avatar">
                  <UserRound size={28} />
                </span>
                <div>
                  <span className="eyebrow">Resident information</span>
                  <h2>{selected.full_name || "Unnamed resident"}</h2>
                  <p>{selected.email || "No email address"}</p>
                </div>
              </div>
              <button
                className="modal-close"
                onClick={closeUser}
                disabled={working}
                aria-label="Close"
              >
                <X size={22} />
              </button>
            </header>

            <div className="user-modal-content">
              <div className="user-status-line">
                <span>Account status</span>
                <Status value={selected.is_banned ? "banned" : "active"} />
              </div>

              <div className="user-info-grid">
                <Detail label="Full name" value={selected.full_name} />
                <Detail label="Phone number" value={selected.phone} />
                <Detail label="Birthdate" value={selected.birthdate} />
                <Detail label="Purok / Sitio" value={selected.purok} />
                <Detail label="Address" value={selected.address} />
                <Detail label="Registered on" value={formatDate(selected.created_at)} />
              </div>

              {selected.is_banned && (
                <div className="ban-summary">
                  <strong>Why this account is blocked</strong>
                  <span>{selected.ban_reason || "No reason recorded."}</span>
                  {selected.banned_at && <small>Blocked on {formatDate(selected.banned_at)}</small>}
                </div>
              )}

              <div className="id-section-heading">
                <div>
                  <h3>Valid ID</h3>
                  <p>Click a picture to see it full size.</p>
                </div>
                {loadingIds && <RefreshCw size={20} className="spin" />}
              </div>

              <div className="id-preview-grid">
                <IdPreview label="Front of ID" url={frontUrl} loading={loadingIds} />
                <IdPreview label="Back of ID" url={backUrl} loading={loadingIds} />
              </div>
            </div>

            <footer className="user-modal-footer">
              <button className="secondary-button" onClick={closeUser} disabled={working}>
                Close
              </button>
              {selected.is_banned ? (
                <button
                  className="unban-button"
                  onClick={() => changeAccess("unban")}
                  disabled={working}
                >
                  {working ? "Saving…" : "Allow sign in again"}
                </button>
              ) : (
                <button
                  className="ban-button"
                  onClick={() => setConfirming(true)}
                  disabled={working}
                >
                  <UserX size={18} /> Block this resident
                </button>
              )}
            </footer>
          </section>
        </div>
      )}

      {selected && confirming && (
        <div className="confirm-backdrop">
          <section className="confirm-modal" role="alertdialog" aria-modal="true">
            <span className="confirm-icon">
              <UserX size={30} />
            </span>
            <h2>Block this resident?</h2>
            <p>
              <strong>{selected.full_name || selected.email}</strong> will not be
              able to sign in to the SmartBRGY app until you allow them again.
            </p>
            <label>
              Reason (required)
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Example: Used a fake valid ID"
                maxLength={300}
                autoFocus
              />
            </label>
            <div className="confirm-actions">
              <button
                className="secondary-button"
                onClick={() => {
                  setConfirming(false);
                  setReason("");
                }}
                disabled={working}
              >
                Cancel
              </button>
              <button
                className="ban-button"
                onClick={() => changeAccess("ban")}
                disabled={working || !reason.trim()}
              >
                {working ? "Blocking…" : "Yes, block"}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function Detail({ label, value }: { label: string; value: any }) {
  return (
    <div className="user-detail">
      <span>{label}</span>
      <strong>{value || "—"}</strong>
    </div>
  );
}

function IdPreview({ label, url, loading }: { label: string; url: string; loading: boolean }) {
  return (
    <div className="id-preview-card">
      <div>
        <strong>{label}</strong>
      </div>
      {loading ? (
        <div className="id-placeholder">
          <RefreshCw className="spin" />
          <span>Loading picture…</span>
        </div>
      ) : url ? (
        <a href={url} target="_blank" rel="noreferrer">
          <img src={url} alt={label} />
          <span>Open full size</span>
        </a>
      ) : (
        <div className="id-placeholder">
          <FileText />
          <span>No picture submitted</span>
        </div>
      )}
    </div>
  );
}

// Shows the current status clearly and the buttons to change it.
function StatusPicker({
  table,
  row,
  options,
  updateStatus,
}: {
  table: string;
  row: Row;
  options: StatusOption[];
  updateStatus: (table: string, id: string, option: StatusOption) => Promise<boolean>;
}) {
  const [saving, setSaving] = useState("");
  return (
    <div className="status-picker">
      <span className="status-picker-label">
        Current status: <Status value={row.status} />
      </span>
      <div className="status-picker-buttons">
        <span>Change to:</span>
        {options.map((option) => {
          const current = row.status === option.value;
          return (
            <button
              key={option.value}
              className={`action ${option.tone || ""} ${current ? "current" : ""}`}
              disabled={current || !!saving}
              onClick={async () => {
                setSaving(option.value);
                await updateStatus(table, row.id, option);
                setSaving("");
              }}
            >
              {current ? <Check size={16} /> : null}
              {saving === option.value ? "Saving…" : option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Documents({ rows, updateStatus }: any) {
  const [selectedResident, setSelectedResident] = useState("");

  const residents = useMemo(() => {
    const grouped = new Map<string, Row>();
    rows.forEach((request: Row) => {
      const key = request.resident_id || request.profiles?.id || "unknown";
      const current = grouped.get(key) || {
        id: key,
        profile: request.profiles,
        requests: [],
        activeCount: 0,
        newCount: 0,
      };
      current.requests.push(request);
      if (!FINISHED_DOCUMENTS.includes(request.status)) current.activeCount += 1;
      if (request.status === "pending") current.newCount += 1;
      grouped.set(key, current);
    });

    return Array.from(grouped.values()).sort((a, b) => {
      if (a.newCount !== b.newCount) return b.newCount - a.newCount;
      if (a.activeCount !== b.activeCount) return b.activeCount - a.activeCount;
      return (
        new Date(b.requests[0]?.created_at || 0).getTime() -
        new Date(a.requests[0]?.created_at || 0).getTime()
      );
    });
  }, [rows]);

  useEffect(() => {
    if (!residents.length) {
      setSelectedResident("");
      return;
    }
    if (!residents.some((resident) => resident.id === selectedResident)) {
      setSelectedResident(residents[0].id);
    }
  }, [residents, selectedResident]);

  const selected = residents.find((resident) => resident.id === selectedResident);
  const activeRequests =
    selected?.requests.filter((request: Row) => !FINISHED_DOCUMENTS.includes(request.status)) || [];
  const history =
    selected?.requests.filter((request: Row) => FINISHED_DOCUMENTS.includes(request.status)) || [];

  return (
    <div className="document-resident-layout">
      <Panel
        title={`Step 1 · Choose a resident (${residents.length})`}
        subtitle="Residents with new requests are listed first."
      >
        <div className="document-resident-list">
          {residents.map((resident) => {
            const latest = resident.requests[0];
            return (
              <button
                key={resident.id}
                className={`document-resident-row ${selectedResident === resident.id ? "selected" : ""}`}
                onClick={() => setSelectedResident(resident.id)}
              >
                <span className="document-resident-avatar">
                  {(resident.profile?.full_name || "R").slice(0, 1).toUpperCase()}
                </span>
                <span className="document-resident-copy">
                  <strong>{resident.profile?.full_name || "Unknown resident"}</strong>
                  <small>
                    {resident.requests.length} request
                    {resident.requests.length === 1 ? "" : "s"} · last{" "}
                    {formatDate(latest?.created_at, false)}
                  </small>
                </span>
                {resident.newCount > 0 ? (
                  <span className="active-request-notice">
                    <span className="notification-dot" />
                    {resident.newCount} new
                  </span>
                ) : resident.activeCount > 0 ? (
                  <span className="open-request-notice">{resident.activeCount} open</span>
                ) : null}
                <ChevronRight size={18} />
              </button>
            );
          })}
          {!residents.length && <EmptyState text="No document requests yet." />}
        </div>
      </Panel>

      <Panel
        title={
          selected
            ? `Step 2 · Requests of ${selected.profile?.full_name || "resident"}`
            : "Step 2 · Requests"
        }
        subtitle={
          selected
            ? `${[selected.profile?.purok, selected.profile?.address].filter(Boolean).join(", ") || "No address"}${selected.profile?.phone ? ` · ${selected.profile.phone}` : ""}`
            : "Choose a resident on the left."
        }
      >
        {selected && (
          <>
            <RequestGroup
              title={`Open requests (${activeRequests.length})`}
              rows={activeRequests}
              updateStatus={updateStatus}
              active
            />
            <RequestGroup
              title={`Finished (${history.length})`}
              rows={history}
              updateStatus={updateStatus}
            />
          </>
        )}
        {!selected && <EmptyState text="Choose a resident on the left." />}
      </Panel>
    </div>
  );
}

function RequestGroup({ title, rows, updateStatus, active = false }: any) {
  return (
    <section className="resident-request-group">
      <div className="resident-request-group-title">
        <h3>{title}</h3>
        <span>{active ? "Update the status as you work on each one." : "Claimed and rejected requests."}</span>
      </div>
      <div className="record-list">
        {rows.map((row: Row) => (
          <article
            className={`record resident-request-card ${active ? "" : "request-history-card"}`}
            key={row.id}
          >
            <div className="record-heading">
              <div>
                <h3>{row.document_types?.name || "Document request"}</h3>
                <p>Requested {formatDate(row.created_at)}</p>
              </div>
              <Status value={row.status} />
            </div>
            <div className="document-info-grid">
              <Info label="Purpose" value={row.purpose} />
              <Info label="Copies" value={row.copies} />
              <Info
                label="Amount to collect"
                value={`₱${(Number(row.fee_per_copy || 0) * Number(row.copies || 1)).toFixed(2)}`}
              />
              <Info
                label="Who will claim"
                value={
                  ["representative", "other_person"].includes(row.claim_method)
                    ? "Authorized representative"
                    : "The resident"
                }
              />
            </div>
            <Info label="Reason / note sent to resident" value={row.admin_note} />
            <RequestAttachments
              claimMethod={row.claim_method}
              attachments={row.request_attachments || []}
            />
            {active && (
              <StatusPicker
                table="document_requests"
                row={row}
                options={DOCUMENT_STATUSES}
                updateStatus={updateStatus}
              />
            )}
          </article>
        ))}
      </div>
      {!rows.length && (
        <div className="request-group-empty">
          {active ? "No open requests." : "No finished requests yet."}
        </div>
      )}
    </section>
  );
}

function RequestAttachments({
  claimMethod,
  attachments,
}: {
  claimMethod?: string;
  attachments: Row[];
}) {
  const [files, setFiles] = useState<Row[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [attachmentError, setAttachmentError] = useState("");
  const isRepresentative = ["representative", "other_person"].includes(claimMethod || "");
  const pathKey = attachments.map((item) => item.storage_path).join("|");

  useEffect(() => {
    let active = true;

    async function loadFiles() {
      if (!isRepresentative || !attachments.length) {
        setFiles([]);
        return;
      }

      setLoadingFiles(true);
      setAttachmentError("");
      const paths = attachments.map((item) => item.storage_path).filter(Boolean);
      const { data, error } = await supabase.storage
        .from("request-attachments")
        .createSignedUrls(paths, 300);

      if (!active) return;

      if (error) {
        setAttachmentError(error.message);
        setFiles([]);
      } else {
        setFiles(
          attachments.map((attachment) => ({
            ...attachment,
            signed_url:
              data?.find((file: Row) => file.path === attachment.storage_path)?.signedUrl || "",
          })),
        );
      }
      setLoadingFiles(false);
    }

    loadFiles();
    return () => {
      active = false;
    };
    // pathKey keeps this from reloading on every live refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRepresentative, pathKey]);

  if (!isRepresentative) {
    return (
      <div className="self-claim-note">
        <ShieldCheck size={18} />
        <span>The resident will claim in person. Ask for their original valid ID.</span>
      </div>
    );
  }

  return (
    <div className="request-attachment-section">
      <div className="request-attachment-heading">
        <div>
          <strong>Representative's documents</strong>
          <span>Check these before releasing the document.</span>
        </div>
        {loadingFiles && <RefreshCw size={18} className="spin" />}
      </div>

      {attachmentError && (
        <div className="attachment-warning">Unable to load pictures: {attachmentError}</div>
      )}

      {!loadingFiles && !attachmentError && !files.length && (
        <div className="attachment-warning">
          No valid ID or authorization letter was attached.
        </div>
      )}

      <div className="request-attachment-grid">
        {files.map((file) => (
          <a
            className="request-attachment-card"
            key={`${file.attachment_type}-${file.storage_path}`}
            href={file.signed_url || undefined}
            target="_blank"
            rel="noreferrer"
          >
            {file.signed_url ? (
              <img
                src={file.signed_url}
                alt={file.attachment_type === "valid_id" ? "Representative valid ID" : "Authorization letter"}
              />
            ) : (
              <FileText size={30} />
            )}
            <span>
              {file.attachment_type === "valid_id" ? "Representative's valid ID" : "Authorization letter"}
            </span>
            <small>{file.signed_url ? "Open full size" : "Picture unavailable"}</small>
          </a>
        ))}
      </div>
    </div>
  );
}

function Fees({ rows, updateFee }: any) {
  return (
    <Panel
      title="Document prices"
      subtitle="Change a price, then click Save. The new price shows in the resident app right away."
    >
      <div className="fee-list">
        {rows.map((row: Row) => (
          <FeeRow key={row.id} row={row} updateFee={updateFee} />
        ))}
      </div>
      {!rows.length && <EmptyState text="No document types found." />}
    </Panel>
  );
}

function FeeRow({ row, updateFee }: any) {
  const [fee, setFee] = useState(String(row.fee));
  const [saving, setSaving] = useState(false);
  useEffect(() => setFee(String(row.fee)), [row.fee]);
  const changed = Number(fee) !== Number(row.fee);
  return (
    <div className={`fee-row ${row.is_active === false ? "fee-inactive" : ""}`}>
      <div>
        <strong>
          {row.name}
          {row.is_active === false && <em className="new-pill muted">Hidden from residents</em>}
        </strong>
        <span>{row.requirements || "No requirements listed"}</span>
      </div>
      <label>
        <span>₱</span>
        <input
          type="number"
          min="0"
          step="0.01"
          value={fee}
          onChange={(event) => setFee(event.target.value)}
          aria-label={`Price of ${row.name}`}
        />
      </label>
      <button
        className={changed ? "primary-button" : "secondary-button"}
        disabled={!changed || saving}
        onClick={async () => {
          setSaving(true);
          await updateFee(row.id, Number(fee), row.name);
          setSaving(false);
        }}
      >
        {saving ? "Saving…" : changed ? "Save" : "Saved"}
      </button>
    </div>
  );
}

function IncidentCases({ rows, residents, updateStatus, reload, showError, notify }: any) {
  const [filter, setFilter] = useState<"open" | "meetings" | "all">("open");
  const shown = rows.filter((row: Row) =>
    filter === "all"
      ? true
      : filter === "meetings"
        ? row.request_meeting && !row.scheduled_meeting_date && !FINISHED_CASES.includes(row.status)
        : !FINISHED_CASES.includes(row.status),
  );
  return (
    <Panel
      title={`Incident reports (${shown.length})`}
      subtitle="The newest reports are at the top. Red border = high urgency."
    >
      <div className="filter-tabs">
        {[
          ["open", "Open reports"],
          ["meetings", "Meetings to schedule"],
          ["all", "All reports"],
        ].map(([key, label]) => (
          <button
            key={key}
            className={filter === key ? "active" : ""}
            onClick={() => setFilter(key as any)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="record-list">
        {shown.map((row: Row) => (
          <IncidentCase
            key={row.id}
            row={row}
            residents={residents}
            updateStatus={updateStatus}
            reload={reload}
            showError={showError}
            notify={notify}
          />
        ))}
      </div>
      {!shown.length && (
        <EmptyState
          text={filter === "all" ? "No incident reports yet." : "Nothing here. All reports are handled."}
        />
      )}
    </Panel>
  );
}

function IncidentCase({ row, residents, updateStatus, reload, showError, notify }: any) {
  const [respondentId, setRespondentId] = useState(row.respondent_id || "");
  const [date, setDate] = useState(row.scheduled_meeting_date || row.preferred_meeting_date || "");
  const [time, setTime] = useState(
    row.scheduled_meeting_time?.slice(0, 5) || row.preferred_meeting_time?.slice(0, 5) || "",
  );
  const [venue, setVenue] = useState(row.meeting_venue || "Barangay Tubod Hall");
  const [official, setOfficial] = useState(row.assigned_official || "");
  const [saving, setSaving] = useState(false);

  // Keep the form in step with the latest saved schedule (live updates).
  useEffect(() => {
    setRespondentId(row.respondent_id || "");
    setDate(row.scheduled_meeting_date || row.preferred_meeting_date || "");
    setTime(row.scheduled_meeting_time?.slice(0, 5) || row.preferred_meeting_time?.slice(0, 5) || "");
    setVenue(row.meeting_venue || "Barangay Tubod Hall");
    setOfficial(row.assigned_official || "");
  }, [
    row.respondent_id,
    row.scheduled_meeting_date,
    row.scheduled_meeting_time,
    row.preferred_meeting_date,
    row.preferred_meeting_time,
    row.meeting_venue,
    row.assigned_official,
  ]);

  async function confirmMeeting() {
    if (!respondentId || !date || !time || !venue.trim())
      return showError(
        "Choose the person to be called, and fill in the date, time and venue.",
      );
    const respondent = residents.find((person: Row) => person.id === respondentId);
    if (
      !window.confirm(
        `Send a meeting notice to ${respondent?.full_name || "this resident"} for ${date} at ${time}, ${venue.trim()}?`,
      )
    )
      return;
    setSaving(true);
    const { error } = await supabase
      .from("incident_reports")
      .update({
        respondent_id: respondentId,
        scheduled_meeting_date: date,
        scheduled_meeting_time: time,
        meeting_venue: venue.trim(),
        assigned_official: official.trim() || null,
        status: "scheduled",
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    if (error) showError(error.message);
    else {
      notify("Meeting scheduled. The reporter and the person called have been notified.");
      await reload();
    }
    setSaving(false);
  }

  return (
    <article className={`record incident-admin-card urgency-${row.urgency || "medium"}`}>
      <div className="record-heading">
        <div>
          <h3>{row.incident_type || "Incident report"}</h3>
          <p>
            {row.reference_number || "No reference"} · Reported by{" "}
            {row.profiles?.full_name || "Resident"} · {formatDate(row.created_at)}
          </p>
        </div>
        <Status value={row.status} />
      </div>
      <div className="document-info-grid">
        <Info label="Urgency" value={row.urgency ? String(row.urgency).toUpperCase() : ""} />
        <Info
          label="When it happened"
          value={[row.incident_date, row.incident_time?.slice(0, 5)].filter(Boolean).join(" · ")}
        />
        <Info label="Where" value={row.location} />
        <Info label="Persons involved" value={row.persons_involved} />
        <Info label="Reporter's phone" value={row.profiles?.phone} />
      </div>
      <Info label="What happened" value={row.details} />
      <Info label="Reason / note sent to resident" value={row.admin_note} />
      <IncidentEvidence path={row.photo_path} />
      {row.request_meeting && (
        <section className="meeting-admin-box">
          <div className="meeting-admin-heading">
            <div>
              <strong>The reporter asked for a barangay meeting</strong>
              <span>Find the person in the list, set the schedule, then send the notice.</span>
            </div>
            <Status value={row.scheduled_meeting_date ? "scheduled" : "for_scheduling"} />
          </div>
          <div className="document-info-grid">
            <Info label="Person to call" value={row.respondent_name} />
            <Info label="Their address" value={row.respondent_address} />
            <Info label="Reason" value={row.meeting_reason} />
            <Info
              label="Reporter's preferred schedule"
              value={[row.preferred_meeting_date, row.preferred_meeting_time?.slice(0, 5)]
                .filter(Boolean)
                .join(" · ")}
            />
          </div>
          <div className="meeting-schedule-form">
            <label>
              Person to call (registered resident) *
              <select value={respondentId} onChange={(e) => setRespondentId(e.target.value)}>
                <option value="">— Choose a resident —</option>
                {residents
                  .filter((person: Row) => person.id !== row.resident_id)
                  .map((person: Row) => (
                    <option key={person.id} value={person.id}>
                      {person.full_name} — {[person.purok, person.address].filter(Boolean).join(", ")}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Meeting date *
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label>
              Meeting time *
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </label>
            <label>
              Venue *
              <input value={venue} onChange={(e) => setVenue(e.target.value)} />
            </label>
            <label>
              Barangay official in charge
              <input
                value={official}
                onChange={(e) => setOfficial(e.target.value)}
                placeholder="Example: Kagawad Juan Dela Cruz"
              />
            </label>
          </div>
          <button className="primary-button issue-notice-button" onClick={confirmMeeting} disabled={saving}>
            <CalendarClock size={18} />
            {saving
              ? "Sending notice…"
              : row.scheduled_meeting_date
                ? "Update schedule and notify again"
                : "Save schedule and send notice"}
          </button>
        </section>
      )}
      <StatusPicker
        table="incident_reports"
        row={row}
        options={INCIDENT_STATUSES}
        updateStatus={updateStatus}
      />
    </article>
  );
}

function IncidentEvidence({ path }: { path?: string }) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState("");
  useEffect(() => {
    let active = true;
    async function loadEvidence() {
      if (!path) return;
      setLoading(true);
      setFailed("");
      const { data, error } = await supabase.storage.from("incident-photos").createSignedUrl(path, 600);
      if (!active) return;
      if (error) setFailed(error.message);
      else setUrl(data?.signedUrl || "");
      setLoading(false);
    }
    loadEvidence();
    return () => {
      active = false;
    };
  }, [path]);
  if (!path)
    return (
      <div className="incident-evidence-empty">
        <FileText size={18} />
        <span>No photo was attached.</span>
      </div>
    );
  return (
    <section className="incident-evidence">
      <div className="incident-evidence-heading">
        <div>
          <strong>Photo from the resident</strong>
          <span>Click the photo to see it full size.</span>
        </div>
        {loading && <RefreshCw size={18} className="spin" />}
      </div>
      {failed && <div className="attachment-warning">Unable to load the photo: {failed}</div>}
      {url && (
        <a href={url} target="_blank" rel="noreferrer">
          <img src={url} alt="Photo submitted with the incident report" />
          <span>Open full size</span>
        </a>
      )}
    </section>
  );
}

function ConcernInbox({ rows, reload, showError, notify, updateStatus }: any) {
  const [selectedId, setSelectedId] = useState("");
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const messagesRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!rows.length) setSelectedId("");
    else if (!rows.some((row: Row) => row.id === selectedId)) setSelectedId(rows[0].id);
  }, [rows, selectedId]);

  const selected = rows.find((row: Row) => row.id === selectedId);
  const messages = [...(selected?.concern_messages || [])].sort(
    (a: Row, b: Row) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  const closed = selected && ["closed"].includes(selected.status);

  // Opening a conversation marks the resident's messages as read.
  useEffect(() => {
    if (!selectedId) return;
    const hasUnread = (selected?.concern_messages || []).some(
      (message: Row) => message.sender_role === "resident" && !message.is_read,
    );
    if (!hasUnread) return;
    void supabase
      .from("concern_messages")
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq("concern_id", selectedId)
      .eq("sender_role", "resident")
      .eq("is_read", false)
      .then(() => reload());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, messages.length]);

  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight });
  }, [selectedId, messages.length]);

  async function sendReply() {
    if (!selected || !reply.trim() || sending) return;
    setSending(true);
    const { data: authData } = await supabase.auth.getUser();
    const { error } = await supabase.from("concern_messages").insert({
      concern_id: selected.id,
      sender_id: authData.user?.id,
      sender_role: "admin",
      message: reply.trim(),
      is_read: false,
    });
    if (error) showError(error.message);
    else {
      setReply("");
      // The database marks a "New" conversation as "Under review" on the first
      // reply, without sending the resident a second notification.
      notify("Reply sent. The resident has been notified.");
      await reload();
    }
    setSending(false);
  }

  async function removeConversation() {
    if (!selected || deleting) return;
    const residentName = selected.profiles?.full_name || "this resident";
    if (
      !window.confirm(
        `Delete the whole conversation with ${residentName}? This cannot be undone.`,
      )
    )
      return;

    setDeleting(true);
    const { data: deletedTicket, error: concernError } = await supabase
      .from("concerns")
      .delete()
      .eq("id", selected.id)
      .select("id")
      .maybeSingle();
    if (concernError) showError(concernError.message);
    else if (!deletedTicket) {
      showError(
        "The conversation was not deleted. Run migration_010_admin_helpdesk_delete.sql in Supabase to allow this.",
      );
    } else {
      setSelectedId("");
      setReply("");
      notify("Conversation deleted.");
      await reload();
    }
    setDeleting(false);
  }

  return (
    <div className="helpdesk-admin-layout">
      <section className="panel helpdesk-ticket-panel">
        <div className="panel-heading">
          <div>
            <h2>Conversations ({rows.length})</h2>
            <p>A red number means unread messages.</p>
          </div>
        </div>
        <div className="helpdesk-ticket-list">
          {rows.map((ticket: Row) => {
            const unread = (ticket.concern_messages || []).filter(
              (message: Row) => message.sender_role === "resident" && !message.is_read,
            ).length;
            const latest = [...(ticket.concern_messages || [])].sort(
              (a: Row, b: Row) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
            )[0];
            return (
              <button
                key={ticket.id}
                className={`helpdesk-ticket ${selectedId === ticket.id ? "selected" : ""} ${unread ? "unread" : ""}`}
                onClick={() => setSelectedId(ticket.id)}
              >
                <span className="helpdesk-ticket-avatar">
                  {(ticket.profiles?.full_name || "R").slice(0, 1).toUpperCase()}
                </span>
                <span className="helpdesk-ticket-copy">
                  <strong>{ticket.profiles?.full_name || "Resident"}</strong>
                  <small>{ticket.category || ticket.subject}</small>
                  <em>{latest?.message || ticket.details}</em>
                </span>
                <span className="helpdesk-ticket-side">
                  {unread > 0 && <b>{unread}</b>}
                  <Status value={ticket.status} />
                </span>
              </button>
            );
          })}
          {!rows.length && <EmptyState text="No conversations yet." />}
        </div>
      </section>
      <section className="panel helpdesk-conversation-panel">
        {selected ? (
          <>
            <header className="helpdesk-conversation-header">
              <div>
                <span>{selected.ticket_number || "HELP DESK"}</span>
                <h2>{selected.category || selected.subject}</h2>
                <p>
                  {selected.profiles?.full_name}
                  {selected.profiles?.phone ? ` · ${selected.profiles.phone}` : ""}
                </p>
              </div>
              <div className="actions">
                <button className="action danger-outline" onClick={removeConversation} disabled={deleting}>
                  <Trash2 size={16} />
                  {deleting ? "Deleting…" : "Delete"}
                </button>
              </div>
            </header>
            <div className="helpdesk-resident-summary">
              <Info
                label="Resident's address"
                value={[selected.profiles?.purok, selected.profiles?.address].filter(Boolean).join(", ")}
              />
              <Info label="Location of concern" value={[selected.area, selected.landmark].filter(Boolean).join(", ")} />
            </div>
            <div className="helpdesk-messages" ref={messagesRef}>
              <div className="helpdesk-system-message">
                Conversation started {formatDate(selected.created_at)}
              </div>
              {messages.map((message: Row) => (
                <div key={message.id} className={`helpdesk-message ${message.sender_role}`}>
                  <span>
                    {message.sender_role === "admin"
                      ? "Barangay (you)"
                      : message.sender_role === "system"
                        ? "System"
                        : selected.profiles?.full_name}
                  </span>
                  <p>{message.message}</p>
                  <small>{formatDate(message.created_at)}</small>
                </div>
              ))}
            </div>
            <div className="helpdesk-reply">
              <label htmlFor="helpdesk-reply-box">Your reply to the resident</label>
              <textarea
                id="helpdesk-reply-box"
                value={reply}
                onChange={(event) => setReply(event.target.value)}
                placeholder={closed ? "This conversation is closed." : "Type your reply here…"}
                maxLength={2000}
                disabled={closed}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) void sendReply();
                }}
              />
              <button className="primary-button" onClick={sendReply} disabled={!reply.trim() || sending || closed}>
                <MessagesSquare size={18} />
                {sending ? "Sending…" : "Send reply"}
              </button>
            </div>
            <StatusPicker table="concerns" row={selected} options={CONCERN_STATUSES} updateStatus={updateStatus} />
          </>
        ) : (
          <EmptyState text="Choose a conversation on the left." />
        )}
      </section>
    </div>
  );
}

function Announcements({ rows, reload, showError, notify }: any) {
  const initial = {
    title: "",
    announcement_type: "General",
    priority: "normal",
    message: "",
    target_audience: "All Barangay Tubod residents",
    event_date: "",
    event_time: "",
    end_time: "",
    location: "",
    purpose: "",
    contact_person: "",
    contact_number: "",
  };
  const [form, setForm] = useState(initial);
  const [posting, setPosting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const field = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const missing = [
    !form.title.trim() && "Title",
    !form.message.trim() && "What",
    !form.target_audience.trim() && "Who",
    !form.purpose.trim() && "Why",
    form.event_time && !form.event_date && "date (a time was entered)",
  ].filter(Boolean) as string[];
  const complete = missing.length === 0;

  function review(event: FormEvent) {
    event.preventDefault();
    if (complete) setPreviewing(true);
  }
  async function post() {
    if (!complete) return;
    setPosting(true);
    const { data: authData } = await supabase.auth.getUser();
    const { error } = await supabase.from("announcements").insert({
      ...form,
      title: form.title.trim(),
      event_date: form.event_date || null,
      event_time: form.event_time || null,
      end_time: form.end_time || null,
      location: form.location.trim() || null,
      contact_person: form.contact_person || null,
      contact_number: form.contact_number || null,
      created_by: authData.user?.id,
      allow_attendance_confirmation: Boolean(form.event_date),
    });
    if (error) showError(error.message);
    else {
      setForm(initial);
      setPreviewing(false);
      notify("Announcement published. All residents have been notified.");
      await reload();
    }
    setPosting(false);
  }
  async function remove(row: Row) {
    if (!window.confirm(`Delete the announcement "${row.title}"? Residents will no longer see it.`)) return;
    const { error } = await supabase.from("announcements").delete().eq("id", row.id);
    if (error) showError(error.message);
    else {
      notify("Announcement deleted.");
      await reload();
    }
  }

  return (
    <>
      <div className="announcement-layout">
        <Panel title="Write a new announcement" subtitle="Fields with * are required. Answer the 5 W's so residents understand quickly.">
          <form className="announcement-form" onSubmit={review}>
            <label>
              Title *
              <input
                value={form.title}
                onChange={(e) => field("title", e.target.value)}
                placeholder="Example: Community Clean-up Drive"
              />
            </label>
            <div className="form-row">
              <label>
                Category
                <select value={form.announcement_type} onChange={(e) => field("announcement_type", e.target.value)}>
                  <option>General</option>
                  <option>Emergency</option>
                  <option>Advisory</option>
                  <option>Event</option>
                  <option>Health</option>
                  <option>Community</option>
                </select>
              </label>
              <label>
                How important?
                <select value={form.priority} onChange={(e) => field("priority", e.target.value)}>
                  <option value="normal">Normal</option>
                  <option value="important">Important</option>
                  <option value="emergency">Emergency (shown at the top)</option>
                </select>
              </label>
            </div>
            <div className="five-w-field">
              <span>WHAT *</span>
              <label>
                What is the announcement?
                <textarea
                  value={form.message}
                  onChange={(e) => field("message", e.target.value)}
                  placeholder="Explain what will happen and what residents should do."
                />
              </label>
            </div>
            <div className="five-w-field">
              <span>WHO *</span>
              <label>
                Who is it for?
                <input
                  value={form.target_audience}
                  onChange={(e) => field("target_audience", e.target.value)}
                  placeholder="All residents, senior citizens, youth…"
                />
              </label>
            </div>
            <div className="five-w-field">
              <span>WHEN</span>
              <p className="field-hint">Leave empty if this is a notice without a schedule.</p>
              <div className="form-row three">
                <label>
                  Date
                  <input type="date" value={form.event_date} onChange={(e) => field("event_date", e.target.value)} />
                </label>
                <label>
                  Start time
                  <input type="time" value={form.event_time} onChange={(e) => field("event_time", e.target.value)} />
                </label>
                <label>
                  End time
                  <input type="time" value={form.end_time} onChange={(e) => field("end_time", e.target.value)} />
                </label>
              </div>
            </div>
            <div className="five-w-field">
              <span>WHERE</span>
              <label>
                Place (if any)
                <input
                  value={form.location}
                  onChange={(e) => field("location", e.target.value)}
                  placeholder="Example: Barangay Tubod Covered Court"
                />
              </label>
            </div>
            <div className="five-w-field">
              <span>WHY *</span>
              <label>
                Why is this being done?
                <textarea
                  value={form.purpose}
                  onChange={(e) => field("purpose", e.target.value)}
                  placeholder="State the goal or reason."
                />
              </label>
            </div>
            <div className="form-row">
              <label>
                Contact person
                <input value={form.contact_person} onChange={(e) => field("contact_person", e.target.value)} />
              </label>
              <label>
                Contact number
                <input value={form.contact_number} onChange={(e) => field("contact_number", e.target.value)} />
              </label>
            </div>
            {!complete && (
              <p className="form-missing">
                <InfoIcon size={17} /> Still needed: {missing.join(", ")}.
              </p>
            )}
            <button className="primary-button" disabled={!complete}>
              <Megaphone size={19} />
              Preview before publishing
            </button>
          </form>
        </Panel>
        <Panel title={`Published announcements (${rows.length})`} subtitle="Newest first.">
          <div className="record-list">
            {rows.map((row: Row) => (
              <Record
                key={row.id}
                title={row.title}
                status={row.priority || "normal"}
                meta={`Posted ${formatDate(row.created_at)}`}
              >
                <div className="published-five-w">
                  <Info label="What" value={row.message} />
                  <Info label="Who" value={row.target_audience} />
                  <Info
                    label="When"
                    value={[row.event_date, [row.event_time?.slice(0, 5), row.end_time?.slice(0, 5)].filter(Boolean).join("–")]
                      .filter(Boolean)
                      .join(" · ")}
                  />
                  <Info label="Where" value={row.location} />
                  <Info label="Why" value={row.purpose} />
                </div>
                <div className="actions">
                  <button className="action danger-outline" onClick={() => remove(row)}>
                    <Trash2 size={16} /> Delete
                  </button>
                </div>
              </Record>
            ))}
          </div>
          {!rows.length && <EmptyState text="No announcements yet." />}
        </Panel>
      </div>
      {previewing && (
        <div
          className="confirm-backdrop"
          onMouseDown={(e) => {
            if (e.currentTarget === e.target) setPreviewing(false);
          }}
        >
          <section className="announcement-preview" role="dialog" aria-modal="true">
            <div className="preview-header">
              <div>
                <span>CHECK BEFORE PUBLISHING</span>
                <h2>{form.title}</h2>
              </div>
              <button onClick={() => setPreviewing(false)} aria-label="Close preview">
                <X size={22} />
              </button>
            </div>
            <div className="preview-tags">
              <Status value={form.announcement_type} />
              <Status value={form.priority} />
            </div>
            <div className="preview-five-w">
              <Detail label="WHAT" value={form.message} />
              <Detail label="WHO" value={form.target_audience} />
              <Detail
                label="WHEN"
                value={
                  form.event_date
                    ? `${form.event_date}${form.event_time ? ` · ${form.event_time}` : ""}${form.end_time ? `–${form.end_time}` : ""}`
                    : "No schedule"
                }
              />
              <Detail label="WHERE" value={form.location || "—"} />
              <Detail label="WHY" value={form.purpose} />
            </div>
            {form.contact_person && (
              <p className="preview-contact">
                Contact: {form.contact_person}
                {form.contact_number ? ` · ${form.contact_number}` : ""}
              </p>
            )}
            <p className="preview-note">All residents will get a notification on their phone.</p>
            <div className="confirm-actions">
              <button className="secondary-button" onClick={() => setPreviewing(false)} disabled={posting}>
                Go back and edit
              </button>
              <button className="primary-button" onClick={post} disabled={posting}>
                {posting ? "Publishing…" : "Publish now"}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function Panel({
  title,
  subtitle,
  action,
  onAction,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: string;
  onAction?: () => void;
  children?: ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action && (
          <button onClick={onAction}>
            {action}
            <ChevronRight size={17} />
          </button>
        )}
      </div>
      {children}
    </section>
  );
}
function Record({ title, status, meta, children }: any) {
  return (
    <article className="record">
      <div className="record-heading">
        <div>
          <h3>{title}</h3>
          {meta && <p>{meta}</p>}
        </div>
        <Status value={status} />
      </div>
      {children}
    </article>
  );
}
function MiniRow({ icon: Icon = FileText, title, detail, status }: any) {
  return (
    <div className="mini-row">
      <div className="mini-icon">
        <Icon size={19} />
      </div>
      <div>
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
      <Status value={status} />
    </div>
  );
}
function Info({ label, value }: any) {
  return value ? (
    <p className="info">
      <strong>{label}:</strong> {String(value)}
    </p>
  ) : null;
}
function Status({ value }: { value: string }) {
  return <span className={`status status-${value}`}>{statusLabel(value)}</span>;
}
function EmptyState({ text = "New activity will appear here." }: { text?: string }) {
  return (
    <div className="empty-state">
      <FileText size={28} />
      <strong>Nothing to show</strong>
      <span>{text}</span>
    </div>
  );
}
