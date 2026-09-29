export const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/prospects", label: "Prospects", icon: "prospects" },
  { href: "/companies", label: "Companies", icon: "companies" },
  { href: "/campaigns", label: "Campaigns", icon: "campaigns" },
  { href: "/inbox", label: "Inbox", icon: "inbox" },
  { href: "/rfqs", label: "RFQs", icon: "rfqs" },
  { href: "/products", label: "Products", icon: "products" },
  { href: "/suppliers", label: "Suppliers", icon: "suppliers" },
  { href: "/pipeline", label: "Pipeline", icon: "pipeline" },
  { href: "/templates", label: "Templates", icon: "templates" },
  { href: "/tasks", label: "Tasks", icon: "tasks" },
  { href: "/analytics", label: "Analytics", icon: "analytics" },
  { href: "/settings", label: "Settings", icon: "settings" },
] as const;

export type NavIcon = (typeof NAV_ITEMS)[number]["icon"];
